@echo off
setlocal

rem 一键启动 DeepSeek Harness Web GUI（开放局域网）：
rem   绑定 0.0.0.0 由 profile 补丁层完成（~/.dsh/profiles/web/cordis.patch.yml），
rem   本机用 http://127.0.0.1:端口 访问，手机用 http://局域网IP:端口 访问
rem   在当前窗口运行 pnpm dsh web，并自动打开浏览器
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

rem 端口已被占用：多半是已有 dsh web 实例在运行，直接打开浏览器访问它
curl.exe -s -o nul --max-time 2 http://127.0.0.1:%PORT%
if not errorlevel 1 (
    echo [start] 端口 %PORT% 已有 dsh web 在运行，直接打开浏览器。
    echo [start] 如需重启，请先关闭正在运行的 dsh web 窗口，再双击本脚本。
    start "" http://127.0.0.1:%PORT%
    pause
    exit /b 0
)

rem 探测局域网 IP，仅用于展示手机访问地址
set "LAN_IP="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-lan-ip.ps1"') do set "LAN_IP=%%i"

echo [start] 启动 dsh web（本机）: http://127.0.0.1:%PORT%
if not "%LAN_IP%"=="" echo [start] 局域网/手机访问: http://%LAN_IP%:%PORT%
start "" /min cmd /c "timeout /t 6 /nobreak >nul & start """" http://127.0.0.1:%PORT%"

call pnpm dsh web --port %PORT%
pause
endlocal
