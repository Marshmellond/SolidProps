$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
Push-Location $project
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Desktop dependency installation failed' }
  pnpm typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
  pnpm test
  if ($LASTEXITCODE -ne 0) { throw 'Desktop tests failed' }
  pnpm test:worker
  if ($LASTEXITCODE -ne 0) { throw 'Worker tests failed' }
  & (Join-Path $PSScriptRoot 'build-worker.ps1')
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
  pnpm package:win
  if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
} finally { Pop-Location }
