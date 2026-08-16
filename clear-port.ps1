# clear-port.ps1 — 供 start.bat 调用：结束占用指定端口的监听进程，再确认端口已释放。
# 按端口动态解析监听者 PID（Get-NetTCPConnection），不假定进程名——僵留的
# dsh web、测试服务器或任何别的程序占用端口时都同样处理。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File clear-port.ps1 <端口>
param([Parameter(Mandatory = $true)][int]$Port)

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) { exit 0 }

$owningPids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $owningPids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    Write-Host "[start] 端口 $Port 被 $($proc.ProcessName) (PID $procId) 占用，正在结束..."
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

# 等端口真正释放（进程退出到监听关闭可能有几百毫秒延迟）
for ($i = 0; $i -lt 10; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { exit 0 }
    Start-Sleep -Milliseconds 500
}
Write-Host "[start] 警告：端口 $Port 仍被占用，启动可能失败。"
exit 1
