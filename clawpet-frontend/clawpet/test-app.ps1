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

# Dynamically find portable and installer (version-agnostic)
$Portable = Get-ChildItem -Path (Join-Path $ClawpetDir "dist") -Filter "ClawPet *.exe" | Where-Object { $_.Name -notlike "*Setup*" } | Select-Object -First 1
$Installer = Get-ChildItem -Path (Join-Path $ClawpetDir "dist") -Filter "ClawPet Setup*.exe" | Select-Object -First 1

$PortablePath = if ($Portable) { $Portable.FullName } else { $null }
$InstallerPath = if ($Installer) { $Installer.FullName } else { $null }

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
if ($PortablePath) {
    Write-Host "  2. Portable version ($($Portable.Name))" -ForegroundColor White
}
if ($InstallerPath) {
    Write-Host "  3. Installer version ($($Installer.Name))" -ForegroundColor White
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
        if ($PortablePath) {
            Write-Host ""
            Write-Host "Launching portable version..." -ForegroundColor Green
            Write-Host "   Path: $PortablePath" -ForegroundColor Gray
            Write-Host ""
            Start-Process $PortablePath
        } else {
            Write-Host "ERROR: Portable version not found" -ForegroundColor Red
        }
    }
    "3" {
        if ($InstallerPath) {
            Write-Host ""
            Write-Host "Launching installer version..." -ForegroundColor Green
            Write-Host "   Path: $InstallerPath" -ForegroundColor Gray
            Write-Host ""
            Start-Process $InstallerPath
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
Write-Host "  - View logs: Get-Content \"$env:USERPROFILE\.picoclaw\logs.txt\" -Tail 30" -ForegroundColor Gray
Write-Host ""
