"""Read-only process and COM diagnostics for explicitly enabled CAD plugins."""
import sys
import psutil
from .adapters import builtin_plugins


def processes():
    supported = {plugin.process_name: plugin.cad_id for plugin in builtin_plugins()}
    found = []
    for process in psutil.process_iter(['pid', 'name', 'exe', 'create_time']):
        try:
            info = process.info
            cad = supported.get((info.get('name') or '').lower())
            if cad:
                found.append(dict(cadId=cad, pid=info['pid'], executable=info.get('exe') or '', started=info.get('create_time', 0)))
        except (psutil.Error, OSError):
            continue
    return found


def registrations():
    if sys.platform != 'win32':
        return {}, ['当前系统非 Windows，CAD COM 不可用。']
    import winreg
    result, issues = {}, []
    for plugin in builtin_plugins():
        values = []
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, plugin.progid + r'\CLSID', 0, winreg.KEY_READ | view) as key:
                    clsid = winreg.QueryValueEx(key, '')[0]
                for server in ('LocalServer32', 'InprocServer32'):
                    try:
                        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, 'CLSID\\' + clsid + '\\' + server, 0, winreg.KEY_READ | view) as key:
                            values.append(str(winreg.QueryValueEx(key, '')[0]))
                    except FileNotFoundError:
                        pass
            except FileNotFoundError:
                pass
            except OSError as exc:
                issues.append(f'{plugin.progid} 注册表只读诊断失败：{exc}')
        result[plugin.progid] = sorted(set(values))
    return result, issues


def discover():
    running = processes()
    regs, issues = registrations()
    sessions = []
    diagnostics = [dict(cadId='system', level='warning', message=x) for x in issues]
    for plugin in builtin_plugins():
        group = [p for p in running if p['cadId'] == plugin.cad_id]
        registered = bool(regs.get(plugin.progid))
        detail = f'检测到 {len(group)} 个进程；COM 注册：' + ('、'.join(regs.get(plugin.progid, [])) or '未找到')
        diagnostics.append(dict(cadId=plugin.cad_id, level='info' if group and registered else 'warning', message=detail))
        for process in group:
            ok = len(group) == 1 and registered and sys.platform == 'win32'
            note = '仅附着既有会话；连接时再次核验。' if ok else '多实例无法可靠区分或官方 COM 不可用，拒绝连接；不会启动或配置 CAD。'
            sessions.append(dict(id=f"{plugin.cad_id}:{process['pid']}:{process['started']}", cadId=plugin.cad_id, label=f"{plugin.display_name} · PID {process['pid']}", pid=process['pid'], version='未知（连接后读取）', executable=process['executable'], connectable=ok, detail=note))
    return dict(sessions=sessions, diagnostics=diagnostics)
