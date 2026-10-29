$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$models = Join-Path $project '测试文件'
$baseline = Join-Path $project '.local\current-model-hashes.csv'
if (-not (Test-Path -LiteralPath $baseline)) { throw 'Local SHA256 baseline is missing' }
$expected = Import-Csv -LiteralPath $baseline
$current = @(Get-ChildItem -LiteralPath $models -Recurse -File | Get-FileHash -Algorithm SHA256)
$left = @($expected | ForEach-Object { $_.Path + ':' + $_.Hash } | Sort-Object)
$right = @($current | ForEach-Object { $_.Path + ':' + $_.Hash } | Sort-Object)
if (Compare-Object $left $right) { throw 'Original CAD file hash mismatch' }
Write-Output "Verified $($current.Count) original CAD assets against local baseline"
