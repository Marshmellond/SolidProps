"""SQLite-only tests: temp directories, no COM/CAD interaction."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from cad_worker.storage import Storage, MAX_PAYLOAD


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
        listed = self.store.dispatch('history.list', {})
        self.assertEqual(listed[0]['status'], 'pending')
        self.assertIsNone(listed[0]['changes'][0]['saved'])
        outcome = {**self.entry, 'modelName': '零件', 'success': False, 'saved': False, 'message': 'Save failed'}
        finish = dict(id=pending['id'], status='failure', detail='Save failed', changes=[outcome])
        self.store.dispatch('audit.finish', finish)
        listed = self.store.dispatch('history.list', {})
        self.assertEqual(listed[0]['status'], 'failure')
        self.assertEqual(listed[0]['changes'][0]['modelName'], '零件')
        self.assertFalse(listed[0]['changes'][0]['saved'])
        with self.assertRaises(ValueError):
            self.store.dispatch('audit.finish', finish)
        exported = self.store.dispatch('history.export', {})
        self.assertTrue(exported['suggestedName'].endswith('.log'))
        self.assertIn('Save failed', exported['content'])
        self.assertIn('零件', exported['content'])

    def test_history_pagination_and_limits(self):
        for index in range(3):
            self.store.dispatch('history.append', dict(title=str(index), detail='local', status='info'))
        self.assertEqual(self.store.dispatch('history.list', dict(limit=1, offset=1))[0]['title'], '1')
        for params in ({'limit': 0}, {'limit': 201}, {'limit': True}, {'offset': -1}, {'path': 'evil.sqlite'}):
            with self.assertRaises(ValueError):
                self.store.dispatch('history.list', params)
        with self.assertRaises(ValueError):
            self.store.dispatch('sql.execute', {})
        with self.assertRaises(ValueError):
            self.store.dispatch('history.append', {'title': 'x' * (MAX_PAYLOAD + 1), 'detail': ''})

    def test_export_all_exceeds_list_limit_and_marks_partial_exports(self):
        for index in range(205):
            self.store.dispatch('history.append', dict(title=str(index), detail='local'))
        partial = self.store.dispatch('history.export', {'limit': 200})
        self.assertTrue(partial['truncated'])
        self.assertIn('TRUNCATED / PARTIAL EXPORT', partial['content'])
        complete = self.store.dispatch('history.export', {'all': True})
        self.assertEqual(complete['count'], 205)
        self.assertEqual(complete['total'], 205)
        self.assertFalse(complete['truncated'])
        self.assertIn('Complete history export.', complete['content'])
        with self.assertRaises(ValueError):
            self.store.dispatch('history.export', {'all': 'true'})

    def test_reject_relative_and_network_paths(self):
        for path in ('relative.sqlite3', '//server/share/storage.sqlite3'):
            with self.assertRaises(ValueError):
                Storage(path)

    def test_store_cli_exits_without_cad_imports(self):
        request = json.dumps({'method': 'history.append', 'params': {'title': 'CLI', 'detail': 'No CAD'}})
        completed = subprocess.run(
            [sys.executable, '-m', 'cad_worker', '--store'], input=request + '\n',
            capture_output=True, text=True, encoding='utf-8', timeout=5,
            env={**os.environ, 'CADWEAVE_STORE_PATH': str(self.path), 'PYTHONUTF8': '1'},
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('id', json.loads(completed.stdout)['result'])
        self.assertEqual(self.store.dispatch('history.list', {})[0]['title'], 'CLI')
        with patch.dict(os.environ, {'CADWEAVE_STORE_PATH': ''}):
            completed = subprocess.run(
                [sys.executable, '-m', 'cad_worker', '--store'], input=request + '\n',
                capture_output=True, text=True, encoding='utf-8', timeout=5,
            )
        self.assertIn('error', json.loads(completed.stdout))

    def test_sql_metacharacters_are_data(self):
        identity = {**self.key, 'rootPath': "'; DROP TABLE history; --"}
        self.store.dispatch('draft.save', dict(**identity, entries=[self.entry]))
        self.assertEqual(self.store.dispatch('draft.load', identity)['rootPath'], identity['rootPath'])
        self.assertEqual(self.store.dispatch('history.list', {}), [])


if __name__ == '__main__':
    unittest.main()
