# GoClaw 一键启动说明

该文档用于说明仓库内稳定可用的一键启动入口。

当前默认模式为 `petclaw`。

## 快速开始（推荐）

双击：

- `GoClaw-OneClickStart.bat`

或在终端运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1
```

该入口会委托到 `scripts/run-goclaw-dev.ps1`，并启动整套本地链路：

- 后端业务口（gateway 直连，优先）：`127.0.0.1:18790`
- 后端管理口（launcher）：`127.0.0.1:18800`
- PetClaw 控制台：`127.0.0.1:3000`
- Electron 桌宠（默认加载本地 `dist`，仅在未构建时回退 `5173`）

## 仅 launcher 模式

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode launcher
```

该模式只启动 Web UI launcher（`picoclaw-web.exe`）。

## 开发模式（dev）

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode dev
```

执行内容：

1. 委托 `scripts/run-goclaw-dev.ps1`
2. 启动 backend launcher，并确保 gateway 在其代理链路中可用
3. 启动米色 `petclaw` 控制台（含 onboarding，`127.0.0.1:3000`）
4. 如需则构建 Electron 渲染资源并启动桌宠

## 分窗口启动（单独排查）

当你要单独定位“桌宠不渲染 / 网关未连上”时，建议按下面方式开 3 个窗口。

### 窗口 1：launcher（18800）

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode launcher
```

### 窗口 2：PetClaw（3000，优先走 18790）

```powershell
Set-Location .\petclaw
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='true'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

### 窗口 3：Electron 桌宠

```powershell
Set-Location .\electron-frontend
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18800'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
npx electron src/main.js
```

可选：若要 renderer 热更新，再单独开一个窗口运行 `npm run dev`，并在窗口 3 额外设置 `$env:ELECTRON_RENDERER_URL='http://127.0.0.1:5173'`。

## 可选参数

- `-NoBrowser`：仅 launcher 模式有效，禁止自动打开浏览器
- `-SkipNpmInstall`：当入口委托到 `scripts/run-goclaw-dev.ps1` 时会被忽略

示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -NoBrowser
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode dev -SkipNpmInstall
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1 -Mode petclaw
```

## 脚本执行被拦截

若 Windows 拦截本地脚本，可先在管理员 PowerShell 执行一次：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

然后重新执行启动命令。
