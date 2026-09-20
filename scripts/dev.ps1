# LumenDeck dev launcher: kills orphans on the dev port first, so a stale
# Vite instance can never wedge the stack ("Port 1420 is already in use").
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev.ps1
$ErrorActionPreference = "Stop"

$port = 1420
$connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $connections) {
    Write-Output "killing orphan pid $($c.OwningProcess) on port $port"
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}
Get-Process lumendeck -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# cargo must be on PATH for the Rust build (winget installs don't always add it).
$env:Path += ";$env:USERPROFILE\.cargo\bin"
pnpm app:dev
