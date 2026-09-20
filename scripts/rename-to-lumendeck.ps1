# Finish the folder rename from outside the project directory.
# Usage (from the PARENT folder, e.g. ...\dev):
#   powershell -ExecutionPolicy Bypass -File .\sticker\scripts\rename-to-lumendeck.ps1
$ErrorActionPreference = "Stop"
$src = Join-Path (Get-Location) "sticker"
$dst = Join-Path (Get-Location) "LumenDeck"
if (-not (Test-Path $src)) { Write-Error "No 'sticker' folder found here." }
if (Test-Path $dst)        { Write-Error "'LumenDeck' already exists here." }
Rename-Item -Path $src -NewName "LumenDeck"
Write-Output "Renamed to LumenDeck. cd LumenDeck and continue."
