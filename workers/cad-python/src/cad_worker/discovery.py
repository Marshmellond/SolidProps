"""Read-only SolidWorks process and COM diagnostics."""
import sys
import psutil

SOLIDWORKS = dict(
    cad_id='solidworks',
    display_name='SolidWorks',
    process_name='sldworks.exe',
    progid='SldWorks.Application',
)


def processes():
    found = []
    for process in psutil.process_iter(['pid', 'name', 'exe', 'create_time']):
        try:
            info = process.info
            if (info.get('name') or '').lower() == SOLIDWORKS['process_name']:
                found.append(dict(
                    pid=info['pid'],
                    executable=info.get('exe') or '',
                    started=info.get('create_time', 0),
                ))
        except (psutil.Error, OSError):
            continue
    return found


def registrations():
    if sys.platform != 'win32':
        return {}, ['当前系统非 Windows，SolidWorks COM 不可用。']
    import winreg
    values, issues = [], []
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, SOLIDWORKS['progid'] + r'\CLSID', 0,
                                winreg.KEY_READ | view) as key:
                clsid = winreg.QueryValueEx(key, '')[0]
            for server in ('LocalServer32', 'InprocServer32'):
                try:
                    with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, 'CLSID\\' + clsid + '\\' + server,
                                        0, winreg.KEY_READ | view) as key:
                        values.append(str(winreg.QueryValueEx(key, '')[0]))
                except FileNotFoundError:
                    pass
        except FileNotFoundError:
            pass
        except OSError as exc:
            issues.append(f'SolidWorks 注册表只读诊断失败：{exc}')
    return {SOLIDWORKS['progid']: sorted(set(values))}, issues


def discover():
    running = processes()
    regs, issues = registrations()
    registered = bool(regs.get(SOLIDWORKS['progid']))
    diagnostics = [dict(cadId='system', level='warning', message=x) for x in issues]
    detail = (f'检测到 {len(running)} 个进程；COM 注册：'
              + ('、'.join(regs.get(SOLIDWORKS['progid'], [])) or '未找到'))
    diagnostics.append(dict(
        cadId='solidworks',
        level='info' if running and registered else 'warning',
        message=detail,
    ))
    sessions = []
    for process in running:
        ok = len(running) == 1 and registered and sys.platform == 'win32'
        note = '仅附着既有会话；连接时再次核验。' if ok else (
            '多实例无法可靠区分或官方 COM 不可用，拒绝连接；不会启动或配置 SolidWorks。'
        )
        sessions.append(dict(
            id=f"solidworks:{process['pid']}:{process['started']}",
            cadId='solidworks',
            label=f"SolidWorks · PID {process['pid']}",
            pid=process['pid'],
            version='未知（连接后读取）',
            executable=process['executable'],
            connectable=ok,
            detail=note,
        ))
    return dict(sessions=sessions, diagnostics=diagnostics)
