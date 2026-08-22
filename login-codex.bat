@echo off
setlocal

rem 一键令牌登录 dsh-codex（设备码方式，自动走本地代理）：
rem   自动探测本地代理（127.0.0.1:10808 -> 10809，或先 set DSH_PROXY=http://127.0.0.1:7890
rem   手动指定），注入 NODE_USE_ENV_PROXY 让插件的 fetch 走代理；
rem   先检查登录状态——已登录且凭据有效（token 自动刷新）时直接退出，不重复授权；
rem   未登录时发起设备码登录：终端显示授权网址和一串码，浏览器打开网址、
rem   输入码即完成登录，凭据保存到 ~/.dsh/.openai-codex-auth.json。
rem
rem 重要（浏览器侧）：
rem   1. 登录前请把梯子（v2rayN 等）切到"全局代理"模式——"绕过大陆"类规则会把
rem      auth.openai.com 误判为直连，授权页会报 unsupported_country_region_territory；
rem   2. 网页显示登录成功后，就可以把梯子切回普通模式了——日常使用不再需要全局，
rem      只要梯子应用保持运行即可（start.bat / start-tui.bat 会自动把 127.0.0.1 本地
rem      代理注入 dsh 进程，浏览器不再参与）。
rem
rem 用法: login-codex.bat        （在 deepseek-harness 仓库根目录双击）

cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [login] 未找到 pnpm，请先安装 pnpm 并加入 PATH。
    pause
    exit /b 1
)

set "NODE_USE_ENV_PROXY=1"
set "NO_PROXY=localhost,127.0.0.1,api.deepseek.com"
if not defined DSH_PROXY (
    curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10808 https://api.ipify.org && set "DSH_PROXY=http://127.0.0.1:10808"
)
if not defined DSH_PROXY (
    curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10809 https://api.ipify.org && set "DSH_PROXY=http://127.0.0.1:10809"
)
if not defined DSH_PROXY (
    echo [login] 未检测到本地代理（已尝试 10808 / 10809），无法连接境外登录服务。
    echo [login] 请确认梯子已运行，或先 set DSH_PROXY=http://127.0.0.1:7890 再运行本脚本。
    pause
    exit /b 1
)
set "HTTP_PROXY=%DSH_PROXY%"
set "HTTPS_PROXY=%DSH_PROXY%"
set "http_proxy=%DSH_PROXY%"
set "https_proxy=%DSH_PROXY%"
echo [login] 插件代理: %DSH_PROXY%

rem 已登录且凭据有效时直接退出，不重复走授权流程
set "STATUS_FILE=%TEMP%\dsh-codex-login-status.txt"
call pnpm dsh plugin --profile web exec dsh-openai-codex status >"%STATUS_FILE%" 2>&1
findstr /c:"signed in" "%STATUS_FILE%" >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%i in ('findstr /c:"OpenAI Codex:" "%STATUS_FILE%"') do echo [login] %%i
    del "%STATUS_FILE%" >nul 2>nul
    echo [login] 检测到已登录且凭据有效（token 自动刷新），无需重新登录。
    pause
    exit /b 0
)
del "%STATUS_FILE%" >nul 2>nul

echo [login] 当前未登录或凭据已失效，即将开始设备码登录，请提前确认：
echo [login]   1. 梯子已切到"全局代理"模式（仅授权网页需要，登录成功后可切回）
echo [login]   2. 稍后浏览器打开终端显示的网址，输入显示的码
echo.
call pnpm dsh plugin --profile web exec dsh-openai-codex login --device-code
if errorlevel 1 (
    echo [login] 登录失败，请检查代理（全局模式）后重试。
    pause
    exit /b 1
)
echo.
echo [login] 登录成功。现在可以把梯子切回普通模式了——
echo [login] 之后日常只要梯子应用开着，用 start.bat 启动 dsh 即可使用 Codex 模型。
pause
endlocal
