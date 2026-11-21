$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$targets = [ordered]@{
    'Thread data.lnk' = 'threads'
    'Follower snapshots.lnk' = 'follower-snapshots'
    'Slash audit.lnk' = 'slash-audit'
    'Legacy follower data.lnk' = 'legacy'
}
foreach ($entry in $targets.GetEnumerator()) {
    $target = Join-Path (Join-Path $root 'data') $entry.Value
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $link = Join-Path $root $entry.Key
    $description = "Open bot data: $($entry.Value)"
    if (Test-Path -LiteralPath $link) {
        $existing = $shell.CreateShortcut($link)
        if ($existing.TargetPath -ne $target -and $existing.Description -ne $description) {
            throw "Shortcut already exists with a different target: $link"
        }
    }
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $target
    $shortcut.Description = $description
    $shortcut.Save()
    Write-Output "Created $link"
}
