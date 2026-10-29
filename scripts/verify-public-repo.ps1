$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $tracked = @(git ls-files)
    $customer = @($tracked | Where-Object { $_ -match '(^|[/\\])测试文件([/\\]|$)' })
    if ($customer.Count -gt 0) {
        throw "Customer test files are tracked: $($customer.Count)"
    }
    $patterns = @('测试文件/', 'artifacts/', '.local/', 'node_modules/')
    $ignoreText = Get-Content -LiteralPath '.gitignore' -Raw
    foreach ($pattern in $patterns) {
        if ($ignoreText -notmatch [regex]::Escape($pattern)) {
            throw "Missing ignore rule: $pattern"
        }
    }
    if (Test-Path -LiteralPath '测试文件') {
        $modelCount = @(Get-ChildItem -LiteralPath '测试文件' -Recurse -File).Count
        if ($modelCount -eq 0) { throw 'Customer test directory is unexpectedly empty' }
        $ignored = git check-ignore --no-index -q -- '测试文件\solidworks\活塞总成\活塞头.SLDPRT'
        if ($LASTEXITCODE -ne 0) { throw 'Representative customer model is not ignored' }
    }
    Write-Output "Public repository check passed: tracked=$($tracked.Count), customerFilesTracked=$($customer.Count)"
} finally {
    Pop-Location
}
