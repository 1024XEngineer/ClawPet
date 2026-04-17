# API 接口文档（ClawPet 前端当前使用）

本文档描述 `electron-frontend` 当前真实对接的接口（HTTP + WebSocket）。

- 网关基地址：`http://127.0.0.1:18790`
- 通道协议：`pet`
- 默认联调语言：中文

## 1. 联调目标（前端 + 后端）

1. 前端通过 Gateway 获取连接信息：`GET /pet/token`
2. 前端连接 WebSocket：`ws://127.0.0.1:18790/pet/ws`
3. 前端收发核心动作：`chat`、`onboarding_config`、`emotion_get`
4. 前端消费核心推送：`init_status`、`ai_chat`、`emotion_change`、`audio`

## 2. HTTP 接口

### 2.1 获取 pet 连接信息

- Method: `GET`
- Path: `/pet/token`
- 用途: 前端获取 `ws_url` 后建立 WebSocket

示例响应：

```json
{
  "enabled": true,
  "token": "",
  "ws_url": "ws://127.0.0.1:18790/pet/ws",
  "protocol": "pet"
}
```

### 2.2 获取技能列表

- Method: `GET`
- Path: `/api/skills`
- 用途: 设置页“技能”模块

### 2.3 获取工具列表

- Method: `GET`
- Path: `/api/tools`
- 用途: 设置页“工具开关”模块

### 2.4 更新工具开关

- Method: `PUT`
- Path: `/api/tools/{name}/state`
- Body:

```json
{
  "enabled": true
}
```

### 2.5 获取频道目录

- Method: `GET`
- Path: `/api/channels/catalog`
- 用途: 设置页“频道”模块

### 2.6 获取单个频道配置

- Method: `GET`
- Path: `/api/channels/{name}/config`
- 用途: 展示 `enabled` 与 `configured_secrets`

## 3. WebSocket 接口

### 3.1 建连

- URL: `ws://127.0.0.1:18790/pet/ws`
- 来源: `/pet/token` 返回的 `ws_url`

建连后服务端会推送 `init_status`。

### 3.2 客户端请求格式

```json
{
  "action": "chat",
  "data": { "text": "你好", "session_key": "pet:default:go-claw" },
  "request_id": "req_..."
}
```

当前前端已使用 action：

- `chat`
- `onboarding_config`
- `emotion_get`
- `health_check`
- `tool_result`

### 3.3 服务端响应格式（动作响应）

```json
{
  "status": "ok",
  "action": "emotion_get",
  "data": {
    "emotion": "neutral",
    "description": "平静"
  }
}
```

错误响应：

```json
{
  "status": "error",
  "action": "chat",
  "data": { "error": "LLM call failed" }
}
```

### 3.4 服务端推送格式（push）

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": { "text": "...", "emotion": "joy", "type": "text" },
  "timestamp": 1710000000,
  "is_final": false
}
```

常见 `push_type`：

- `init_status`：首次连接初始化状态
- `ai_chat`：聊天流式增量/结束块
- `emotion_change`：情绪变化
- `audio`：语音片段
- `heartbeat`：心跳

## 4. 引导页初始化流程（已对接）

1. 前端调用 `GET /pet/token`
2. 前端连接 `ws://.../pet/ws`
3. 后端推送 `push_type=init_status`
4. 若 `need_config=true`，前端显示 onboarding 表单
5. 用户提交后发送 `action=onboarding_config`
6. 收到成功后发送 `action=emotion_get`
7. 关闭 onboarding，进入聊天

校验规则：

- `pet_name` 长度：2-24
- `pet_persona` 长度：8-300
- `pet_persona_type`：`gentle | playful | cool`
- 未连接后端时禁止提交

## 5. 联调排错清单

1. `GET /health` 必须 `200`
2. `GET /ready` 建议 `200`
3. `GET /pet/token` 必须 `200`
4. 前端 Network 中必须出现 `ws://127.0.0.1:18790/pet/ws`
5. 如果发送 `chat` 后无回复，检查后端日志和模型配置
