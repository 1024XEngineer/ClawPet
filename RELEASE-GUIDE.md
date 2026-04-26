# ClawPet Release 打包发布指南

## 📦 打包流程总览

```
开发者推送 Tag → GitHub Actions 自动构建 → 生成 Release 包 → 用户下载使用
```

## 🎯 两种发布包说明（已更新）

### 1. 标准包 (Standard Package)
**文件名：** `clawpet_Windows_x86_64.zip`

**包含内容：**
- `clawpet.exe` - Gateway 核心服务 (18790)
- `clawpet-launcher.exe` - Launcher 管理服务 (18800)
- `clawpet-gateway.bat` - 快速启动脚本（开发者用）

**适用场景：**
- 开发者使用
- 已有 Node.js/Go 环境
- 需要自定义配置  
**大小：** ~50MB

---

### 2. Electron 安装包（推荐普通用户下载） ⭐

**文件名：**
- `clawpet_Setup_Windows_x86_64.exe` - 安装版（推荐）
- `clawpet_Portable_Windows_x86_64.exe` - 便携版（免安装）

**安装版特点：**
```
双击安装 → 自动创建桌面快捷方式 → 完成！
```
- ✅ 完全无黑窗口，用户体验好
- ✅ 自动创建桌面和开始菜单快捷方式  
- ✅ 支持自动卸载，清理所有文件  
- ✅ 自动启动后端服务（Gateway + Launcher）
- ✅ 安装后直接从桌面启动  
- ✅ 可自定义安装路径  
**大小：** ~150MB  

**便携版特点：**
```
下载 → 双击运行 → 即用！
```
- ✅ 无需安装，双击即用  
- ✅ 可放在 U 盘随身携带  
- ✅ 不写入注册表  
- ✅ 退出后无残留  
**大小：** ~150MB

**适用场景：**
- **普通用户下载即用** ⭐
- 无需安装任何依赖（Node.js/Go）
- 双击 exe 直接运行  
- **完全无黑窗口**

---

## 🚀 发布流程（开发者操作）

### 步骤 1：准备发布

```bash
# 1. 确保代码已提交
git status
git add -A
git commit -m "chore: prepare for release"

# 2. 推送到远程
git push origin fyh/test
```

### 步骤 2：创建版本标签

```bash
# 语义化版本号：v主版本.次版本.修订版本
git tag v0.1.0

# 或者带说明的标签
git tag -a v0.1.0 -m "ClawPet 首个桌面版本"
```

### 步骤 3：推送标签触发 CI

```bash
# 推送标签到 GitHub
git push origin v0.1.0
```

推送后 GitHub Actions 会自动：
1. ✅ 检出代码  
2. ✅ 安装 Go 和 Node.js 环境  
3. ✅ 编译 Gateway (picoclaw.exe)  
4. ✅ 编译 Launcher (picoclaw-web.exe)  
5. ✅ 构建前端 (Next.js)  
6. ✅ 打包标准包（zip）  
7. ✅ 使用 electron-builder 打包安装包  
8. ✅ 创建 GitHub Release  
9. ✅ 上传所有产物

### 步骤 4：检查 Release

访问：`https://github.com/你的用户名/GoClawPet/releases`

你会看到：
- **Release 标题：** v0.1.0  
- **自动生成说明：** 基于 commit 历史  
- **下载附件：**  
  - `clawpet_Windows_x86_64.zip`（标准包）
  - `clawpet_Setup_Windows_x86_64.exe`（安装版 ⭐）
  - `clawpet_Portable_Windows_x86_64.exe`（便携版）
  - `clawpet_Linux_x86_64.tar.gz`
  - `clawpet_Darwin_arm64.tar.gz`
  - ... 等其他平台

---

## 📝 Release 说明模板

发布时应该填写的 Release Notes：

```markdown
# ClawPet v0.1.0 🎉

## ✨ 新特性
- 桌面宠 Electron 客户端
- 一键启动脚本 (GoClaw-OneClickStart.bat)
- 完整的 Onboarding 引导流程
- 支持多角色切换
- 情感引擎和语音合成

## 🔧 组件说明
- **Gateway (18790):** AI 核心服务，处理聊天和推理
- **Launcher (18800):** Web 管理界面，配置管理
- **Frontend (3000):** Next.js + Electron 桌面客户端

## 📦 下载说明
- **普通用户：** 下载 `clawpet_Setup_Windows_x86_64.exe`，双击安装后从桌面启动  
- **便携版用户：** 下载 `clawpet_Portable_Windows_x86_64.exe`，双击即用  
- **开发者：** 下载标准包 `clawpet_Windows_x86_64.zip`，需要自行配置 Node.js/Go 环境  

## 🚀 快速启动

### 安装版用户：
1. 下载 `clawpet_Setup_Windows_x86_64.exe`  
2. 双击安装，选择安装路径  
3. 安装完成后从桌面快捷方式启动  
4. 完成 Onboarding 配置  
5. 开始使用！

### 便携版用户：
1. 下载 `clawpet_Portable_Windows_x86_64.exe`  
2. 双击运行  
3. 完成 Onboarding 配置  
4. 开始使用！

## ⚠️ 注意事项
- 首次启动需要配置 AI 模型 API Key
- 确保端口 18790/18800/3000 未被占用
- Windows 10/11 系统

## 📚 文档
- [API 文档](API.md)
- [使用说明](使用说明.md)
- [README](README.md)
```

---

## 🔍 CI/CD 构建详情

### 构建平台矩阵

| 操作系统 | 架构 | 产物格式 |
|---------|------|---------|
| Windows | x86_64 | .zip |
| Windows | arm64 | .zip |
| Linux | x86_64 | .tar.gz |
| Linux | arm64 | .tar.gz |
| Linux | armv7 | .tar.gz |
| Linux | riscv64 | .tar.gz |
| Linux | loong64 | .tar.gz |
| macOS | x86_64 | .tar.gz |
| macOS | arm64 | .tar.gz |
| FreeBSD | x86_64 | .tar.gz |
| FreeBSD | arm64 | .tar.gz |

### 构建时间预估

- **Gateway 编译：** ~2 分钟
- **Launcher 编译：** ~1 分钟
- **前端构建：** ~3-5 分钟
- **打包上传：** ~1 分钟
- **总计：** ~10-15 分钟

---

## 🛠️ 本地测试打包

在推送标签前，可以本地测试：

```bash
# 方法 1：使用 Makefile  
make build              # 编译当前平台  
make build-launcher     # 编译 Launcher  
make build-all          # 编译所有平台  

# 方法 2：手动编译  
# 编译 Gateway  
go build -tags "goolm,stdjson" -o picoclaw.exe ./cmd/picoclaw  

# 编译 Launcher  
go build -tags "goolm,stdjson" -o picoclaw-web.exe ./web/backend  

# 构建前端  
cd clawpet-frontend/clawpet  
pnpm install  
pnpm build  

# 方法 3：Electron 本地打包  
cd clawpet-frontend/clawpet  
pnpm dist:win  
# 输出到 clawpet-frontend/clawpet/dist/ 目录

# 方法 4：使用 GoReleaser（需要安装）  
goreleaser release --snapshot --clean
```

---

## 📊 版本管理策略

### 语义化版本 (SemVer)

```
v主版本.次版本.修订版本
 v0   .  1   .  0

主版本：不兼容的 API 修改
次版本：向下兼容的功能性新增
修订版本：向下兼容的问题修正
```

### 版本命名示例

- `v0.1.0` - 首个公开版本
- `v0.1.1` - Bug 修复
- `v0.2.0` - 新增功能
- `v1.0.0` - 稳定版本

---

## 🎯 用户下载后的使用流程

### 对于 AllInOne 包用户

```
1. 下载 clawpet_AllInOne_Windows_x86_64.zip
2. 右键 → 解压到当前文件夹
3. 进入解压后的文件夹
4. 双击 GoClaw-OneClickStart.bat
5. 等待 10-30 秒
6. 浏览器自动打开 http://localhost:3000/onboarding
7. 完成初始化配置
8. 开始使用！
```

### 对于标准包用户

```
1. 下载 clawpet_Windows_x86_64.zip
2. 解压
3. 确保已安装 Node.js 22+ 和 Go 1.25+
4. 手动启动各组件（参考启动脚本）
```

---

## ⚡ 常见问题

### Q1: 推送标签后没有触发构建？
**A:** 检查：
- `.github/workflows/release.yml` 是否存在
- tag 格式是否为 `v*` (如 v0.1.0)
- GitHub Actions 是否启用

### Q2: 构建失败怎么办？
**A:** 
- 查看 Actions 日志
- 检查依赖是否完整
- 确认前端代码能否本地构建

### Q3: 如何更新已发布的 Release？
**A:**
```bash
# 删除远程标签
git push --delete origin v0.1.0
git tag -d v0.1.0

# 修改后重新打标签
git tag v0.1.0
git push origin v0.1.0
```

### Q4: 用户可以保留配置更新吗？
**A:** 是的！`.goclaw-runtime/config.json` 不会被覆盖，用户更新版本时只需替换二进制文件。

---

## 📈 后续优化建议

1. **自动版本号递增** - 使用工具自动管理版本
2. **增量更新包** - 只更新变更的文件
3. **安装包制作** - 使用 NSIS/Inno Setup 制作 .exe 安装包
4. **自动更新** - Electron 内置 auto-updater
5. **代码签名** - Windows Authenticode 签名
6. **Docker 镜像** - 同步发布到 Docker Hub

---

## 📞 联系与支持

- **问题反馈：** GitHub Issues
- **文档：** README.md + API.md
- **启动脚本：** GoClaw-OneClickStart.md
