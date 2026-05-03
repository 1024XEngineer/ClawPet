# ClawPet Desktop App

ClawPet 桌面宠物应用 - 单 EXE 启动，无黑窗口

## 🚀 快速开始

### 打包应用

```powershell
# 一键打包（编译后端 + 打包 Electron）
.\build-and-test.ps1
```

### 测试应用

```powershell
# 快速启动（推荐用于调试）
.\run-packaged.ps1

# 或交互式选择版本
.\test-app.ps1
```

## 📦 生成的文件

打包后在 `dist` 目录生成：

- **win-unpacked/** - 解压版（包含所有组件）
  - `ClawPet.exe` - 主程序
  - `picoclaw.exe` - Gateway 服务
  - `picoclaw-web.exe` - Launcher 服务
- **ClawPet \*.exe** - 便携版（如 `ClawPet 0.1.0.exe`）
- **ClawPet Setup \*.exe** - 安装版（如 `ClawPet Setup 0.1.0.exe`）

## ⚠️ 重要说明

**必须运行打包后的 exe，不能使用开发模式！**

- ❌ `npm run dev` - 不包含后端服务
- ✅ `.\run-packaged.ps1` - 完整功能

## 📖 详细文档

- [打包指南](./BUILD_GUIDE.md) - 完整的打包流程和故障排除
- [项目说明](../../项目说明文档.md) - 架构和代码说明

## 🔧 开发

```powershell
# 仅前端开发（不包含后端）
npm run dev

# 完整测试（必须打包）
.\build-and-test.ps1
.\run-packaged.ps1
```

## 📊 架构

用户只需双击 **1 个 exe**，自动启动所有服务：

```
ClawPet.exe → picoclaw.exe (18790) + picoclaw-web.exe (18800)
```

无黑窗口，用户无感知。
