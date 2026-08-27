param(
    [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DshHome)) {
    $DshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
        Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
    } else {
        $env:DSH_HOME
    }
}

$nodePtyRoot = Join-Path $DshHome 'profiles\web\node_modules\node-pty'
if (-not (Test-Path -LiteralPath $nodePtyRoot)) {
    exit 0
}

function Write-AtomicUtf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    $tempPath = "$Path.$PID.tmp"
    $backupPath = "$Path.$PID.bak"
    try {
        [System.IO.File]::WriteAllText($tempPath, $Content, (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::Replace($tempPath, $Path, $backupPath)
    } finally {
        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    }
}

$targets = @(
    @{
        Path = Join-Path $nodePtyRoot 'lib\conpty_console_list_agent.js'
        Old = @(
            'var consoleProcessList = getConsoleProcessList(shellPid);'
            'process.send({ consoleProcessList: consoleProcessList });'
        )
        New = @(
            'var consoleProcessList;'
            'try {'
            '    consoleProcessList = getConsoleProcessList(shellPid);'
            '} catch (_a) {'
            '    consoleProcessList = [shellPid];'
            '}'
            'process.send({ consoleProcessList: consoleProcessList });'
        )
    }
    @{
        Path = Join-Path $nodePtyRoot 'src\conpty_console_list_agent.ts'
        Old = @(
            'const consoleProcessList = getConsoleProcessList(shellPid);'
            'process.send!({ consoleProcessList });'
        )
        New = @(
            'let consoleProcessList: number[];'
            'try {'
            '  consoleProcessList = getConsoleProcessList(shellPid);'
            '} catch {'
            '  consoleProcessList = [shellPid];'
            '}'
            'process.send!({ consoleProcessList });'
        )
    }
)

$patched = 0
foreach ($target in $targets) {
    $path = [string]$target.Path
    if (-not (Test-Path -LiteralPath $path)) {
        continue
    }
    $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    if ($content.Contains('consoleProcessList = [shellPid]')) {
        continue
    }
    $newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
    $oldText = ($target.Old -join $newline)
    if (-not $content.Contains($oldText)) {
        Write-Warning "node-pty console-list agent changed; skip unsupported patch target: $path"
        continue
    }
    $newText = ($target.New -join $newline)
    Write-AtomicUtf8NoBom -Path $path -Content $content.Replace($oldText, $newText)
    $patched++
}

if ($patched -gt 0) {
    Write-Host "[start] Patched node-pty AttachConsole fallback ($patched files)."
}
