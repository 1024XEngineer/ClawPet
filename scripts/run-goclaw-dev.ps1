param(
  [string]$DashboardUrl = "http://127.0.0.1:3000",
  [switch]$Restart,
  [ValidateSet("prod", "dev")]
  [string]$PetclawMode = "prod",
  [switch]$ForceFrontendBuild,
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
$LauncherConfigPath = $GatewayConfigPath
if (-not (Test-Path $gatewayHomeDir)) {
  New-Item -ItemType Directory -Path $gatewayHomeDir -Force | Out-Null
}

$LauncherToken = "goclaw-local-token"
$launcherCandidates = @(
  (Join-Path $repoRoot "picoclaw-web.exe"),
  (Join-Path $repoRoot "picoclaw-launcher.exe"),
  (Join-Path $repoRoot "build\picoclaw-launcher.exe")
)
$resolvedLauncherBin = $null
foreach ($candidate in $launcherCandidates) {
  if (Test-Path $candidate) {
    $resolvedLauncherBin = $candidate
    break
  }
}

function Write-JsonNoBom {
  param(
    [string]$Path,
    [string]$Json
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Json, $utf8NoBom)
}

function Normalize-JsonFileNoBom {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  $raw = [System.IO.File]::ReadAllText($Path)
  Write-JsonNoBom -Path $Path -Json $raw
}

function Test-PortListening {
  param([int]$Port)

  $line = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING" | Select-Object -First 1
  return $null -ne $line
}

function Get-FirstListeningPidOnPort {
  param([int]$Port)

  $line = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING" | Select-Object -First 1
  if (-not $line) {
    return 0
  }

  $parts = ($line.Line -replace "\s+", " ").Trim().Split(" ")
  if ($parts.Count -lt 5) {
    return 0
  }

  $pid = 0
  if ([int]::TryParse($parts[4], [ref]$pid)) {
    return $pid
  }
  return 0
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

function Invoke-LauncherApi {
  param(
    [string]$Method,
    [string]$Path,
    [string]$LauncherToken,
    $Body = $null
  )

  $uri = "http://127.0.0.1:18800$Path"
  $headers = @{ Authorization = "Bearer $LauncherToken" }

  try {
    if ($null -ne $Body) {
      return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 8) -TimeoutSec 10
    }

    return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -TimeoutSec 10
  } catch {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $bodyText = $reader.ReadToEnd()
      if ($bodyText.Length -gt 400) {
        $bodyText = $bodyText.Substring(0, 400)
      }
      throw "Launcher API $Method $Path failed ($statusCode): $bodyText"
    }
    throw
  }
}

function Wait-GatewayRunning {
  param(
    [string]$LauncherToken,
    [int]$TimeoutSeconds = 20,
    [int]$IntervalMs = 700
  )

  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
    try {
      $status = Invoke-LauncherApi -Method GET -Path "/api/gateway/status" -LauncherToken $LauncherToken
      if ($status.gateway_status -eq "running") {
        return $true
      }
    } catch {
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
  return $false
}

function Start-DetachedPowerShell {
  param(
    [string]$Title,
    [string]$Command
  )

  if ($NoTerminalWindows) {
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

  Start-Process -FilePath "powershell" -ArgumentList $argList -WindowStyle Hidden | Out-Null
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

function Find-FreeTcpPort {
  param(
    [int]$Start = 18790,
    [int]$End = 18990
  )

  for ($p = $Start; $p -le $End; $p++) {
    if (-not (Test-PortListening -Port $p)) {
      return $p
    }
  }

  throw "No free TCP port found in range $Start-$End"
}

function Ensure-GatewayPortAvailable {
  param([string]$ConfigPath)

  $fixedGatewayPort = 18790

  if (-not (Test-Path $ConfigPath)) {
    return
  }

  Normalize-JsonFileNoBom -Path $ConfigPath
  $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
  try {
    $cfg = $raw | ConvertFrom-Json
  } catch {
    Write-Warning "Unable to parse config for gateway port check; skip port auto-adjust. Error: $($_.Exception.Message)"
    return
  }

  if ($null -eq $cfg.gateway) {
    $cfg | Add-Member -MemberType NoteProperty -Name gateway -Value @{ host = "127.0.0.1"; port = 18790 }
  }

  $targetPort = [int]$cfg.gateway.port
  if ($targetPort -ne $fixedGatewayPort) {
    Write-Warning "Gateway port in config is $targetPort; forcing fixed port $fixedGatewayPort to keep integration stable."
    $targetPort = $fixedGatewayPort
    $cfg.gateway.port = $targetPort
    $json = $cfg | ConvertTo-Json -Depth 30
    Write-JsonNoBom -Path $ConfigPath -Json $json
  }

  if (-not (Test-PortListening -Port $targetPort)) {
    return
  }

  Write-Step "Gateway target port $targetPort is occupied, attempting cleanup..."
  Stop-PidsOnPort -Port $targetPort
  Start-Sleep -Milliseconds 250

  if (-not (Test-PortListening -Port $targetPort)) {
    Write-Step "Port $targetPort released."
    return
  }

  $holderPid = Get-FirstListeningPidOnPort -Port $targetPort
  throw "Port $targetPort is still occupied by PID $holderPid. Fixed gateway port mode is enabled; please stop that process and retry."
}

function Get-GatewayPortFromConfig {
  param([string]$ConfigPath)

  if (-not (Test-Path $ConfigPath)) {
    return 18790
  }

  $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
  $cfg = ($raw | ConvertFrom-Json)
  if ($null -eq $cfg.gateway -or [int]$cfg.gateway.port -le 0) {
    return 18790
  }
  return [int]$cfg.gateway.port
}

function Set-GatewayPortInConfig {
  param(
    [string]$ConfigPath,
    [int]$Port
  )

  if (-not (Test-Path $ConfigPath)) {
    return
  }

  $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
  $cfg = ($raw | ConvertFrom-Json)
  if ($null -eq $cfg.gateway) {
    $cfg | Add-Member -MemberType NoteProperty -Name gateway -Value @{ host = "127.0.0.1"; port = $Port }
  } else {
    $cfg.gateway.port = $Port
  }
  $json = $cfg | ConvertTo-Json -Depth 30
  Write-JsonNoBom -Path $ConfigPath -Json $json
}

if (-not (Test-Path $repoRoot)) {
  throw "Repository root not found: $repoRoot"
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

if (-not [string]::IsNullOrWhiteSpace($resolvedLauncherBin)) {
  if ((Test-HttpReady -Url "http://127.0.0.1:18800" -TimeoutSeconds 2) -or (Test-PortListening -Port 18800)) {
    Write-Step "PicoClaw launcher already running on :18800"
  } else {
    Write-Step "Starting PicoClaw launcher..."
    $configDir = Split-Path -Parent $LauncherConfigPath
    if (-not [string]::IsNullOrWhiteSpace($configDir) -and -not (Test-Path $configDir)) {
      New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    $escapedLauncherToken = $LauncherToken.Replace("'", "''")
    $escapedLauncherConfigPath = $LauncherConfigPath.Replace("'", "''")
    $escapedConfigDir = $configDir.Replace("'", "''")
    $escapedMainBinary = $mainBinary.Replace("'", "''")
    $launcherCmd = "`$env:PICOCLAW_BINARY='$escapedMainBinary'; `$env:PICOCLAW_LAUNCHER_TOKEN='$escapedLauncherToken'; `$env:PICOCLAW_HOME='$escapedConfigDir'; `$env:PICOCLAW_CONFIG='$escapedLauncherConfigPath'; & '$resolvedLauncherBin' -no-browser '$escapedLauncherConfigPath'"
    Start-DetachedPowerShell -Title "GoClaw - Launcher" -Command $launcherCmd

    if (-not (Wait-HttpReady -Url "http://127.0.0.1:18800" -TimeoutSeconds 25)) {
      throw "Launcher did not become ready on http://127.0.0.1:18800. Please check launcher window logs."
    } else {
      Write-Step "Launcher is ready at http://127.0.0.1:18800"
    }
  }
} else {
  if (-not (Test-HttpReady -Url "http://127.0.0.1:18800" -TimeoutSeconds 2)) {
    throw "Launcher binary not found and http://127.0.0.1:18800 is unavailable. Please pass -LauncherBin <path>."
  }
  Write-Warning "Launcher binary not found, but detected existing launcher on :18800."
}

Write-Step "Ensuring gateway is running before opening UI..."
try {
  $gatewayReady = $false
  $gatewayPreconditionBlocked = $false
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    Ensure-GatewayPortAvailable -ConfigPath $LauncherConfigPath

    $gatewayStatus = Invoke-LauncherApi -Method GET -Path "/api/gateway/status" -LauncherToken $LauncherToken
    if ($gatewayStatus.gateway_status -eq "stopped" -or $gatewayStatus.gateway_status -eq "error") {
      try {
        $null = Invoke-LauncherApi -Method POST -Path "/api/gateway/start" -LauncherToken $LauncherToken
      } catch {
        if ($_.Exception.Message -match "failed \(400\)") {
          $latest = Invoke-LauncherApi -Method GET -Path "/api/gateway/status" -LauncherToken $LauncherToken
          $reason = ""
          if ($latest.gateway_start_reason) {
            $reason = "$($latest.gateway_start_reason)"
          }
          if ([string]::IsNullOrWhiteSpace($reason)) {
            $reason = "gateway start preconditions are not met yet"
          }
          Write-Warning "Gateway not started yet: $reason. Continuing startup so onboarding/UI can open."
          $gatewayPreconditionBlocked = $true
          break
        }
        throw
      }
    }

    if (Wait-GatewayRunning -LauncherToken $LauncherToken -TimeoutSeconds 25) {
      $gatewayReady = $true
      break
    }

    $latest = Invoke-LauncherApi -Method GET -Path "/api/gateway/status" -LauncherToken $LauncherToken
    $logs = Invoke-LauncherApi -Method GET -Path "/api/gateway/logs" -LauncherToken $LauncherToken
    $joinedLogs = ""
    if ($logs.logs) {
      $joinedLogs = ($logs.logs -join "`n")
    }

    $currentPort = Get-GatewayPortFromConfig -ConfigPath $LauncherConfigPath
    $portConflict = (Test-PortListening -Port $currentPort)
    $bindError = $joinedLogs -match "listen tcp .*:${currentPort}: bind"

    if ($attempt -lt 2 -and ($bindError -or $portConflict)) {
      Write-Warning "Gateway failed on fixed port $currentPort; retrying once after cleanup..."
      Stop-PidsOnPort -Port $currentPort
      Start-Sleep -Milliseconds 300
      continue
    }

    $reason = ""
    if ($latest.gateway_start_reason) {
      $reason = " reason: $($latest.gateway_start_reason)"
    }
    throw "Gateway is not running after startup.$reason"
  }

  if (-not $gatewayReady -and -not $gatewayPreconditionBlocked) {
    throw "Gateway is not running after startup."
  }

  if ($gatewayReady) {
    Write-Step "Gateway is running."
  } else {
    Write-Step "Gateway is not running yet (waiting for onboarding/model setup)."
  }
} catch {
  throw "Gateway preflight failed: $($_.Exception.Message)"
}

$currentGatewayPort = Get-GatewayPortFromConfig -ConfigPath $LauncherConfigPath
$directGatewayUrl = "http://127.0.0.1:$currentGatewayPort"

Ensure-NpmDeps -ProjectDir $petclawDir -DisplayName "petclaw"

$escapedDashboard = $DashboardUrl.Replace("'", "''")
$escapedElectronLauncherToken = $LauncherToken.Replace("'", "''")
$existingElectron = @(Get-Process -Name electron -ErrorAction SilentlyContinue)
if ($existingElectron.Count -gt 0) {
  Write-Step "Electron desktop pet already running."
} else {
  Write-Step "Starting electron desktop pet process (startup page mode)..."
  $electronCmd = "`$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'; `$env:GOCLAW_DASHBOARD_URL='$escapedDashboard'; `$env:GOCLAW_LAUNCHER_TOKEN='$escapedElectronLauncherToken'; `$env:PICOCLAW_LAUNCHER_TOKEN='$escapedElectronLauncherToken'; `$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'; `$env:GOCLAW_OPEN_PANEL_ON_READY='1'; `$env:GOCLAW_SHOW_STARTUP='1'; Set-Location '$petclawDir'; npx electron electron/main.js"
  Start-DetachedPowerShell -Title "GoClaw - Electron" -Command $electronCmd
}

if ($gatewayReady) {
  Write-Step "Gateway is already running (launcher-managed), skip direct start."
} else {
  Write-Step "Starting gateway on 127.0.0.1:18790..."
  $escapedGatewayConfigPath = $GatewayConfigPath.Replace("'", "''")
  $escapedGatewayHomeDir = $gatewayHomeDir.Replace("'", "''")
  $gatewayCmd = "`$env:PICOCLAW_HOME='$escapedGatewayHomeDir'; `$env:PICOCLAW_CONFIG='$escapedGatewayConfigPath'; Set-Location '$repoRoot'; & '$mainBinary' gateway -E"
  Start-DetachedPowerShell -Title "GoClaw - Gateway" -Command $gatewayCmd

  if (-not (Wait-HttpReady -Url "http://127.0.0.1:18790/health" -TimeoutSeconds 35)) {
    throw "Gateway did not become ready on http://127.0.0.1:18790"
  }
  Write-Step "Gateway is ready at http://127.0.0.1:18790"
}

if ((Test-HttpReady -Url $DashboardUrl -TimeoutSeconds 2)) {
  Write-Step "Petclaw dashboard already running at $DashboardUrl"
} else {
  if ($PetclawMode -eq "prod") {
    $buildIdPath = Join-Path $petclawDir ".next\BUILD_ID"
    $shouldBuild = $ForceFrontendBuild -or -not (Test-Path $buildIdPath)
    if ($shouldBuild) {
      Write-Step "Building petclaw dashboard (prod mode)..."
      Invoke-Npm -WorkingDir $petclawDir -Arguments "run build"
    } else {
      Write-Step "Using existing petclaw production build (.next/BUILD_ID detected)."
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
