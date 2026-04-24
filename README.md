# ClawPet 开发说明

本仓库默认采用三段启动链路：

- Launcher API：`http://127.0.0.1:18800`
- Gateway：`http://127.0.0.1:18790`
- 前端面板：`http://127.0.0.1:3000`

以上端口均可通过 `scripts/run-goclaw-dev.ps1` 的参数覆盖。

桌宠渲染页统一来自 `http://127.0.0.1:3000/desktop-pet`，不再依赖 `5173`。  
桌宠窗口默认出现在主屏幕工作区右下角（不是屏幕中间）。

## 前端结构（已合并）

- `clawpet-frontend/clawpet`：Next.js 面板 + Electron 桌宠壳层
- `clawpet-frontend/clawpet/electron`：Electron 主进程、preload、启动页

## 一键启动（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

首次在新机器启动时：

- 如果仓库内不存在 `picoclaw.exe` / `picoclaw-web.exe`，脚本会自动回退到 `go run` 启动后端和 launcher。
- 因此请确保系统已安装 `Go` 与 `Node.js`（并且 `go` / `npm` 可在命令行直接执行）。
- 如需自定义端口或二进制路径，可附加参数，例如：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev -GatewayPort 18791 -LauncherPort 18801 -FrontendPort 3001 -GatewayBin ".\build\picoclaw.exe" -LauncherBin ".\build\picoclaw-web.exe"
```

启动行为：

1. 清理旧进程和旧端口（含 `5173` / `18800`）。
2. 启动 launcher（默认 `18800`，优先使用本地二进制，否则回退 `go run ./web/backend`）。
3. 由 launcher 拉起并检查 gateway（默认 `18790`）。
4. 启动 Electron 启动页与前端面板（默认 `3000`）。
5. 输出当前实际 URL、端口和启动模式（binary / go-run），并自动切换到桌宠窗口。

如需显示后台命令行窗口：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev -ShowTerminalWindows
```

## 分别启动前后端

### 1) 仅启动 launcher（18800）

如果本地有 `picoclaw-web.exe` / `picoclaw-launcher.exe`：

```powershell
$env:PICOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
$env:PICOCLAW_HOME = (Resolve-Path .\.goclaw-runtime)
$env:PICOCLAW_CONFIG = (Resolve-Path .\.goclaw-runtime\config.json)
.\picoclaw-web.exe -no-browser -port 18800 .\.goclaw-runtime\config.json
```

如果本地没有 launcher 二进制：

```powershell
$env:PICOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
$env:PICOCLAW_HOME = (Resolve-Path .\.goclaw-runtime)
$env:PICOCLAW_CONFIG = (Resolve-Path .\.goclaw-runtime\config.json)
go run -tags "goolm,stdjson" .\web\backend -no-browser -console -port 18800 .\.goclaw-runtime\config.json
```

### 2) 仅启动 gateway（18790）

```powershell
$env:PICOCLAW_HOME = (Resolve-Path .\.goclaw-runtime)
$env:PICOCLAW_CONFIG = (Resolve-Path .\.goclaw-runtime\config.json)
.\picoclaw.exe gateway -E
```

如果本地没有 `picoclaw.exe`：

```powershell
$env:PICOCLAW_HOME = (Resolve-Path .\.goclaw-runtime)
$env:PICOCLAW_CONFIG = (Resolve-Path .\.goclaw-runtime\config.json)
go run -tags "goolm,stdjson" .\cmd\picoclaw gateway
```

### 3) 仅启动前端（3000）

```powershell
Set-Location .\clawpet-frontend\clawpet
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

### 4) 仅启动桌宠窗口（Electron）

```powershell
Set-Location .\clawpet-frontend\clawpet
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'
$env:GOCLAW_API_URL='http://127.0.0.1:18800'
$env:GOCLAW_LAUNCHER_URL='http://127.0.0.1:18800'
$env:GOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'
$env:GOCLAW_SHOW_STARTUP='1'
npx electron .\electron\main.js
```

## 常见排查

### 桌宠没渲染

```powershell
curl.exe -i http://127.0.0.1:3000/desktop-pet
curl.exe -i http://127.0.0.1:3000/pets/standby1.gif
```

### launcher / gateway 没连上

```powershell
curl.exe -i http://127.0.0.1:18800/api/gateway/status
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/pet/token
```

### 确认旧端口已停用

```powershell
netstat -ano | findstr :5173
netstat -ano | findstr :18800
```
