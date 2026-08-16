@echo off
setlocal

rem 一键启动 DSH 终端 TUI（dsh-TUI 插件，Claude Code 风格全屏交互终端）：
rem   在当前窗口运行 pnpm dsh --profile dsh-tui
rem 用法: start-tui.bat [附加参数]   例如 start-tui.bat --resume 恢复上次会话
rem 建议: 用 Windows Terminal 体验更佳（像素字体/真彩/鼠标支持更好）

cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [start-tui] 未找到 pnpm，请先安装 pnpm 并加入 PATH。
    pause
    exit /b 1
)

call pnpm dsh --profile dsh-tui %*
pause
endlocal
