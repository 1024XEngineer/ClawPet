param(
    [ValidateSet("launcher", "dev", "petclaw")]
    [string]$Mode = "petclaw",

    [switch]$NoBrowser,
    [switch]$SkipNpmInstall,
    [switch]$NoTerminalWindows
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Resolve-CommandPath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Fallbacks = @()
    )

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    foreach ($candidate in $Fallbacks) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "Required command not found: $Name"
}

function Escape-SingleQuote {
    param([Parameter(Mandatory = $true)][string]$Value)
    return $Value -replace "'", "''"
}

function Get-ExitCodeOrDefault {
    param([int]$Default = 0)
    $lastExit = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
    if ($null -ne $lastExit) {
        return [int]$lastExit.Value
    }
    if (-not $?) {
        return 1
    }
    return $Default
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Frontend = Join-Path $Root "electron-frontend"
$PetClaw = Join-Path $Root "petclaw"
$LauncherExe = Join-Path $Root "picoclaw-web.exe"

Write-Host "Project root: $Root"
Write-Host "Start mode:   $Mode"

$runGoclawDev = Join-Path $Root "scripts\run-goclaw-dev.ps1"

if ($Mode -ne "launcher") {
    if (-not (Test-Path $runGoclawDev)) {
        throw "Startup script not found: $runGoclawDev"
    }

    if ($SkipNpmInstall) {
        Write-Warning "-SkipNpmInstall is ignored when delegating to scripts\\run-goclaw-dev.ps1"
    }

    $delegateArgs = @(
        "-ExecutionPolicy", "Bypass",
        "-File", $runGoclawDev,
        "-Restart",
        "-PetclawMode", "dev"
    )
    if ($NoTerminalWindows) {
        $delegateArgs += "-NoTerminalWindows"
    }

    if ($NoBrowser) {
        Write-Warning "-NoBrowser is not used by scripts\\run-goclaw-dev.ps1 and will be ignored"
    }

    & powershell @delegateArgs
    exit (Get-ExitCodeOrDefault)
}

if ($Mode -eq "launcher") {
    if (-not (Test-Path $LauncherExe)) {
        throw "Launcher not found: $LauncherExe"
    }

    $launcherArgs = @()
    if ($NoBrowser) {
        $launcherArgs += "-no-browser"
    }

    Write-Host "Launching Web UI launcher..."
    & $LauncherExe @launcherArgs
    exit (Get-ExitCodeOrDefault)
}

$goCmd = Resolve-CommandPath -Name "go" -Fallbacks @(
    "C:\Program Files\Go\bin\go.exe"
)
$npmCmd = Resolve-CommandPath -Name "npm" -Fallbacks @(
    "C:\Program Files\nodejs\npm.cmd",
    "C:\Program Files (x86)\nodejs\npm.cmd"
)

if (-not (Test-Path $Frontend)) {
    throw "Frontend folder not found: $Frontend"
}
if (-not (Test-Path $PetClaw)) {
    throw "PetClaw folder not found: $PetClaw"
}

$rootEscaped = Escape-SingleQuote -Value $Root
$frontendEscaped = Escape-SingleQuote -Value $Frontend
$petclawEscaped = Escape-SingleQuote -Value $PetClaw

if (-not $SkipNpmInstall) {
    $nodeModules = Join-Path $Frontend "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "Installing frontend dependencies..."
        & "$npmCmd" install --prefix "$Frontend"
    }

    $petclawNodeModules = Join-Path $PetClaw "node_modules"
    if (-not (Test-Path $petclawNodeModules)) {
        Write-Host "Installing PetClaw dependencies..."
        & "$npmCmd" install --prefix "$PetClaw"
    }
}

$goEscaped = Escape-SingleQuote -Value $goCmd
$npmEscaped = Escape-SingleQuote -Value $npmCmd

$backendCommand = "Set-Location '$rootEscaped'; & '$goEscaped' run -tags 'goolm,stdjson' ./cmd/picoclaw gateway"
$frontendCommand = "Set-Location '$frontendEscaped'; & '$npmEscaped' run start"
$petclawCommand = "Set-Location '$petclawEscaped'; & '$npmEscaped' run dev"

if ($Mode -eq "petclaw") {
    Write-Host "Starting backend in a new PowerShell window..."
    Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCommand) | Out-Null

    Write-Host "Starting PetClaw frontend in a new PowerShell window..."
    Start-Process powershell -ArgumentList @("-NoExit", "-Command", $petclawCommand) | Out-Null

    if (-not $NoBrowser) {
        Start-Sleep -Seconds 2
        Start-Process "http://localhost:3000/onboarding"
    }

    Write-Host "Done. Keep both windows open while using the app."
    exit 0
}

Write-Host "Starting backend in a new PowerShell window..."
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCommand) | Out-Null

Write-Host "Starting frontend in a new PowerShell window..."
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCommand) | Out-Null

Write-Host "Done. Keep both windows open while using the app."
