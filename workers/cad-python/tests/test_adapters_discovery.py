from types import SimpleNamespace as NS
from cad_worker import discovery
from cad_worker.adapters import builtin_plugins
from cad_worker.contracts import capabilities
from cad_worker.service import Worker


def test_only_solidworks_enabled():
    plugins = builtin_plugins()
    assert [p.cad_id for p in plugins] == ['solidworks']
    assert set(Worker().factories) == {'solidworks'}


def test_processes_ignore_unregistered_cad(monkeypatch):
    rows = [NS(info=dict(pid=i, name=name, exe='C:/cad/' + name, create_time=1))
            for i, name in enumerate(('SLDWORKS.exe', 'othercad.exe', 'notepad.exe'), 1)]
    monkeypatch.setattr(discovery.psutil, 'process_iter', lambda attrs: rows)
    assert [p['cadId'] for p in discovery.processes()] == ['solidworks']


def test_discovery_is_readonly_and_rejects_multi_instance(monkeypatch):
    monkeypatch.setattr(discovery, 'processes', lambda: [dict(cadId='solidworks', pid=i, started=1, executable='D:/cad/SldWorks.exe') for i in (1, 2)])
    monkeypatch.setattr(discovery, 'registrations', lambda: ({'SldWorks.Application': ['D:/cad/SldWorks.exe']}, []))
    response = discovery.discover()
    assert len(response['sessions']) == 2
    assert all(not s['connectable'] for s in response['sessions'])
    assert {d['cadId'] for d in response['diagnostics']} == {'solidworks'}


def test_absent_process_has_diagnostic_but_no_synthetic_session(monkeypatch):
    monkeypatch.setattr(discovery, 'processes', lambda: [])
    monkeypatch.setattr(discovery, 'registrations', lambda: ({}, []))
    assert discovery.discover()['sessions'] == []


def test_unknown_driver_rejected_before_existing_adapter_closed():
    session = dict(id='future:1', cadId='future', connectable=True)
    worker = Worker(discover=lambda: dict(sessions=[session], diagnostics=[]))
    closed = []
    worker.adapter = NS(close=lambda: closed.append(True))
    response = worker.dispatch(dict(id='1', method='connect', params=dict(sessionId=session['id']), protocolVersion=1))
    assert response['error']['code'] == 'UNSUPPORTED_CAD'
    assert closed == []


def test_future_adapter_can_be_injected_without_changing_protocol():
    session = dict(id='future:1', cadId='future', connectable=True)
    class FutureAdapter:
        def __init__(self, value):
            self.session = value
            self.capabilities = capabilities('future', display_name='Future CAD')
        def close(self): pass
    worker = Worker(discover=lambda: dict(sessions=[session], diagnostics=[]), factories={'future': FutureAdapter})
    response = worker.dispatch(dict(id='1', method='connect', params=dict(sessionId=session['id']), protocolVersion=1))
    assert response['result']['capabilities']['displayName'] == 'Future CAD'
