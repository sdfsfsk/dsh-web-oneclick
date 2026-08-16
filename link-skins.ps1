# link-skins.ps1 — 多 profile 皮肤兼容：把 web profile 里的独立皮肤包链接进
# dsh 的全局模块回退目录，让 dsh-tui 等其他 profile 也能解析皮肤中心写入
# 全局补丁层（~/.dsh/cordis.patch.yml）的皮肤包引用。
#
# 背景：皮肤中心把"当前应用的独立皮肤"以包名写进全局补丁层，所有 profile
# 启动时都会加载它；没装皮肤包的 profile（如 dsh-tui）会因
# ERR_MODULE_NOT_FOUND 启动失败。把皮肤包直接装进那些 profile 又会被当作
# bundle 挂载、与全局插入产生 duplicate loader entry id 冲突。
# 启动器维护的 profiles/node_modules 回退目录只增不删（ stale link 不会被
# 清理），把 junction 放进去即可一劳永逸：能解析、不挂载、不冲突。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File link-skins.ps1
# 皮肤包更新后无需重跑——junction 指向 web profile 的实时目录。

$profiles = "$env:USERPROFILE\.dsh\profiles"
$webModules = Join-Path $profiles 'web\node_modules\@linxin666'
$fallback = Join-Path $profiles 'node_modules\@linxin666'
New-Item -ItemType Directory -Force -Path $fallback | Out-Null
$skins = Get-ChildItem $webModules -Directory -Filter 'dsh-client-ui-skin-*' -ErrorAction SilentlyContinue
if (-not $skins) {
    Write-Host 'web profile 里没找到独立皮肤包（dsh-client-ui-skin-*），无需处理。'
    exit 0
}
foreach ($skin in $skins) {
    $link = Join-Path $fallback $skin.Name
    if (Test-Path $link) { Remove-Item $link -Force -Recurse }
    New-Item -ItemType Junction -Path $link -Target $skin.FullName | Out-Null
    Write-Host "已链接 $($skin.Name)"
}
Write-Host '完成。其他 profile 现在也能解析这些皮肤包了。'
