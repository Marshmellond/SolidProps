"""Bounded local-only SQLite storage. No CAD imports or model identity persistence."""
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_PAYLOAD = 4 * 1024 * 1024
PUBLIC_METHODS = {'draft.save', 'draft.load', 'draft.delete'}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def fields(value, required=(), optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise ValueError('Invalid storage fields')


def text(value, maximum=65536, empty=True):
    if not isinstance(value, str) or len(value) > maximum or '\x00' in value or (not empty and not value):
        raise ValueError('Invalid storage string')
    return value


def key(params):
    return (text(params['cadId'], 128, False), text(params['rootPath'], 32768, False), text(params['scope'], 256, False))


def changes(value, draft=False):
    if not isinstance(value, list) or len(value) > 1000:
        raise ValueError('Expected at most 1000 changes')
    result = []
    for item in value:
        required = ('modelPath', 'propertyName', 'oldValue', 'newValue')
        optional = ('operation',) if draft else ('operation', 'modelName', 'success', 'message', 'saved')
        fields(item, required, optional)
        clean = {name: text(item[name]) for name in required}
        clean['operation'] = item.get('operation', 'update')
        if clean['operation'] not in ('update', 'add', 'delete'):
            raise ValueError('Invalid operation')
        if not draft:
            clean.update(modelName=text(item.get('modelName', '')), message=text(item.get('message', '')))
            for name in ('success', 'saved'):
                val = item.get(name)
                if val is not None and type(val) is not bool:
                    raise ValueError('Invalid outcome')
                clean[name] = val
        result.append(clean)
    return result


class Storage:
    def __init__(self, path):
        target = Path(path)
        if not target.is_absolute() or str(target).startswith(('\\\\', '//')):
            raise ValueError('Storage must be an absolute local path')
        target.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(target, timeout=1.0)
        self.db.execute('PRAGMA busy_timeout=1000')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS drafts (
                cad_id TEXT NOT NULL, root_path TEXT NOT NULL, scope TEXT NOT NULL,
                id TEXT NOT NULL, saved_at TEXT NOT NULL, entries TEXT NOT NULL,
                PRIMARY KEY(cad_id, root_path, scope));
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY, time TEXT NOT NULL, record TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS history_time ON history(time DESC);
        ''')
        self.db.commit()

    def close(self):
        self.db.close()

    def dispatch(self, method, params):
        if method not in PUBLIC_METHODS | {'audit.begin', 'audit.finish'}:
            raise ValueError('Unknown storage method')
        if len(json.dumps(params, ensure_ascii=False).encode('utf-8')) > MAX_PAYLOAD:
            raise ValueError('Storage payload exceeds limit')
        if method.startswith('draft.'):
            fields(params, ('cadId', 'rootPath', 'scope'), ('entries',) if method == 'draft.save' else ())
            identity = key(params)
            if method == 'draft.save':
                if 'entries' not in params:
                    raise ValueError('Missing entries')
                entries = changes(params['entries'], draft=True)
                existing = self.db.execute('SELECT id FROM drafts WHERE cad_id=? AND root_path=? AND scope=?', identity).fetchone()
                record_id, stamp = existing[0] if existing else str(uuid.uuid4()), now()
                with self.db:
                    self.db.execute('INSERT OR REPLACE INTO drafts VALUES (?,?,?,?,?,?)', (*identity, record_id, stamp, json.dumps(entries, ensure_ascii=False)))
                return dict(id=record_id, savedAt=stamp)
            if method == 'draft.delete':
                with self.db:
                    cursor = self.db.execute('DELETE FROM drafts WHERE cad_id=? AND root_path=? AND scope=?', identity)
                return dict(deleted=cursor.rowcount > 0)
            row = self.db.execute('SELECT id,saved_at,entries FROM drafts WHERE cad_id=? AND root_path=? AND scope=?', identity).fetchone()
            return dict(id=row[0], savedAt=row[1], cadId=identity[0], rootPath=identity[1], scope=identity[2], entries=json.loads(row[2])) if row else None
        if method == 'audit.finish':
            fields(params, ('id', 'status', 'detail', 'changes'))
            record_id = text(params['id'], 128, False)
            row = self.db.execute('SELECT record FROM history WHERE id=?', (record_id,)).fetchone()
            if not row:
                raise ValueError('Audit record missing')
            record = json.loads(row[0])
            if record['status'] != 'pending':
                raise ValueError('Audit already finalized')
            if params['status'] not in ('success', 'failure', 'partial', 'unknown'):
                raise ValueError('Invalid audit status')
            record.update(status=params['status'], detail=text(params['detail']), changes=changes(params['changes']))
            record['finishedAt'] = now()
            with self.db:
                self.db.execute('UPDATE history SET record=? WHERE id=?', (json.dumps(record, ensure_ascii=False), record_id))
            return dict(id=record_id, time=record['time'])
        fields(params, ('title', 'detail'), ('changes', 'cadId', 'rootPath', 'scope', 'sessionId'))
        record = dict(id=str(uuid.uuid4()), time=now(), title=text(params['title'], 1024),
                      detail=text(params['detail']), status='pending',
                      changes=changes(params.get('changes', [])))
        for name in ('cadId', 'rootPath', 'scope', 'sessionId'):
            record[name] = text(params.get(name, ''))
        with self.db:
            self.db.execute('INSERT INTO history VALUES (?,?,?)', (record['id'], record['time'], json.dumps(record, ensure_ascii=False)))
        return dict(id=record['id'], time=record['time'])


def run_store():
    """One request per process; DB location comes only from the trusted main env."""
    store = None
    try:
        path = os.environ.get('CADWEAVE_STORE_PATH')
        if not path:
            raise ValueError('Missing trusted storage path')
        line = sys.stdin.buffer.readline(MAX_PAYLOAD + 1)
        if len(line) > MAX_PAYLOAD:
            raise ValueError('Storage request exceeds limit')
        request = json.loads(line.decode('utf-8'))
        fields(request, ('method', 'params'))
        store = Storage(path)
        result = store.dispatch(request['method'], request['params'])
        response = dict(result=result)
    except Exception as exc:
        response = dict(error=str(exc))
    finally:
        if store:
            store.close()
    print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)
