# link-skins.ps1 — 旧版皮肤链接清理（历史脚本，保留用于善后）
#
# 背景：dsh-web-ui 皮肤中心 v2 起，皮肤已全部内置进
# @linxin666/dsh-client-ui-skin-center（纯资产目录），不再发布
# dsh-client-ui-skin-* 独立皮肤包，也不再需要向其他 profile 做 junction。
# 旧版（v1）留下的痕迹在升级后会直接拖垮启动：
#   1. web profile node_modules 里的 dsh-client-ui-skin-* 符号链接指向
#      已不存在的 dsh-skins/skins/* → ERR_MODULE_NOT_FOUND 启动崩溃；
#   2. ~/.dsh/cordis.patch.yml 里的 "dsh-skin managed" 段引用这些死包名；
#   3. profiles/node_modules 回退目录里指向它们的旧 junction。
# 本脚本现在负责清理 1 和 3（死链接）；2 需手动处理：
#   备份并编辑 ~/.dsh/cordis.patch.yml，删掉 "dsh-skin managed" 整段
#  （新版皮肤中心首次启动会把当时的活动皮肤迁移进 v2 存储，之后该段无意义）。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File link-skins.ps1

$base = "$env:USERPROFILE\.dsh\profiles"
$dirs = @(
    (Join-Path $base 'web\node_modules\@linxin666'),
    (Join-Path $base 'node_modules\@linxin666')
)

$removed = 0
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem $dir -Force -Filter 'dsh-client-ui-skin-*' | ForEach-Object {
        $item = $_
        if (-not $item.LinkType) { return }  # 真目录不动
        $target = $item.Target
        $targetDead = ($null -eq $target) -or ($target | Where-Object { -not (Test-Path $_) })
        if ($targetDead) {
            Remove-Item $item.FullName -Force
            Write-Host ("已删除死链接: {0} -> {1}" -f $item.Name, ($target -join ', '))
            $removed++
        } else {
            Write-Host ("保留活链接: {0} -> {1}" -f $item.Name, ($target -join ', '))
        }
    }
}

if ($removed -eq 0) {
    Write-Host '没有发现旧版皮肤死链接，无需处理。'
} else {
    Write-Host "共清理 $removed 个死链接。"
}

# 顺带检查全局补丁层是否还残留旧版皮肤段
$globalPatch = "$env:USERPROFILE\.dsh\cordis.patch.yml"
if ((Test-Path $globalPatch) -and (Select-String -Path $globalPatch -Pattern 'dsh-skin managed' -Quiet)) {
    Write-Host "警告: $globalPatch 仍包含旧版 'dsh-skin managed' 段，请备份后删除该段（仅删该段，保留其他补丁项）。"
}
