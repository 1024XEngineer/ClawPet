# PetClaw 接口数据结构表

本文档补充 [petclaw-integration-plan.md](/D:/opencode/clawpet/GoClaw/docs/zh/petclaw-integration-plan.md)，重点给出当前版本常用接口的请求、响应和推送字段结构。

主参考代码：

- [auth.go](/D:/opencode/clawpet/GoClaw/web/backend/api/auth.go)
- [gateway.go](/D:/opencode/clawpet/GoClaw/web/backend/api/gateway.go)
- [pico.go](/D:/opencode/clawpet/GoClaw/web/backend/api/pico.go)
- [types.go](/D:/opencode/clawpet/GoClaw/pkg/pet/types.go)
- [channel.go](/D:/opencode/clawpet/GoClaw/pkg/channels/pet/channel.go)

## 1. Launcher HTTP

Base URL: `http://127.0.0.1:18800`

### 1.1 `POST /api/auth/login`

请求：

```json
{
  "token": "goclaw-local-token"
}
```

成功响应：

```json
{
  "status": "ok"
}
```

失败响应：

```json
{
  "error": "invalid token"
}
```

### 1.2 `GET /api/auth/status`

已登录响应：

```json
{
  "authenticated": true
}
```

未登录响应：

```json
{
  "authenticated": false,
  "token_help": {
    "env_var_name": "PICOCLAW_LAUNCHER_TOKEN",
    "log_file": "C:\\path\\to\\launcher.log",
    "config_file": "C:\\path\\to\\launcher-config.json",
    "tray_copy_menu": true,
    "console_stdout": true
  }
}
```

### 1.3 `GET /api/gateway/status`

典型响应：

```json
{
  "config_default_model": "glm-4-flash",
  "gateway_status": "running",
  "gateway_restart_required": false,
  "gateway_start_allowed": true,
  "gateway_start_reason": "",
  "pid": 12345
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `config_default_model` | string | 当前配置里的默认模型 |
| `gateway_status` | string | `stopped / starting / running / stopping / restarting / error` |
| `gateway_restart_required` | boolean | 配置是否变化到需要重启 |
| `gateway_start_allowed` | boolean | 当前配置是否允许启动 |
| `gateway_start_reason` | string | 不能启动时的原因 |
| `pid` | number | 运行中的 gateway PID |

### 1.4 `POST /api/gateway/start`

成功响应：

```json
{
  "status": "ok",
  "pid": 12345
}
```

前置条件失败：

```json
{
  "status": "precondition_failed",
  "message": "no default model configured"
}
```

### 1.5 `GET /api/pet/token`

响应：

```json
{
  "enabled": true,
  "token": "pico-xxxxxxxx",
  "ws_url": "ws://127.0.0.1:18800/pico/ws"
}
```

说明：

- 当前 launcher 返回的 `ws_url` 可能是 `/pico/ws`
- 前端仍可以把它当当前 WebSocket 入口

### 1.6 `POST /api/pet/setup`

响应：

```json
{
  "token": "pico-xxxxxxxx",
  "ws_url": "ws://127.0.0.1:18800/pico/ws",
  "enabled": true,
  "changed": true
}
```

## 2. Direct Gateway HTTP

Base URL: `http://127.0.0.1:{dynamic-port}`

### 2.1 `GET /pet/token`

响应：

```json
{
  "enabled": true,
  "protocol": "pet",
  "token": "",
  "ws_url": "ws://127.0.0.1:18793/pet/ws"
}
```

说明：

- 当前 `pet` 直连模式里 `token` 可能为空
- 真实连接地址以 `ws_url` 为准

### 2.2 `GET /health`

响应：

```json
{
  "status": "ok",
  "uptime": "53.9176007s"
}
```

### 2.3 `GET /ready`

响应：

```json
{
  "status": "ready",
  "uptime": "53.9176007s"
}
```

## 3. WebSocket 请求格式

```json
{
  "action": "chat",
  "data": {},
  "request_id": "req-1"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `action` | string | 动作名 |
| `data` | object | 动作负载 |
| `request_id` | string | 请求追踪 ID |

## 4. 常用 action 数据结构

### 4.1 `chat`

请求：

```json
{
  "action": "chat",
  "data": {
    "text": "你好",
    "session_key": "session-1710000000000"
  },
  "request_id": "req-chat-1"
}
```

成功响应：

```json
{
  "status": "ok",
  "action": "chat",
  "data": {
    "session_key": "session-1710000000000"
  }
}
```

### 4.2 `onboarding_config`

请求：

```json
{
  "action": "onboarding_config",
  "data": {
    "pet_name": "艾莉",
    "pet_persona": "温柔体贴，善于提醒学习节奏",
    "pet_persona_type": "gentle"
  }
}
```

成功响应：

```json
{
  "status": "ok",
  "action": "onboarding_config",
  "data": {
    "pet_id": "pet_001"
  }
}
```

### 4.3 `emotion_get`

请求：

```json
{
  "action": "emotion_get",
  "data": {
    "pet_id": "pet_001"
  }
}
```

成功响应：

```json
{
  "status": "ok",
  "action": "emotion_get",
  "data": {
    "pet_id": "pet_001",
    "emotion": "joy",
    "joy": 65,
    "anger": 10,
    "sadness": 8,
    "disgust": 5,
    "surprise": 20,
    "fear": 6,
    "description": "开心"
  }
}
```

### 4.4 `character_get`

成功响应：

```json
{
  "status": "ok",
  "action": "character_get",
  "data": {
    "pet_id": "pet_001",
    "pet_name": "艾莉",
    "pet_persona": "温柔体贴，善于提醒学习节奏",
    "pet_persona_type": "gentle",
    "avatar": "default",
    "created_at": "2026-04-19T08:00:00Z",
    "updated_at": "2026-04-19T08:00:00Z"
  }
}
```

### 4.5 `config_get`

说明：

- 当前 `types.go` 里定义了 `config_update`
- 具体响应内容来自运行配置，字段会随版本变化
- 前端对接时建议按“局部字段可选”解析

### 4.6 `memory_search`

成功响应：

```json
{
  "status": "ok",
  "action": "memory_search",
  "data": {
    "memories": [
      {
        "id": 1,
        "type": "profile",
        "weight": 90,
        "content": "用户喜欢晚上学习",
        "created_at": "2026-04-19T08:00:00Z"
      }
    ],
    "total": 1,
    "has_more": false
  }
}
```

### 4.7 `conversation_list`

成功响应：

```json
{
  "status": "ok",
  "action": "conversation_list",
  "data": {
    "conversations": [
      {
        "id": 1,
        "role": "user",
        "content": "你好",
        "timestamp": "2026-04-19T08:00:00Z",
        "compressed": false
      }
    ],
    "total": 1,
    "has_more": false
  }
}
```

### 4.8 `model_list_get`

说明：

- 这类 action 与 launcher `/api/models` 有交集
- 新接入方如果只做控制台，优先用 launcher HTTP
- 如果做纯 `pet` 通道客户端，再对接这些 action

## 5. Push 消息总格式

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {},
  "timestamp": 1710000000,
  "is_final": false
}
```

## 6. 常用 push_type 数据结构

### 6.1 `init_status`

```json
{
  "type": "push",
  "push_type": "init_status",
  "data": {
    "need_config": true,
    "has_character": false,
    "character": null,
    "mbti": {
      "ie": 50,
      "sn": 50,
      "tf": 50,
      "jp": 50
    },
    "emotion_state": {
      "pet_id": "pet_001",
      "emotion": "neutral",
      "joy": 50,
      "anger": 50,
      "sadness": 50,
      "disgust": 50,
      "surprise": 50,
      "fear": 50,
      "description": "平静"
    }
  },
  "timestamp": 1710000000
}
```

### 6.2 `ai_chat`

代码中的流式文本结构：

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {
    "chat_id": 1,
    "type": "text",
    "text": "你好",
    "emotion": "joy",
    "action": ""
  },
  "timestamp": 1710000000,
  "is_final": false
}
```

结束块：

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {
    "chat_id": 1,
    "type": "final",
    "text": "",
    "emotion": "joy",
    "action": ""
  },
  "timestamp": 1710000000,
  "is_final": true
}
```

### 6.3 `audio`

```json
{
  "type": "push",
  "push_type": "audio",
  "data": {
    "chat_id": 1,
    "type": "audio",
    "text": "<base64-audio>",
    "is_final": false
  },
  "timestamp": 1710000000,
  "is_final": false
}
```

结束块：

```json
{
  "type": "push",
  "push_type": "audio",
  "data": {
    "chat_id": 1,
    "type": "audio",
    "text": "<base64-audio>",
    "is_final": true
  },
  "timestamp": 1710000000,
  "is_final": true
}
```

### 6.4 `emotion_change`

```json
{
  "type": "push",
  "push_type": "emotion_change",
  "data": {
    "emotion": "joy",
    "score": 75,
    "description": "开心"
  },
  "timestamp": 1710000000
}
```

### 6.5 `action_trigger`

```json
{
  "type": "push",
  "push_type": "action_trigger",
  "data": {
    "action": "wave",
    "expression": "wave_01"
  },
  "timestamp": 1710000000
}
```

### 6.6 `heartbeat`

```json
{
  "type": "push",
  "push_type": "heartbeat",
  "data": {
    "timestamp": 1710000000
  },
  "timestamp": 1710000000
}
```

### 6.7 `character_switch`

```json
{
  "type": "push",
  "push_type": "character_switch",
  "data": {
    "character_id": "pet_002"
  },
  "timestamp": 1710000000
}
```

## 7. 推荐前端解析策略

### 7.1 对 `ai_chat`

- 允许 `data` 是 object
- 允许 `data` 是 JSON string
- 允许 `data` 是 raw string

### 7.2 对 `audio`

- 允许分块
- 用 `chat_id` 聚合
- 以 `is_final=true` 合并播放

### 7.3 对 `init_status`

- 不要只看 `need_config`
- 同时保留 `character` / `mbti` / `emotion_state`
- 初始化页完成后立刻补发 `emotion_get`

## 8. 实战建议

如果你要写自己的前端 / 程序：

1. `launcher` 只负责控制和 token 获取
2. `pet` WebSocket 只负责会话消息
3. `PET_CHANNEL_API.md` 只当老协议参考
4. 当前字段结构以代码和本文档为准

