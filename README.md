# ClawPet（桌宠）使用说明

ClawPet 是一个以“桌宠 + 对话陪伴”为核心的桌面产品。
当前联调形态为：`electron-frontend` 通过 Gateway（`picoclaw`）连接 `pet` 通道完成聊天与初始化。

当前仓库里与你使用直接相关的是：

- `picoclaw` 网关后端（默认 `127.0.0.1:18790`）
- `electron-frontend` 前端（Vite + Electron）
- `pet` 通道（`/pet/token` + `/pet/ws`）

默认交互语言：

- 前端输入与引导文案默认中文
- 联调建议直接使用中文消息验证会话链路

## 1. 面向他人的启动方式（重点）

> 不依赖 `make`，直接使用跨平台命令。

### 1.1 环境要求

- Go `>= 1.23`
- Node.js `>= 18`（建议 20/22）
- npm
- Windows 下建议安装 C/C++ 编译环境（否则 SQLite 相关能力会降级）

### 1.2 启动后端（Gateway）

在仓库根目录执行：

```powershell
cd "D:\study part\GoClawself"
go run -tags "goolm,stdjson" ./cmd/picoclaw gateway
```

启动成功后，你应看到：

- `Gateway started on 127.0.0.1:18790`
- 健康检查可访问：`/health`、`/ready`

快速验证：

```powershell
curl.exe -i http://127.0.0.1:18790/health
curl.exe -i http://127.0.0.1:18790/ready
curl.exe -i http://127.0.0.1:18790/pet/token
```

### 1.3 启动 Electron 前端

新开一个终端：

```powershell
cd "D:\study part\GoClawself\electron-frontend"
npm install
npm run start
```

默认会拉起：

- Vite 开发服务（通常 `http://localhost:5173`）
- Electron 桌面窗口

## 2. 首次使用（引导页）

首次连接后，前端会收到 `init_status` 推送：

- `need_config=true`：显示初始化引导页
- `need_config=false`：直接进入聊天

引导页提交流程：

1. 填写宠物名称、性格类型、性格描述。
2. 前端发送 `onboarding_config`。
3. 后端返回成功后，前端自动发送 `emotion_get`。
4. 引导层关闭，输入框可用，进入正常聊天。

当前前端已增加输入校验：

- 宠物名称长度：`2-24`
- 性格描述长度：`8-300`
- 性格类型限定：`gentle | playful | cool`
- 未连接后端时不允许提交

### 2.1 如何手动强制显示引导页（用于测试）

在设置页的 DevTools Console 执行：

```js
localStorage.setItem('clawpet.forceOnboarding', '1')
location.reload()
```

关闭强制引导：

```js
localStorage.removeItem('clawpet.forceOnboarding')
location.reload()
```

## 3. 常见问题

### 3.1 `make run` 不可用

Windows 默认没有 `make`，请按上面的 `go run` + `npm run start` 启动。

### 3.2 `Cannot find module ... electron\cli.js`

在 `electron-frontend` 目录执行：

```powershell
npm install
```

### 3.3 前端“已连接”但消息无回复

请检查：

1. `http://127.0.0.1:18790/health` 是否 `200`。
2. `http://127.0.0.1:18790/ready` 是否 `200`。
3. `http://127.0.0.1:18790/pet/token` 是否 `200`。
4. DevTools 的 WebSocket 是否连接到 `ws://127.0.0.1:18790/pet/ws`。
5. 若后端模型调用失败，前端现在会直接显示错误文本，便于定位问题。

## 4. 目录说明

- `electron-frontend/`: 桌宠前端（聊天、引导、设置）
- `pkg/channels/pet/`: pet 通道 WebSocket/HTTP 入口
- `pkg/pet/`: 桌宠业务核心（角色、情绪、记忆、引导）
- `picoread/`: 已归档的历史根目录文档
- `API.md`: 当前前端对接接口文档（HTTP + WebSocket）

## 5. 本次 PR 联调范围（前端 + 后端）

本次联调覆盖：

1. Gateway 健康与就绪状态：`/health`、`/ready`
2. 前端到后端连接链路：`/pet/token` -> `ws://127.0.0.1:18790/pet/ws`
3. 引导流程：`init_status` + `onboarding_config`
4. 聊天链路：`chat` 请求、`ai_chat` 推送回显
