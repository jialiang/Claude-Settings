<#
    On-demand backup of local folders to Proton Drive.

    Each folder is zipped and uploaded as a single archive that replaces the
    previous one. An archive is a snapshot of whatever is on disk right now,
    so the cloud copy tracks local state including deletions, without having
    to compare the two sides file by file.

    Trade-off: the Proton Drive web app can only hand back the whole archive,
    not an individual file inside it.
#>

$ErrorActionPreference = 'Stop'

$protonDrive = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\proton-drive.exe"
$destination = '/my-files'

$sources = @(
    "$env:USERPROFILE\Desktop\All\Finance"
    "$env:USERPROFILE\Desktop\All\Medical"
)

if (-not (Test-Path $protonDrive)) {
    throw 'Proton Drive CLI not found. Install with: winget install Proton.ProtonDrive.CLI'
}

$missing = @($sources | Where-Object { -not (Test-Path $_) })

if ($missing.Count -gt 0) {
    throw "Source folder not found: $($missing -join ', ')"
}

$staging = Join-Path $env:TEMP "proton-drive-backup-$PID"
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    foreach ($source in $sources) {
        $name = Split-Path $source -Leaf
        $archive = Join-Path $staging "$name.zip"

        Compress-Archive -Path $source -DestinationPath $archive -CompressionLevel Optimal

        $megabytes = [math]::Round((Get-Item $archive).Length / 1MB, 1)
        Write-Host "Uploading $name.zip ($megabytes MB) to $destination" -ForegroundColor Cyan

        & $protonDrive filesystem upload --file-conflict-strategy replace $archive $destination

        if ($LASTEXITCODE -ne 0) {
            throw "Upload failed for $name.zip (exit code $LASTEXITCODE)"
        }
    }
}
finally {
    if (Test-Path $staging) {
        Remove-Item $staging -Recurse -Force
    }
}

Write-Host 'Backup complete.' -ForegroundColor Green
