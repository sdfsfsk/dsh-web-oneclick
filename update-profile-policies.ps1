[CmdletBinding()]
param(
    [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DshHome)) {
    if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
        $userProfile = if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
            [Environment]::GetFolderPath('UserProfile')
        } else {
            $env:USERPROFILE
        }
        $DshHome = Join-Path $userProfile '.dsh'
    } else {
        $DshHome = $env:DSH_HOME
    }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Add-MinimumReleaseAgeExclusions {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string[]]$Entries
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-Host "[update] Profile policy skipped (not installed): $Path"
        return
    }

    $text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = [regex]::Split($text, "`r`n|`n|`r")
    $sectionStart = -1
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match '^minimumReleaseAgeExclude\s*:\s*(?<inline>[^#]*?)\s*(?:#.*)?$') {
            $sectionStart = $index
            $inline = $Matches['inline'].Trim()
            if ($inline -eq '[]') {
                $lines[$index] = 'minimumReleaseAgeExclude:'
            } elseif ($inline.Length -gt 0) {
                throw "Unsupported inline minimumReleaseAgeExclude value in $Path; use a YAML block list"
            }
            break
        }
    }

    $existing = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $sectionEnd = $lines.Count
    if ($sectionStart -ge 0) {
        for ($index = $sectionStart + 1; $index -lt $lines.Count; $index++) {
            $line = $lines[$index]
            if ($line -match '^[^\s#]') {
                $sectionEnd = $index
                break
            }
            if ($line -match '^\s*-\s*(?<value>[^#]+?)\s*$') {
                $value = $Matches['value'].Trim().Trim("'", '"')
                if ($value.Length -gt 0) { [void]$existing.Add($value) }
            }
        }
    }

    $missing = @($Entries | Where-Object { -not $existing.Contains($_) })
    if ($missing.Count -eq 0) {
        Write-Host "[update] Profile policy already configured: $Path"
        return
    }

    $newLines = @($missing | ForEach-Object { "  - '$($_.Replace("'", "''"))'" })
    if ($sectionStart -lt 0) {
        $addition = @()
        if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Length -gt 0) { $addition += '' }
        $addition += 'minimumReleaseAgeExclude:'
        $addition += $newLines
        $lines = @($lines + $addition)
    } else {
        $insertionIndex = $sectionEnd
        while ($insertionIndex -gt ($sectionStart + 1) -and $lines[$insertionIndex - 1] -match '^\s*$') {
            $insertionIndex--
        }
        $prefix = if ($insertionIndex -gt 0) { @($lines[0..($insertionIndex - 1)]) } else { @() }
        $suffix = if ($insertionIndex -lt $lines.Count) { @($lines[$insertionIndex..($lines.Count - 1)]) } else { @() }
        $lines = @($prefix + $newLines + $suffix)
    }

    [IO.File]::WriteAllText($Path, ($lines -join $newline), $utf8NoBom)
    Write-Host "[update] Profile policy added: $($missing -join ', ')"
}

$policies = [ordered]@{
    web = @('@linxin666/*', '@morlay/*', '@codemirror/*', '@iconify/*', 'dsh-mnemon', 'dsh-codex')
    'dsh-tui' = @('@deepseek-harness-tui/dsh-tui', 'dsh-codex')
}

foreach ($profileName in $policies.Keys) {
    $workspaceFile = Join-Path (Join-Path (Join-Path $DshHome 'profiles') $profileName) 'pnpm-workspace.yaml'
    Add-MinimumReleaseAgeExclusions -Path $workspaceFile -Entries $policies[$profileName]
}
