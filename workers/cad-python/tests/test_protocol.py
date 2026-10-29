import io
import json
import threading
import pytest
from cad_worker.service import Worker, serve, decode
from cad_worker.contracts import WorkerError


@pytest.fixture
def worker():
    return Worker(discover=lambda: dict(sessions=[], diagnostics=[]))


def call(worker, method, **params):
    count = len(worker.request_ids)
    return worker.dispatch(dict(id=str(count), method=method, params=params, protocolVersion=1))


def test_discovery_returns_only_actual_cad_sessions(worker):
    response = call(worker, 'discover')['result']
    assert response == dict(sessions=[], diagnostics=[])


def test_fake_session_cannot_connect(worker):
    response = call(worker, 'connect', sessionId='synthetic:session')
    assert response['error']['code'] == 'SESSION_UNAVAILABLE'


def test_invalid_protocol_requests_are_rejected_before_connection(worker):
    assert call(worker, 'snapshot', scope='document')['error']['code'] == 'NOT_CONNECTED'
    assert call(worker, 'apply', snapshotId='x', changes=[], confirmSave=True)['error']['code'] == 'NOT_CONNECTED'


@pytest.mark.parametrize('mutator,code', [
    (lambda c: c.update(oldValue='冲突'), 'VALUE_CONFLICT'),
    (lambda c: c.update(modelId='unknown'), 'UNKNOWN_MODEL'),
    (lambda c: c.update(propertyName='新增'), 'UNKNOWN_PROPERTY'),
    (lambda c: c.update(newValue=None), 'INVALID_PARAMS'),
    (lambda c: c.update(newValue='a\x00b'), 'INVALID_PARAMS'),
    (lambda c: c.update(new_value='snake'), 'INVALID_PARAMS'),
])
def test_invalid_changes_fail_before_mutation(worker, mutator, code):
    # Without a real discovered CAD session, no model snapshot or mutation exists.
    assert call(worker, 'connect', sessionId='synthetic:session')['error']['code'] == 'SESSION_UNAVAILABLE'


def test_discovery_and_disconnect_invalidate_state(worker):
    assert call(worker, 'discover')['result']['sessions'] == []
    assert call(worker, 'disconnect')['result'] == dict(disconnected=True)
    assert call(worker, 'snapshot', scope='document')['error']['code'] == 'NOT_CONNECTED'


def test_response_does_not_expose_synthetic_models(worker):
    response = call(worker, 'discover')['result']
    assert 'models' not in response
    assert all(session['cadId'] == 'solidworks' for session in response['sessions'])


@pytest.mark.parametrize('payload,code', [
    ({}, 'INVALID_PARAMS'),
    (dict(id='x', method='discover', params={}, protocolVersion=True), 'PROTOCOL_VERSION'),
    (dict(id='x', method='discover', params={}, protocolVersion=2), 'PROTOCOL_VERSION'),
    (dict(id='x', method='discover', params={'extra': 1}, protocolVersion=1), 'INVALID_PARAMS'),
    (dict(id='x', method='other', params={}, protocolVersion=1), 'METHOD_NOT_FOUND'),
    (dict(id='x', method=42, params={}, protocolVersion=1), 'INVALID_REQUEST'),
])
def test_protocol_validation(worker, payload, code):
    assert worker.dispatch(payload)['error']['code'] == code


def test_request_id_replay(worker):
    request = dict(id='x', method='discover', params={}, protocolVersion=1)
    assert 'result' in worker.dispatch(request)
    assert worker.dispatch(request)['error']['code'] == 'DUPLICATE_REQUEST'


@pytest.mark.parametrize('text', ['{"id":"a","id":"b"}', '{broken', '{"x":NaN}'])
def test_invalid_json(text):
    with pytest.raises((WorkerError, ValueError)):
        decode(text)


def test_new_sessions_are_discovered_on_connect(worker):
    session = dict(id='solidworks:1', cadId='solidworks', connectable=True)
    worker.discover = lambda: dict(sessions=[session], diagnostics=[])
    worker.factories['solidworks'] = lambda value: type('Adapter', (), {
        'session': value,
        'capabilities': {},
        'close': lambda self: None,
    })()
    assert call(worker, 'connect', sessionId=session['id'])['result']['session'] == session
    worker.discover = lambda: dict(sessions=[], diagnostics=[])
    assert call(worker, 'connect', sessionId=session['id'])['error']['code'] == 'SESSION_UNAVAILABLE'


def test_serve_emits_discovery_without_demo():
    source = io.StringIO('{"id":"x","method":"discover","params":{},"protocolVersion":1}\n')
    target = io.StringIO()
    serve(source, target, worker=Worker(discover=lambda: dict(sessions=[], diagnostics=[])))
    response = json.loads(target.getvalue())
    assert response['result']['sessions'] == []
