# ClawPet Quick Test Script
# Purpose: Run packaged application

$ErrorActionPreference = "Stop"
$ClawpetDir = $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ClawPet Quick Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if package exists
$WinUnpacked = Join-Path $ClawpetDir "dist\win-unpacked\ClawPet.exe"
$Portable = Join-Path $ClawpetDir "dist\ClawPet 0.1.0.exe"
$Installer = Join-Path $ClawpetDir "dist\ClawPet Setup 0.1.0.exe"

if (-not (Test-Path $WinUnpacked)) {
    Write-Host "ERROR: Package not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run build script first:" -ForegroundColor Yellow
    Write-Host "  .\build-and-test.ps1" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Show available test options
Write-Host "Select test method:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. win-unpacked (recommended, for debugging)" -ForegroundColor White
if (Test-Path $Portable) {
    Write-Host "  2. Portable version (single file)" -ForegroundColor White
}
if (Test-Path $Installer) {
    Write-Host "  3. Installer version" -ForegroundColor White
}
Write-Host "  0. Cancel" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Enter option (1/2/3/0)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Launching win-unpacked version..." -ForegroundColor Green
        Write-Host "   Path: $WinUnpacked" -ForegroundColor Gray
        Write-Host ""
        Start-Process $WinUnpacked
    }
    "2" {
        if (Test-Path $Portable) {
            Write-Host ""
            Write-Host "Launching portable version..." -ForegroundColor Green
            Write-Host "   Path: $Portable" -ForegroundColor Gray
            Write-Host ""
            Start-Process $Portable
        } else {
            Write-Host "ERROR: Portable version not found" -ForegroundColor Red
        }
    }
    "3" {
        if (Test-Path $Installer) {
            Write-Host ""
            Write-Host "Launching installer version..." -ForegroundColor Green
            Write-Host "   Path: $Installer" -ForegroundColor Gray
            Write-Host ""
            Start-Process $Installer
        } else {
            Write-Host "ERROR: Installer version not found" -ForegroundColor Red
        }
    }
    "0" {
        Write-Host "Cancelled" -ForegroundColor Gray
        exit 0
    }
    default {
        Write-Host "ERROR: Invalid option" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Tips:" -ForegroundColor Yellow
Write-Host "  - The app will show startup progress window first" -ForegroundColor Gray
Write-Host "  - Gateway (18790) and Launcher (18800) will auto-start" -ForegroundColor Gray
Write-Host "  - View logs: Get-Content \"$env:USERPROFILE\.goclaw\logs.txt\" -Tail 30" -ForegroundColor Gray
Write-Host ""
