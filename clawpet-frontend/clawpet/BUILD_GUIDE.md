# ClawPet 打包指南

本文档说明如何在本地打包 ClawPet 桌面应用。

## 📋 前置要求

- **Node.js** >= 18.x
- **Go** >= 1.21
- **Windows** 10/11
- PowerShell 5.1+

## 🚀 快速开始

### 方式一：一键打包（推荐）

```powershell
# 进入 clawpet 目录
cd clawpet-frontend\clawpet

# 运行一键打包脚本
.\build-and-test.ps1
```

该脚本会自动：
1. ✅ 编译 Gateway 后端 (picoclaw.exe)
2. ✅ 编译 Launcher 后端 (picoclaw-web.exe)
3. ✅ 复制到 Electron 项目目录
4. ✅ 执行 electron-builder 打包
5. ✅ 复制后端二进制到打包目录
6. ✅ 显示生成的文件列表和测试命令

### 方式二：分步打包

#### 1. 编译 Go 后端

```powershell
# 在项目根目录执行
cd D:\study part\GoClawPet

# 编译 Gateway
go build -tags "goolm,stdjson" -o dist\picoclaw.exe .\cmd\picoclaw

# 编译 Launcher
go build -tags "goolm,stdjson" -o dist\picoclaw-web.exe .\web\backend
```

#### 2. 复制到 Electron 项目

```powershell
Copy-Item "dist\picoclaw.exe" "clawpet-frontend\clawpet\picoclaw.exe" -Force
Copy-Item "dist\picoclaw-web.exe" "clawpet-frontend\clawpet\picoclaw-web.exe" -Force
```

#### 3. 打包 Electron 应用

```powershell
cd clawpet-frontend\clawpet

# 清理旧的打包
Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue

# 执行打包
npx electron-builder --win --publish never
```

#### 4. 复制后端二进制到打包目录

```powershell
# 这一步很关键！electron-builder 的 extraResources 配置可能不生效
Copy-Item "picoclaw.exe" "dist\win-unpacked\picoclaw.exe" -Force
Copy-Item "picoclaw-web.exe" "dist\win-unpacked\picoclaw-web.exe" -Force
```

## 📦 生成的文件

打包完成后，在 `clawpet-frontend\clawpet\dist` 目录会生成：

```
dist/
├── win-unpacked/              # 解压版（方便调试）
│   ├── ClawPet.exe           # 主程序 (168 MB)
│   ├── picoclaw.exe          # Gateway 服务 (44 MB)
│   ├── picoclaw-web.exe      # Launcher 服务 (21 MB)
│   └── ...                   # Electron 运行时文件
│
├── ClawPet *.exe             # 便携版 (213 MB)，如 ClawPet 0.1.0.exe
└── ClawPet Setup *.exe       # 安装版 (213 MB)，如 ClawPet Setup 0.1.0.exe
```

### 文件说明

| 文件 | 大小 | 用途 |
|------|------|------|
| `ClawPet.exe` | ~168 MB | Electron 主程序 |
| `picoclaw.exe` | ~44 MB | Gateway 后端服务（端口 18790） |
| `picoclaw-web.exe` | ~21 MB | Launcher 后端服务（端口 18800） |
| `ClawPet *.exe` | ~213 MB | 便携版，无需安装（如 `ClawPet 0.1.0.exe`） |
| `ClawPet Setup *.exe` | ~213 MB | NSIS 安装包（如 `ClawPet Setup 0.1.0.exe`） |

## 🧪 测试打包结果

### 方式一：使用测试脚本

```powershell
cd clawpet-frontend\clawpet
.\test-app.ps1
```

脚本会提供交互式菜单，选择要运行的版本。

### 方式二：使用快速启动脚本

```powershell
cd clawpet-frontend\clawpet
.\run-packaged.ps1
```

直接启动 win-unpacked 版本（推荐用于调试）。

### 方式三：手动运行

```powershell
# 方式1：运行 win-unpacked（方便调试）
& "clawpet-frontend\clawpet\dist\win-unpacked\ClawPet.exe"

# 方式2：运行便携版（版本号随发布变化）
& "clawpet-frontend\clawpet\dist\ClawPet *.exe"

# 方式3：运行安装版（版本号随发布变化）
& "clawpet-frontend\clawpet\dist\ClawPet Setup *.exe"
```

## ✅ 验证清单

运行后检查以下内容：

- [ ] 启动进度窗口首先显示
- [ ] Gateway 服务自动启动（端口 18790）
- [ ] Launcher 服务自动启动（端口 18800）
- [ ] Pet 窗口正常显示
- [ ] Settings 窗口正常显示
- [ ] 无 `ERR_CONNECTION_REFUSED` 错误

### 查看日志

```powershell
Get-Content "$env:USERPROFILE\.goclaw\logs.txt" -Tail 30
```

成功启动的日志应包含：

```
[BACKEND] Starting embedded backend services...
[LAUNCHER] Service ready
[GATEWAY] Service ready
[BACKEND] Backend services startup initiated
[STARTUP] startup progress page enabled
```

## ⚠️ 常见问题

### 1. ERR_CONNECTION_REFUSED 错误

**原因**：运行的是开发模式（`npm run dev`），而不是打包后的 exe。

**解决**：
```powershell
# ❌ 错误：开发模式不包含后端二进制
npm run dev

# ✅ 正确：运行打包后的 exe
.\run-packaged.ps1
```

### 2. 后端服务未启动

**日志显示**：`[BACKEND] No embedded backend binaries found`

**原因**：打包目录中缺少 picoclaw.exe 和 picoclaw-web.exe。

**解决**：
```powershell
# 手动复制后端二进制
Copy-Item "picoclaw.exe" "dist\win-unpacked\picoclaw.exe" -Force
Copy-Item "picoclaw-web.exe" "dist\win-unpacked\picoclaw-web.exe" -Force
```

### 3. electron-builder extraResources 不生效

这是已知问题，electron-builder 在解析 extraResources 路径时存在问题。

**临时方案**：打包后手动复制后端二进制文件（见上方步骤 4）。

**永久方案**：在 GitHub Actions 的 release.yml 中添加手动复制步骤。

### 4. 启动页不显示

**原因**：环境变量 `GOCLAW_SHOW_STARTUP` 未正确设置。

**解决**：代码已修改为默认显示启动页，除非明确设置 `GOCLAW_SHOW_STARTUP=0`。

## 🔧 开发模式说明

### 前端开发（仅 UI 调试）

```powershell
cd clawpet-frontend\clawpet
npm run dev
```

**注意**：
- 开发模式只启动 Electron 前端
- **不包含后端服务**（Gateway 和 Launcher）
- 需要手动启动后端或使用已运行的服务
- 适用于纯 UI 调试

### 完整测试（必须打包）

```powershell
cd clawpet-frontend\clawpet
.\build-and-test.ps1
.\run-packaged.ps1
```

**优势**：
- 包含完整的后端服务
- 用户实际运行方式
- 测试真实使用场景

## 📊 架构说明

### 单 EXE 启动原理

虽然打包目录中有 3 个 exe 文件，但**用户只需双击 1 个**：

```
用户双击 ClawPet.exe
    ↓
自动启动 picoclaw.exe (Gateway) 作为子进程
    ↓
自动启动 picoclaw-web.exe (Launcher) 作为子进程
    ↓
用户无感知，无黑窗口
```

**关键点**：
- 用户只需要运行 **1 个 exe**
- 后端服务作为子进程自动启动
- 进程在后台运行，无控制台窗口
- 应用退出时自动清理子进程

### 端口分配

| 服务 | 端口 | 用途 |
|------|------|------|
| Gateway | 18790 | AI 核心服务、健康检查 |
| Launcher | 18800 | Web 管理界面 |
| Frontend | 动态 | Electron 渲染进程 |

## 🚀 发布流程

### 本地测试

```powershell
# 1. 打包
.\build-and-test.ps1

# 2. 测试
.\run-packaged.ps1

# 3. 验证功能
# - 检查后端服务启动
# - 检查前端界面显示
# - 检查无连接错误
```

### GitHub Actions 自动发布

推送标签后自动触发：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流文件：`.github/workflows/release.yml`

## 📝 脚本说明

### build-and-test.ps1

完整打包脚本，执行所有编译和打包步骤。

**使用场景**：
- 本地打包测试
- 验证打包流程
- 生成发布文件

### test-app.ps1

交互式测试脚本，提供版本选择菜单。

**使用场景**：
- 快速测试不同版本
- 选择安装版/便携版/调试版

### run-packaged.ps1

快速启动脚本，直接运行 win-unpacked 版本。

**使用场景**：
- 日常开发调试
- 快速验证修改
- 查看实时日志

## 📚 相关文档

- [项目说明文档](./项目说明文档.md)
- [GitHub Actions Release 流程](../../.github/workflows/release.yml)
- [Electron 配置](./package.json)

## 🆘 获取帮助

如遇到问题：

1. 查看日志文件：`$env:USERPROFILE\.goclaw\logs.txt`
2. 检查进程是否运行：`Get-Process -Name "ClawPet,picoclaw" -ErrorAction SilentlyContinue`
3. 检查端口占用：`netstat -ano | findstr :18790` 和 `netstat -ano | findstr :18800`
