# PetClaw 前端（统一包）

`clawpet` 是统一前端包，包含：

- Next.js 主面板（`/`）
- 桌宠渲染页（`/desktop-pet`）
- Electron 桌宠壳层（`./electron/main.js`）
- Electron 启动页（`./electron/startup.html`）

默认行为：

- 桌宠窗口会显示在主屏幕工作区右下角
- 启动时优先显示启动页（避免弹出多个命令行窗口）

## 固定端口

- 前端：`http://127.0.0.1:3000`
- 后端：`http://127.0.0.1:18790`

## 推荐启动（仓库根目录）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

## 仅启动当前前端

```powershell
Set-Location .\clawpet-frontend\clawpet
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

## 仅启动桌宠窗口

```powershell
Set-Location .\clawpet-frontend\clawpet
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'
$env:GOCLAW_SHOW_STARTUP='1'
npm run desktop
```

## 快速排查

```powershell
curl.exe -i http://127.0.0.1:3000
curl.exe -i http://127.0.0.1:3000/desktop-pet
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/pet/token
```
