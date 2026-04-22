# ClawPet 开发说明

ClawPet 是本仓库当前正在迭代的桌宠产品形态。

目前以米色风格的 `petclaw` 控制台为主：桌宠会打开该控制台，onboarding 页面也在这里，聊天会话历史在这里展示，后端语音输出也在这里消费。

## 本地架构

当前本地主链路统一为 2 个业务端口：

- `frontend`（`petclaw` 控制台）：`127.0.0.1:3000`
- `backend`（Pet channel / gateway 直连）：`127.0.0.1:18790`（优先）

同时保留一个管理端口（非业务首选）：

- `launcher` 管理接口：`127.0.0.1:18800`（用于启动状态、鉴权与代理兜底）

桌宠渲染页默认加载本地构建产物（`electron-frontend/dist`）；仅在未构建时回退 `5173` 开发服务。

当前关系：

- 桌宠 `S` 按钮会打开 `petclaw`
- onboarding 在 `petclaw /onboarding`
- `electron-frontend` 负责桌宠窗口壳，不是主控制台
- 旧的深色 settings/chat 页面不是当前主界面

## 推荐启动方式

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

该脚本会：

1. 清理历史 GoClaw / Electron / Node 进程
2. 启动后端 launcher（`127.0.0.1:18800`）
3. 启动 gateway，并让桌宠/面板优先直连 `127.0.0.1:18790`
4. 启动 `petclaw`（`127.0.0.1:3000`）
5. 如需则构建桌宠渲染资源
6. 启动 Electron，并将设置/引导窗口指向 `petclaw`

## 一体包启动（All-In-One）

如需一键启动完整链路（`18790`、`18800`、`3000` + Electron），请使用 Windows 发行包：

- `clawpet_AllInOne_Windows_x86_64.zip`（或 arm64 版本）

解压后运行：

- `GoClaw-OneClickStart.bat`

它会代理执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

并按顺序启动：backend launcher、gateway（优先 `18790`）、petclaw 控制台、Electron 桌宠。

首次启动说明：

- 若尚未配置模型，gateway 可能延迟启动，需先完成 onboarding/model 设置
- 首次会自动为 `petclaw` 与 `electron-frontend` 安装依赖，耗时可能更长

## 一键入口

也可直接使用根目录入口：

- `GoClaw-OneClickStart.bat`

或：

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1
```

该入口当前统一委托到 `scripts/run-goclaw-dev.ps1`，即使用同一套完整启动流程。

## 启动后地址

正常启动后：

- petclaw 控制台：`http://127.0.0.1:3000`
- backend（gateway 直连）：`http://127.0.0.1:18790`
- launcher 管理接口：`http://127.0.0.1:18800`
- onboarding：`http://127.0.0.1:3000/onboarding?mode=rerun`

## 分窗口启动（手动）

当你要单独排查“桌宠不渲染 / 网关未连上”时，建议开 3 个终端窗口按顺序启动。

### 窗口 1：仅启动 launcher（管理口 `18800`）

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode launcher
```

### 窗口 2：启动 `petclaw`（前端口 `3000`，后端优先 `18790`）

```powershell
Set-Location .\petclaw
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='true'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

### 窗口 3：启动 Electron 桌宠窗口

```powershell
Set-Location .\electron-frontend
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18800'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
npx electron src/main.js
```

可选：若要桌宠 renderer 热更新，再开第 4 个窗口：

```powershell
Set-Location .\electron-frontend
npm run dev
```

并在窗口 3 额外设置：

```powershell
$env:ELECTRON_RENDERER_URL='http://127.0.0.1:5173'
```

## UI 约定

### 主界面

以米色 `petclaw` 为主：

- 主控制台：`http://127.0.0.1:3000`
- onboarding：`http://127.0.0.1:3000/onboarding?mode=rerun`

`electron-frontend` 的职责：

- 渲染桌宠
- 承载 Electron 桌面壳
- 打开 `petclaw` 控制台

如果打开的是深色聊天/设置页，说明不是当前主 UI。

### 聊天行为

当前 `petclaw` 聊天行为：

- `New Chat` 会创建新的前端本地 session id，并重连 websocket
- 左侧会话历史目前只显示每个会话的第一条用户消息
- 会话历史当前为前端本地状态，不是服务端持久化历史

### 语音行为

当前语音行为：

- 以后端 `audio` push 为主播放源
- `petclaw` 会合并后端音频分片后播放
- 浏览器本地 TTS fallback 默认关闭
- 麦克风按钮仅用于语音输入，依赖浏览器语音识别支持

## 环境要求

- Go `>= 1.23`
- Node.js `>= 18`（建议 `20` 或 `22`）
- npm
- Windows 下建议具备 C/C++ 编译环境，否则部分 SQLite 能力可能受限

## 常用命令

### 启动完整本地开发链路

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

### 以生产模式启动 `petclaw`

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode prod
```

### 仅启动 launcher

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode launcher
```

## 常见问题

### 控制台白屏

先确认 `petclaw` 正常运行：

```powershell
curl.exe -i http://127.0.0.1:3000
```

若 `3000` 不可用，点击桌宠 `S` 按钮会只看到空壳窗口。

### 打开了错误 UI

若打开的是深色 settings 页面而不是米色控制台，请重启：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

### 重新执行 onboarding

直接打开：

```text
http://127.0.0.1:3000/onboarding?mode=rerun
```

### 查看 gateway 状态

```powershell
curl.exe -i http://127.0.0.1:18800/api/gateway/status
```

优先链路连通检查（建议先看这个）：

```powershell
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/pet/token
```

### 长回复缺失

`petclaw` 目前支持 object / JSON string / raw string 三种 `ai_chat` 与 `audio` push 形态。若长回复仍缺失，请在 DevTools 中检查 WS payload，并对照 `petclaw/lib/api/websocket.ts` 的解析逻辑。

## 关键目录

- `scripts/run-goclaw-dev.ps1`：完整本地启动脚本
- `GoClaw-OneClickStart.ps1`：一键入口（委托完整启动脚本）
- `petclaw/`：米色控制台与 onboarding UI
- `electron-frontend/`：桌宠窗口与 Electron 壳
- `cmd/picoclaw/`：gateway 入口
- `pkg/channels/pet/`：`pet` HTTP / websocket 通道
- `pkg/pet/`：桌宠业务实现

## 建议阅读顺序

若要快速熟悉项目，建议：

1. `scripts/run-goclaw-dev.ps1`
2. `petclaw/`
3. `electron-frontend/src/main.js`
4. `pkg/channels/pet/`

这条路径最容易看清启动流程、主 UI、桌宠窗口职责和实际聊天链路。
