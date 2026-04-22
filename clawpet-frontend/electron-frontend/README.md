# Electron 桌宠前端（clawpet-frontend/electron-frontend）

该模块负责：

- 桌宠窗口（透明窗体）
- 与后端 `18790` 通信
- 打开 `petclaw` 面板（`3000`）
- 从 `petclaw` 的 `/desktop-pet` 加载渲染页

## 启动方式

推荐在仓库根目录统一启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

仅启动 Electron：

```powershell
Set-Location .\clawpet-frontend\electron-frontend
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18790'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_PET_RENDERER_PATH='/desktop-pet'
npx electron src/main.js
```

## 开发说明

- 本项目 Vite 开发端口已改为 `3002`
- `5173` 已停用，不再作为默认渲染入口
- 生产/调试都建议优先使用 `3000/desktop-pet` 作为桌宠渲染页

## 常见问题

### 桌宠空白

检查：

```powershell
curl.exe -i http://127.0.0.1:3000/desktop-pet
```

### 后端连接失败

检查：

```powershell
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/pet/token
```
