# GoClaw-OneClickStart 使用说明

`GoClaw-OneClickStart.ps1` 现在默认委托到 `scripts/run-goclaw-dev.ps1`，使用统一的两端口架构：

- 前端：`3000`
- 后端：`18790`

## 快速启动

```powershell
powershell -ExecutionPolicy Bypass -File .\GoClaw-OneClickStart.ps1
```

或双击：

- `GoClaw-OneClickStart.bat`

## 推荐开发启动（同一逻辑）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

## 单独窗口启动

### 仅后端

```powershell
$env:PICOCLAW_CONFIG = (Resolve-Path .\.goclaw-runtime\config.json)
.\picoclaw.exe gateway -E
```

### 仅 PetClaw 前端

```powershell
Set-Location .\clawpet-frontend\clawpet
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

### 仅 Electron 桌宠

```powershell
Set-Location .\clawpet-frontend\clawpet
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'
npx electron .\electron\main.js
```

## 说明

- 桌宠渲染地址统一为 `http://127.0.0.1:3000/desktop-pet`
- `5173` 已不再作为渲染依赖，启动脚本会主动清理该端口占用
- `18800` 不再是业务链路依赖，业务优先走 `18790`
