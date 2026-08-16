# update-mnemon.ps1 — 由 update.bat 调用：检查并更新 Mnemon CLI 到最新 GitHub release。
# 语义为"尽力而为"：任何失败只打印警告并以 0 退出，不阻断 update.bat 的其他更新。
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\mnemon'
$exe = Join-Path $installDir 'mnemon.exe'
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'amd64' }
$proxyArgs = @{}
if ($env:HTTPS_PROXY) { $proxyArgs.Proxy = $env:HTTPS_PROXY }

try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/mnemon-dev/mnemon/releases/latest' -Headers @{ 'User-Agent' = 'dsh-update' } @proxyArgs
    $latest = $release.tag_name -replace '^v', ''
    $current = $null
    if (Test-Path $exe) {
        $current = (& $exe --version) -replace '^.*version\s+', ''
    }
    if ($current -eq $latest) {
        Write-Host "[update] Mnemon CLI 已是最新（$latest）。"
        exit 0
    }
    $currentDisplay = if ($current) { $current } else { '未安装' }
    Write-Host "[update] Mnemon CLI: $currentDisplay -> $latest，下载更新..."
    $zipName = "mnemon_${latest}_windows_${arch}.zip"
    $zip = Join-Path $env:TEMP $zipName
    $shaFile = "$zip.sha256src"
    $base = "https://github.com/mnemon-dev/mnemon/releases/download/v$latest"
    Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zip @proxyArgs
    Invoke-WebRequest -Uri "$base/checksums.txt" -OutFile $shaFile @proxyArgs
    $expected = Get-Content $shaFile | Where-Object { $_ -match [regex]::Escape($zipName) } | ForEach-Object { ($_ -split '\s+')[0] }
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $expected -or $expected -ne $actual) { throw "校验和不匹配：$zipName" }
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $installDir -Force
    Remove-Item $zip, $shaFile -Force -ErrorAction SilentlyContinue
    Write-Host "[update] Mnemon CLI 已更新：$(& $exe --version)。"
} catch {
    Write-Host "[update] Mnemon CLI 更新失败：$_（不影响其他更新，可稍后手动重试）"
}
exit 0
