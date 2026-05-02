# ClawPet 本地打包测试脚本
# 功能：编译后端 + 打包 Electron + 自动复制后端二进制

$ErrorActionPreference = "Stop"
# $PSScriptRoot = ...\GoClawPet\clawpet-frontend\clawpet
# $ProjectRoot   = ...\GoClawPet (repo root, where go.mod and cmd/ live)
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ClawpetDir = $PSScriptRoot
$DistDir = Join-Path $ProjectRoot "dist"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ClawPet 本地打包测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: 编译 Go 后端
Write-Host "[1/5] 编译 Gateway 后端..." -ForegroundColor Yellow
Set-Location $ProjectRoot
go build -tags "goolm,stdjson" -o "$DistDir\picoclaw.exe" ./cmd/picoclaw
Write-Host "  ✅ Gateway 编译完成" -ForegroundColor Green

Write-Host "[2/5] 编译 Launcher 后端..." -ForegroundColor Yellow
go build -tags "goolm,stdjson" -o "$DistDir\picoclaw-web.exe" ./web/backend
Write-Host "  ✅ Launcher 编译完成" -ForegroundColor Green

# Step 2: 复制到 Electron 项目目录
Write-Host "[3/5] 复制后端二进制到 Electron 项目..." -ForegroundColor Yellow
Copy-Item "$DistDir\picoclaw.exe" "$ClawpetDir\picoclaw.exe" -Force
Copy-Item "$DistDir\picoclaw-web.exe" "$ClawpetDir\picoclaw-web.exe" -Force
Write-Host "  ✅ 复制完成" -ForegroundColor Green

# Step 3: 构建 Next.js 前端
Write-Host "[4/5] 构建 Next.js 前端..." -ForegroundColor Yellow
Set-Location $ClawpetDir

# 安装依赖（如果 node_modules 不存在）
if (-not (Test-Path "node_modules")) {
    Write-Host "  安装依赖..." -ForegroundColor Gray
    npm install
}

# 构建 Next.js
if (Test-Path ".next") {
    Write-Host "  清理旧的构建..." -ForegroundColor Gray
    Remove-Item -Path ".next" -Recurse -Force
}

npm run build
Write-Host "  ✅ Next.js 构建完成" -ForegroundColor Green

# Step 4: Electron 打包
Write-Host "[5/5] 打包 Electron 应用..." -ForegroundColor Yellow
Set-Location $ClawpetDir

# 清理旧的打包
if (Test-Path "dist") {
    Write-Host "  清理旧的打包..." -ForegroundColor Gray
    Remove-Item -Path "dist" -Recurse -Force
}

# 执行打包
npx electron-builder --win --publish never

# Step 4: 复制后端二进制到打包目录
Write-Host ""
Write-Host "复制后端二进制到打包目录..." -ForegroundColor Yellow
Copy-Item "picoclaw.exe" "dist\win-unpacked\picoclaw.exe" -Force
Copy-Item "picoclaw-web.exe" "dist\win-unpacked\picoclaw-web.exe" -Force
Write-Host "  ✅ 复制完成" -ForegroundColor Green

# 显示结果
Write-Host ""
Write-Host "Packaging complete!" -ForegroundColor Green
Write-Host ""

Write-Host "Generated files:" -ForegroundColor Yellow
Get-ChildItem "dist\*.exe" | ForEach-Object {
    $size = [math]::Round($_.Length/1MB, 2)
    Write-Host "  - $($_.Name) ($size MB)" -ForegroundColor White
}

Write-Host ""
Write-Host "win-unpacked directory (all components):" -ForegroundColor Yellow
Get-ChildItem "dist\win-unpacked\*.exe" | ForEach-Object {
    $size = [math]::Round($_.Length/1MB, 2)
    Write-Host "  - $($_.Name) ($size MB)" -ForegroundColor White
}

Write-Host ""
Write-Host "Test commands:" -ForegroundColor Yellow
Write-Host "  # Method 1: Run win-unpacked (for debugging)" -ForegroundColor Gray
Write-Host "  & \"$ClawpetDir\dist\win-unpacked\ClawPet.exe\"" -ForegroundColor White
Write-Host ""
Write-Host "  # Method 2: Run portable version" -ForegroundColor Gray
Write-Host "  & \"$ClawpetDir\dist\ClawPet 0.1.0.exe\"" -ForegroundColor White
Write-Host ""
Write-Host "View logs:" -ForegroundColor Yellow
Write-Host "  Get-Content \"$env:USERPROFILE\.picoclaw\logs.txt\" -Tail 30" -ForegroundColor White
Write-Host ""
