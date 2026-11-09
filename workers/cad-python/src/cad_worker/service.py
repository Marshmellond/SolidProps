"""Strict line-delimited protocol v1 dispatcher, sequential and main-thread only."""
import json
import sys
import threading
from copy import deepcopy
from .contracts import WorkerError
from . import discovery
from .solidworks import SolidWorksAdapter

MAX_LINE = 4 * 1024 * 1024


def reject_duplicates(pairs):
    output = {}
    for key, value in pairs:
        if key in output:
            raise WorkerError('INVALID_JSON', f'JSON 包含重复键：{key}')
        output[key] = value
    return output


def decode(line):
    try:
        return json.loads(line, object_pairs_hook=reject_duplicates, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, UnicodeError) as exc:
        raise WorkerError('INVALID_JSON', '请求不是有效 UTF-8 JSON。') from exc


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise WorkerError('INVALID_PARAMS', '请求字段缺失、未知或不是对象。')


class Worker:
    def __init__(self, discover=None, adapter_factory=None):
        self.discover = discover if discover is not None else discovery.discover
        self.adapter_factory = adapter_factory if adapter_factory is not None else SolidWorksAdapter
        self.adapter = None
        self.snapshot = None
        self.thread = threading.get_ident()
        self.request_ids = set()

    def dispatch(self, request):
        request_id = request.get('id') if isinstance(request, dict) else None
        try:
            if threading.get_ident() != self.thread:
                raise WorkerError('THREAD_VIOLATION', 'Worker 请求必须在主线程串行处理。')
            fields(request, ('id', 'method', 'params', 'protocolVersion'))
            if not isinstance(request_id, str) or not request_id or len(request_id) > 256:
                raise WorkerError('INVALID_REQUEST', 'id 必须是非空唯一字符串（最多256字符）。')
            if type(request['protocolVersion']) is not int or request['protocolVersion'] != 1:
                raise WorkerError('PROTOCOL_VERSION', '仅支持 protocolVersion: 1。')
            if request_id in self.request_ids:
                raise WorkerError('DUPLICATE_REQUEST', '请求 ID 已使用，拒绝重放。')
            if len(self.request_ids) >= 100000:
                raise WorkerError('REQUEST_LIMIT', '请求数量达到安全上限，请重启 Worker。')
            self.request_ids.add(request_id)
            if not isinstance(request['method'], str) or not isinstance(request['params'], dict):
                raise WorkerError('INVALID_REQUEST', 'method 必须为字符串，params 必须为对象。')
            answer = self._method(request['method'], request['params'])
            return dict(id=request_id, result=answer, protocolVersion=1)
        except WorkerError as exc:
            return dict(id=request_id, error=dict(code=exc.code, message=str(exc)), protocolVersion=1)
        except Exception as exc:
            # COM details belong on stderr; frontend receives a truthful failure.
            print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
            return dict(id=request_id, error=dict(code='CAD_API_ERROR', message=f'SolidWorks 接口调用失败，未宣称成功：{exc}'), protocolVersion=1)

    def _method(self, method, params):
        if method == 'discover':
            fields(params, ())
            return self.discover()
        if method == 'disconnect':
            fields(params, ())
            self.close()
            return dict(disconnected=True)
        if method == 'connect':
            fields(params, ('sessionId',))
            if not isinstance(params['sessionId'], str):
                raise WorkerError('INVALID_PARAMS', 'sessionId 必须为字符串。')
            session = next((s for s in self.discover()['sessions'] if s['id'] == params['sessionId']), None)
            if not session or not session['connectable']:
                raise WorkerError('SESSION_UNAVAILABLE', '所选会话不存在或不可安全连接。')
            if session['cadId'] != 'solidworks':
                raise WorkerError('UNSUPPORTED_CAD', '仅支持 SolidWorks。')
            self.close()
            self.adapter = self.adapter_factory(deepcopy(session))
            return dict(session=deepcopy(self.adapter.session), capabilities=deepcopy(self.adapter.capabilities))
        if method not in ('snapshot', 'apply'):
            raise WorkerError('METHOD_NOT_FOUND', '未知协议方法。')
        if self.adapter is None:
            raise WorkerError('NOT_CONNECTED', '请先连接会话。')
        if method == 'snapshot':
            fields(params, ('scope',))
            if params['scope'] not in ('document', 'configuration'):
                raise WorkerError('INVALID_PARAMS', 'scope 必须为 document 或 configuration。')
            # Invalidate old snapshot BEFORE trying a new one, even if API fails.
            self.snapshot = None
            self.snapshot = self.adapter.snapshot(params['scope'])
            return deepcopy(self.snapshot)
        fields(params, ('snapshotId', 'changes', 'confirmSave'))
        if params['confirmSave'] is not True:
            raise WorkerError('CONFIRM_REQUIRED', '必须明确 confirmSave:true 才能提交。')
        if not self.snapshot or params['snapshotId'] != self.snapshot['id']:
            raise WorkerError('STALE_SNAPSHOT', '快照已失效或不属于当前会话，请重新读取。')
        if self.snapshot['sessionId'] != self.adapter.session['id']:
            raise WorkerError('SESSION_CHANGED', '快照会话不一致。')
        changes = params['changes']
        if not isinstance(changes, list) or not changes or len(changes) > 1000:
            raise WorkerError('INVALID_PARAMS', 'changes 必须是包含1至1000项的数组。')
        models = {m['id']: m for m in self.snapshot['models']}
        seen = set()
        # Whole-batch checks prevent a later malformed property causing partial writes.
        for change in changes:
            fields(change, ('modelId', 'propertyName', 'oldValue', 'newValue'), ('operation',))
            if not all(isinstance(value, str) for value in change.values()) or any(len(value) > 65536 or '\x00' in value for value in change.values()):
                raise WorkerError('INVALID_PARAMS', '变更字段必须为字符串且不得包含 NUL 或超过65536字符。')
            operation = change.get('operation', 'update')
            if operation not in ('add', 'update', 'delete') or not change['propertyName'].strip():
                raise WorkerError('INVALID_PARAMS', 'operation 必须为 add/update/delete，属性名不能为空。')
            if (operation == 'add' and change['oldValue'] != '') or (operation == 'delete' and change['newValue'] != ''):
                raise WorkerError('INVALID_PARAMS', '新增的 oldValue 和删除的 newValue 必须为空字符串。')
            key = (change['modelId'], change['propertyName'].casefold())
            if key in seen:
                raise WorkerError('DUPLICATE_CHANGE', '同一属性不能重复提交。')
            seen.add(key)
            model = models.get(change['modelId'])
            if not model:
                raise WorkerError('UNKNOWN_MODEL', '未知模型，不允许跨快照写入。')
            matches = [p for p in model['properties'] if p['name'].casefold() == change['propertyName'].casefold()]
            if not model['writable'] or model['dirty']:
                raise WorkerError('READ_ONLY', model['reason'] or '模型已脏，禁止保存。')
            if operation == 'add':
                if matches:
                    raise WorkerError('PROPERTY_EXISTS', '新增属性名已存在（不区分大小写）。')
                continue
            if not matches:
                raise WorkerError('UNKNOWN_PROPERTY', '待修改或删除的属性不存在。')
            if len(matches) != 1 or matches[0]['name'] != change['propertyName']:
                raise WorkerError('PROPERTY_NAME_CONFLICT', '属性名大小写不匹配或存在歧义，请重新读取。')
            prop = matches[0]
            if not prop['writable']:
                raise WorkerError('READ_ONLY', prop['reason'] or '属性不可写。')
            if prop['value'] != change['oldValue']:
                raise WorkerError('VALUE_CONFLICT', '原值与快照不一致。')
        self.adapter.validate()
        # Once mutation may begin, consume snapshot even on exception. A save
        # failure cannot be retried using the same snapshot or auto-saved later.
        snapshot, self.snapshot = self.snapshot, None
        return self.adapter.apply(snapshot, deepcopy(changes))

    def close(self):
        adapter, self.adapter = self.adapter, None
        self.snapshot = None
        if adapter is not None:
            adapter.close()


def serve(input_stream=None, output_stream=None, worker=None):
    source, target, worker = input_stream or sys.stdin, output_stream or sys.stdout, worker or Worker()
    try:
        while True:
            line = source.readline(MAX_LINE + 1)
            if not line:
                break
            try:
                if len(line) > MAX_LINE:
                    while line and not line.endswith('\n'):
                        line = source.readline(MAX_LINE + 1)
                    raise WorkerError('REQUEST_TOO_LARGE', '单行请求超过4 MiB安全上限。')
                response = worker.dispatch(decode(line))
            except WorkerError as exc:
                response = dict(id=None, error=dict(code=exc.code, message=str(exc)), protocolVersion=1)
            target.write(json.dumps(response, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
            target.flush()
    finally:
        worker.close()
