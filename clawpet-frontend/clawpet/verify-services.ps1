# ClawPet 服务验证脚本
# 在重启 Electron 应用后运行此脚本验证服务是否正常

Write-Host "`n=== ClawPet 服务验证 ===" -ForegroundColor Cyan

# 等待服务启动
Write-Host "`n等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 检查 Launcher
Write-Host "`n[1] 检查 Launcher (18800)" -ForegroundColor Yellow
try {
    $launcherResponse = Invoke-WebRequest -Uri "http://127.0.0.1:18800/api/auth/status" -TimeoutSec 3 -ErrorAction Stop
    if ($launcherResponse.StatusCode -eq 200) {
        Write-Host "  ✓ Launcher 正在运行" -ForegroundColor Green
    }
} catch {
    Write-Host "  ✗ Launcher 未运行" -ForegroundColor Red
}

# 检查 Gateway
Write-Host "`n[2] 检查 Gateway (18790)" -ForegroundColor Yellow
try {
    $gatewayResponse = Invoke-WebRequest -Uri "http://127.0.0.1:18790/health" -TimeoutSec 3 -ErrorAction Stop
    if ($gatewayResponse.StatusCode -eq 200) {
        Write-Host "  ✓ Gateway 正在运行" -ForegroundColor Green
        
        # 检查启用的 channels
        $gatewayContent = $gatewayResponse.Content | ConvertFrom-Json
        if ($gatewayContent.channels) {
            Write-Host "  启用的 Channels: $($gatewayContent.channels -join ', ')" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "  ✗ Gateway 未运行" -ForegroundColor Red
}

# 检查 PetChannel token 端点
Write-Host "`n[3] 检查 PetChannel 端点" -ForegroundColor Yellow

# 检查 Gateway 的 /pet/token
try {
    $petTokenGateway = Invoke-WebRequest -Uri "http://127.0.0.1:18790/pet/token" -TimeoutSec 3 -ErrorAction Stop
    if ($petTokenGateway.StatusCode -eq 200) {
        $petData = $petTokenGateway.Content | ConvertFrom-Json
        Write-Host "  ✓ Gateway /pet/token 可用" -ForegroundColor Green
        Write-Host "    Enabled: $($petData.enabled)" -ForegroundColor Gray
        Write-Host "    Protocol: $($petData.protocol)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ✗ Gateway /pet/token 不可用: $($_.Exception.Message)" -ForegroundColor Red
}

# 检查 Launcher 的 /api/pet/token
try {
    $headers = @{}
    $token = "goclaw-local-token"
    if ($token) {
        $headers["Authorization"] = "Bearer $token"
    }
    $petTokenLauncher = Invoke-WebRequest -Uri "http://127.0.0.1:18800/api/pet/token" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
    if ($petTokenLauncher.StatusCode -eq 200) {
        $petData = $petTokenLauncher.Content | ConvertFrom-Json
        Write-Host "  ✓ Launcher /api/pet/token 可用" -ForegroundColor Green
        Write-Host "    Enabled: $($petData.enabled)" -ForegroundColor Gray
        Write-Host "    Protocol: $($petData.protocol)" -ForegroundColor Gray
        Write-Host "    WS URL: $($petData.ws_url)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ✗ Launcher /api/pet/token 不可用: $($_.Exception.Message)" -ForegroundColor Red
}

# 检查最新日志
Write-Host "`n[4] 最新日志（最近 10 行）" -ForegroundColor Yellow
$logPath = "$env:USERPROFILE\.picoclaw\logs.txt"
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 10 | ForEach-Object {
        if ($_ -match "ERROR|Failed|error") {
            Write-Host "  $_" -ForegroundColor Red
        } elseif ($_ -match "ready|started|enabled") {
            Write-Host "  $_" -ForegroundColor Green
        } else {
            Write-Host "  $_" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  日志文件不存在" -ForegroundColor Gray
}

Write-Host "`n=== 验证完成 ===" -ForegroundColor Cyan
Write-Host "`n提示：" -ForegroundColor Yellow
Write-Host "- 如果所有检查都通过，WebSocket 连接应该正常工作" -ForegroundColor White
Write-Host "- 如果仍有问题，请查看完整日志: Get-Content `$env:USERPROFILE\.picoclaw\logs.txt -Tail 50" -ForegroundColor White
Write-Host ""
