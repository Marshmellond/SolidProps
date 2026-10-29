"""Opt-in grouped write certification using complete isolated assembly copies.

Fails BEFORE mutation if any loaded dependency resolves outside the copy tree.
Never closes/saves any document that was open before this script.
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path
import shutil
import sys
import pythoncom
import win32com.client
from win32com.client import VARIANT

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'workers/cad-python/src'))
from cad_worker.discovery import discover
from cad_worker.solidworks import SolidWorksAdapter, invoke


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    pythoncom.CoInitialize()
    output = ROOT / '.local/cad-validation' / ('assembly-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    output.mkdir(parents=True, exist_ok=False)
    source = ROOT / '测试文件/solidworks/活塞总成'
    before = {str(p.relative_to(source)): digest(p) for p in source.rglob('*') if p.is_file()}
    copy = output / 'assembly-copy'
    shutil.copytree(source, copy)
    target = next(copy.glob('*.SLDASM'))
    report = dict(success=False, mutated=False, sourceUnchanged=False, originalDirtyPreserved=False, copyDirectory=str(copy))
    adapter = None
    app = win32com.client.GetActiveObject('SldWorks.Application')
    original = invoke(app, 'ActiveDoc')
    original_title = str(invoke(original, 'GetTitle')) if original else ''
    original_dirty = bool(invoke(original, 'GetSaveFlag')) if original else False
    original_docs = list(invoke(app, 'GetDocuments') or [])
    scratch = None
    try:
        errors = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        warnings = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        scratch = app.OpenDoc6(str(target), 2, 1, '', errors, warnings)
        if scratch is None or Path(str(invoke(scratch, 'GetPathName'))).resolve() != target.resolve():
            raise RuntimeError('Copy assembly did not open exactly; refusing all mutation')
        # OpenDoc6 may keep the previous document active. Activate ONLY exact copy.
        activate_errors = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        app.ActivateDoc3(str(invoke(scratch, 'GetTitle')), False, 0, activate_errors)
        if invoke(app, 'ActiveDoc') != scratch:
            raise RuntimeError('Scratch not active; refusing mutation')
        session = next(s for s in discover()['sessions'] if s['cadId'] == 'solidworks' and s['connectable'])
        adapter = SolidWorksAdapter(session)
        snapshot = adapter.snapshot('document')
        report['models'] = [dict(id=m['id'], path=m['path'], dirty=m['dirty']) for m in snapshot['models']]
        if len(snapshot['models']) < 2:
            raise RuntimeError('No loaded child model; grouped validation not possible')
        for model in snapshot['models']:
            if not model['path'] or not Path(model['path']).resolve().is_relative_to(copy.resolve()):
                raise RuntimeError('Loaded dependency outside isolated copy tree; no model was modified')
        # Never use an object that was open before validation, even if path matches.
        if any(record['doc'] in original_docs for record in adapter.documents.values()):
            raise RuntimeError('Pre-existing document reused; refusing mutation')
        changes = []
        for model in snapshot['models']:
            if not model['writable']:
                raise RuntimeError(f'Copy model is dirty/read-only: {model["name"]}')
            prop = next((p for p in model['properties'] if p['writable']), None)
            if not prop:
                raise RuntimeError('No writable existing literal text property on each copy model')
            changes.append(dict(modelId=model['id'], propertyName=prop['name'], oldValue=prop['value'], newValue='CadWeave-Grouped-Copy-' + output.name))
        report['mutated'] = True
        report['apply'] = adapter.apply(snapshot, changes)
        report['success'] = all(r['success'] and r['saved'] for r in report['apply']['results'])
        report['productionVerified'] = False
        # Independent disk persistence check: close only newly-opened copy docs.
        if report['success']:
            copy_docs = [record['doc'] for record in adapter.documents.values()]
            for doc in copy_docs:
                if doc in original_docs:
                    raise RuntimeError('Cleanup identity guard')
            app.CloseDoc(str(invoke(scratch, 'GetTitle')))
            scratch = None
            for doc in copy_docs:
                path = str(invoke(doc, 'GetPathName'))
                if app.GetOpenDocumentByName(path) == doc:
                    app.CloseDoc(str(invoke(doc, 'GetTitle')))
            checks = []
            for model, change in zip(snapshot['models'], changes):
                doc = app.OpenDoc6(model['path'], 2 if model['kind'] == 'assembly' else 1, 1, '', errors, warnings)
                if doc is None or Path(str(invoke(doc, 'GetPathName'))).resolve() != Path(model['path']).resolve():
                    raise RuntimeError('Reopen copy path mismatch')
                actual = adapter.bridge.property(invoke(doc, 'Extension').CustomPropertyManager(''), change['propertyName'])
                checks.append(actual['value'] == change['newValue'])
                app.CloseDoc(str(invoke(doc, 'GetTitle')))
            report['reopenedVerified'] = all(checks)
    except Exception as exc:
        report['error'] = repr(exc)
        report['success'] = False
    finally:
        if adapter:
            adapter.close()
        # Cleanup cannot save. Only close new objects whose actual path is copy-local.
        for doc in list(invoke(app, 'GetDocuments') or []):
            try:
                path = Path(str(invoke(doc, 'GetPathName'))).resolve()
                if doc not in original_docs and path.is_relative_to(copy.resolve()):
                    app.CloseDoc(str(invoke(doc, 'GetTitle')))
            except Exception as exc:
                report.setdefault('cleanupWarnings', []).append(repr(exc))
        if original_title:
            err = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
            app.ActivateDoc3(original_title, False, 0, err)
            report['originalDirtyPreserved'] = bool(invoke(original, 'GetSaveFlag')) == original_dirty
        report['sourceUnchanged'] = all((source / name).is_file() and digest(source / name) == checksum for name, checksum in before.items())
        (output / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
        pythoncom.CoUninitialize()
    return 0 if report['success'] and report['sourceUnchanged'] and report['originalDirtyPreserved'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
