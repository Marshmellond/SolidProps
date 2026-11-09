"""SolidWorks active-document reader and fail-closed write coordinator.

Production writes are gated by an explicit certified-revision allowlist.
Certification used an isolated copied part; source CAD files were not modified.
"""
from pathlib import Path
from uuid import uuid4
import hashlib
import re
import shutil
import threading
from .contracts import WorkerError, capabilities, result
from . import discovery

# ICustomPropertyManager.Get6 is available from SolidWorks 2018 (revision 26).
MIN_READ_REVISION = (26, 0, 0)
CERTIFIED_WRITE_REVISIONS = {(34, 0, 0)}


def parse_revision(value):
    """Extract major/minor/patch robustly from RevisionNumber variants."""
    match = re.match(r'^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?', str(value or ''))
    if not match:
        return None
    return tuple(int(part or 0) for part in match.groups())


def read_supported(value):
    """Unknown revisions are attempted; confirmed pre-2018 revisions are rejected."""
    parsed = parse_revision(value)
    return parsed is None or parsed >= MIN_READ_REVISION


def invoke(obj, name, *args):
    value = getattr(obj, name)
    # Dynamic COM dispatch objects are callable via DISPID_VALUE even when
    # they represent a property (ActiveDoc/Extension), not a method.
    return value(*args) if callable(value) and not hasattr(value, '_oleobj_') else value


class ComBridge:
    # Default disabled; enable only after checking the exact attached revision.
    # Revision 34.0.0 BYREF I4 Save3 certified on an isolated copied model.
    write_certified = False
    write_reason = '本机未验证 SolidWorks COM Save3/out 参数绑定；真实写回已禁用，避免假成功。'

    def attach(self):
        import win32com.client
        # GetActiveObject ONLY; Dispatch/DispatchEx would launch a CAD server.
        return win32com.client.GetActiveObject('SldWorks.Application')

    def property(self, manager, name):
        """Get6 cached=True avoids activating configurations/rebuilding user data."""
        try:
            values = manager.Get6(name, True)
        except Exception:
            import pythoncom
            from win32com.client import VARIANT
            raw = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_BSTR, '')
            evaluated = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_BSTR, '')
            resolved = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_BOOL, False)
            linked = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_BOOL, False)
            status = manager.Get6(name, True, raw, evaluated, resolved, linked)
            values = (status, raw.value, evaluated.value, resolved.value, linked.value)
        if not isinstance(values, tuple) or len(values) != 5:
            raise WorkerError('API_UNRELIABLE', 'Get6 返回形状无法确认，拒绝伪造属性值。')
        status, raw, evaluated, resolved, linked = values
        if type(status) is not int or status not in (0, 2) or not isinstance(raw, str) or not isinstance(evaluated, str) or type(linked) is not bool:
            raise WorkerError('API_UNRELIABLE', 'Get6 返回状态或属性类型无法确认。')
        value_type = manager.GetType2(name)
        if type(value_type) is not int:
            raise WorkerError('API_UNRELIABLE', 'GetType2 未返回明确的整数类型。')
        return dict(name=name, value=raw, evaluated=evaluated, valueType='text' if value_type == 30 else 'other', linked=linked, resolved=bool(resolved))

    def certify(self, revision):
        parsed = parse_revision(revision)
        self.write_certified = parsed in CERTIFIED_WRITE_REVISIONS
        label = str(revision or '版本未知')
        self.write_reason = (
            'SolidWorks 34.0.0：可读取并写回既有普通文本属性；新增/删除尚未完成实机认证。'
            if self.write_certified
            else f'SolidWorks {label}：仅可读取；写回仅认证 34.0.0。'
        )

    def save(self, document):
        if not self.write_certified:
            raise WorkerError('WRITE_DISABLED', self.write_reason)
        import pythoncom
        from win32com.client import VARIANT
        errors = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        warnings = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        saved = document.Save3(1, errors, warnings)
        if bool(invoke(document, 'GetSaveFlag')):
            raise WorkerError('SAVE_FAILED', 'Save3 后模型仍有未保存修改，不能确认保存。')
        return saved, errors.value, warnings.value


class SolidWorksAdapter:
    def __init__(self, session, bridge=None, inventory=None, backup_root=None):
        self.session = session
        production_bridge = bridge is None
        self.bridge = bridge or ComBridge()
        self.inventory = inventory or discovery.processes
        self.thread = threading.get_ident()
        self.backup_root = backup_root or Path.home() / 'SolidProps' / 'backups'
        self._check_process()
        self.app = self.bridge.attach()
        self._check_process()
        # Verify ROT target PID instead of assuming the one visible process owns it.
        pid = int(invoke(self.app, 'GetProcessID'))
        if pid != session['pid']:
            raise WorkerError('SESSION_CHANGED', 'ROT 对象 PID 与所选会话不一致。')
        try:
            self.session['version'] = str(invoke(self.app, 'RevisionNumber'))
        except Exception:
            pass
        if production_bridge:
            if not read_supported(self.session.get('version')):
                raise WorkerError(
                    'UNSUPPORTED_VERSION',
                    f'SolidWorks {self.session.get("version")} 低于最低支持版本 2018（26.0.0），无法读取自定义属性。',
                )
            self.bridge.certify(self.session['version'])
        self.capabilities = capabilities(self.bridge.write_certified, notes=self.bridge.write_reason)
        self.doc = None
        self.identity = None
        self.write_uncertain = False
        self.documents = {}
        # Development fixture guard. Frozen products have no checkout fixture root.
        checkout = Path(__file__).resolve().parents[4]
        self.protected_roots = [checkout / '测试文件'] if (checkout / '测试文件').is_dir() else []

    def _check_process(self):
        if threading.get_ident() != self.thread:
            raise WorkerError('THREAD_VIOLATION', 'COM 调用只能在 Worker 主线程串行执行。')
        group = list(self.inventory())
        if len(group) != 1:
            raise WorkerError('AMBIGUOUS_SESSION', 'SolidWorks 多实例或会话已退出，无法可靠区分，拒绝连接/写入。')
        p = group[0]
        if f"solidworks:{p['pid']}:{p['started']}" != self.session['id']:
            raise WorkerError('SESSION_CHANGED', 'SolidWorks 进程身份已变化。')

    def _document_identity(self, doc):
        if doc is None:
            raise WorkerError('NO_ACTIVE_DOCUMENT', 'SolidWorks 没有活动文档。')
        path = str(invoke(doc, 'GetPathName'))
        config = str(invoke(invoke(doc, 'ConfigurationManager'), 'ActiveConfiguration').Name)
        return (path, str(invoke(doc, 'GetTitle')), config, int(invoke(doc, 'GetType')))

    def validate(self):
        self._check_process()
        if int(invoke(self.app, 'GetProcessID')) != self.session['pid']:
            raise WorkerError('SESSION_CHANGED', 'COM 会话 PID 已变化。')
        active = invoke(self.app, 'ActiveDoc')
        if self.doc is not None:
            # COM IUnknown equality plus path/config check: same-name replacement
            # or close/reopen must not pass a pathname-only comparison.
            if active != self.doc or self._document_identity(active) != self.identity:
                raise WorkerError('ACTIVE_DOCUMENT_CHANGED', '活动文档或配置已变化，请重新获取快照。')

    def _manager(self, scope):
        name = self.identity[2] if scope == 'configuration' else ''
        extension = invoke(self.doc, 'Extension')
        return extension.CustomPropertyManager(name)

    def _properties(self, manager):
        names = invoke(manager, 'GetNames') or []
        properties, warnings = [], []
        for name in names:
            try:
                prop = self.bridge.property(manager, str(name))
                text = prop['valueType'] == 'text'
                literal = not prop['linked'] and prop['value'] == prop['evaluated'] and not any(t in prop['value'] for t in ('$PRP', 'SW-', '="'))
                writable = bool(self.bridge.write_certified and text and literal)
                reason = '' if writable else (self.bridge.write_reason if not self.bridge.write_certified else '仅支持既有未链接的普通文本属性。')
                properties.append({k: prop[k] for k in ('name', 'value', 'valueType', 'evaluated')} | dict(writable=writable, reason=reason))
                if not prop['resolved']:
                    warnings.append(f'{name} 使用缓存值，未强制激活配置或重建。')
            except Exception as exc:
                warnings.append(f'{name} 无法可靠读取：{exc}')
        return properties, warnings

    def _model(self, document, scope, config, warnings):
        path = str(invoke(document, 'GetPathName'))
        title = str(invoke(document, 'GetTitle'))
        canonical = str(Path(path).resolve()).casefold() if path else title
        key = (canonical, config if scope == 'configuration' else '', scope)
        model_id = hashlib.sha256(repr(key).encode()).hexdigest()[:24]
        previous = self.documents.get(model_id)
        if previous and previous['doc'] != document:
            raise WorkerError('AMBIGUOUS_DOCUMENT', '同一文件标识对应不同COM文档，拒绝读取/写入。')
        properties, notes = self._properties(invoke(document, 'Extension').CustomPropertyManager(config if scope == 'configuration' else ''))
        warnings.extend(f'{title}: {note}' for note in notes)
        kind = int(invoke(document, 'GetType'))
        if kind not in (1, 2):
            raise WorkerError('UNSUPPORTED_DOCUMENT', '仅支持零件或装配。')
        dirty = bool(invoke(document, 'GetSaveFlag'))
        readonly = bool(invoke(document, 'IsOpenedReadOnly'))
        protected = any(Path(path).resolve().is_relative_to(root.resolve()) for root in self.protected_roots) if path else False
        writable = bool(self.bridge.write_certified and scope == 'document' and path and Path(path).is_file() and not dirty and not readonly and not protected and not self.write_uncertain)
        if writable:
            reason = ''
        elif self.write_uncertain:
            reason = '上次保存状态未知，请在CAD检查后重新连接。'
        elif protected:
            reason = '客户原始测试文件受保护，请使用完整工作副本。'
        elif dirty:
            reason = 'SolidWorks 中已有未保存修改；请自行保存或处理后重新读取，避免提交属性时一并保存其他修改。'
        elif readonly:
            reason = '文件在 SolidWorks 中以只读方式打开。'
        elif not self.bridge.write_certified:
            reason = '当前 SolidWorks 版本尚未认证写入接口，仅可读取。'
        elif scope != 'document':
            reason = '仅支持文档属性写入。'
        else:
            reason = '模型尚未保存到有效文件路径。'
        for prop in properties:
            if not writable:
                prop.update(writable=False, reason=reason)
        self.documents[model_id] = dict(doc=document, path=path, canonical=canonical, scope=scope, config=config)
        return dict(id=model_id, name=title, path=path, kind='part' if kind == 1 else 'assembly', configuration=config, scope=scope, properties=properties, writable=writable, reason=reason, dirty=dirty)

    def _validate_target(self, record, clean=True):
        self.validate()
        if not self.bridge.write_certified or record['scope'] != 'document':
            raise WorkerError('WRITE_DISABLED', '当前目标作用域或版本不可写。')
        doc, path = record['doc'], record['path']
        if str(invoke(doc, 'GetPathName')) != path or invoke(self.app, 'GetOpenDocumentByName', path) != doc:
            raise WorkerError('DOCUMENT_CHANGED', '目标模型已关闭、重开、换路径或COM身份变化。')
        if any(Path(path).resolve().is_relative_to(root.resolve()) for root in self.protected_roots):
            raise WorkerError('PROTECTED_SOURCE', '禁止写入开发原始测试文件，请使用完整独立副本。')
        if bool(invoke(doc, 'IsOpenedReadOnly')):
            raise WorkerError('READ_ONLY', '目标模型以只读方式打开。')
        if clean and bool(invoke(doc, 'GetSaveFlag')):
            raise WorkerError('DIRTY_MODEL', '目标模型已有未保存修改，禁止保存。')
        return doc

    def snapshot(self, scope):
        self._check_process()
        self.doc = invoke(self.app, 'ActiveDoc')
        self.identity = self._document_identity(self.doc)
        if self.identity[3] not in (1, 2):
            raise WorkerError('UNSUPPORTED_DOCUMENT', '仅支持零件和装配体，不支持工程图。')
        self.validate()
        self.documents = {}
        warnings = ['上次保存状态未知，请在CAD检查后重新连接；重新读取不会解除写入锁定。'] if self.write_uncertain else []
        path, title, config, kind = self.identity
        model = self._model(self.doc, scope, config, warnings)
        root = dict(id='active', name=title, modelId=model['id'], children=[], status='已加载')
        if kind == 2:
            warnings.append('装配读取活动根及已加载子模型属性；仅document作用域支持分文档保存，不解析轻量化/抑制件，不激活配置。')
            root['children'] = self._occurrences(warnings, scope, models := [model])
        else:
            models = [model]
        self.validate()
        return dict(id=str(uuid4()), sessionId=self.session['id'], title=title, cadId='solidworks', scope=scope, models=models, root=root, warnings=warnings)

    def _occurrences(self, warnings, scope, models):
        try:
            root = invoke(invoke(invoke(self.doc, 'ConfigurationManager'), 'ActiveConfiguration'), 'GetRootComponent3', False)
            seen = set()
            def visit(component, index, depth=0):
                if depth > 64 or len(seen) > 10000:
                    raise WorkerError('TREE_LIMIT', '装配结构超过安全读取上限。')
                name = str(invoke(component, 'Name2'))
                key = f'{index}:{name}'
                seen.add(key)
                suppressed = bool(invoke(component, 'IsSuppressed'))
                children = [] if suppressed else invoke(component, 'GetChildren') or []
                model_id = None
                status = '抑制（未解析）' if suppressed else '未加载/轻量化（不强制解析）'
                if not suppressed:
                    try:
                        document = invoke(component, 'GetModelDoc2')
                        if document is not None:
                            config = str(invoke(component, 'ReferencedConfiguration'))
                            candidate = self._model(document, scope, config, warnings)
                            model_id = candidate['id']
                            if not any(m['id'] == model_id for m in models):
                                models.append(candidate)
                            status = '已加载'
                    except Exception as exc:
                        warnings.append(f'{name} 子模型读取失败：{exc}')
                        model_id = None
                        status = '子模型读取失败'
                return dict(id=key, name=name, modelId=model_id, children=[visit(c, key + '/' + str(i), depth + 1) for i, c in enumerate(children)], status=status)
            return [visit(c, str(i)) for i, c in enumerate(invoke(root, 'GetChildren') or [])] if root else []
        except Exception as exc:
            warnings.append(f'发生项读取不完整：{exc}')
            return []

    def _property_names(self, manager):
        names = invoke(manager, 'GetNames')
        if names is None:
            return []
        if not isinstance(names, (list, tuple)) or any(not isinstance(n, str) or not n.strip() for n in names):
            raise WorkerError('API_UNRELIABLE', 'GetNames 返回形状或属性名无法确认。')
        if len({n.casefold() for n in names}) != len(names):
            raise WorkerError('PROPERTY_NAME_CONFLICT', '存在不区分大小写的属性名冲突。')
        return names

    def _preflight_property(self, manager, change):
        operation = change.get('operation', 'update')
        names = self._property_names(manager)
        matches = [name for name in names if name.casefold() == change['propertyName'].casefold()]
        if operation == 'add':
            if matches:
                raise WorkerError('PROPERTY_EXISTS', '新增属性名已存在（不区分大小写）。')
            return
        if not matches:
            raise WorkerError('UNKNOWN_PROPERTY', '待修改或删除属性已不存在。')
        if matches != [change['propertyName']]:
            raise WorkerError('PROPERTY_NAME_CONFLICT', '属性名称大小写已变化。')
        prop = self.bridge.property(manager, change['propertyName'])
        if prop['value'] != change['oldValue']:
            raise WorkerError('VALUE_CONFLICT', '原属性值已变化，请重新获取快照。')
        if (prop['valueType'] != 'text' or prop['linked'] or prop['value'] != prop['evaluated']
                or any(token in prop['value'] for token in ('$PRP', 'SW-', '="'))):
            raise WorkerError('READ_ONLY', '仅支持未链接普通文本属性。')

    def apply(self, snapshot, changes):
        self.validate()
        if self.write_uncertain:
            raise WorkerError('WRITE_STATE_UNCERTAIN', '本连接已有未确认写入/保存，禁止后续自动保存；请人工处理后断开重连。')
        if not self.bridge.write_certified:
            raise WorkerError('WRITE_DISABLED', self.bridge.write_reason)
        if snapshot['scope'] != 'document':
            raise WorkerError('UNSUPPORTED_SCOPE', 'configuration作用域只读；当前仅document支持写回。')
        models = {model['id']: model for model in snapshot['models']}
        groups, seen = {}, set()
        # Whole-batch identity, original value and dirty preflight before backups.
        for index, change in enumerate(changes):
            if (not isinstance(change, dict) or set(change) - {'modelId', 'propertyName', 'oldValue', 'newValue', 'operation'}
                    or not {'modelId', 'propertyName', 'oldValue', 'newValue'} <= change.keys()
                    or any(not isinstance(v, str) or len(v) > 65536 or '\x00' in v for v in change.values())):
                raise WorkerError('INVALID_PARAMS', '无效属性变更字段。')
            operation = change.get('operation', 'update')
            if operation not in ('add', 'update', 'delete') or not change['propertyName'].strip():
                raise WorkerError('INVALID_PARAMS', '无效操作或空属性名。')
            if (operation == 'add' and change['oldValue'] != '') or (operation == 'delete' and change['newValue'] != ''):
                raise WorkerError('INVALID_PARAMS', '新增 oldValue / 删除 newValue 必须为空字符串。')
            key = (change['modelId'], change['propertyName'].casefold())
            if key in seen:
                raise WorkerError('DUPLICATE_CHANGE', '同一属性重复提交。')
            seen.add(key)
            record = self.documents.get(change['modelId'])
            model = models.get(change['modelId'])
            if not record or not model or model['path'] != record['path']:
                raise WorkerError('UNKNOWN_MODEL', '目标不属于当前私有快照映射。')
            if not model['writable'] or model['dirty']:
                raise WorkerError('READ_ONLY', model['reason'] or '快照模型不可写。')
            if operation != 'add':
                props = [p for p in model['properties'] if p['name'].casefold() == change['propertyName'].casefold()]
                if len(props) != 1 or props[0]['name'] != change['propertyName']:
                    raise WorkerError('UNKNOWN_PROPERTY', '属性不属于快照或名称有歧义。')
                if not props[0]['writable']:
                    raise WorkerError('READ_ONLY', props[0]['reason'] or '快照属性不可写。')
                if props[0]['value'] != change['oldValue']:
                    raise WorkerError('VALUE_CONFLICT', '原值与快照不一致。')
            elif any(p['name'].casefold() == change['propertyName'].casefold() for p in model['properties']):
                raise WorkerError('PROPERTY_EXISTS', '快照中新增属性名已存在。')
            doc = self._validate_target(record)
            if operation != 'delete' and any(token in change['newValue'] for token in ('$PRP', 'SW-', '="')):
                raise WorkerError('UNSUPPORTED_VALUE', '不接受可能触发链接/表达式的新值。')
            manager = invoke(doc, 'Extension').CustomPropertyManager('')
            self._preflight_property(manager, change)
            group = groups.setdefault(record['canonical'], dict(record=record, manager=manager, items=[]))
            if group['record']['doc'] != doc:
                raise WorkerError('AMBIGUOUS_DOCUMENT', '同文件多COM文档，拒绝保存。')
            group['items'].append((index, change))
        directory = Path(self.backup_root) / str(uuid4())
        try:
            directory.mkdir(parents=True, exist_ok=False)
            for index, group in enumerate(groups.values()):
                source = Path(group['record']['path'])
                if not source.is_file() or source.is_symlink():
                    raise OSError('原文件不存在或是符号链接')
                # Separate per-document directories avoid same-basename collisions.
                target = directory / str(index) / source.name
                target.parent.mkdir()
                shutil.copy2(source, target)
                if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
                    raise OSError('备份校验失败')
        except OSError as exc:
            raise WorkerError('BACKUP_FAILED', f'全批备份失败，未修改模型：{exc}') from exc
        # Recheck EVERY target and property after ALL backups, before mutation.
        for group in groups.values():
            self._validate_target(group['record'])
            for _, change in group['items']:
                self._preflight_property(group['manager'], change)
        results = [result(c, message='前文档失败，尚未执行/已取消。') for c in changes]
        for group in groups.values():
            manager, record = group['manager'], group['record']
            try:
                document = self._validate_target(record)
                for index, change in group['items']:
                    self._validate_target(record, clean=False)
                    self._preflight_property(manager, change)
                    operation = change.get('operation', 'update')
                    self.write_uncertain = True
                    if operation == 'add':
                        # swCustomInfoText=30, swCustomPropertyOnlyIfNew=0.
                        # Never delete/replace an existing property as part of add.
                        code = manager.Add3(change['propertyName'], 30, change['newValue'], 0)
                        api = 'Add3'
                    elif operation == 'delete':
                        code = manager.Delete2(change['propertyName'])
                        api = 'Delete2'
                    else:
                        code = manager.Set2(change['propertyName'], change['newValue'])
                        api = 'Set2'
                    if type(code) is not int or code != 0:
                        raise WorkerError({'add': 'ADD_FAILED', 'delete': 'DELETE_FAILED', 'update': 'SET_FAILED'}[operation], f'{api}未明确成功：{code!r}')
                    names = self._property_names(manager)
                    matches = [n for n in names if n.casefold() == change['propertyName'].casefold()]
                    if operation == 'delete':
                        if matches:
                            raise WorkerError('VERIFY_FAILED', '删除后属性仍存在，未保存。')
                    else:
                        if matches != [change['propertyName']]:
                            raise WorkerError('VERIFY_FAILED', '写入后属性名不匹配，未保存。')
                        # Verify raw value, text type, linkage and evaluated value.
                        self._preflight_property(manager, dict(change, operation='update', oldValue=change['newValue']))
                    results[index] = result(change, message='内存回读一致，尚未保存。')
                self._validate_target(record, clean=False)
                saved, errors, warnings = self.bridge.save(document)
                if saved is not True or type(errors) is not int or errors != 0:
                    raise WorkerError('SAVE_FAILED', f'Save3未明确成功：errors={errors!r}')
                self.write_uncertain = False
                for index, change in group['items']:
                    results[index] = result(change, True, f'本文件Save3成功；未重开验证。warnings={warnings}', True, False)
            except Exception as exc:
                for index, change in group['items']:
                    results[index] = result(change, message=f'本文件失败：{exc}；停止后续文件，可能保留未保存修改。')
                break
        return dict(results=results, backupDirectory=str(directory))

    def close(self):
        # Do not close CAD/documents, save, rebuild, or call ExitApp.
        self.doc = None
        self.documents = {}
        self.app = None
