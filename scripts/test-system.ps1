# Full system test: static checks, unit tests, worker tests, build, isolated UI E2E,
# real Electron smoke, read-only real CAD integration, and public-repo safety.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$results = [System.Collections.Generic.List[object]]::new()

function Invoke-Step {
  param([string]$Name, [scriptblock]$Action)
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "command exited with code $LASTEXITCODE" }
    $results.Add([pscustomobject]@{ Step = $Name; Status = 'PASS'; Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1) })
    Write-Host "--- PASS: $Name" -ForegroundColor Green
  } catch {
    $results.Add([pscustomobject]@{ Step = $Name; Status = 'FAIL'; Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1) })
    Write-Host "--- FAIL: $Name :: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Invoke-Step 'TypeScript typecheck' { pnpm typecheck }
Invoke-Step 'Renderer unit tests' { pnpm test }
Invoke-Step 'Python worker tests' {
  $python = Join-Path $root 'workers\cad-python\.venv\Scripts\python.exe'
  if (Test-Path -LiteralPath $python) {
    & $python -m pytest workers\cad-python\tests -q
  } else {
    pnpm test:worker
  }
}
Invoke-Step 'Desktop build' { pnpm build }
Invoke-Step 'Isolated workbench E2E' { pnpm test:e2e }
Invoke-Step 'Real Electron connection guard' { pnpm test:ui }
Invoke-Step 'Real Electron read-only smoke' { pnpm test:desktop }
Invoke-Step 'Real CAD read-only integration' { pnpm test:cad }
Invoke-Step 'Public repository safety' { pwsh -NoProfile -File scripts/verify-public-repo.ps1 }

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object { $_.Status -eq 'FAIL' })
if ($failed.Count) {
  Write-Host "$($failed.Count) step(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host "All $($results.Count) steps passed." -ForegroundColor Green
