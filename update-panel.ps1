<#
.SYNOPSIS
  dsh-x 拉取 / 切换助手（管理面板的 UI 与插件开关来自这个上游仓库）。

.DESCRIPTION
  面板（start-panel.bat + panel-server.mjs）运行时引用旁边的 dsh-x\：UI 是它的 public\，
  插件开关是它的 plugins.js，启动加速与会话事件兼容是它的 perf\ / compat\ 两个加载钩子。
  本脚本只做三件事：

    1. 没有 dsh-x\ 就 clone（要用代理时由 update.bat 设好的环境变量负责）；
    2. 有就切到钉死的版本（默认是上游 master 的一个提交，可用 set DSHX_REF=... 覆盖成
       分支名 / 标签 / 提交号——例如 set DSHX_REF=v0.1.13 就是安装包里那版较旧的界面）；
    3. 断言面板依赖的上游锚点还在——上游 UI 结构一变，面板可能露出发不出去的按钮，
       这里给出一句人话，而不是让用户对着一个坏页面猜。

  版本是**刻意钉死**的（与 update.bat 的 DSH_REF 同一个思路）：上游改结构时要人工确认，
  换版本是维护者动作——改这里的默认值，或临时 set DSHX_REF。

  用法：powershell -File update-panel.ps1 [-Root <目录>] [-Ref <分支|标签|提交号>]
#>
param(
    [string]$Root = '',
    [string]$Ref = ''
)

$ErrorActionPreference = 'Stop'

$repoUrl = 'https://github.com/yyh-001/DSH-X.git'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($Ref)) {
    # 上游 master 上的提交（2026-09-23 的界面改版：设置页外壳 + 深色外观）。
    # 钉提交而不是钉分支：界面换代时不至于某天突然换一张脸。
    $Ref = if ($env:DSHX_REF) { $env:DSHX_REF } else { '1062d1a800131026e52421bbdf00bb93f5ac7a25' }
}
$dir = Join-Path $Root 'dsh-x'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host '[panel] 未找到 git，无法拉取 dsh-x。'
    exit 1
}

function Invoke-Git {
    param([string[]]$Arguments)
    # git 的进度/提示都走 stderr，而 NativeCommandError 在本脚本的 'Stop' 策略下会被当成
    # 致命错误直接中断——所以这段里临时降到 Continue，只认退出码。
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & git @Arguments 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    $text = ($output | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ } }) -join "`n"
    return @{ Code = $code; Output = $text.Trim() }
}

function Show-Version {
    $manifest = Join-Path $dir 'package.json'
    $version = ''
    if (Test-Path -LiteralPath $manifest) {
        # 一律显式按 UTF-8 读：没有 BOM 的 UTF-8 会被默认按 GBK 解码，中文描述就成了乱码，
        # ConvertFrom-Json 可能直接抛错（读版本号失败）
        try { $version = (Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { $version = '' }
    }
    $describe = (Invoke-Git @('-C', $dir, 'describe', '--tags', '--always')).Output
    Write-Host "[panel] dsh-x 版本 $version（$describe），请求的版本 $Ref"
}

# 1) 拉取：没有就 clone；然后统一切到 $Ref（分支名 / 标签 / 提交号都认）
Write-Host "[panel] dsh-x 目标目录 $dir"
$fresh = $false
if (-not (Test-Path -LiteralPath (Join-Path $dir '.git'))) {
    if (Test-Path -LiteralPath $dir) {
        Write-Host "[panel] dsh-x 已存在但不是 git checkout（被改过的拷贝？），跳过拉取，按现状使用。"
    } else {
        Write-Host "[panel] 拉取 dsh-x 到 $dir ..."
        $clone = Invoke-Git @('clone', $repoUrl, $dir)
        if ($clone.Code -ne 0) {
            Write-Host "[panel] git clone 失败：$($clone.Output)"
            Write-Host '[panel] 请确认代理可用（update.bat 会设好代理环境变量），或手动 clone 后重试。'
            exit 1
        }
        $fresh = $true
    }
}
if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
    $dirty = (Invoke-Git @('-C', $dir, 'status', '--porcelain')).Output
    if ($dirty) {
        # 面板从不改上游文件，dirty 只可能是人为改动：保持现状，别把别人的改动冲掉
        Write-Host '[panel] dsh-x 有本地改动，跳过版本切换（按现状使用）。'
    } else {
        if (-not $fresh) { $null = Invoke-Git @('-C', $dir, 'fetch', '--tags', '--prune', 'origin') }
        $verify = Invoke-Git @('-C', $dir, 'rev-parse', '--verify', "$Ref^{commit}")
        if ($verify.Code -ne 0) {
            Write-Host "[panel] 找不到 $Ref（fetch 是否成功？），保持当前版本继续。"
        } else {
            $switch = Invoke-Git @('-C', $dir, 'switch', '--detach', $Ref)
            if ($switch.Code -ne 0) {
                Write-Host "[panel] 无法切换到 ${Ref}：$($switch.Output)"
            }
        }
    }
}

# 2) 断言面板依赖的锚点还在
$requiredFiles = @(
    'package.json',
    'plugins.js',
    'public\index.html',
    'perf\register.mjs',
    'compat\register.mjs',
    'compat\worker-events.cjs'
)
$missing = @()
foreach ($relative in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir $relative))) { $missing += $relative }
}
if ($missing.Count -gt 0) {
    Write-Host "[panel] dsh-x 里缺少面板依赖的文件：$($missing -join ' / ')"
    Write-Host '[panel] 面板起不来。请检查标签是否正确（set DSHX_REF=... 后重试）。'
    exit 1
}

$indexPath = Join-Path $dir 'public\index.html'
$page = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8
$anchors = @('id="remove"', 'id="dataDirHint"', '__APP_VERSION__', '/api/state')
$missingAnchors = @()
foreach ($anchor in $anchors) {
    if ($page -notlike "*$anchor*") { $missingAnchors += $anchor }
}
if ($missingAnchors.Count -gt 0) {
    Write-Host "[panel] 警告：上游 UI 结构有变，找不到：$($missingAnchors -join ' / ')"
    Write-Host '[panel] 面板仍可启动，但页面上可能露出「安装 / 卸载」一类用不了的按钮。'
    Write-Host '[panel] 确认过再更新：把 DSHX_REF 钉回旧标签即可。'
}

$plugins = Get-Content -LiteralPath (Join-Path $dir 'plugins.js') -Raw -Encoding UTF8
foreach ($needle in @('export function listPlugins', 'export function setPluginEnabled')) {
    if ($plugins -notlike "*$needle*") {
        Write-Host "[panel] 警告：plugins.js 里找不到 $needle，插件页可能不可用。"
    }
}

Show-Version
Write-Host '[panel] dsh-x 就绪。双击 start-panel.bat 打开管理面板。'
exit 0