# ClawPet 桌面端 API 文档

本文档描述 **clawpet-frontend 桌面端**（Electron 应用）使用的核心接口。

## 典型调用时序

```
前端启动
  ↓
获取 Pet Token (18800)
  ↓
连接 WebSocket (18790)
  ↓
接收 init_status (18790)
  ↓
需要 Onboarding? ── Yes ──→ 发送 onboarding_config (18790)
  ↓                                    ↓
  No                          推送 character_switch (18790)
  ↓                                    ↓
发送 chat action (18790) ←─────────────┘
  ↓
流式推送 ai_chat (18790)
  ├─ type: "text" (多次)
  └─ type: "final" (is_final: true)
  ↓
推送 audio (18790) [如果启用语音]
  ↓
推送 emotion_change (18790)
  ↓
推送 action_trigger (18790)
```

## 架构概览

```
┌─────────────────────────────────────────┐
│   ClawPet Desktop (Electron + Next.js)  │
│   端口: 3000                            │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
   HTTP API      WebSocket
   (18800)       (18790)
        │             │
   ┌────┴────┐   ┌────┴────┐
   │Launcher │   │Gateway  │
   │18800    │   │18790    │
   └─────────┘   └─────────┘
```

## 端口职责

### 18800 - Launcher API
提供配置管理、设备控制等 REST API

### 18790 - Gateway
提供 WebSocket 聊天、情感推送等实时通信

---

## 核心接口

### 1. 认证 API（18800）

桌面端启动时需要验证 Launcher 认证状态。

#### 认证状态检查

```
GET /api/auth/status
端口: 18800
响应: { authenticated: boolean, expires?: string }
状态: ✅ 已对接
```

#### 登录

```
POST /api/auth/login
端口: 18800
请求: { token: string }
响应: { success: boolean }
状态: ✅ 已对接
```

---

### 2. Pet/设备管理 API（18800）

管理桌宠设备的配置和初始化。

#### 获取 Pet Token

```
GET /api/pet/token
端口: 18800
说明: 获取 WebSocket 连接所需的 token 和 ws_url
响应: {
  enabled: boolean,
  token: string,
  ws_url: string,  // ws://127.0.0.1:18790/pet/ws
  protocol: string
}
状态: ✅ 已对接
```

#### Pet 初始化设置

```
POST /api/pet/setup
端口: 18800
说明: 初始化设备配置
状态: ⚠️ 待确认
```

#### Onboarding 状态

```
GET /api/pet/onboarding
端口: 18800
响应: OnboardingStatusData
状态: ✅ 已对接
```

#### 保存 Onboarding 草稿

```
PUT /api/pet/onboarding
端口: 18800
请求: OnboardingPayloadV1
响应: { code?: string, data?: { saved: boolean, draftUpdatedAt?: string } }
状态: ✅ 已对接
```

#### 完成 Onboarding

```
POST /api/pet/onboarding
端口: 18800
请求: { schemaVersion: 1, onboardingId: string }
响应: { code?: string, data?: { completed: boolean, completedAt?: string } }
状态: ✅ 已对接
```

---

### 3. WebSocket 聊天接口（18790）

桌面端的核心聊天功能通过 WebSocket 实现。

#### 连接地址

```
URL: ws://127.0.0.1:18790/pet/ws
参数: ?session=xxx&session_id=xxx
状态: ✅ 已对接
```

#### 客户端发送消息格式

```json
{
  "action": "chat",
  "data": {
    "text": "你好",
    "session_key": "session-1710000000000-abcdef123"
  },
  "request_id": "req-1-1710000000000"
}
```

**支持的 Action：**
- `chat` - 发送聊天消息 ✅
- `onboarding_config` - 提交 onboarding 配置 ✅
- `emotion_get` - 获取当前情感状态 ✅

#### Action 响应格式

**成功：**
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

**失败：**
```json
{
  "status": "error",
  "action": "chat",
  "error": "LLM call failed"
}
```

---

### 4. WebSocket 推送消息（18790）

Gateway 主动推送给前端的消息类型。

#### 消息信封格式

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {},
  "timestamp": 1710000000,
  "is_final": false
}
```

#### 推送类型

##### `init_status` - 初始化状态 ✅
- 用途：会话初始状态，决定是否显示 onboarding

##### `ai_chat` - AI 聊天消息 ✅
- 用途：助手流式回复、最终回复、工具调用提示

**data 格式支持 3 种：**
1. 对象：`{ text: string, emotion?: string, type: string }`
2. JSON 字符串
3. 原始文本字符串

**type 值：**
- `"text"` - 流式文本
- `"final"` - 最终回复
- `"tool"` - 工具调用提示

##### `audio` - 语音播放 ✅
- 用途：TTS 音频块推送

```json
{
  "chat_id": 1,
  "type": "audio",
  "text": "<base64-audio>",
  "is_final": false
}
```

##### `emotion_change` - 情感变化 ✅
- 用途：更新桌宠情感状态和动画

##### `action_trigger` - 动作触发 ✅
- 用途：触发桌宠特定动作或 UI 提示

##### `heartbeat` - 心跳 ✅
- 用途：连接保活

---

### 5. 渠道管理 API（18800）

管理消息平台渠道。

#### 渠道目录

```
GET /api/channels/catalog
端口: 18800
响应: { catalog: Array<{ type, name, description, configSchema }> }
状态: ⚠️ 待确认是否使用
```

#### 渠道列表

```
GET /api/channels
端口: 18800
响应: { channels: Channel[] }
状态: ⚠️ 待确认
```

#### 渠道状态

```
GET /api/channels/{id}/status
端口: 18800
响应: { connected: boolean, error?: string }
状态: ⚠️ 待确认
```

#### 启用/禁用渠道

```
POST /api/channels/{id}/enable   // 启用
POST /api/channels/{id}/disable  // 禁用
端口: 18800
响应: { success: boolean }
状态: ⚠️ 待确认
```

#### 更新渠道配置

```
PUT /api/channels/{id}/config
端口: 18800
请求: Record<string, unknown>
响应: { success: boolean }
状态: ⚠️ 待确认
```

---

### 6. 技能市场 API（18800）

桌宠技能插件管理。

#### 技能列表

```
GET /api/skills
端口: 18800
响应: { skills: Skill[] }
状态: ⚠️ 待确认
```

#### 搜索技能

```
GET /api/skills/search?q={query}&limit={limit}&offset={offset}
端口: 18800
响应: SkillSearchResponse
状态: ⚠️ 待确认
```

#### 安装技能

```
POST /api/skills/install
端口: 18800
请求: { slug: string, registry: string, version?: string, force?: boolean }
响应: { status: string, skill?: Skill }
状态: ⚠️ 待确认
```

#### 导入技能

```
POST /api/skills/import
端口: 18800
Content-Type: multipart/form-data
表单: file (.md / .zip, 最大 1MB)
响应: Skill
状态: ⚠️ 待确认
```

#### 删除技能

```
DELETE /api/skills/{name}
端口: 18800
响应: { status: string }
状态: ⚠️ 待确认
```

---

### 7. 工具管理 API（18800）

管理桌宠可用的工具。

#### 工具列表

```
GET /api/tools
端口: 18800
响应: { tools: Tool[] }
状态: ⚠️ 待确认
```

#### 更新工具状态

```
PUT /api/tools/{name}/state
端口: 18800
请求: { enabled: boolean }
响应: { success: boolean }
状态: ⚠️ 待确认
```

---

### 8. 定时任务 API（18800）

桌宠提醒和定时任务。

#### 任务列表

```
GET /api/cron
端口: 18800
响应: { jobs: CronJob[] }
状态: ⚠️ 待确认
```

#### 创建任务

```
POST /api/cron
端口: 18800
请求: CronJobInput
响应: { job: CronJob }
状态: ⚠️ 待确认
```

#### 更新任务

```
PUT /api/cron/{id}
端口: 18800
请求: Partial<CronJobInput>
响应: { job: CronJob }
状态: ⚠️ 待确认
```

#### 删除任务

```
DELETE /api/cron/{id}
端口: 18800
响应: { success: boolean }
状态: ⚠️ 待确认
```

#### 切换任务状态

```
POST /api/cron/{id}/toggle
端口: 18800
请求: { enabled: boolean }
响应: { success: boolean, job: CronJob }
状态: ⚠️ 待确认
```

---

### 9. 配置 API（18800）

获取和更新系统配置。

#### 获取配置

```
GET /api/config
端口: 18800
响应: { config: Config }
状态: ⚠️ 待确认
```

#### 更新配置

```
PUT /api/config
端口: 18800
请求: Partial<Config>
响应: { success: boolean }
状态: ⚠️ 待确认
```

---

### 10. 日志 API（18800）

查看系统日志。

#### 获取日志

```
GET /api/logs
端口: 18800
响应: { logs: string[] }
状态: ⚠️ 待确认
```

#### 清除日志

```
POST /api/logs/clear
端口: 18800
响应: { success: boolean }
状态: ⚠️ 待确认
```

---

### 11. 会话历史 API（18800）

聊天会话历史记录。

#### 会话列表

```
GET /api/sessions?offset={offset}&limit={limit}
端口: 18800
响应: SessionListItem[]
状态: ⚠️ 待确认
```

#### 会话详情

```
GET /api/sessions/{id}
端口: 18800
响应: SessionDetail
状态: ⚠️ 待确认
```

#### 删除会话

```
DELETE /api/sessions/{id}
端口: 18800
响应: 200 或 404
状态: ⚠️ 待确认
```

---

### 12. Gateway 管理 API（18800）

控制 Gateway 服务。

#### Gateway 状态

```
GET /api/gateway/status
端口: 18800
响应: GatewayStatus
状态: ⚠️ 待确认
```

#### 启动/停止/重启 Gateway

```
POST /api/gateway/start    // 启动
POST /api/gateway/stop     // 停止
POST /api/gateway/restart  // 重启
端口: 18800
响应: { success: boolean }
状态: ⚠️ 待确认
```

#### 获取日志

```
GET /api/gateway/logs
端口: 18800
响应: { logs: string }
状态: ⚠️ 待确认
```

---

## 前端启动流程

1. **认证检查** → `GET /api/auth/status` (18800) ✅
2. **获取设备 Token** → `GET /api/pet/token` (18800) ✅
3. **连接 WebSocket** → `ws://127.0.0.1:18790/pet/ws` (18790) ✅
4. **接收初始状态** → `init_status` 推送 (18790) ✅
5. **如需 Onboarding** → 显示引导流程 (18800 + 18790) ✅
6. **开始聊天** → 发送 `chat` action (18790) ✅
7. **接收消息** → `ai_chat`、`audio`、`emotion_change` 推送 (18790) ✅

---

## 错误处理

### HTTP 错误码
- `400` - 请求无效
- `401` - 未认证
- `404` - 资源不存在
- `409` - 冲突（如技能已安装）
- `502` - 上游服务错误

### WebSocket 错误
- Action 返回 `status: "error"`
- 连接断开需重连
- Token 过期需重新获取

---

## 认证说明

所有 18800 端口的 API 请求需要在 Header 中携带 Launcher Token：

```
Authorization: Bearer {launcher_token}
```

Token 获取方式：
1. 环境变量 `NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN`
2. Electron API: `window.electronAPI.getLauncherToken()`
3. URL 参数: `?token=xxx`
4. SessionStorage: `petclaw.launcher.token`

---

## 环境变量

前端通过环境变量配置连接地址：

```bash
# Launcher API 地址
NEXT_PUBLIC_PICOCLAW_API_URL=http://127.0.0.1:18800

# WebSocket 地址
NEXT_PUBLIC_PICOCLAW_WS_URL=ws://127.0.0.1:18790

# Gateway 直接访问地址
NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL=http://127.0.0.1:18790

# Launcher Token
NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN=goclaw-local-token

# 是否使用 credentials
NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS=false
```

---

## 接口对接状态说明

- ✅ **已对接** - 前端已实现并在使用
- ⚠️ **待确认** - 后端已实现，需确认前端是否使用
- ❌ **未对接** - 后端未实现或前端未使用
