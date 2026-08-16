@echo off
setlocal

rem 一键更新 DeepSeek Harness + 社区插件 + Mnemon CLI（走 v2rayN 本地代理）：
rem   1. 探测 v2rayN 本地 HTTP 代理端口（10808 -> 10809），也可显式传参
rem   2. 设置 git / pnpm 的代理环境变量（仅本脚本进程内生效）
rem   3. git pull --ff-only + pnpm install + pnpm run build
rem   4. 更新 dsh-web-ui 与 dsh-mnemon 插件到最新版（失败只警告，不影响本体更新）
rem   5. 检查并更新 Mnemon CLI 到最新 release（update-mnemon.ps1，失败只警告）
rem 用法: update.bat [代理端口]

cd /d "%~dp0"

where git >nul 2>nul || (echo [update] 未找到 git。 & pause & exit /b 1)
where pnpm >nul 2>nul || (echo [update] 未找到 pnpm。 & pause & exit /b 1)

set "PORT=%~1"
if not "%PORT%"=="" goto :haveport

echo [update] 未指定端口，自动探测 v2rayN 本地代理端口...
set "PORT=10808"
curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10808 https://github.com && goto :haveport
set "PORT=10809"
curl.exe -s -o nul --max-time 5 -x http://127.0.0.1:10809 https://github.com && goto :haveport
echo [update] 未检测到可用的代理端口（已尝试 10808 / 10809）。请确认 v2rayN 已运行，或用 update.bat ^<端口^> 手动指定。
pause
exit /b 1

:haveport
set "PROXY=http://127.0.0.1:%PORT%"
set "HTTP_PROXY=%PROXY%"
set "HTTPS_PROXY=%PROXY%"
set "http_proxy=%PROXY%"
set "https_proxy=%PROXY%"
echo [update] 使用代理 %PROXY%

echo [update] git pull --ff-only ...
git pull --ff-only
if errorlevel 1 (
    echo [update] git pull 失败（可能有本地改动冲突或无法快进）。请手动处理后重试。
    pause
    exit /b 1
)

echo [update] pnpm install ...
call pnpm install || (pause & exit /b 1)

echo [update] pnpm run build ...
call pnpm run build || (pause & exit /b 1)

echo [update] 更新社区插件（dsh-web-ui-all / dsh-mnemon）...
call pnpm dsh plugin --profile web update --latest @linxin666/dsh-web-ui-all dsh-mnemon || echo [update] 插件更新失败，不影响本体更新结果，可稍后手动重试。

echo [update] 检查 Mnemon CLI 更新...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-mnemon.ps1"

echo [update] 完成。重启 GUI（start.bat）后生效。
pause
endlocal
