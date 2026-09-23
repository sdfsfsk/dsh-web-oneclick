@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

rem 一键启动 DeepSeek Harness Web GUI（开放局域网）：
rem   启动前自动清理端口占用（僵留的 dsh web 实例等，见 clear-port.ps1）
rem   绑定 0.0.0.0 由 profile 补丁层完成（~/.dsh/profiles/web/cordis.patch.yml），
rem   本机用 http://127.0.0.1:端口 访问，手机用 http://局域网IP:端口 访问
rem   自动探测本地代理并让 Node 全局 fetch 走代理（dsh-codex 等境外插件需要）
rem   在当前窗口运行 pnpm dsh web，输出双写到 %LOCALAPPDATA%\DeepSeekHarness\logs 并自动打开浏览器
rem 用法: start.bat [端口]   默认端口 3080
rem 注意: 局域网开放意味着同网络设备都能访问本界面，公共 Wi-Fi 下请慎用

call :locate_repo
if errorlevel 1 (
    echo [start] 未找到 DeepSeek Harness 源码。
    echo [start] 请先双击 update.bat 完成安装，或把本脚本放到 DSH 仓库根目录。
    pause
    endlocal & exit /b 1
)

rem 构建产物自检：DSH 的 Web 客户端 bundle 由 pnpm run build 产出，构建记录落在
rem .dsh-build\client-build-environment.json。产物缺失或与当前源码不匹配时，pnpm 11 会在
rem 启动瞬间自行触发 install（verify-deps-before-run），网络一有问题就会把依赖事故伪装成
rem “启动失败”。这里只做显式提示，不擅自构建，避免每次启动都付出构建代价。
if not exist "%DSH_ROOT%\.dsh-build\client-build-environment.json" (
    echo [start] 警告：未检测到构建产物（.dsh-build\client-build-environment.json）。
    echo [start] 请先运行 update.bat 完成 pnpm install + pnpm run build 再启动。
    echo [start] 否则 pnpm 会在启动瞬间自动安装依赖，网络异常时将直接以退出码 1 结束。
)

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3080"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [start] 未找到 pnpm，请先安装 pnpm 并加入 PATH。
    pause
    exit /b 1
)

rem 清理端口占用（僵留实例等）；无占用时静默跳过
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%clear-port.ps1" %PORT%

rem node-pty 1.1.0 在 Windows ConPTY 清理时可能 AttachConsole 失败；启动前幂等加入安全回退
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%fix-node-pty-attach-console.ps1" || echo [start] node-pty 兼容补丁失败，终端关闭时可能出现 AttachConsole 错误。

rem 让 Node 全局 fetch 走本地代理：dsh-codex 等插件直接裸用 fetch()，不读
rem HTTP(S)_PROXY；Node 24.5+ 的 NODE_USE_ENV_PROXY 使内置 undici fetch 遵循
rem 代理环境变量。NO_PROXY 排除回环与 DeepSeek API，避免国内服务被绕到境外。
rem 手动指定代理：先 set DSH_PROXY=http://127.0.0.1:7890 再运行本脚本。
call "%SCRIPT_DIR%configure-codex-models.bat"

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
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%get-lan-ip.ps1"') do set "LAN_IP=%%i"

echo [start] 启动 dsh web（本机）: http://127.0.0.1:%PORT%
if not "%LAN_IP%"=="" echo [start] 局域网/手机访问: http://%LAN_IP%:%PORT%

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-web.ps1" -Port %PORT% -RepositoryRoot "%DSH_ROOT%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [start] DSH Web 启动失败，退出码 %EXIT_CODE%。请查看上方错误和 latest 日志。
pause
endlocal & exit /b %EXIT_CODE%

:locate_repo
if exist "%SCRIPT_DIR%package.json" if exist "%SCRIPT_DIR%apps\cli\src\bin.ts" (
    cd /d "%SCRIPT_DIR%"
    set "DSH_ROOT=%SCRIPT_DIR:~0,-1%"
    exit /b 0
)
if exist "%SCRIPT_DIR%deepseek-harness\package.json" if exist "%SCRIPT_DIR%deepseek-harness\apps\cli\src\bin.ts" (
    cd /d "%SCRIPT_DIR%deepseek-harness"
    set "DSH_ROOT=%SCRIPT_DIR%deepseek-harness"
    exit /b 0
)
exit /b 1
