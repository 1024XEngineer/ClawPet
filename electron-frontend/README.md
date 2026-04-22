# GoClaw Electron 前端说明

该模块负责桌宠窗口渲染，并打开 PetClaw 控制台窗口。

## 启动方式

推荐：在仓库根目录直接启动整套链路：

```powershell
powershell -ExecutionPolicy Bypass -File "scripts/run-goclaw-dev.ps1" -Restart
```

仅在当前目录本地启动（默认加载本地 `dist` 渲染）：

```bash
npm install
npm run build    # 构建 renderer 到 dist/
npx electron src/main.js
```

若需要 renderer 热更新开发：

```bash
npm run start:dev
```

Windows 下可用 `run.bat` 方便开两个窗口。

## 分窗口联调（推荐排障）

当桌宠不渲染或网关未连上时，可按下面方式手动分窗口启动：

1. 窗口 A（launcher）：

```powershell
powershell -ExecutionPolicy Bypass -File ..\GoClaw-OneClickStart.ps1 -Mode launcher
```

2. 窗口 B（petclaw，优先直连 `18790`）：

```powershell
Set-Location ..\petclaw
$env:NEXT_PUBLIC_PICOCLAW_API_URL='http://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_WS_URL='ws://127.0.0.1:18800'
$env:NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL='http://127.0.0.1:18790'
$env:NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
$env:NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS='true'
npm run dev -- --hostname 127.0.0.1 --port 3000 --webpack
```

3. 窗口 C（electron）：

```powershell
Set-Location .
$env:GOCLAW_BACKEND_URL='http://127.0.0.1:18800'
$env:GOCLAW_DASHBOARD_URL='http://127.0.0.1:3000'
$env:GOCLAW_LAUNCHER_TOKEN='goclaw-local-token'
npx electron src/main.js
```

4. 可选窗口 D（renderer 热更新）：

```powershell
npm run dev
```

若启用窗口 D，请在窗口 C 额外设置：

```powershell
$env:ELECTRON_RENDERER_URL='http://127.0.0.1:5173'
```

## 目录职责

- `src/main.js`：Electron 主进程（桌宠窗口、控制台窗口）
- `src/preload.js`：安全桥接层（`window.electronAPI`）
- `src/App.tsx`：桌宠 UI 与气泡行为
- `public/`：桌宠动画资源

## 常见问题

- 出现顶部菜单（`File/Help`）：菜单应已禁用，重启 Electron 进程
- 控制台白屏：确认 PetClaw 在 `GOCLAW_DASHBOARD_URL`（默认 `http://127.0.0.1:3000`）可访问
- 网关未连接：优先检查 `http://127.0.0.1:18790/health` 与 `http://127.0.0.1:18790/pet/token`
- 需要重新 onboarding：在控制台侧栏点击“重新初始化”
- 桌宠无响应：确认 `electron-frontend/dist/index.html` 已生成（先执行 `npm run build`）
