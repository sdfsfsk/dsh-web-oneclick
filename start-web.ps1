param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3080,

    [ValidateRange(1, 100)]
    [int]$KeepLogs = 20,

    [string]$LogDirectory = '',

    [string]$RepositoryRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    $localAppData = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        [Environment]::GetFolderPath('LocalApplicationData')
    } else {
        $env:LOCALAPPDATA
    }
    $LogDirectory = Join-Path $localAppData 'DeepSeekHarness\logs'
}
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

# Prune incomplete runs too: a force-killed wrapper cannot perform shutdown cleanup.
Get-ChildItem -LiteralPath $logDirectory -Filter 'dsh-web-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip ([Math]::Max(0, $KeepLogs - 1)) |
    Remove-Item -Force -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logName = "dsh-web-$timestamp.log"
$logPath = Join-Path $logDirectory $logName
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText(
    (Join-Path $logDirectory 'dsh-web-latest.txt'),
    "$logName`r`n",
    $utf8Bom
)
$writer = New-Object System.IO.StreamWriter($logPath, $false, $utf8Bom)
$writer.AutoFlush = $true

function Write-ConsoleAndLog {
    param([AllowEmptyString()][string]$Line)
    Write-Host $Line
    $writer.WriteLine($Line)
}

$exitCode = 1
Write-ConsoleAndLog "[start] DSH Web log: $logPath"
Write-ConsoleAndLog "[start] Started at $((Get-Date).ToString('o')); port=$Port; wrapperPid=$PID"

try {
    Push-Location -LiteralPath $RepositoryRoot
    try {
        & cmd.exe /d /s /c "pnpm dsh web --port $Port 2>&1" | ForEach-Object {
            Write-ConsoleAndLog ([string]$_)
        }
        $nativeExitCode = $LASTEXITCODE
        $exitCode = if ($null -eq $nativeExitCode) { 0 } else { [int]$nativeExitCode }
    } finally {
        Pop-Location
    }
} catch {
    Write-ConsoleAndLog "[crash] $($_.Exception.Message)"
    $exitCode = 1
} finally {
    Write-ConsoleAndLog "[stop] Finished at $((Get-Date).ToString('o')); exitCode=$exitCode"
    $writer.Dispose()
}

exit $exitCode
