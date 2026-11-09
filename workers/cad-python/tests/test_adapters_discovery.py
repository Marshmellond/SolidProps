from types import SimpleNamespace as NS
from cad_worker import discovery
from cad_worker.service import Worker


def test_processes_only_match_solidworks(monkeypatch):
    rows = [NS(info=dict(pid=i, name=name, exe='C:/cad/' + name, create_time=1))
            for i, name in enumerate(('SLDWORKS.exe', 'othercad.exe', 'notepad.exe'), 1)]
    monkeypatch.setattr(discovery.psutil, 'process_iter', lambda attrs: rows)
    assert [p['pid'] for p in discovery.processes()] == [1]


def test_discovery_is_readonly_and_rejects_multi_instance(monkeypatch):
    monkeypatch.setattr(discovery, 'processes', lambda: [
        dict(pid=i, started=1, executable='D:/cad/SldWorks.exe') for i in (1, 2)])
    monkeypatch.setattr(discovery, 'registrations', lambda: ({'SldWorks.Application': ['D:/cad/SldWorks.exe']}, []))
    response = discovery.discover()
    assert len(response['sessions']) == 2
    assert all(session['cadId'] == 'solidworks' for session in response['sessions'])
    assert all(not session['connectable'] for session in response['sessions'])
    assert {d['cadId'] for d in response['diagnostics']} == {'solidworks'}


def test_single_instance_is_connectable(monkeypatch):
    monkeypatch.setattr(discovery, 'processes', lambda: [dict(pid=7, started=1, executable='D:/cad/SldWorks.exe')])
    monkeypatch.setattr(discovery, 'registrations', lambda: ({'SldWorks.Application': ['D:/cad/SldWorks.exe']}, []))
    sessions = discovery.discover()['sessions']
    assert len(sessions) == 1
    assert sessions[0]['id'] == 'solidworks:7:1'
    assert sessions[0]['connectable']


def test_absent_process_has_diagnostic_but_no_synthetic_session(monkeypatch):
    monkeypatch.setattr(discovery, 'processes', lambda: [])
    monkeypatch.setattr(discovery, 'registrations', lambda: ({}, []))
    assert discovery.discover()['sessions'] == []


def test_non_solidworks_session_rejected_before_existing_adapter_closed():
    session = dict(id='future:1', cadId='future', connectable=True)
    worker = Worker(discover=lambda: dict(sessions=[session], diagnostics=[]))
    closed = []
    worker.adapter = NS(close=lambda: closed.append(True))
    response = worker.dispatch(dict(id='1', method='connect', params=dict(sessionId=session['id']), protocolVersion=1))
    assert response['error']['code'] == 'UNSUPPORTED_CAD'
    assert closed == []


def test_solidworks_adapter_factory_is_injected():
    session = dict(id='solidworks:1', cadId='solidworks', connectable=True)
    class FakeAdapter:
        def __init__(self, value):
            self.session = value
            self.capabilities = dict(cadId='solidworks', displayName='SolidWorks', writable=False, notes='')
        def close(self): pass
    worker = Worker(discover=lambda: dict(sessions=[session], diagnostics=[]), adapter_factory=FakeAdapter)
    response = worker.dispatch(dict(id='1', method='connect', params=dict(sessionId=session['id']), protocolVersion=1))
    assert response['result']['capabilities']['displayName'] == 'SolidWorks'
