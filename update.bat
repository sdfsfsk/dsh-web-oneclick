@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "FRESH=0"
if not defined DSH_REF set "DSH_REF=dsh-v0.1.2-rc.1"

rem 一键更新 / 安装 DeepSeek Harness + 社区插件 + Mnemon CLI（走 v2rayN 本地代理）：
rem   1. 探测 v2rayN 本地 HTTP 代理端口（10808 -> 10809），也可显式传参
rem   2. 设置 git / pnpm 的代理环境变量（仅本脚本进程内生效）
rem   3. 定位 DSH 源码：当前目录是 DSH 仓库则直接更新；当前目录下有已克隆的
rem      deepseek-harness 目录则进入更新；都没有则 git clone 全新安装
rem   4. 切换到与社区 Web 插件兼容的 DSH_REF + pnpm install + pnpm run build
rem   5. 更新社区插件：web profile（dsh-web-all / dsh-mnemon / dsh-codex，npm 源；
rem      dsh-reasoning-effort，git 源）
rem      与 dsh-tui profile（dsh-TUI）——失败只警告，不影响本体更新
rem   6. 检查并更新 Mnemon CLI 到最新 release（update-mnemon.ps1，失败只警告）
rem 用法: update.bat [代理端口]    例如 update.bat 7890（Clash 默认端口）

cd /d "%SCRIPT_DIR%"

where git >nul 2>nul || (echo [update] 未找到 git，请先安装 git 并加入 PATH。 & pause & exit /b 1)
where pnpm >nul 2>nul || (echo [update] 未找到 pnpm，请先安装 pnpm 并加入 PATH。 & pause & exit /b 1)

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

rem 定位 DSH 源码目录
if exist package.json if exist apps\cli\src\bin.ts goto :sync
if not exist deepseek-harness\package.json goto :install
if not exist deepseek-harness\apps\cli\src\bin.ts goto :install
cd /d "%SCRIPT_DIR%deepseek-harness"
goto :sync

:install
echo [update] 未找到 DSH 源码，git clone %DSH_REF% ...
git clone --branch "%DSH_REF%" https://github.com/deepseek-ai/deepseek-harness.git "%SCRIPT_DIR%deepseek-harness"
if errorlevel 1 (
    echo [update] git clone 失败，请检查代理后重试。
    pause
    exit /b 1
)

echo [update] 复制一键脚本到 deepseek-harness 仓库根目录...
copy /y "%SCRIPT_DIR%*.bat" "%SCRIPT_DIR%deepseek-harness\" >nul
copy /y "%SCRIPT_DIR%*.ps1" "%SCRIPT_DIR%deepseek-harness\" >nul

cd /d "%SCRIPT_DIR%deepseek-harness"
set "FRESH=1"
goto :build

:sync
echo [update] 获取官方标签并切换到兼容版本 %DSH_REF% ...
git fetch --tags --prune origin
if errorlevel 1 (
    echo [update] git fetch 失败，请检查代理后重试。
    pause
    exit /b 1
)
git rev-parse --verify "%DSH_REF%^{commit}" >nul 2>nul
if errorlevel 1 (
    echo [update] 找不到 DSH_REF=%DSH_REF%，请检查版本名后重试。
    pause
    exit /b 1
)
git switch --detach "%DSH_REF%"
if errorlevel 1 (
    echo [update] 无法切换到 %DSH_REF%（可能有会被覆盖的本地改动）。请先处理后重试。
    pause
    exit /b 1
)

:build
echo [update] pnpm install ...
call pnpm install || (pause & exit /b 1)

echo [update] pnpm run clean（清理跨版本残留产物）...
call pnpm run clean || (pause & exit /b 1)

echo [update] pnpm run build ...
call pnpm run build || (pause & exit /b 1)

if "%FRESH%"=="1" (
    echo [update] 安装完成。双击 deepseek-harness 目录中的 start.bat 即可启动 Web GUI。
    echo [update] 社区插件（皮肤全家桶 / Mnemon / dsh-TUI）可按 README 说明另行安装。
    pause
    exit /b 0
)

echo [update] 配置 profile 的受信任插件供应链策略...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%update-profile-policies.ps1"
if errorlevel 1 (
    echo [update] profile 供应链策略配置失败，已停止社区插件更新。
    pause
    exit /b 1
)

echo [update] 更新社区插件（web: dsh-web-all / dsh-mnemon）...
call pnpm dsh plugin --profile web update --latest @linxin666/dsh-web-all dsh-mnemon || echo [update] web 插件更新失败，不影响本体更新结果，可稍后手动重试。

echo [update] 更新 dsh-codex（保留 link/file/git 本地补丁来源）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%update-codex.ps1" || echo [update] dsh-codex 更新失败，不影响本体更新结果，可稍后手动重试。

echo [update] 更新社区插件（web: dsh-reasoning-effort，git 源）...
call pnpm dsh plugin --profile web add github:HanaAyane/dsh-reasoning-effort#main || echo [update] dsh-reasoning-effort 更新失败，不影响其他更新结果，可稍后手动重试。

echo [update] 更新社区插件（dsh-tui: dsh-TUI）...
call pnpm dsh plugin --profile dsh-tui update --latest @deepseek-harness-tui/dsh-tui || echo [update] dsh-TUI 更新失败，不影响其他更新结果，可稍后手动重试。

echo [update] 检查 Mnemon CLI 更新...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%update-mnemon.ps1" || echo [update] Mnemon CLI 更新失败，不影响其他更新结果，可稍后手动重试。

echo [update] 完成。重启 GUI（start.bat）后生效。
pause
endlocal & exit /b 0
