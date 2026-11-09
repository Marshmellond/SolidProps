"""SQLite-only tests: temp directories, no COM/CAD interaction."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from cad_worker.storage import Storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'local.sqlite3'
        self.store = Storage(self.path)
        self.key = dict(cadId='solidworks', rootPath=r'C:\Models\总装.sldasm', scope='document')
        self.entry = dict(modelPath=r'C:\Models\零件.sldprt', propertyName='材料', oldValue='钢', newValue='铝')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def record(self, record_id):
        row = self.store.db.execute('SELECT record FROM history WHERE id=?', (record_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def test_draft_reopen_atomic_replace_and_delete(self):
        saved = self.store.dispatch('draft.save', dict(**self.key, entries=[self.entry]))
        self.store.close()
        self.store = Storage(self.path)
        loaded = self.store.dispatch('draft.load', self.key)
        self.assertEqual(loaded['id'], saved['id'])
        self.assertEqual(loaded['savedAt'], saved['savedAt'])
        self.assertEqual(loaded['entries'][0]['operation'], 'update')
        self.assertNotIn('modelId', loaded['entries'][0])
        replaced = self.store.dispatch('draft.save', dict(**self.key, entries=[]))
        self.assertEqual(saved['id'], replaced['id'])
        self.assertEqual(self.store.dispatch('draft.load', self.key)['entries'], [])
        self.assertTrue(self.store.dispatch('draft.delete', self.key)['deleted'])
        self.assertIsNone(self.store.dispatch('draft.load', self.key))

    def test_key_isolation_and_operations(self):
        for scope in ('document', 'configuration'):
            self.store.dispatch('draft.save', dict(**{**self.key, 'scope': scope}, entries=[{**self.entry, 'operation': 'add'}]))
        self.store.dispatch('draft.delete', self.key)
        self.assertIsNotNone(self.store.dispatch('draft.load', {**self.key, 'scope': 'configuration'}))
        self.assertIsNone(self.store.dispatch('draft.load', {**self.key, 'cadId': 'other'}))
        self.assertIsNone(self.store.dispatch('draft.load', {**self.key, 'rootPath': 'different'}))

    def test_invalid_draft_cannot_overwrite_saved_state(self):
        self.store.dispatch('draft.save', dict(**self.key, entries=[self.entry]))
        for invalid in ({**self.entry, 'modelId': 'stale'}, {**self.entry, 'operation': 'execute'}, {**self.entry, 'newValue': '\x00'}):
            with self.assertRaises(ValueError):
                self.store.dispatch('draft.save', dict(**self.key, entries=[invalid]))
        self.assertEqual(self.store.dispatch('draft.load', self.key)['entries'][0]['newValue'], '铝')

    def test_pending_survives_reopen_and_finalizes_once(self):
        pending = self.store.dispatch('audit.begin', dict(title='Write', detail='Pending', **self.key, sessionId='session', changes=[self.entry]))
        self.store.close()
        self.store = Storage(self.path)
        self.assertEqual(self.record(pending['id'])['status'], 'pending')
        self.assertIsNone(self.record(pending['id'])['changes'][0]['saved'])
        outcome = {**self.entry, 'modelName': '零件', 'success': False, 'saved': False, 'message': 'Save failed'}
        finish = dict(id=pending['id'], status='failure', detail='Save failed', changes=[outcome])
        self.store.dispatch('audit.finish', finish)
        record = self.record(pending['id'])
        self.assertEqual(record['status'], 'failure')
        self.assertEqual(record['changes'][0]['modelName'], '零件')
        self.assertFalse(record['changes'][0]['saved'])
        with self.assertRaises(ValueError):
            self.store.dispatch('audit.finish', finish)

    def test_history_public_methods_are_gone(self):
        for method in ('history.list', 'history.export', 'history.append', 'sql.execute'):
            with self.assertRaises(ValueError):
                self.store.dispatch(method, {})

    def test_reject_relative_and_network_paths(self):
        for path in ('relative.sqlite3', '//server/share/storage.sqlite3'):
            with self.assertRaises(ValueError):
                Storage(path)

    def test_store_cli_exits_without_cad_imports(self):
        request = json.dumps({'method': 'draft.save', 'params': dict(**self.key, entries=[self.entry])})
        completed = subprocess.run(
            [sys.executable, '-m', 'cad_worker', '--store'], input=request + '\n',
            capture_output=True, text=True, encoding='utf-8', timeout=5,
            env={**os.environ, 'CADWEAVE_STORE_PATH': str(self.path), 'PYTHONUTF8': '1'},
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('id', json.loads(completed.stdout)['result'])
        self.assertEqual(self.store.dispatch('draft.load', self.key)['entries'][0]['propertyName'], '材料')
        with patch_env({'CADWEAVE_STORE_PATH': ''}):
            completed = subprocess.run(
                [sys.executable, '-m', 'cad_worker', '--store'], input=request + '\n',
                capture_output=True, text=True, encoding='utf-8', timeout=5,
            )
        self.assertIn('error', json.loads(completed.stdout))

    def test_sql_metacharacters_are_data(self):
        identity = {**self.key, 'rootPath': "'; DROP TABLE drafts; --"}
        self.store.dispatch('draft.save', dict(**identity, entries=[self.entry]))
        self.assertEqual(self.store.dispatch('draft.load', identity)['rootPath'], identity['rootPath'])
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM drafts').fetchone()[0], 1)


class patch_env:
    def __init__(self, values):
        self.values = values

    def __enter__(self):
        self.saved = {key: os.environ.get(key) for key in self.values}
        os.environ.update(self.values)

    def __exit__(self, *_):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == '__main__':
    unittest.main()
