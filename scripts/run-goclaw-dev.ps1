param(
  [string]$DashboardUrl = "http://127.0.0.1:3000",
  [string]$LauncherBin = "",
  [switch]$Restart,
  [ValidateSet("prod", "dev")]
  [string]$PetclawMode = "prod",
  [string]$LauncherToken = "goclaw-local-token",
  [string]$LauncherConfigPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$petclawDir = Join-Path $repoRoot "petclaw"
$electronDir = Join-Path $repoRoot "electron-frontend"
$mainBinary = Join-Path $repoRoot "picoclaw.exe"

if ([string]::IsNullOrWhiteSpace($LauncherConfigPath)) {
  $LauncherConfigPath = Join-Path $repoRoot ".goclaw-runtime\config.json"
}

function Write-Step([string]$message) {
  Write-Host "[GoClaw] $message"
}

function Find-LauncherBinary {
  param([string]$baseDir, [string]$explicitPath)

  if (-not [string]::IsNullOrWhiteSpace($explicitPath)) {
    if (Test-Path $explicitPath) {
      return $explicitPath
    }
    throw "Launcher binary not found at path: $explicitPath"
  }

  $candidates = @(
    (Join-Path $baseDir "build\picoclaw-launcher.exe"),
    (Join-Path $baseDir "picoclaw-launcher.exe"),
    (Join-Path $baseDir "picoclaw-web.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return ""
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

  $argList = @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "`$Host.UI.RawUI.WindowTitle='$Title'; $Command"
  )

  Start-Process -FilePath "powershell" -ArgumentList $argList | Out-Null
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

  $pids = @()
  $lines = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING"
  foreach ($line in $lines) {
    $parts = ($line.Line -replace "\s+", " ").Trim().Split(" ")
    if ($parts.Count -ge 5) {
      $procId = 0
      if ([int]::TryParse($parts[4], [ref]$procId) -and $procId -gt 0) {
        $pids += $procId
      }
    }
  }
  return @($pids | Select-Object -Unique)
}

function Test-PortListening {
  param([int]$Port)
  return (Get-ListeningPidsForPort -Port $Port).Count -gt 0
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

function Stop-NodeProcessesByPathHint {
  param([string[]]$PathHints)

  $nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
  foreach ($proc in $nodeProcs) {
    $cmd = $proc.CommandLine
    if ([string]::IsNullOrWhiteSpace($cmd)) {
      continue
    }
    $shouldStop = $false
    foreach ($hint in $PathHints) {
      if ($cmd -like "*$hint*") {
        $shouldStop = $true
        break
      }
    }
    if ($shouldStop) {
      try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

function Remove-StalePidFiles {
  param([string[]]$Paths)
  foreach ($path in $Paths) {
    if (Test-Path $path) {
      try {
        Remove-Item -Path $path -Force -ErrorAction Stop
      } catch {
      }
    }
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

  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $raw = $raw.TrimStart([char]0xFEFF)
  Write-JsonNoBom -Path $Path -Json $raw
}

function Test-JsonFileValid {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $false
  }

  try {
    $null = Get-Content $Path -Raw | ConvertFrom-Json
    return $true
  } catch {
    return $false
  }
}

function Repair-LauncherConfigIfInvalid {
  param([string]$ConfigPath)

  if (-not (Test-Path $ConfigPath)) {
    return
  }

  Normalize-JsonFileNoBom -Path $ConfigPath
  if (Test-JsonFileValid -Path $ConfigPath) {
    return
  }

  $fallback = Join-Path $env:USERPROFILE ".picoclaw\config.json"
  if (Test-Path $fallback -and (Test-JsonFileValid -Path $fallback)) {
    Copy-Item -Path $fallback -Destination $ConfigPath -Force
    Normalize-JsonFileNoBom -Path $ConfigPath
    Write-Warning "Launcher config was invalid JSON. Recovered from $fallback"
    return
  }

  throw "Launcher config is invalid JSON and fallback config is unavailable: $ConfigPath"
}

function Ensure-LauncherConfigVersionCompat {
  param([string]$ConfigPath)

  if (-not (Test-Path $ConfigPath)) {
    return
  }

  $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
  $cfg = $raw | ConvertFrom-Json
  $ver = 0
  try {
    $ver = [int]$cfg.version
  } catch {
    $ver = 0
  }

  if ($ver -le 0) {
    $cfg.version = 2
    $json = $cfg | ConvertTo-Json -Depth 30
    Write-JsonNoBom -Path $ConfigPath -Json $json
    Write-Step "Normalized launcher config version to 2"
    return
  }

  if ($ver -gt 2) {
    $cfg.version = 2
    $json = $cfg | ConvertTo-Json -Depth 30
    Write-JsonNoBom -Path $ConfigPath -Json $json
    Write-Step "Downgraded launcher config version from $ver to 2 for backend compatibility"
  }
}

function Ensure-PicoAllowOrigins {
  param([string]$ConfigPath)

  if (-not (Test-Path $ConfigPath)) {
    return
  }

  $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
  $cfg = $raw | ConvertFrom-Json

  if ($null -eq $cfg.channels) {
    return
  }
  if ($null -eq $cfg.channels.pico) {
    return
  }

  $mustHave = @(
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:18800',
    'http://localhost:18800'
  )

  $current = @()
  if ($cfg.channels.pico.allow_origins) {
    $current = @($cfg.channels.pico.allow_origins)
  }

  $normalized = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($origin in $current) {
    if (-not [string]::IsNullOrWhiteSpace($origin)) {
      [void]$normalized.Add($origin.Trim())
    }
  }

  $changed = $false
  foreach ($origin in $mustHave) {
    if (-not $normalized.Contains($origin)) {
      [void]$normalized.Add($origin)
      $changed = $true
    }
  }

  if ($changed -or $current.Count -eq 0) {
    $cfg.channels.pico.allow_origins = @($normalized)
    $json = $cfg | ConvertTo-Json -Depth 30
    Write-JsonNoBom -Path $ConfigPath -Json $json
    Write-Step "Ensured pico allow_origins include localhost/127.0.0.1 dashboard origins"
  }
}

function Get-FirstListeningPidOnPort {
  param([int]$Port)
  $pids = Get-ListeningPidsForPort -Port $Port
  if ($pids.Count -gt 0) {
    return [int]$pids[0]
  }
  return 0
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
  if ($targetPort -le 0) {
    $targetPort = 18790
    $cfg.gateway.port = $targetPort
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
  $newPort = Find-FreeTcpPort -Start ($targetPort + 1) -End ($targetPort + 200)
  $cfg.gateway.port = $newPort
  $json = $cfg | ConvertTo-Json -Depth 30
  Write-JsonNoBom -Path $ConfigPath -Json $json
  Write-Warning "Port $targetPort is still occupied by PID $holderPid. Switched gateway port to $newPort in $ConfigPath"
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

if (-not (Test-Path $electronDir)) {
  throw "electron-frontend directory not found: $electronDir"
}

Repair-LauncherConfigIfInvalid -ConfigPath $LauncherConfigPath
Ensure-LauncherConfigVersionCompat -ConfigPath $LauncherConfigPath
Ensure-PicoAllowOrigins -ConfigPath $LauncherConfigPath
Ensure-GatewayPortAvailable -ConfigPath $LauncherConfigPath
Normalize-JsonFileNoBom -Path $LauncherConfigPath

$resolvedLauncherBin = Find-LauncherBinary -baseDir $repoRoot -explicitPath $LauncherBin

Write-Step "Pre-cleaning old GoClaw processes and stale PID files..."
Stop-PidsOnPort -Port 18800
Stop-PidsOnPort -Port 18790
Stop-PidsOnPort -Port 3000
Stop-PidsOnPort -Port 5173
Stop-PidsOnPort -Port 8080
Stop-ProcessesByName -Names @("electron", "picoclaw", "picoclaw-web", "picoclaw-launcher")
Stop-NodeProcessesByPathHint -PathHints @("\petclaw\", "\electron-frontend\")

$userHome = $env:USERPROFILE
$pidCandidates = @(
  (Join-Path $userHome ".picoclaw\.picoclaw.pid"),
  (Join-Path $userHome ".picoclaw\.picoclaw.pid.json"),
  (Join-Path $repoRoot ".goclaw-runtime\.picoclaw.pid"),
  (Join-Path $repoRoot ".goclaw-runtime\.picoclaw.pid.json")
)
Remove-StalePidFiles -Paths $pidCandidates

if ($Restart) {
  Write-Step "Restart mode enabled: waiting extra cooldown..."
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
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    Ensure-GatewayPortAvailable -ConfigPath $LauncherConfigPath

    $gatewayStatus = Invoke-LauncherApi -Method GET -Path "/api/gateway/status" -LauncherToken $LauncherToken
    if ($gatewayStatus.gateway_status -eq "stopped" -or $gatewayStatus.gateway_status -eq "error") {
      $null = Invoke-LauncherApi -Method POST -Path "/api/gateway/start" -LauncherToken $LauncherToken
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
      $newPort = Find-FreeTcpPort -Start ($currentPort + 1) -End ($currentPort + 200)
      Set-GatewayPortInConfig -ConfigPath $LauncherConfigPath -Port $newPort
      Write-Warning "Gateway failed on port $currentPort; switched to $newPort and retrying start..."
      continue
    }

    $reason = ""
    if ($latest.gateway_start_reason) {
      $reason = " reason: $($latest.gateway_start_reason)"
    }
    throw "Gateway is not running after startup.$reason"
  }

  if (-not $gatewayReady) {
    throw "Gateway is not running after startup."
  }

  Write-Step "Gateway is running."
} catch {
  throw "Gateway preflight failed: $($_.Exception.Message)"
}

$gatewayPort = Get-GatewayPortFromConfig -ConfigPath $LauncherConfigPath
$directGatewayUrl = "http://127.0.0.1:$gatewayPort"

if ((Test-HttpReady -Url $DashboardUrl -TimeoutSeconds 2) -or (Test-PortListening -Port 3000)) {
  Write-Step "Petclaw dashboard already running at $DashboardUrl"
} else {
  if ($PetclawMode -eq "prod") {
    $buildId = Join-Path $petclawDir ".next\BUILD_ID"
    if (-not (Test-Path $buildId)) {
      Write-Step "Petclaw prod build not found, running npm run build..."
      Invoke-Npm -WorkingDir $petclawDir -Arguments "run build"
    }
    Write-Step "Starting petclaw dashboard (prod mode)..."
    $escapedLauncherToken = $LauncherToken.Replace("'", "''")
    $escapedDirectGatewayUrl = $directGatewayUrl.Replace("'", "''")
    $petclawCmd = "`$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18800'; `$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18800'; `$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='$escapedDirectGatewayUrl'; `$env:NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN='$escapedLauncherToken'; `$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='true'; Set-Location '$petclawDir'; npm run start -- --hostname 127.0.0.1 --port 3000"
  } else {
    Write-Step "Starting petclaw dashboard (dev mode)..."
    $escapedLauncherToken = $LauncherToken.Replace("'", "''")
    $escapedDirectGatewayUrl = $directGatewayUrl.Replace("'", "''")
    $petclawCmd = "`$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18800'; `$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18800'; `$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='$escapedDirectGatewayUrl'; `$env:NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN='$escapedLauncherToken'; `$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='true'; Set-Location '$petclawDir'; npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack"
  }

  Start-DetachedPowerShell -Title "GoClaw - Petclaw" -Command $petclawCmd

  if (-not (Wait-HttpReady -Url $DashboardUrl -TimeoutSeconds 35)) {
    Write-Warning "Petclaw did not become ready at $DashboardUrl in time."
  } else {
    Write-Step "Petclaw is ready at $DashboardUrl"
  }
}

$existingElectron = @(Get-Process -Name electron -ErrorAction SilentlyContinue)
if ($existingElectron.Count -gt 0) {
  Write-Step "Electron desktop pet already running."
} else {
  if (-not (Test-PortListening -Port 5173)) {
    Write-Step "Starting electron frontend vite server..."
    $viteCmd = "Set-Location '$electronDir'; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
    Start-DetachedPowerShell -Title "GoClaw - Electron Vite" -Command $viteCmd
    if (-not (Wait-HttpReady -Url "http://127.0.0.1:5173" -TimeoutSeconds 25)) {
      throw "Electron Vite server did not become ready on http://127.0.0.1:5173"
    }
  } else {
    Write-Step "Electron frontend vite server already running on :5173"
  }

  Write-Step "Starting electron desktop pet process..."
  $escapedDashboard = $DashboardUrl.Replace("'", "''")
  $escapedLauncherToken = $LauncherToken.Replace("'", "''")
  $electronCmd = "`$env:GOCLAW_DASHBOARD_URL='$escapedDashboard'; `$env:GOCLAW_LAUNCHER_TOKEN='$escapedLauncherToken'; Set-Location '$electronDir'; npx electron src/main.js"
  Start-DetachedPowerShell -Title "GoClaw - Electron" -Command $electronCmd
}

Write-Host ""
Write-Host "GoClaw startup summary:"
$launcherSummary = $resolvedLauncherBin
if ([string]::IsNullOrWhiteSpace($launcherSummary)) {
  $launcherSummary = "manual"
}
Write-Host "- Launcher:  $launcherSummary"
Write-Host "- Config:    $LauncherConfigPath"
Write-Host "- Dashboard: $DashboardUrl"
Write-Host "- Petclaw:   $PetclawMode"
Write-Host "- Auth:      Cookie + token bootstrap mode"
Write-Host "- Electron:  started or already running"
