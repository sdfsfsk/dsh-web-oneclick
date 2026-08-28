@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

rem 一键启动 DSH 终端 TUI（dsh-TUI 插件，Claude Code 风格全屏交互终端）：
rem   在当前窗口运行 pnpm dsh --profile dsh-tui
rem   自动探测本地代理并让 Node 全局 fetch 走代理（dsh-codex 等境外插件需要）
rem 用法: start-tui.bat [附加参数]   例如 start-tui.bat --resume 恢复上次会话
rem 建议: 用 Windows Terminal 体验更佳（像素字体/真彩/鼠标支持更好）

call :locate_repo
if errorlevel 1 (
    echo [start-tui] 未找到 DeepSeek Harness 源码。
    echo [start-tui] 请先双击 update.bat 完成安装，或把本脚本放到 DSH 仓库根目录。
    pause
    endlocal & exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [start-tui] 未找到 pnpm，请先安装 pnpm 并加入 PATH。
    pause
    exit /b 1
)

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
    echo [start-tui] 插件代理: %DSH_PROXY%（NO_PROXY=%NO_PROXY%）
) else (
    echo [start-tui] 未检测到本地代理（已尝试 10808 / 10809），境外插件（如 dsh-codex）将无法连接；
    echo [start-tui] 可先 set DSH_PROXY=http://127.0.0.1:7890 再运行本脚本。DeepSeek 本体不受影响。
)

call pnpm dsh --profile dsh-tui %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [start-tui] DSH TUI 启动失败，退出码 %EXIT_CODE%。
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
