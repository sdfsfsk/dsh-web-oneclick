<#
.SYNOPSIS
  管理面板的启动与日志助手（由 start-panel.bat 调用，也可单独跑）。

.DESCRIPTION
  与 start-web.ps1 同一个套路：控制台与 UTF-8 日志双写、维护 latest 指针、保留最近若干份，
  差别只是这里跑的是面板自己（panel-server.mjs），而不是 dsh。
  面板进程是常驻的：dsh 的启停、日志、自检都由它在内部管，这里只负责把它拉起来并把
  输出留档——面板崩了的时候，日志就是唯一的现场。
#>
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3080,

    [ValidateRange(1, 100)]
    [int]$KeepLogs = 20,

    [string]$LogDirectory = '',

    [string]$PanelRoot = $PSScriptRoot,

    [string]$RepositoryRoot = ''
)

$ErrorActionPreference = 'Stop'
# node 往管道里写的是 UTF-8；不设这个，中文日志会被按 GBK 解码成乱码
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { /* 老系统上失败就算了 */ }

# 调用方（start-panel.bat）传的是 %~dp0 这类带尾部反斜杠的路径，而 PowerShell 的
# -LiteralPath 会把结尾的反斜杠当转义字符吃掉，报 "Illegal characters in path"
$PanelRoot = $PanelRoot.TrimEnd('\', '/')
$RepositoryRoot = $RepositoryRoot.TrimEnd('\', '/')

if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    $localAppData = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        [Environment]::GetFolderPath('LocalApplicationData')
    } else {
        $env:LOCALAPPDATA
    }
    $LogDirectory = Join-Path $localAppData 'DeepSeekHarness\logs'
}
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

# 被强杀的一轮不会自己收尾，所以残缺日志也一起按时间清理
Get-ChildItem -LiteralPath $LogDirectory -Filter 'dsh-panel-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip ([Math]::Max(0, $KeepLogs - 1)) |
    Remove-Item -Force -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logName = "dsh-panel-$timestamp.log"
$logPath = Join-Path $LogDirectory $logName
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText(
    (Join-Path $LogDirectory 'dsh-panel-latest.txt'),
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

# 面板自己的端口、dsh 网页端口、DSH 源码目录：都用环境变量递给 panel-server.mjs
$env:DSH_PANEL_WEB_PORT = [string]$Port
if (-not [string]::IsNullOrWhiteSpace($RepositoryRoot)) { $env:DSH_PANEL_REPO = $RepositoryRoot }

$exitCode = 1
Write-ConsoleAndLog "[panel] 面板日志: $logPath"
Write-ConsoleAndLog "[panel] Started at $((Get-Date).ToString('o')); dsh web port=$Port; wrapperPid=$PID"

try {
    Push-Location -LiteralPath $PanelRoot
    try {
        & node panel-server.mjs 2>&1 | ForEach-Object {
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
    Write-ConsoleAndLog "[panel] Finished at $((Get-Date).ToString('o')); exitCode=$exitCode"
    $writer.Dispose()
}

exit $exitCode