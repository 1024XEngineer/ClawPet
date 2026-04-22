# PetClaw 前端面板（clawpet-frontend/petclaw）

`petclaw` 是当前主前端，负责：

- 主聊天面板
- onboarding 页面
- 展示后端状态
- 播放后端推送的音频
- 提供 Electron 桌宠渲染页：`/desktop-pet`

## 端口约定

- 前端固定：`http://127.0.0.1:3000`
- 后端优先：`http://127.0.0.1:18790`

## 启动

在仓库根目录推荐一键启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-goclaw-dev.ps1 -Restart -PetclawMode dev
```

仅启动当前前端：

```powershell
Set-Location .\clawpet-frontend\petclaw
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='false'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

## 常见排查

### 面板打不开

```powershell
curl.exe -i http://127.0.0.1:3000
```

### 桌宠页面打不开

```powershell
curl.exe -i http://127.0.0.1:3000/desktop-pet
```

### 网关状态异常

```powershell
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/pet/token
```
