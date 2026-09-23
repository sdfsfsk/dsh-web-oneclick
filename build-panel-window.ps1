<#
.SYNOPSIS
  编译面板的原生窗口壳 panel-window.exe（无边框窗口 + WebView2，观感与 DSH-X 一致）。

.DESCRIPTION
  面板页默认装在一个自建的窗口里：无边框、标题栏和最小化/最大化/关闭都由页面画、尺寸
  1100x760 逻辑像素——和上游 DSH-X 的窗口一模一样（同一套库：tao + wry）。浏览器的
  「应用模式窗口」顶着系统标题栏，而且 Edge 已经开着时 --window-size 会被忽略，做不到这一点。

  源码在 panel-window\（Rust）。本脚本：

    1. 找 cargo（没装 Rust 就直接跳过，只警告——面板会退回浏览器独立窗口，功能不受影响）；
    2. cargo build --release（构建产物写到 panel-window\target\，不进仓库）；
    3. 把 exe 复制到脚本同级目录，panel-server.mjs 就在那儿找它。

  首次编译要下依赖、编 wry/tao，会慢几分钟；之后是增量编译（源码没改就一两秒）。
  用法：powershell -File build-panel-window.ps1 [-Root <目录>] [-Force]
#>
param(
    [string]$Root = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }
$Root = $Root.TrimEnd('\', '/')
$project = Join-Path $Root 'panel-window'
$manifest = Join-Path $project 'Cargo.toml'
$targetDir = Join-Path $project 'target'
$output = Join-Path $Root 'panel-window.exe'

function Find-Cargo {
    $command = Get-Command cargo -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $fallback = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }
    return ''
}

if (-not (Test-Path -LiteralPath $manifest)) {
    Write-Host "[panel] 找不到窗口壳源码：$manifest"
    Write-Host '[panel] 面板会退回浏览器的独立窗口（功能一样，只是窗口顶着系统标题栏）。'
    exit 0
}

$cargo = Find-Cargo
if ([string]::IsNullOrWhiteSpace($cargo)) {
    Write-Host '[panel] 没找到 cargo（Rust 工具链）。跳过窗口壳编译。'
    Write-Host '[panel] 面板会退回浏览器的独立窗口；想要无边框窗口就装一次 Rust：https://rustup.rs'
    exit 0
}

if ($Force -and (Test-Path -LiteralPath $output)) { Remove-Item -LiteralPath $output -Force }

Write-Host "[panel] 编译窗口壳（$cargo build --release）..."
Write-Host '[panel] 首次要下载依赖并编译 wry/tao，会慢几分钟；之后是增量编译。'

# 目标目录放在项目内（已在 .gitignore 里），构建产物不散落到别处
& $cargo build --release --manifest-path $manifest --target-dir $targetDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[panel] 窗口壳编译失败（cargo 退出码 $LASTEXITCODE）。"
    Write-Host '[panel] 面板会退回浏览器的独立窗口，其余功能不受影响。'
    exit 1
}

$built = Join-Path $targetDir 'release\panel-window.exe'
if (-not (Test-Path -LiteralPath $built)) {
    Write-Host "[panel] 编译成功但没找到产物：$built"
    exit 1
}

Copy-Item -LiteralPath $built -Destination $output -Force
$size = [math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 2)
Write-Host "[panel] 窗口壳就绪：$output（$size MB）"
exit 0
