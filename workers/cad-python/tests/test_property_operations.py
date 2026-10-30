"""Fake COM only: add/delete validation, ordering, verification and uncertainty."""
from pathlib import Path
import pytest
from test_solidworks import setup, Manager
from test_grouped_writes import assembly
from test_protocol import connected_worker, worker, call, valid_change
from cad_worker.contracts import WorkerError


def change(snapshot, operation, name='New', old='', new='value'):
    return dict(modelId=snapshot['models'][0]['id'], operation=operation,
                propertyName=name, oldValue=old, newValue=new)


@pytest.mark.parametrize('value_type', [True, None, '30', 30.0])
def test_property_type_requires_exact_com_integer(value_type):
    from cad_worker.solidworks import ComBridge
    manager = Manager()
    manager.GetType2 = lambda name: value_type
    with pytest.raises(WorkerError) as exc:
        ComBridge().property(manager, '名称')
    assert exc.value.code == 'API_UNRELIABLE'


@pytest.mark.parametrize('failure', ['mutation', 'save'])
def test_uncertain_snapshot_exposes_connection_wide_readonly_lock(assembly, failure):
    adapter, docs, bridge, snap, changes = assembly
    if failure == 'mutation':
        docs[1].manager.code = 1
    else:
        bridge.save_result = (False, 1, 0)
    adapter.apply(snap, changes)
    assert adapter.write_uncertain
    # Even if a user later clears CAD's dirty flags, refresh cannot release
    # this connection's uncertainty lock, including already-saved/untouched docs.
    for doc in docs:
        doc.dirty = False
    refreshed = adapter.snapshot('document')
    assert len(refreshed['models']) == 3
    assert all(not model['writable'] and '重新连接' in model['reason'] for model in refreshed['models'])
    assert all(not prop['writable'] and '重新连接' in prop['reason']
               for model in refreshed['models'] for prop in model['properties'])
    assert any('重新读取不会解除' in warning for warning in refreshed['warnings'])
    assert adapter.write_uncertain
    with pytest.raises(WorkerError) as exc:
        adapter.apply(refreshed, changes)
    assert exc.value.code == 'WRITE_STATE_UNCERTAIN'


def test_successful_batch_snapshot_remains_writable(assembly):
    adapter, docs, bridge, snap, changes = assembly
    response = adapter.apply(snap, changes)
    assert all(r['success'] for r in response['results'])
    assert not adapter.write_uncertain
    refreshed = adapter.snapshot('document')
    assert all(model['writable'] for model in refreshed['models'])
    assert all(prop['writable'] for model in refreshed['models'] for prop in model['properties'])
    assert not any('保存状态未知' in warning for warning in refreshed['warnings'])


def test_mixed_add_delete_update_one_save(setup):
    adapter, doc, bridge, _, source = setup
    snap = adapter.snapshot('document')
    batch = [change(snap, 'add'), change(snap, 'delete', '名称', '活塞', ''),
             change(snap, 'update', '材料', '铝', '钢')]
    response = adapter.apply(snap, batch)
    assert doc.manager.values == {'New': 'value', '材料': '钢'}
    assert doc.manager.add_calls == [('New', 30, 'value', 0)]
    assert doc.manager.delete_calls == ['名称']
    assert doc.manager.set_calls == [('材料', '钢')]
    assert bridge.saved == 1 and all(r['success'] and r['saved'] and not r['verified'] for r in response['results'])
    assert (Path(response['backupDirectory']) / '0' / source.name).read_bytes() == source.read_bytes()


@pytest.mark.parametrize('operation', ['add', 'delete'])
@pytest.mark.parametrize('code', [False, True, None, '0', 1, 2])
def test_strict_mutation_status_locks_and_never_saves(setup, operation, code):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    setattr(doc.manager, operation + '_code', code)
    item = change(snap, operation) if operation == 'add' else change(snap, operation, '名称', '活塞', '')
    response = adapter.apply(snap, [item])
    assert not response['results'][0]['success'] and bridge.saved == 0
    assert adapter.write_uncertain
    with pytest.raises(WorkerError) as exc:
        adapter.apply(adapter.snapshot('document'), [item])
    assert exc.value.code == 'WRITE_STATE_UNCERTAIN'


@pytest.mark.parametrize('operation', ['add', 'delete'])
def test_mutation_readback_must_match(setup, operation):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    doc.manager.bad_read = True
    doc.manager.keep_deleted = True
    item = change(snap, operation) if operation == 'add' else change(snap, operation, '名称', '活塞', '')
    response = adapter.apply(snap, [item])
    assert not response['results'][0]['success'] and bridge.saved == 0 and adapter.write_uncertain


@pytest.mark.parametrize('item,code', [
    (dict(operation='add', name='名称'), 'PROPERTY_EXISTS'),
    (dict(operation='delete', name='Missing', new=''), 'UNKNOWN_PROPERTY'),
    (dict(operation='add', name=' '), 'INVALID_PARAMS'),
    (dict(operation='add', new='$PRP:x'), 'UNSUPPORTED_VALUE'),
])
def test_adapter_rejects_before_any_mutation(setup, item, code):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [change(snap, **item)])
    assert exc.value.code == code
    assert not doc.manager.add_calls and not doc.manager.delete_calls and not bridge.saved


def test_case_insensitive_add_collision_and_duplicate_batch(setup):
    adapter, doc, bridge, _, _ = setup
    doc.manager.values['Name'] = 'old'
    snap = adapter.snapshot('document')
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [change(snap, 'add', 'name')])
    assert exc.value.code == 'PROPERTY_EXISTS'
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [change(snap, 'add', 'New'), change(snap, 'add', 'NEW')])
    assert exc.value.code == 'DUPLICATE_CHANGE'
    assert not doc.manager.add_calls and bridge.saved == 0


def test_add_external_collision_after_snapshot(setup):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    doc.manager.values['NEW'] = 'external'
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [change(snap, 'add')])
    assert exc.value.code == 'PROPERTY_EXISTS' and bridge.saved == 0
    assert doc.manager.values['NEW'] == 'external' and not doc.manager.add_calls


def test_add_empty_property_manager(setup):
    adapter, doc, bridge, _, _ = setup
    doc.manager = Manager({})
    snap = adapter.snapshot('document')
    assert not snap['models'][0]['properties']
    assert adapter.apply(snap, [change(snap, 'add', new='')])['results'][0]['success']
    assert doc.manager.values == {'New': ''}


@pytest.mark.parametrize('operation', ['add', 'delete'])
def test_whole_batch_later_target_conflict_prevents_all_operations(assembly, operation):
    adapter, docs, bridge, snap, changes = assembly
    first = change(snap, operation) if operation == 'add' else change(snap, operation, '名称', '活塞', '')
    docs[-1].manager.values['名称'] = 'external'
    with pytest.raises(WorkerError):
        adapter.apply(snap, [first, changes[-1]])
    assert bridge.saved == 0
    assert all(not d.manager.set_calls and not d.manager.add_calls and not d.manager.delete_calls for d in docs)


@pytest.mark.parametrize('operation', ['add', 'delete'])
def test_all_backups_precede_add_delete(assembly, operation):
    adapter, docs, bridge, snap, changes = assembly
    first = change(snap, operation) if operation == 'add' else change(snap, operation, '名称', '活塞', '')
    Path(docs[-1].path).unlink()
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [first, changes[-1]])
    assert exc.value.code == 'BACKUP_FAILED'
    assert not docs[0].manager.add_calls and not docs[0].manager.delete_calls and not bridge.saved


@pytest.mark.parametrize('operation', [None, 'update', 'add', 'delete'])
def test_service_accepts_valid_operation(connected_worker, operation):
    worker, calls = connected_worker
    item = valid_change()
    if operation is not None:
        item['operation'] = operation
    if operation == 'add': item.update(propertyName='New', oldValue='')
    if operation == 'delete': item.update(newValue='')
    assert 'result' in call(worker, 'apply', snapshotId='snapshot', changes=[item], confirmSave=True)
    assert calls == ['validate', [item]] and worker.snapshot is None


@pytest.mark.parametrize('target', ['dirty', 'model_readonly', 'property_readonly'])
@pytest.mark.parametrize('operation', ['add', 'delete'])
def test_service_model_and_property_safety(connected_worker, target, operation):
    worker, calls = connected_worker
    model = worker.snapshot['models'][0]
    if target == 'dirty': model['dirty'] = True
    elif target == 'model_readonly': model['writable'] = False
    else: model['properties'][0]['writable'] = False
    item = valid_change(operation=operation)
    if operation == 'add': item.update(propertyName='New', oldValue='')
    else: item.update(newValue='')
    response = call(worker, 'apply', snapshotId='snapshot', changes=[item], confirmSave=True)
    if operation == 'add' and target == 'property_readonly':
        assert 'result' in response  # unrelated existing property does not prohibit add
    else:
        assert response['error']['code'] == 'READ_ONLY' and not calls


@pytest.mark.parametrize('operation', ['add', 'delete'])
def test_partial_failure_preserves_first_saved_and_cancels_rest(assembly, operation):
    adapter, docs, bridge, snap, changes = assembly
    second = dict(changes[1], operation=operation)
    if operation == 'add': second.update(propertyName='New', oldValue='', newValue='value')
    else: second.update(newValue='')
    setattr(docs[1].manager, operation + '_code', 1)
    response = adapter.apply(snap, [changes[0], second, changes[2]])
    assert response['results'][0]['success'] and response['results'][0]['saved']
    assert not response['results'][1]['success'] and not response['results'][2]['saved']
    assert bridge.saved == 1 and adapter.write_uncertain
    assert not docs[2].manager.set_calls


@pytest.mark.parametrize('change_kind', ['linked', 'nontext', 'expression'])
def test_delete_external_type_or_link_change_prevents_mutation(setup, change_kind):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    if change_kind == 'linked':
        doc.manager.Get6 = lambda name, cached: (2, '活塞', '活塞', True, True)
    elif change_kind == 'nontext':
        doc.manager.GetType2 = lambda name: 3
    else:
        doc.manager.Get6 = lambda name, cached: (2, '活塞', 'evaluated', True, False)
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [change(snap, 'delete', '名称', '活塞', '')])
    assert exc.value.code == 'READ_ONLY'
    assert not doc.manager.delete_calls and not bridge.saved


def test_external_add_during_backups_rechecks_whole_batch(setup, monkeypatch):
    import cad_worker.solidworks as sw
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    original = sw.shutil.copy2
    def copy_and_collide(source, target):
        result = original(source, target)
        doc.manager.values['NEW'] = 'external'
        return result
    monkeypatch.setattr(sw.shutil, 'copy2', copy_and_collide)
    with pytest.raises(WorkerError) as exc:
        adapter.apply(snap, [change(snap, 'update', '材料', '铝', '钢'), change(snap, 'add')])
    assert exc.value.code == 'PROPERTY_EXISTS'
    assert not doc.manager.set_calls and not doc.manager.add_calls and bridge.saved == 0
    assert not adapter.write_uncertain


def test_service_casefold_duplicate_and_collision(connected_worker):
    worker, calls = connected_worker
    first = valid_change(operation='add', propertyName='New', oldValue='')
    second = dict(first, propertyName='NEW')
    assert call(worker, 'apply', snapshotId='snapshot', changes=[first, second], confirmSave=True)['error']['code'] == 'DUPLICATE_CHANGE'
    first['propertyName'] = 'name'
    assert call(worker, 'apply', snapshotId='snapshot', changes=[first], confirmSave=True)['error']['code'] == 'PROPERTY_EXISTS'
    assert not calls
