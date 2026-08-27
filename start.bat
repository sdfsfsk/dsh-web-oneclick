@echo off
setlocal

rem 一键启动 DeepSeek Harness Web GUI（开放局域网）：
rem   启动前自动清理端口占用（僵留的 dsh web 实例等，见 clear-port.ps1）
rem   绑定 0.0.0.0 由 profile 补丁层完成（~/.dsh/profiles/web/cordis.patch.yml），
rem   本机用 http://127.0.0.1:端口 访问，手机用 http://局域网IP:端口 访问
rem   自动探测本地代理并让 Node 全局 fetch 走代理（dsh-codex 等境外插件需要）
rem   在当前窗口运行 pnpm dsh web，输出双写到 %LOCALAPPDATA%\DeepSeekHarness\logs 并自动打开浏览器
rem 用法: start.bat [端口]   默认端口 3080
rem 注意: 局域网开放意味着同网络设备都能访问本界面，公共 Wi-Fi 下请慎用

cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3080"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [start] 未找到 pnpm，请先安装 pnpm 并加入 PATH。
    pause
    exit /b 1
)

rem 清理端口占用（僵留实例等）；无占用时静默跳过
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0clear-port.ps1" %PORT%

rem 让 Node 全局 fetch 走本地代理：dsh-codex 等插件直接裸用 fetch()，不读
rem HTTP(S)_PROXY；Node 24.5+ 的 NODE_USE_ENV_PROXY 使内置 undici fetch 遵循
rem 代理环境变量。NO_PROXY 排除回环与 DeepSeek API，避免国内服务被绕到境外。
rem 手动指定代理：先 set DSH_PROXY=http://127.0.0.1:7890 再运行本脚本。
set "NODE_USE_ENV_PROXY=1"
set "NO_PROXY=localhost,127.0.0.1,api.deepseek.com"
if not defined DSH_PROXY (
    curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10808 https://api.ipify.org && set "DSH_PROXY=http://127.0.0.1:10808"
)
if not defined DSH_PROXY (
    curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10809 https://api.ipify.org && set "DSH_PROXY=http://127.0.0.1:10809"
)
if defined DSH_PROXY (
    set "HTTP_PROXY=%DSH_PROXY%"
    set "HTTPS_PROXY=%DSH_PROXY%"
    set "http_proxy=%DSH_PROXY%"
    set "https_proxy=%DSH_PROXY%"
    echo [start] 插件代理: %DSH_PROXY%（NO_PROXY=%NO_PROXY%）
) else (
    echo [start] 未检测到本地代理（已尝试 10808 / 10809），境外插件（如 dsh-codex）将无法连接；
    echo [start] 可先 set DSH_PROXY=http://127.0.0.1:7890 再运行本脚本。DeepSeek 本体不受影响。
)

rem 探测局域网 IP，仅用于展示手机访问地址
set "LAN_IP="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-lan-ip.ps1"') do set "LAN_IP=%%i"

echo [start] 启动 dsh web（本机）: http://127.0.0.1:%PORT%
if not "%LAN_IP%"=="" echo [start] 局域网/手机访问: http://%LAN_IP%:%PORT%
start "" /min cmd /c "timeout /t 6 /nobreak >nul & start """" http://127.0.0.1:%PORT%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-web.ps1" -Port %PORT%
pause
endlocal
