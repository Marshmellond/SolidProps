from pathlib import Path
from types import SimpleNamespace as NS
import pytest
from cad_worker.solidworks import SolidWorksAdapter, ComBridge, invoke
from cad_worker.contracts import WorkerError


class Manager:
    def __init__(self, values=None):
        self.values = values or {'名称': '活塞', '材料': '铝'}
        self.set_calls = []
        self.code = 0
        self.bad_read = False
    def GetNames(self):
        return list(self.values)
    def GetType2(self, name):
        return 30
    def Get6(self, name, cached):
        assert cached is True
        return (2, self.values[name], self.values[name], True, False)
    def Set2(self, name, value):
        self.set_calls.append((name, value))
        if self.code == 0:
            self.values[name] = 'bad' if self.bad_read else value
        return self.code


class Document:
    def __init__(self, path, manager=None, kind=1):
        self.path = str(path)
        self.manager = manager or Manager()
        self.dirty = False
        self.readonly = False
        self.kind = kind
        self.ConfigurationManager = NS(ActiveConfiguration=NS(Name='Default'))
        self.Extension = NS(CustomPropertyManager=lambda scope: self.manager)
    def GetPathName(self): return self.path
    def GetTitle(self): return Path(self.path).name
    def GetType(self): return self.kind
    def GetSaveFlag(self): return self.dirty
    def IsOpenedReadOnly(self): return self.readonly


class Bridge(ComBridge):
    write_certified = True
    write_reason = 'fake certified bridge; no real CAD file'
    def __init__(self, doc):
        self.docs = {doc.path: doc}
        self.app = NS(ActiveDoc=doc, GetProcessID=lambda: 42, RevisionNumber=lambda: '34.0', GetOpenDocumentByName=lambda path: self.docs.get(path))
        self.saved = 0
        self.save_result = (True, 0, 0)
    def attach(self): return self.app
    def save(self, doc):
        self.saved += 1
        if self.save_result[0]: doc.dirty = False
        return self.save_result


@pytest.fixture
def setup(tmp_path):
    source = tmp_path / 'copied-test-model.SLDPRT'
    source.write_bytes(b'FAKE MODEL BYTES -- NOT REAL CAD')
    doc = Document(source)
    bridge = Bridge(doc)
    processes = [dict(cadId='solidworks', pid=42, started=10.0)]
    session = dict(id='solidworks:42:10.0', cadId='solidworks', pid=42, version='unknown')
    adapter = SolidWorksAdapter(session, bridge=bridge, inventory=lambda: processes, backup_root=tmp_path / 'user-backups')
    return adapter, doc, bridge, processes, source


def changes(snapshot):
    return [dict(modelId=snapshot['models'][0]['id'], propertyName=p['name'], oldValue=p['value'], newValue=p['value'] + '-改') for p in snapshot['models'][0]['properties']]


def test_save_multi_property_and_backup(setup):
    adapter, doc, bridge, _, source = setup
    snap = adapter.snapshot('document')
    response = adapter.apply(snap, changes(snap))
    assert bridge.saved == 1 and len(doc.manager.set_calls) == 2
    assert all(r['success'] and r['saved'] and not r['verified'] for r in response['results'])
    assert (Path(response['backupDirectory']) / '0' / source.name).read_bytes() == source.read_bytes()


@pytest.mark.parametrize('mutation,code', [
    (lambda a, d, b, p: setattr(d, 'dirty', True), 'DIRTY_MODEL'),
    (lambda a, d, b, p: setattr(d, 'readonly', True), 'READ_ONLY'),
    (lambda a, d, b, p: p.append(dict(cadId='solidworks', pid=55, started=11)), 'AMBIGUOUS_SESSION'),
    (lambda a, d, b, p: b.app.__setattr__('ActiveDoc', Document(d.path)), 'ACTIVE_DOCUMENT_CHANGED'),
    (lambda a, d, b, p: setattr(d.ConfigurationManager.ActiveConfiguration, 'Name', 'Other'), 'ACTIVE_DOCUMENT_CHANGED'),
    (lambda a, d, b, p: d.manager.values.update({'名称': '外部变更'}), 'VALUE_CONFLICT'),
])
def test_safety_preflight(setup, mutation, code):
    adapter, doc, bridge, processes, source = setup
    snap = adapter.snapshot('document')
    mutation(adapter, doc, bridge, processes)
    with pytest.raises(WorkerError) as error:
        adapter.apply(snap, changes(snap))
    assert error.value.code == code
    assert doc.manager.set_calls == [] and bridge.saved == 0
    assert source.read_bytes() == b'FAKE MODEL BYTES -- NOT REAL CAD'


def test_backup_failure_prevents_set(setup, tmp_path):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    blocker = tmp_path / 'file-not-directory'
    blocker.write_text('block')
    adapter.backup_root = blocker
    with pytest.raises(WorkerError, match='备份失败'):
        adapter.apply(snap, changes(snap))
    assert not doc.manager.set_calls and not bridge.saved


@pytest.mark.parametrize('code', [False, None, 1, 2])
def test_set_not_explicit_success_stops_without_save(setup, code):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    doc.manager.code = code
    response = adapter.apply(snap, changes(snap))
    assert not any(r['success'] or r['saved'] for r in response['results'])
    assert bridge.saved == 0 and len(doc.manager.set_calls) == 1


def test_readback_failure_never_saves(setup):
    adapter, doc, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    doc.manager.bad_read = True
    response = adapter.apply(snap, changes(snap))
    assert all(not r['success'] for r in response['results'])
    assert bridge.saved == 0


def test_save_error_not_success(setup):
    adapter, _, bridge, _, _ = setup
    snap = adapter.snapshot('document')
    bridge.save_result = (False, 1, 0)
    response = adapter.apply(snap, changes(snap))
    assert all(not r['success'] and not r['saved'] and not r['verified'] for r in response['results'])
    assert adapter.write_uncertain is True
    new_snapshot = adapter.snapshot('document')
    with pytest.raises(WorkerError) as error:
        adapter.apply(new_snapshot, changes(new_snapshot))
    assert error.value.code == 'WRITE_STATE_UNCERTAIN'


def test_real_bridge_disabled(setup):
    adapter, doc, bridge, _, _ = setup
    bridge.write_certified = False
    snap = adapter.snapshot('document')
    assert not snap['models'][0]['writable']
    assert all(not p['writable'] for p in snap['models'][0]['properties'])
    with pytest.raises(WorkerError, match='fake certified'):
        adapter.apply(snap, changes(snap))
    assert not doc.manager.set_calls


def test_child_models_dedup_and_unloaded_occurrences(setup):
    adapter, doc, _, _, source = setup
    doc.kind = 2
    child_doc = Document(source.parent / 'child-copy.SLDPRT')
    scopes = []
    child_doc.Extension.CustomPropertyManager = lambda scope: scopes.append(scope) or child_doc.manager
    def child(name, model):
        return NS(Name2=name, ReferencedConfiguration='ChildConfig', IsSuppressed=lambda: False, GetChildren=lambda: [], GetModelDoc2=lambda: model)
    root = NS(GetChildren=lambda: [child('one', child_doc), child('two', child_doc), child('lightweight', None)])
    doc.ConfigurationManager.ActiveConfiguration.GetRootComponent3 = lambda resolve: root
    snap = adapter.snapshot('configuration')
    assert len(snap['models']) == 2 and set(scopes) == {'ChildConfig'}
    occurrences = snap['root']['children']
    assert occurrences[0]['modelId'] == occurrences[1]['modelId']
    assert occurrences[2]['modelId'] is None
    assert all(not p['writable'] for p in snap['models'][1]['properties'])


@pytest.mark.parametrize('revision,expected', [('34.0.0', True), ('34.0.1', False), ('33.0.0', False), ('unknown', False)])
def test_production_revision_certification_exact(revision, expected):
    bridge = ComBridge()
    bridge.certify(revision)
    assert bridge.write_certified is expected


def test_dynamic_com_property_not_called_as_default_method():
    class Dispatch:
        _oleobj_ = object()
        def __call__(self):
            raise AssertionError('COM property must not invoke DISPID_VALUE')
    document = Dispatch()
    assert invoke(NS(ActiveDoc=document), 'ActiveDoc') is document


def test_unreliable_get6_never_fakes_value():
    manager = Manager()
    manager.Get6 = lambda *args: (True, 'x', 'x', True, False)
    with pytest.raises(WorkerError):
        ComBridge().property(manager, '名称')
