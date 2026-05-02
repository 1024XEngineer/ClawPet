# Quick Launch - Run Packaged ClawPet
# This script runs the packaged version with all backend services

$ErrorActionPreference = "Stop"
$ExePath = "$PSScriptRoot\dist\win-unpacked\ClawPet.exe"

if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: ClawPet.exe not found!" -ForegroundColor Red
    Write-Host "Please run build-and-test.ps1 first" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Launching ClawPet (Packaged)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Path: $ExePath" -ForegroundColor Gray
Write-Host ""
Write-Host "Starting..." -ForegroundColor Green
Write-Host ""

# Start the packaged application
Start-Process $ExePath

Write-Host "Tips:" -ForegroundColor Yellow
Write-Host "  - Startup progress window will appear first" -ForegroundColor Gray
Write-Host "  - Backend services will auto-start (Gateway + Launcher)" -ForegroundColor Gray
Write-Host "  - Check logs if needed:" -ForegroundColor Gray
Write-Host "    Get-Content `"$env:USERPROFILE\.picoclaw\logs.txt`" -Tail 30" -ForegroundColor White
Write-Host ""
