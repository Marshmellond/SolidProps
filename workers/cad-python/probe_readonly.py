"""Manual read-only probe. Never calls apply/Set2/Save3 or starts CAD."""
import json
import traceback
from cad_worker.discovery import discover
from cad_worker.solidworks import SolidWorksAdapter
s = next(s for s in discover()['sessions'] if s['cadId'] == 'solidworks')
a = SolidWorksAdapter(s)
try:
    print(json.dumps(a.snapshot('document'), ensure_ascii=False))
except Exception:
    traceback.print_exc()
finally:
    a.close()
