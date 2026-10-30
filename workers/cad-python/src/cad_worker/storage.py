"""Bounded local-only SQLite storage. No CAD imports or model identity persistence."""
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_PAYLOAD = 4 * 1024 * 1024
MAX_EXPORT_PAYLOAD = 16 * 1024 * 1024
MAX_EXPORT_RECORDS = 100000
PUBLIC_METHODS = {'draft.save', 'draft.load', 'draft.delete', 'history.list', 'history.export', 'history.append'}


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


def log_field(label, value, indent='  ', empty='（空）'):
    """Keep user text literal and indent every line, including CRLF values."""
    value = str(value) if value is not None else '未知'
    parts = value.replace('\r\n', '\n').replace('\r', '\n').split('\n') if value else [empty]
    return [f'{indent}{label}：', *(f'{indent}  {line}' for line in parts)]


def history_log_record(record):
    statuses = {'pending': '待确认（保存状态未知）', 'success': '成功', 'failure': '失败',
                'partial': '部分成功', 'unknown': '未知', 'info': '信息'}
    operations = {'update': '修改', 'add': '新增', 'delete': '删除'}
    lines = [f"[{record['time']}] 操作记录"]
    for label, value in (('记录编号', record['id']), ('标题', record['title']),
                         ('状态', statuses.get(record['status'], '未知')),
                         ('说明', record['detail'])):
        lines.extend(log_field(label, value))
    for name, label in (('cadId', 'CAD 软件'), ('rootPath', '根文件'), ('scope', '作用范围'),
                        ('sessionId', '会话编号'), ('finishedAt', '完成时间')):
        lines.extend(log_field(label, record.get(name) or '未知（未记录）'))
    if not record['changes']:
        lines.append('  文件操作：无已记录的属性操作（不代表文件已保存）')
    for index, change in enumerate(record['changes'], 1):
        lines.append(f'  文件操作 {index}：')
        for label, value in (('文件路径', change['modelPath'] or '未知（未记录）'),
                             ('文件名称', change.get('modelName') or '未知（未记录）'),
                             ('操作类型', operations.get(change['operation'], '未知')),
                             ('属性名称', change['propertyName']),
                             ('旧值', change['oldValue']), ('新值', change['newValue'])):
            lines.extend(log_field(label, value, '    '))
        result = {True: '成功', False: '失败', None: '未知（未确认）'}[change.get('success')]
        saved = {True: '已保存', False: '未保存', None: '未知（未确认）'}[change.get('saved')]
        for label, value in (('执行结果', result), ('文件保存', saved), ('结果说明', change.get('message', ''))):
            lines.extend(log_field(label, value, '    '))
    return '\n'.join(lines) + '\n\n'


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
        if method in ('history.list', 'history.export'):
            fields(params, (), ('limit', 'offset', 'all') if method == 'history.export' else ('limit', 'offset'))
            export_all = params.get('all', False)
            if type(export_all) is not bool:
                raise ValueError('all must be boolean')
            limit, offset = params.get('limit', 100), params.get('offset', 0)
            if type(limit) is not int or not 1 <= limit <= 200 or type(offset) is not int or not 0 <= offset <= 1000000:
                raise ValueError('Invalid history pagination')
            records, blocks, size, rendered_size, truncated = [], [], 0, 0, False
            is_export = method == 'history.export'
            row_limit = MAX_EXPORT_RECORDS + 1 if export_all else limit
            budget = MAX_EXPORT_PAYLOAD if export_all else MAX_PAYLOAD
            total = self.db.execute('SELECT COUNT(*) FROM history').fetchone()[0]
            # The UI remains newest first. A full export reads oldest first; a
            # page export selects the UI page first, then reverses only that page.
            order = 'ASC' if export_all else 'DESC'
            query = f'SELECT record FROM history ORDER BY time {order},rowid {order} LIMIT ? OFFSET ?'
            for row in self.db.execute(query, (row_limit, offset)):
                size += len(row[0].encode('utf-8'))
                if size > budget or len(records) >= MAX_EXPORT_RECORDS:
                    truncated = True
                    break
                record = json.loads(row[0])
                if is_export:
                    block = history_log_record(record)
                    rendered_size += len(block.encode('utf-8'))
                    # Reserve room for the bounded summary; do not cut a record
                    # mid-value or claim that omitted records were exported.
                    if rendered_size + 4096 > budget:
                        truncated = True
                        break
                    blocks.append(block)
                records.append(record)
            truncated = truncated or offset > 0 or offset + len(records) < total
            if not is_export:
                return records
            if not export_all:
                blocks.reverse()
            lines = ['CadWeave 本地操作历史', '排列顺序：从旧到新，最新记录位于底部。',
                     '待确认或未知结果不能证明 CAD 文件已保存。',
                     '导出范围：全部历史（从最旧记录起）。' if export_all else '导出范围：按界面从新到旧分页选取，再按从旧到新排列。',
                     f'已导出 {len(records)} / {total} 条记录；跳过 {offset} 条。',
                     '截断 / 部分导出：分页、偏移或资源上限导致部分记录未包含；未包含的记录不会显示。' if truncated else '完整历史导出。',
                     f'资源上限：最多 {MAX_EXPORT_RECORDS} 条记录，源记录及日志各不超过 {budget} 字节；仅导出完整记录。', '']
            return dict(suggestedName='CadWeave-history.log', content='\n'.join(lines) + '\n' + ''.join(blocks),
                        truncated=truncated, count=len(records), total=total)
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
        fields(params, ('title', 'detail'), ('status', 'changes', 'cadId', 'rootPath', 'scope', 'sessionId') if method == 'audit.begin' else ('status', 'changes'))
        status = 'pending' if method == 'audit.begin' else params.get('status', 'info')
        if status not in (('pending',) if method == 'audit.begin' else ('success', 'failure', 'info')):
            raise ValueError('Invalid history status')
        record = dict(id=str(uuid.uuid4()), time=now(), title=text(params['title'], 1024), detail=text(params['detail']), status=status, changes=changes(params.get('changes', [])))
        if method == 'audit.begin':
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
