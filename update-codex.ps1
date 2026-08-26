$ErrorActionPreference = 'Stop'

$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
} else {
    $env:DSH_HOME
}
$profilePackage = Join-Path $dshHome 'profiles\web\package.json'
$spec = $null

if (Test-Path -LiteralPath $profilePackage) {
    try {
        $manifest = Get-Content -LiteralPath $profilePackage -Raw -Encoding UTF8 | ConvertFrom-Json
        $dependency = $manifest.dependencies.'dsh-codex'
        if ($dependency -is [string]) {
            $spec = $dependency
        }
    } catch {
        Write-Warning "Cannot inspect $profilePackage; falling back to the normal dsh-codex update. $($_.Exception.Message)"
    }
}

if ($spec -match '^(?:link|file|github|git\+|https?|ssh):') {
    Write-Host "[update] Preserve the local or Git dsh-codex override: $spec"
    exit 0
}

& pnpm dsh plugin --profile web update --latest dsh-codex
exit $LASTEXITCODE
