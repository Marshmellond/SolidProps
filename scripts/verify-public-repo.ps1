$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $tracked = @(git ls-files)
    $customer = @($tracked | Where-Object { $_ -match '(^|[/\\])测试文件([/\\]|$)' })
    if ($customer.Count -gt 0) {
        throw "Customer test files are tracked: $($customer.Count)"
    }
    $patterns = @('artifacts/', '.local/', 'node_modules/')
    $ignoreText = Get-Content -LiteralPath '.gitignore' -Raw
    foreach ($pattern in $patterns) {
        if ($ignoreText -notmatch [regex]::Escape($pattern)) {
            throw "Missing ignore rule: $pattern"
        }
    }
    if (Test-Path -LiteralPath '测试文件') {
        throw 'Customer test directory should not be present in the repository'
    }
    Write-Output "Public repository check passed: tracked=$($tracked.Count), customerFilesTracked=$($customer.Count)"
} finally {
    Pop-Location
}
