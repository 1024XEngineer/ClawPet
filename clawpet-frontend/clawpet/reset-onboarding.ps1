# 重置ClawPet应用到首次使用状态
# 用途：删除引导状态文件，触发重新初始化流程

$ErrorActionPreference = "Stop"

# 颜色输出函数
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error2 {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# 显示脚本说明
Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  ClawPet 初始化状态重置工具" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

Write-Info "此脚本将："
Write-Host "  1. 停止所有ClawPet相关进程" -ForegroundColor White
Write-Host "  2. 删除引导状态文件 (onboarding-state.json)" -ForegroundColor White
Write-Host "  3. 清理运行日志 (可选)" -ForegroundColor White
Write-Host "  4. 重启应用 (可选)" -ForegroundColor White
Write-Host ""

# 确认是否继续
$confirm = Read-Host "是否继续？(y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Info "操作已取消"
    exit 0
}

# 定义路径
$picoclawDir = "$env:USERPROFILE\.picoclaw"
$onboardingStateFile = "$picoclawDir\onboarding-state.json"
$logFile = "$picoclawDir\logs.txt"
$clawpetExe = "D:\study part\GoClawPet\clawpet-frontend\clawpet\dist\win-unpacked\ClawPet.exe"

# 步骤1：停止所有相关进程
Write-Host "`n[步骤 1/4] 停止ClawPet相关进程..." -ForegroundColor Cyan
$processes = Get-Process | Where-Object { 
    $_.ProcessName -match "ClawPet|electron|picoclaw" 
}

if ($processes.Count -gt 0) {
    Write-Info "发现 $($processes.Count) 个进程，正在停止..."
    $processes | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Success "进程已停止"
} else {
    Write-Info "没有发现运行中的进程"
}

# 步骤2：删除引导状态文件
Write-Host "`n[步骤 2/4] 删除引导状态文件..." -ForegroundColor Cyan
if (Test-Path $onboardingStateFile) {
    Remove-Item $onboardingStateFile -Force
    Write-Success "已删除: $onboardingStateFile"
} else {
    Write-Warning "引导状态文件不存在: $onboardingStateFile"
}

# 步骤3：清理日志（可选）
Write-Host "`n[步骤 3/4] 清理运行日志..." -ForegroundColor Cyan
$cleanLogs = Read-Host "是否清理日志文件？(y/n)"
if ($cleanLogs -eq "y" -or $cleanLogs -eq "Y") {
    if (Test-Path $logFile) {
        Clear-Content $logFile -ErrorAction SilentlyContinue
        Write-Success "日志已清理: $logFile"
    } else {
        Write-Info "日志文件不存在"
    }
} else {
    Write-Info "跳过日志清理"
}

# 步骤4：重启应用（可选）
Write-Host "`n[步骤 4/4] 重启应用..." -ForegroundColor Cyan
if (Test-Path $clawpetExe) {
    $restart = Read-Host "是否立即启动ClawPet？(y/n)"
    if ($restart -eq "y" -or $restart -eq "Y") {
        Write-Info "正在启动ClawPet..."
        Start-Process $clawpetExe
        Write-Success "ClawPet已启动"
        Write-Info "应用将进入首次引导模式"
    } else {
        Write-Info "跳过应用启动"
        Write-Info "你可以手动运行: `"$clawpetExe`""
    }
} else {
    Write-Error2 "未找到ClawPet可执行文件: $clawpetExe"
    Write-Warning "请检查打包路径是否正确"
}

# 完成
Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  重置完成！" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

Write-Success "引导状态已重置为'首次使用'"
Write-Info "下次启动时将显示引导界面"
Write-Host ""

# 提示查看日志
Write-Info "如需查看启动日志："
Write-Host "  Get-Content `"$logFile`" -Tail 50`n" -ForegroundColor Gray

Write-Info "如需查看引导状态："
Write-Host "  Get-Content `"$onboardingStateFile`"`n" -ForegroundColor Gray

pause

