@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

rem 一键启动 DSH 管理面板（本仓库的面板后端 + DSH-X 的管理页界面）：
rem   1. 定位 DSH 源码（当前目录是 DSH 仓库就用它，否则进 deepseek-harness\ 子目录），
rem      并检查 dsh-x\（管理页 UI）与 panel-server.mjs 是否都在
rem   2. 探测本地代理（v2rayN 10808 -> 10809）并注入环境变量，让 dsh 里的境外插件走代理
rem   3. 起面板：自动开独立窗口（默认 127.0.0.1:3780，被占则顺延），并把 dsh web 拉起来
rem      （dsh 网页也用独立窗口打开，不占浏览器标签页）
rem   4. 控制台输出同时落 %LOCALAPPDATA%\DeepSeekHarness\logs（dsh-panel-latest.txt 指向最新一份）
rem   5. 面板右上角的「自动更新」按钮 = 双击 update.bat（源码 + 社区插件 + 面板 UI 一起更新）
rem 用法: start-panel.bat [dsh 网页端口]   默认端口 3080
rem 注意: 面板自己的端口在管理页「设置」里改（默认 3780，重启面板后生效）；
rem       dsh 网页端口由这里的参数决定，dsh 若起不来会在日志里说明原因。
rem 说明: 面板驱动的是**源码版** dsh（就是当前 checkout，update.bat 构建的那个），
rem       不安装 npm 版本，所以管理页里没有安装 / 卸载 / 版本更新按钮（更新走 update.bat，也就是右上角那个按钮）；
rem       想只用控制台更新：双击 update.bat 效果一样。
rem 参考: 只想启动 dsh 网页（不要面板）用 start.bat；面板停掉后 dsh 也会跟着退出。

call :locate_repo
if errorlevel 1 (
    echo [panel] 未找到 DeepSeek Harness 源码。
    echo [panel] 先双击 update.bat 完成安装，或把本脚本放进 DSH 仓库根目录。
    pause
    endlocal & exit /b 1
)

if not exist "%SCRIPT_DIR%panel-server.mjs" (
    echo [panel] 缺少 panel-server.mjs（面板后端），它要和本脚本放在同一目录。
    pause
    endlocal & exit /b 1
)

if not exist "%SCRIPT_DIR%dsh-x\public\index.html" (
    echo [panel] 缺少管理页 UI（dsh-x\public\index.html）。
    echo [panel] 先双击 update.bat（或单独运行 update-panel.ps1）把它拉下来。
    pause
    endlocal & exit /b 1
)

rem 与 start.bat 同款自检：DSH 的 Web 客户端 bundle 由 pnpm run build 生成，构建产物
rem 缺失说明源码没构建过或者被清理过，面板仍然能起，但 dsh 大概起不来。
if not exist "%DSH_ROOT%\.dsh-build\client-build-environment.json" (
    echo [panel] 警告：未检测到构建产物（.dsh-build\client-build-environment.json）。
    echo [panel] 请先双击 update.bat 完成 pnpm install + pnpm run build。
)

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3080"

where node >nul 2>nul
if errorlevel 1 (
    echo [panel] 未找到 node（Node 22.18+），请先安装 Node 并加入 PATH。
    pause
    exit /b 1
)

rem 代理：面板本身不需要联网，但 dsh 里的境外插件（dsh-codex 等）需要。Node 24.5+ 的
rem NODE_USE_ENV_PROXY 让内置 undici fetch 遵循代理环境变量，这里探测 v2rayN 的
rem 10808 -> 10809；手动指定：set DSH_PROXY=http://127.0.0.1:7890 后再运行本脚本。
rem NO_PROXY 把回环和 DeepSeek API 排除在代理之外。
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
    echo [panel] 本地代理: %DSH_PROXY%，NO_PROXY=%NO_PROXY%
) else (
    echo [panel] 未检测到本地代理（已尝试 10808 / 10809），dsh-codex 一类境外插件会连不上。
    echo [panel] 要手动指定：set DSH_PROXY=http://127.0.0.1:7890 后再运行本脚本；DeepSeek 本体不受影响。
)

rem 探测局域网 IP，方便手机访问（dsh 就绪后面板会打印它自己的地址）
set "LAN_IP="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%get-lan-ip.ps1"') do set "LAN_IP=%%i"

echo [panel] 管理面板: 起好后自动开独立窗口（默认 127.0.0.1:3780，端口被占会自动顺延，实际地址见日志）
echo [panel] dsh 网页端口: %PORT%
if not "%LAN_IP%"=="" echo [panel] 局域网/手机访问: http://%LAN_IP%:%PORT% ^(需要 profile 补丁把 dsh 绑到 0.0.0.0，见 README^)
echo [panel] 按 Ctrl+C 结束面板（跑着的 dsh 会一起退出）。

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-panel.ps1" -Port %PORT% -PanelRoot "%SCRIPT_DIR:~0,-1%" -RepositoryRoot "%DSH_ROOT%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [panel] 面板已退出，退出码 %EXIT_CODE%（看上方输出或 latest 日志）。
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