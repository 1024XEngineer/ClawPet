# ClawPet 打包后启动问题诊断脚本
# 用于检查 Gateway 和 Launcher 服务状态

Write-Host "`n=== ClawPet 后端服务诊断 ===" -ForegroundColor Cyan

# 检查配置文件
$configPath = "$env:USERPROFILE\.goclaw-runtime\config.json"
Write-Host "`n[1] 检查配置文件: $configPath" -ForegroundColor Yellow

if (Test-Path $configPath) {
    Write-Host "  ✓ 配置文件存在" -ForegroundColor Green
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        Write-Host "  ✓ 配置文件格式正确" -ForegroundColor Green
        
        # 检查 PetChannel 配置
        if ($config.channels -and $config.channels.pet) {
            if ($config.channels.pet.enabled) {
                Write-Host "  ✓ PetChannel 已启用" -ForegroundColor Green
            } else {
                Write-Host "  ✗ PetChannel 未启用！" -ForegroundColor Red
                Write-Host "    请在配置文件中设置: channels.pet.enabled = true" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ✗ 未找到 PetChannel 配置！" -ForegroundColor Red
            Write-Host "    请添加 PetChannel 配置到 channels.pet 部分" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ✗ 配置文件格式错误: $_" -ForegroundColor Red
    }
} else {
    Write-Host "  ✗ 配置文件不存在！" -ForegroundColor Red
    Write-Host "    首次运行时会自动创建，或者手动创建配置文件" -ForegroundColor Yellow
}

# 检查二进制文件
Write-Host "`n[2] 检查嵌入的二进制文件" -ForegroundColor Yellow

$exePath = Get-Process -Name "ClawPet*" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path
if ($exePath) {
    $exeDir = Split-Path $exePath -Parent
    Write-Host "  应用路径: $exeDir" -ForegroundColor Gray
    
    # 检查 resources 目录
    $resourcesPath = Join-Path (Split-Path $exeDir -Parent) "resources"
    if (Test-Path $resourcesPath) {
        Write-Host "  ✓ resources 目录存在: $resourcesPath" -ForegroundColor Green
        
        $gatewayExe = Join-Path $resourcesPath "picoclaw.exe"
        $launcherExe = Join-Path $resourcesPath "picoclaw-web.exe"
        
        if (Test-Path $gatewayExe) {
            Write-Host "  ✓ Gateway 二进制存在: picoclaw.exe" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Gateway 二进制缺失: picoclaw.exe" -ForegroundColor Red
        }
        
        if (Test-Path $launcherExe) {
            Write-Host "  ✓ Launcher 二进制存在: picoclaw-web.exe" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Launcher 二进制缺失: picoclaw-web.exe" -ForegroundColor Red
        }
    } else {
        Write-Host "  ✗ resources 目录不存在" -ForegroundColor Red
    }
} else {
    Write-Host "  ℹ ClawPet 应用未运行" -ForegroundColor Gray
}

# 检查服务端口
Write-Host "`n[3] 检查服务端口" -ForegroundColor Yellow

$launcherPort = 18800
$gatewayPort = 18790

# 检查 Launcher
try {
    $launcherResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$launcherPort/api/auth/status" -TimeoutSec 2 -ErrorAction Stop
    if ($launcherResponse.StatusCode -eq 200) {
        Write-Host "  ✓ Launcher (端口 $launcherPort) 正在运行" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Launcher (端口 $launcherPort) 响应异常: $($launcherResponse.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Launcher (端口 $launcherPort) 未运行或无法访问" -ForegroundColor Red
}

# 检查 Gateway
try {
    $gatewayResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$gatewayPort/health" -TimeoutSec 2 -ErrorAction Stop
    if ($gatewayResponse.StatusCode -eq 200) {
        Write-Host "  ✓ Gateway (端口 $gatewayPort) 正在运行" -ForegroundColor Green
        
        # 检查 PetChannel 端点
        try {
            $petTokenResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$gatewayPort/pet/token" -TimeoutSec 2 -ErrorAction Stop
            if ($petTokenResponse.StatusCode -eq 200) {
                Write-Host "  ✓ /pet/token 端点可用" -ForegroundColor Green
            } else {
                Write-Host "  ✗ /pet/token 端点响应异常: $($petTokenResponse.StatusCode)" -ForegroundColor Red
            }
        } catch {
            Write-Host "  ✗ /pet/token 端点不可用" -ForegroundColor Red
        }
    } else {
        Write-Host "  ✗ Gateway (端口 $gatewayPort) 响应异常: $($gatewayResponse.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Gateway (端口 $gatewayPort) 未运行或无法访问" -ForegroundColor Red
}

# 检查日志文件
Write-Host "`n[4] 检查日志文件" -ForegroundColor Yellow

$logPath = "$env:USERPROFILE\.goclaw\logs.txt"
if (Test-Path $logPath) {
    Write-Host "  ✓ 日志文件存在: $logPath" -ForegroundColor Green
    
    # 查找错误信息
    $logContent = Get-Content $logPath -Tail 100
    $errors = $logContent | Where-Object { $_ -match '\[GATEWAY ERROR\]|\[LAUNCHER ERROR\]|\[BACKEND\].*Failed' }
    
    if ($errors) {
        Write-Host "`n  发现以下错误：" -ForegroundColor Red
        $errors | Select-Object -Last 10 | ForEach-Object {
            Write-Host "    $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ✓ 未发现明显错误" -ForegroundColor Green
    }
} else {
    Write-Host "  ℹ 日志文件不存在" -ForegroundColor Gray
}

Write-Host "`n=== 诊断完成 ===" -ForegroundColor Cyan
Write-Host "`n提示：" -ForegroundColor Yellow
Write-Host "1. 如果 Gateway 或 Launcher 未运行，请重启 ClawPet 应用" -ForegroundColor White
Write-Host "2. 如果二进制文件缺失，请重新打包应用" -ForegroundColor White
Write-Host "3. 如果配置有问题，请检查 ~/.goclaw-runtime/config.json" -ForegroundColor White
Write-Host "4. 查看详细日志: Get-Content `$env:USERPROFILE\.goclaw\logs.txt -Tail 50" -ForegroundColor White
Write-Host ""
