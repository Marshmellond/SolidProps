import argparse
import json
import sys
from .service import Worker, serve
from .discovery import discover
from .adapters import builtin_plugins


def main():
    parser = argparse.ArgumentParser(description='CadWeave JSON stdio worker（不会启动 CAD）')
    parser.add_argument('--diagnose', action='store_true', help='输出一次 discover JSON 后退出')
    parser.add_argument('--self-test', action='store_true', help='执行协议和发现器自检，不连接或修改 CAD')
    args = parser.parse_args()
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='strict')
    if args.diagnose:
        print(json.dumps(discover(), ensure_ascii=False))
        return
    if args.self_test:
        report = discover()
        assert isinstance(report.get('sessions'), list)
        enabled = {p.cad_id for p in builtin_plugins()}
        assert all(session.get('cadId') in enabled for session in report['sessions'])
        print(json.dumps(dict(ok=True, discovered=len(report['sessions']), realCadTouched=False), ensure_ascii=False))
        return
    try:
        import pythoncom
    except ImportError:
        serve()
    else:
        pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)
        try:
            serve()
        finally:
            pythoncom.CoUninitialize()


if __name__ == '__main__':
    main()
