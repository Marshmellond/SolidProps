from pathlib import Path
from types import SimpleNamespace as NS
import pytest
from test_solidworks import Document, Bridge
from cad_worker.solidworks import SolidWorksAdapter
from cad_worker.contracts import WorkerError


@pytest.fixture
def assembly(tmp_path):
    docs = []
    for name in ('root.SLDASM', 'child.SLDPRT', 'other.SLDPRT'):
        path = tmp_path / name
        path.write_bytes(b'FAKE COPY ONLY')
        docs.append(Document(path))
    root, child, other = docs
    root.kind = 2
    def occurrence(name, doc):
        return NS(Name2=name, ReferencedConfiguration='Default', IsSuppressed=lambda: False, GetChildren=lambda: [], GetModelDoc2=lambda: doc)
    tree = NS(GetChildren=lambda: [occurrence('one', child), occurrence('repeat', child), occurrence('two', other)])
    root.ConfigurationManager.ActiveConfiguration.GetRootComponent3 = lambda resolve: tree
    bridge = Bridge(root)
    bridge.docs = {d.path: d for d in docs}
    adapter = SolidWorksAdapter(dict(id='solidworks:42:1', pid=42, cadId='solidworks'), bridge=bridge, inventory=lambda: [dict(cadId='solidworks', pid=42, started=1)], backup_root=tmp_path / 'backups')
    snap = adapter.snapshot('document')
    changes = [dict(modelId=m['id'], propertyName=m['properties'][0]['name'], oldValue=m['properties'][0]['value'], newValue='modified') for m in snap['models']]
    return adapter, docs, bridge, snap, changes


def test_root_child_grouped_save_and_dedup(assembly):
    adapter, docs, bridge, snap, changes = assembly
    assert len(snap['models']) == 3 and all(m['writable'] for m in snap['models'])
    response = adapter.apply(snap, changes)
    assert bridge.saved == 3 and all(r['saved'] and r['success'] and not r['verified'] for r in response['results'])
    assert all(len(d.manager.set_calls) == 1 for d in docs)
    assert len(list(Path(response['backupDirectory']).rglob('*.SLDPRT'))) == 2


@pytest.mark.parametrize('mutation,code', [
    (lambda docs, bridge: setattr(docs[2], 'dirty', True), 'DIRTY_MODEL'),
    (lambda docs, bridge: setattr(docs[2], 'readonly', True), 'READ_ONLY'),
    (lambda docs, bridge: bridge.docs.update({docs[2].path: Document(docs[2].path)}), 'DOCUMENT_CHANGED'),
    (lambda docs, bridge: docs[2].manager.values.update({'名称': 'external'}), 'VALUE_CONFLICT'),
])
def test_whole_batch_preflight_no_partial_mutation(assembly, mutation, code):
    adapter, docs, bridge, snap, changes = assembly
    mutation(docs, bridge)
    with pytest.raises(WorkerError) as error: adapter.apply(snap, changes)
    assert error.value.code == code
    assert bridge.saved == 0 and all(not d.manager.set_calls for d in docs)


def test_backup_all_before_first_mutation(assembly):
    adapter, docs, bridge, snap, changes = assembly
    Path(docs[2].path).unlink()
    with pytest.raises(WorkerError, match='备份失败'): adapter.apply(snap, changes)
    assert bridge.saved == 0 and all(not d.manager.set_calls for d in docs)


def test_second_group_failure_preserves_first_and_cancels_third(assembly):
    adapter, docs, bridge, snap, changes = assembly
    docs[1].manager.code = 1
    response = adapter.apply(snap, changes)
    assert response['results'][0]['saved'] is True
    assert not response['results'][1]['saved'] and not response['results'][2]['success']
    assert bridge.saved == 1 and not docs[2].manager.set_calls
    assert adapter.write_uncertain is True


def test_save_failure_stops_following_group_and_locks(assembly):
    adapter, docs, bridge, snap, changes = assembly
    bridge.save_result = (False, 1, 0)
    response = adapter.apply(snap, changes)
    assert not any(r['success'] for r in response['results'])
    assert not docs[1].manager.set_calls and adapter.write_uncertain


def test_original_fixture_guard(assembly):
    adapter, docs, bridge, snap, changes = assembly
    adapter.protected_roots = [Path(docs[1].path).parent]
    with pytest.raises(WorkerError) as error: adapter.apply(snap, changes)
    assert error.value.code == 'PROTECTED_SOURCE' and bridge.saved == 0


def test_configuration_scope_readonly(assembly):
    adapter, docs, bridge, _, _ = assembly
    snap = adapter.snapshot('configuration')
    assert all(not m['writable'] for m in snap['models'])
    with pytest.raises(WorkerError) as error: adapter.apply(snap, [])
    assert error.value.code == 'UNSUPPORTED_SCOPE'


def test_dirty_active_root_not_saved_when_only_child_target(assembly):
    adapter, docs, bridge, snap, changes = assembly
    docs[0].dirty = True
    response = adapter.apply(snap, changes[1:2])
    assert response['results'][0]['saved'] and docs[0].dirty is True
    assert not docs[0].manager.set_calls and bridge.saved == 1
