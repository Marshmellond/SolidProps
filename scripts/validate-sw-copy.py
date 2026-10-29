"""Explicit scratch-copy Save3 binding validation. Never saves an existing document."""
import hashlib
import json
from datetime import datetime
from pathlib import Path
import shutil
import sys
import pythoncom
import win32com.client
from win32com.client import VARIANT

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'workers/cad-python/src'))
from cad_worker.solidworks import invoke, ComBridge


def main():
    pythoncom.CoInitialize()
    report = {'sourceUnchanged': False, 'reopenedVerified': False}
    app = win32com.client.GetActiveObject('SldWorks.Application')
    original = invoke(app, 'ActiveDoc')
    original_title = str(invoke(original, 'GetTitle')) if original is not None else ''
    original_dirty = bool(invoke(original, 'GetSaveFlag')) if original is not None else False
    source = root / '测试文件/solidworks/活塞总成/活塞头.SLDPRT'
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    target_dir = root / '.local/cad-validation' / datetime.now().strftime('%Y%m%d-%H%M%S')
    target_dir.mkdir(parents=True, exist_ok=False)
    target = target_dir / 'cadweave_validation_copy.SLDPRT'
    shutil.copy2(source, target)
    report['scratchFile'] = str(target)
    doc = None
    try:
        errors = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        warnings = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        doc = app.OpenDoc6(str(target), 1, 1, '', errors, warnings)
        if doc is None or Path(str(invoke(doc, 'GetPathName'))).resolve() != target.resolve():
            raise RuntimeError('Scratch path was not opened exactly; refusing mutation')
        if bool(invoke(doc, 'IsOpenedReadOnly')):
            raise RuntimeError('Scratch model opened readonly')
        manager = invoke(doc, 'Extension').CustomPropertyManager('')
        bridge = ComBridge()
        names = invoke(manager, 'GetNames') or []
        chosen = None
        for name in names:
            prop = bridge.property(manager, name)
            if prop['valueType'] == 'text' and not prop['linked'] and prop['value'] == prop['evaluated']:
                chosen = prop
                break
        if chosen is None:
            raise RuntimeError('No existing literal text property for controlled validation')
        report['propertyName'] = chosen['name']
        report['oldValue'] = chosen['value']
        new = 'CadWeave-Save3-Validation-' + datetime.now().strftime('%H%M%S')
        code = manager.Set2(chosen['name'], new)
        report['setResult'] = code
        if type(code) is not int or code != 0:
            raise RuntimeError(f'Unexpected Set2 result {code!r}')
        errors.value = 0
        warnings.value = 0
        saved = doc.Save3(1, errors, warnings)
        report.update(saveReturn=saved, saveErrors=errors.value, saveWarnings=warnings.value)
        if saved is not True or errors.value != 0 or bool(invoke(doc, 'GetSaveFlag')):
            raise RuntimeError('Save3 did not provide unambiguous success')
        title = str(invoke(doc, 'GetTitle'))
        app.CloseDoc(title)
        doc = None
        reopened = app.OpenDoc6(str(target), 1, 1, '', errors, warnings)
        doc = reopened
        if doc is None or Path(str(invoke(doc, 'GetPathName'))).resolve() != target.resolve():
            raise RuntimeError('Reopen target mismatch')
        actual = bridge.property(invoke(doc, 'Extension').CustomPropertyManager(''), chosen['name'])
        report['reopenedVerified'] = actual['value'] == new
        if not report['reopenedVerified']:
            raise RuntimeError('Reopened property not persisted')
        report['revision'] = str(invoke(app, 'RevisionNumber'))
        report['success'] = True
    except Exception as exc:
        report['success'] = False
        report['error'] = repr(exc)
    finally:
        if doc is not None:
            # Close scratch only. Never save from cleanup.
            app.CloseDoc(str(invoke(doc, 'GetTitle')))
        if original_title:
            try:
                err = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                app.ActivateDoc3(original_title, False, 0, err)
                report['originalDirtyPreserved'] = bool(invoke(original, 'GetSaveFlag')) == original_dirty
            except Exception as exc:
                report['restoreWarning'] = repr(exc)
        report['sourceUnchanged'] = hashlib.sha256(source.read_bytes()).hexdigest() == before
        (target_dir / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
        pythoncom.CoUninitialize()
    return 0 if report.get('success') and report['sourceUnchanged'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
