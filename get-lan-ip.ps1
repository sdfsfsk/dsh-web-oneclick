# get-lan-ip.ps1 — 供 start.bat 调用：输出默认路由网卡的 IPv4 地址（无则输出空）。
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
    Select-Object -First 1
if ($route) {
    $ip = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($ip) { $ip.IPAddress }
}
