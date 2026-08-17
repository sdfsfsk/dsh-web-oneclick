@echo off
setlocal

rem 一键安装 DeepSeek Harness 源码环境（走 v2rayN 本地代理）：
rem   1. 探测 v2rayN 本地 HTTP 代理端口（10808 -> 10809），也可显式传参
rem   2. git clone https://github.com/deepseek-ai/deepseek-harness 到当前目录
rem   3. 把一键脚本（*.bat / *.ps1）复制进 deepseek-harness 仓库根目录
rem   4. pnpm install + pnpm run build（代理环境变量仅本脚本进程内生效）
rem 用法: install.bat [代理端口]    例如 install.bat 7890（Clash 默认端口）
rem 注意: 已按官方文档装好 DSH 时无需运行本脚本，直接用 start.bat / update.bat 即可

cd /d "%~dp0"

where git >nul 2>nul || (echo [install] 未找到 git，请先安装 git 并加入 PATH。 & pause & exit /b 1)
where pnpm >nul 2>nul || (echo [install] 未找到 pnpm，请先安装 pnpm 并加入 PATH。 & pause & exit /b 1)

if exist deepseek-harness (
    echo [install] 当前目录已存在 deepseek-harness，如需更新请进入该目录运行 update.bat。
    pause
    exit /b 1
)

set "PORT=%~1"
if not "%PORT%"=="" goto :haveport

echo [install] 未指定端口，自动探测 v2rayN 本地代理端口...
set "PORT=10808"
curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10808 https://github.com && goto :haveport
set "PORT=10809"
curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10809 https://github.com && goto :haveport
echo [install] 未检测到可用的代理端口（已尝试 10808 / 10809）。请确认 v2rayN 已运行，或用 install.bat ^<端口^> 手动指定。
pause
exit /b 1

:haveport
set "PROXY=http://127.0.0.1:%PORT%"
set "HTTP_PROXY=%PROXY%"
set "HTTPS_PROXY=%PROXY%"
set "http_proxy=%PROXY%"
set "https_proxy=%PROXY%"
echo [install] 使用代理 %PROXY%

echo [install] git clone https://github.com/deepseek-ai/deepseek-harness ...
git clone https://github.com/deepseek-ai/deepseek-harness.git
if errorlevel 1 (
    echo [install] git clone 失败，请检查代理后重试。
    pause
    exit /b 1
)

echo [install] 复制一键脚本到 deepseek-harness 仓库根目录...
copy /y "%~dp0*.bat" "%~dp0deepseek-harness\" >nul
copy /y "%~dp0*.ps1" "%~dp0deepseek-harness\" >nul

cd /d "%~dp0deepseek-harness"

echo [install] pnpm install ...
call pnpm install || (pause & exit /b 1)

echo [install] pnpm run build ...
call pnpm run build || (pause & exit /b 1)

echo [install] 完成。DSH 源码在 deepseek-harness 目录，双击其中的 start.bat 即可启动 Web GUI。
pause
endlocal
