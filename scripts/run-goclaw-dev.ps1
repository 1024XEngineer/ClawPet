param(
  [string]$DashboardUrl = "http://127.0.0.1:3000",
  [switch]$Restart,
  [ValidateSet("prod", "dev")]
  [string]$PetclawMode = "prod",
  [string]$GatewayConfigPath = "",
  [switch]$NoTerminalWindows,
  [switch]$ShowTerminalWindows
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot "clawpet-frontend"
$petclawDir = Join-Path $frontendRoot "clawpet"
$electronEntry = Join-Path $petclawDir "electron\main.js"
$mainBinary = Join-Path $repoRoot "picoclaw.exe"
$gatewayHomeDir = Join-Path $repoRoot ".goclaw-runtime"
$hideTerminalWindows = $true
if ($ShowTerminalWindows) {
  $hideTerminalWindows = $false
} elseif ($NoTerminalWindows) {
  $hideTerminalWindows = $true
}

if ([string]::IsNullOrWhiteSpace($GatewayConfigPath)) {
  $GatewayConfigPath = Join-Path $repoRoot ".goclaw-runtime\config.json"
}
if (-not (Test-Path $gatewayHomeDir)) {
  New-Item -ItemType Directory -Path $gatewayHomeDir -Force | Out-Null
}

function Write-Step([string]$message) {
  Write-Host "[GoClaw] $message"
}

function Invoke-Npm {
  param(
    [string]$WorkingDir,
    [string]$Arguments
  )

  $old = Get-Location
  try {
    Set-Location $WorkingDir
    & npm $Arguments.Split(" ")
    if (-not $?) {
      throw "npm $Arguments failed in $WorkingDir"
    }
  } finally {
    Set-Location $old
  }
}

function Test-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 2
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 30,
    [int]$IntervalMs = 500
  )

  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
    if (Test-HttpReady -Url $Url -TimeoutSeconds 2) {
      return $true
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
  return $false
}

function Get-ListeningPidsForPort {
  param([int]$Port)

  $ids = @()
  $lines = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING"
  foreach ($line in $lines) {
    $parts = ($line.Line -replace "\s+", " ").Trim().Split(" ")
    if ($parts.Count -ge 5) {
      $procId = 0
      if ([int]::TryParse($parts[4], [ref]$procId) -and $procId -gt 0) {
        $ids += $procId
      }
    }
  }
  return @($ids | Select-Object -Unique)
}

function Stop-PidsOnPort {
  param([int]$Port)

  foreach ($procId in (Get-ListeningPidsForPort -Port $Port)) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
    }
  }
}

function Stop-ProcessesByName {
  param([string[]]$Names)
  foreach ($name in $Names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

function Start-DetachedPowerShell {
  param(
    [string]$Title,
    [string]$Command
  )

  if ($hideTerminalWindows) {
    $argList = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      $Command
    )
    Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList $argList | Out-Null
    return
  }

  $argList = @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "`$Host.UI.RawUI.WindowTitle='$Title'; $Command"
  )
  Start-Process -FilePath "powershell" -ArgumentList $argList | Out-Null
}

function Ensure-NpmDeps {
  param(
    [string]$ProjectDir,
    [string]$DisplayName
  )

  $nodeModules = Join-Path $ProjectDir "node_modules"
  if (Test-Path $nodeModules) {
    return
  }

  Write-Step "Installing npm dependencies for $DisplayName (first run)..."
  Invoke-Npm -WorkingDir $ProjectDir -Arguments "install"
}

if (-not (Test-Path $frontendRoot)) {
  throw "frontend root not found: $frontendRoot"
}
if (-not (Test-Path $petclawDir)) {
  throw "petclaw directory not found: $petclawDir"
}
if (-not (Test-Path $electronEntry)) {
  throw "electron entry not found: $electronEntry"
}
if (-not (Test-Path $mainBinary)) {
  throw "gateway binary not found: $mainBinary"
}

Write-Step "Pre-cleaning old GoClaw processes..."
Stop-PidsOnPort -Port 18790
Stop-PidsOnPort -Port 18800
Stop-PidsOnPort -Port 3000
Stop-PidsOnPort -Port 3002
Stop-PidsOnPort -Port 5173
Stop-ProcessesByName -Names @("electron", "picoclaw", "picoclaw-web", "picoclaw-launcher")

if ($Restart) {
  Start-Sleep -Milliseconds 800
} else {
  Start-Sleep -Milliseconds 400
}

Ensure-NpmDeps -ProjectDir $petclawDir -DisplayName "petclaw"

$escapedDashboard = $DashboardUrl.Replace("'", "''")
$existingElectron = @(Get-Process -Name electron -ErrorAction SilentlyContinue)
if ($existingElectron.Count -gt 0) {
  Write-Step "Electron desktop pet already running."
} else {
  Write-Step "Starting electron desktop pet process (startup page mode)..."
  $electronCmd = "`$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'; `$env:GOCLAW_DASHBOARD_URL='$escapedDashboard'; `$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'; `$env:GOCLAW_OPEN_PANEL_ON_READY='1'; `$env:GOCLAW_SHOW_STARTUP='1'; Set-Location '$petclawDir'; npx electron electron/main.js"
  Start-DetachedPowerShell -Title "GoClaw - Electron" -Command $electronCmd
}

Write-Step "Starting gateway on 127.0.0.1:18790..."
$escapedGatewayConfigPath = $GatewayConfigPath.Replace("'", "''")
$escapedGatewayHomeDir = $gatewayHomeDir.Replace("'", "''")
$gatewayCmd = "`$env:PICOCLAW_HOME='$escapedGatewayHomeDir'; `$env:PICOCLAW_CONFIG='$escapedGatewayConfigPath'; Set-Location '$repoRoot'; & '$mainBinary' gateway -E"
Start-DetachedPowerShell -Title "GoClaw - Gateway" -Command $gatewayCmd

if (-not (Wait-HttpReady -Url "http://127.0.0.1:18790/health" -TimeoutSeconds 35)) {
  throw "Gateway did not become ready on http://127.0.0.1:18790"
}
Write-Step "Gateway is ready at http://127.0.0.1:18790"

if ((Test-HttpReady -Url $DashboardUrl -TimeoutSeconds 2)) {
  Write-Step "Petclaw dashboard already running at $DashboardUrl"
} else {
  if ($PetclawMode -eq "prod") {
    $buildId = Join-Path $petclawDir ".next\BUILD_ID"
    if (-not (Test-Path $buildId)) {
      Write-Step "Petclaw prod build not found, running npm run build..."
      Invoke-Npm -WorkingDir $petclawDir -Arguments "run build"
    }
    Write-Step "Starting petclaw dashboard (prod mode)..."
    $petclawCmd = "`$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18790'; `$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'; `$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'; `$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'; Set-Location '$petclawDir'; npm run start -- --hostname 127.0.0.1 --port 3000"
  } else {
    Write-Step "Starting petclaw dashboard (dev mode)..."
    $petclawCmd = "`$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18790'; `$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'; `$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'; `$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'; Set-Location '$petclawDir'; npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack"
  }

  Start-DetachedPowerShell -Title "GoClaw - Petclaw" -Command $petclawCmd

  if (-not (Wait-HttpReady -Url $DashboardUrl -TimeoutSeconds 120)) {
    Write-Warning "Petclaw did not become ready at $DashboardUrl in time."
  } else {
    Write-Step "Petclaw is ready at $DashboardUrl"
  }
}

Write-Host ""
Write-Host "GoClaw startup summary:"
Write-Host "- Config:    $GatewayConfigPath"
Write-Host "- Backend:   http://127.0.0.1:18790 (gateway direct)"
Write-Host "- Dashboard: $DashboardUrl"
Write-Host "- Petclaw:   $PetclawMode"
Write-Host "- Renderer:  $DashboardUrl/desktop-pet"
Write-Host "- Ports:     frontend=3000, backend=18790"
Write-Host "- Electron:  started or already running"
