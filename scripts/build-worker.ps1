$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$worker = Join-Path $project 'workers\cad-python'
$artifacts = Join-Path $project 'artifacts'
uv sync --project $worker --group dev
if ($LASTEXITCODE -ne 0) { throw 'uv sync failed' }
uv run --project $worker python -m PyInstaller --noconfirm --clean --name cad-worker --onedir --console --distpath (Join-Path $artifacts 'worker') --workpath (Join-Path $artifacts 'pyinstaller') --specpath (Join-Path $artifacts 'spec') --paths (Join-Path $worker 'src') --hidden-import win32timezone --hidden-import pythoncom --hidden-import win32com.client (Join-Path $worker 'entry.py')
if ($LASTEXITCODE -ne 0) { throw 'Worker packaging failed' }
