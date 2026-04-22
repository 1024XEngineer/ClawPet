# ClawPet 开发说明

本仓库已重构为 **两端口架构**：

- 前端：`http://127.0.0.1:3000`（`clawpet-frontend/petclaw`）
- 后端：`http://127.0.0.1:18790`（gateway / pet channel）

Electron 桌宠渲染页统一从 `petclaw` 的 `/desktop-pet` 加载，不再依赖 `5173`。

## 目录结构

- `clawpet-frontend/petclaw`：主前端面板（Next.js）
- `clawpet-frontend/electron-frontend`：Electron 桌宠外壳
- `pkg/channels/pet`：Pet Channel 协议层
- `pkg/pet`：Pet 业务实现
- `scripts/run-goclaw-dev.ps1`：推荐的一键开发启动脚本

## 一键启动（推荐）

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

该脚本会：

1. 清理旧进程和旧端口（含 `5173` / `18800`）
2. 启动后端 `18790`
3. 启动前端 `3000`
4. 启动 Electron，并加载 `http://127.0.0.1:3000/desktop-pet`

## 单独窗口启动

### 1) 仅启动后端（18790）

```powershell
$env:PICOCLAW_CONFIG = (Resolve-Path .\.goclaw-runtime\config.json)
.\picoclaw.exe gateway -E
```

如果你本地没有 `picoclaw.exe`，可用：

```powershell
go run -tags "goolm,stdjson" .\cmd\picoclaw gateway
```

### 2) 仅启动前端面板（3000）

```powershell
Set-Location .\clawpet-frontend\petclaw
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

### 3) 仅启动桌宠窗口（Electron）

```powershell
Set-Location .\clawpet-frontend\electron-frontend
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'
npx electron src/main.js
```

## 常见排查

### 桌宠没渲染

先确认这两个地址可访问：

```powershell
curl.exe -i http://127.0.0.1:3000
curl.exe -i http://127.0.0.1:3000/desktop-pet
```

### 网关没连上

优先检查后端：

```powershell
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/pet/token
```

### 确认 5173 已停用

```powershell
netstat -ano | findstr :5173
```

若有进程占用，执行一键脚本会自动清理。
