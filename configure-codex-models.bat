@echo off
rem Shared by Web and TUI. Keep these variables in the calling launcher's setlocal.
if not defined DSH_CODEX_MODELS_CACHE (
    if defined CODEX_HOME (
        set "DSH_CODEX_MODELS_CACHE=%CODEX_HOME%\models_cache.json"
    ) else (
        set "DSH_CODEX_MODELS_CACHE=%USERPROFILE%\.codex\models_cache.json"
    )
)
if exist "%DSH_CODEX_MODELS_CACHE%" (
    echo [codex] Model catalog: "%DSH_CODEX_MODELS_CACHE%"
) else (
    echo [codex] No Codex model cache found. The plugin will use its bundled catalog.
    echo [codex] Open an updated Codex CLI/Desktop to refresh models, or set DSH_CODEX_MODELS_CACHE.
)
exit /b 0
