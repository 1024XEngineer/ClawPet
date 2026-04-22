# Pet Channel API 接口文档

> 版本：v2.7  
> 日期：2026-04-23  
> 协议：WebSocket + JSON

---

## 一、连接方式

### 1.1 WebSocket 连接地址

```
ws://{host}:{port}/ws?session={sessionId}
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| host | string | 是 | 服务器地址，默认 `0.0.0.0` |
| port | int | 是 | 服务器端口，默认 `8080` |
| sessionId | string | 否 | 会话ID，默认为 `default` |

**连接示例**：
```javascript
const ws = new WebSocket('ws://localhost:8080/ws?session=user_001');
```

**重要**：连接建立后，服务器会主动推送 `init_status`，告知前端是否需要初始化配置。

---

## 二、消息格式

### 2.1 请求消息 (Client → Server)

```json
{
  "action": "string",
  "data": {},
  "request_id": "string"
}
```

### 2.2 响应消息 (Server → Client)

```json
{
  "status": "ok|error|pending",
  "action": "string",
  "data": {},
  "error": "string",
  "request_id": "string"
}
```

### 2.3 推送消息 (Server → Client)

```json
{
  "type": "push",
  "push_type": "string",
  "data": {},
  "timestamp": 1234567890,
  "is_final": false
}
```

---

## 三、推送类型

### 3.1 init_status - 连接初始化状态

连接建立时服务器主动推送，告知前端是否需要初始化配置。

```json
{
  "type": "push",
  "push_type": "init_status",
  "data": {
    "need_config": false,
    "has_character": true,
    "character": {
      "pet_id": "pet_001",
      "pet_name": "艾莉",
      "pet_persona": "温柔体贴，善于关心他人",
      "pet_persona_type": "gentle",
      "avatar": "default"
    },
    "mbti": {
      "ie": 60,
      "sn": 40,
      "tf": 30,
      "jp": 50
    },
    "emotion_state": {
      "pet_id": "pet_001",
      "emotion": "joy",
      "joy": 65,
      "anger": 50,
      "sadness": 40,
      "disgust": 50,
      "surprise": 55,
      "fear": 50,
      "description": "开心"
    }
  },
  "timestamp": 1712610000
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| need_config | bool | 是否需要配置（为 true 时前端应显示初始化界面） |
| has_character | bool | 是否有角色配置 |
| character | object | 角色信息（无配置时为 null） |
| character.pet_id | string | 桌宠ID |
| character.pet_name | string | 桌宠名称 |
| character.pet_persona | string | 性格描述 |
| character.pet_persona_type | string | 性格类型 |
| character.avatar | string | 头像/模型ID |
| mbti | object | MBTI 配置 |
| mbti.ie | int | 内向/外向 (0-100, 50中性, <50偏内向, >50偏外向) |
| mbti.sn | int | 实感/直觉 (0-100, 50中性, <50偏实感, >50偏直觉) |
| mbti.tf | int | 理性/感性 (0-100, 50中性, <50偏理性, >50偏感性) |
| mbti.jp | int | 判断/感知 (0-100, 50中性, <50偏判断, >50偏感知) |
| emotion_state | object | 当前情绪状态 |
| emotion_state.emotion | string | 主要情绪标签 (neutral/joy/anger/sadness/disgust/surprise/fear) |
| emotion_state.joy | int | 快乐值 0-100 |
| emotion_state.anger | int | 愤怒值 0-100 |
| emotion_state.sadness | int | 悲伤值 0-100 |
| emotion_state.disgust | int | 厌恶值 0-100 |
| emotion_state.surprise | int | 惊讶值 0-100 |
| emotion_state.fear | int | 恐惧值 0-100 |
| emotion_state.description | string | 情绪中文描述 |

---

### 3.2 ai_chat - AI 聊天回复（流式）

AI 回复时推送，支持流式输出。

**流式推送**：

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {
    "chat_id": 1,
    "type": "text",
    "text": "你好呀"
  },
  "timestamp": 1712610000,
  "is_final": false
}
```

**最终推送（结束标记）**：

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {
    "chat_id": 100,
    "type": "final",
    "text": "",
    "emotion": "joy",
    "action": ""
  },
  "timestamp": 1712610000,
  "is_final": true
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| chat_id | int | 聊天块序号，逐块递增 |
| type | string | 内容类型：`text`=文本块, `final`=结束标记 |
| text | string | AI 回复文本（流式输出） |
| emotion | string | 当前主要情绪标签 |
| action | string | 动作名称（如有） |
| is_final | bool | 是否为最终块 |

**前端处理逻辑**：
1. 收到 `type: "text"` 时，将 text 追加显示到聊天界面
2. 收到 `type: "final"` 时，表示 AI 回复结束
3. 情绪和动作标签在流式输出时已由后端处理，不在 text 中显示

---

### 3.3 emotion_change - 情绪变化

情绪状态发生变化时推送（定时检测）。

```json
{
  "type": "push",
  "push_type": "emotion_change",
  "data": {
    "emotion": "joy",
    "score": 75,
    "description": "开心"
  },
  "timestamp": 1712610000
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| emotion | string | 情绪标签 (neutral/joy/anger/sadness/disgust/surprise/fear) |
| score | int | 情绪强度 0-100 |
| description | string | 情绪中文描述 |

---

### 3.4 action_trigger - 动作触发

LLM 解析到动作标签时推送。

```json
{
  "type": "push",
  "push_type": "action_trigger",
  "data": {
    "action": "wave",
    "expression": "wave_01"
  },
  "timestamp": 1712610000
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| action | string | 动作名称 |
| expression | string | 表情标识 |

---

### 3.5 heartbeat - 心跳保活

定期发送的心跳保活推送，间隔 30 秒。

```json
{
  "type": "push",
  "push_type": "heartbeat",
  "data": {
    "timestamp": 1712610000
  },
  "timestamp": 1712610000
}
```

---

### 3.6 character_switch - 角色切换

角色切换成功后，所有客户端会收到此推送。

```json
{
  "type": "push",
  "push_type": "character_switch",
  "data": {
    "character_id": "pet_002"
  },
  "timestamp": 1712610000
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| character_id | string | 切换后的角色ID |

---

### 3.7 audio_and_voice - 语音流式合成音频

当 `voice_enabled` 启用时，AI 回复会触发语音流式合成。后端将文本按标点符号和 `[text:]` 标签分割成多个片段，异步合成音频后按顺序推送给前端播放。

**音频块推送**：

```json
{
  "type": "push",
  "push_type": "audio_and_voice",
  "data": {
    "seq": 1,
    "text": "你好呀，很高兴见到你",
    "audio": "//uQxAAAAs3gAAFBYy...",
    "duration": 2500,
    "is_final": false,
    "error": ""
  },
  "timestamp": 1712610000,
  "is_final": false
}
```

**错误块推送**：

```json
{
  "type": "push",
  "push_type": "audio_and_voice",
  "data": {
    "seq": 2,
    "text": "你好",
    "audio": "",
    "duration": 0,
    "is_final": false,
    "error": "语音合成返回空，请检查一下相关语音合成模型的额度"
  },
  "timestamp": 1712610000,
  "is_final": false
}
```

**最终块推送**：

```json
{
  "type": "push",
  "push_type": "audio_and_voice",
  "data": {
    "seq": 0,
    "text": "",
    "audio": "",
    "duration": 0,
    "is_final": true,
    "error": ""
  },
  "timestamp": 1712610000,
  "is_final": true
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| seq | int | 音频片段序号，按发送顺序递增 |
| text | string | 对应的原始文本内容 |
| audio | string | Base64 编码的音频数据（MP3 格式） |
| duration | int | 音频时长（毫秒） |
| is_final | bool | 是否为最后一个音频块 |
| error | string | 错误信息（如果有） |

**语音流式合成流程**：

1. **文本分割**：后端按标点符号（`.。；;?？！!`）和 `[text:]` 标签将文本分割成多个片段
2. **异步合成**：每个片段独立异步调用 TTS 合成
3. **顺序发送**：第一个合成完成的音频立即发送，后续音频需等待前端 `audio_done` 通知或超时
4. **等待机制**：
   - 后端发送音频后启动计时器（默认 3 秒）
   - 收到前端 `audio_done` 通知后发送下一个音频
   - 计时器超时时也发送下一个音频
5. **最终块**：所有音频发送完毕后，发送 `is_final=true` 的块

**前端处理逻辑**：

```javascript
// 接收 audio_and_voice 推送
if (msg.push_type === 'audio_and_voice') {
    const data = msg.data;
    
    if (data.is_final) {
        // 最终块，语音播放结束
        console.log('Voice streaming completed');
        return;
    }
    
    if (data.error) {
        // 错误块
        console.error('Audio error:', data.error);
        // 通知后端当前音频播放完毕，继续下一个
        ws.send(JSON.stringify({
            "action": "audio_done",
            "data": { "seq": data.seq }
        }));
        return;
    }
    
    // 播放音频
    const audioData = base64ToArrayBuffer(data.audio);
    const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    audio.onended = function() {
        // 音频播放完毕，通知后端
        ws.send(JSON.stringify({
            "action": "audio_done",
            "data": { "seq": data.seq }
        }));
    };
    
    audio.play();
}
```

---

## 四、客户端请求接口

### 4.1 audio_done - 音频播放完毕通知

前端通知后端当前音频片段已播放完毕，后端收到通知后发送下一个音频片段。

**请求**：

```json
{
  "action": "audio_done",
  "data": {
    "seq": 1
  },
  "request_id": "req_001"
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "audio_done",
  "data": {
    "seq": 1
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| seq | int | 是 | 已播放完毕的音频片段序号 |

**注意**：
- 前端应在音频播放完毕后尽快发送此通知，以便后端发送下一个音频
- 如果音频播放失败或中断，也应发送此通知避免阻塞后续音频
- 后端有超时机制（默认 3 秒），超时后会自动发送下一个音频

---

### 4.2 chat - 发送聊天消息

### 4.1 chat - 发送聊天消息

发送用户消息给 AI，获得 AI 回复（流式推送）。

**请求**：

```json
{
  "action": "chat",
  "data": {
    "text": "今天心情不错",
    "session_key": "pet:default:user_001"
  },
  "request_id": "req_001"
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "chat",
  "data": {
    "session_key": "pet:default:user_001"
  }
}
```

**推送**：AI 回复通过 `ai_chat` 推送，详见 3.2

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| text | string | 是 | 用户输入的文本内容 |
| session_key | string | 是 | 会话标识符 |

---

### 4.2 onboarding_config - 提交初始化配置

首次启动时提交用户与桌宠的配置信息。

**请求**：

```json
{
  "action": "onboarding_config",
  "data": {
    "pet_name": "艾莉",
    "pet_persona": "温柔体贴，善于关心他人，说话轻声细语",
    "pet_persona_type": "gentle"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "onboarding_config",
  "data": {
    "pet_id": "pet_001"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pet_name | string | 是 | 桌宠名称 |
| pet_persona | string | 是 | 性格描述 |
| pet_persona_type | string | 否 | 性格类型ID |

**性格类型映射**：

| persona_type | 性格描述 |
|--------------|----------|
| gentle | 温柔体贴，善于关心他人，说话轻声细语 |
| playful | 活泼可爱，精力充沛，喜欢开玩笑和撒娇 |
| cool | 高冷傲娇，表面冷淡但内心关心主人 |
| wise | 睿智沉稳，知识渊博，说话有条理 |

---

### 4.3 user_profile_update - 用户画像更新

提交用户的基本信息，用于桌宠了解用户并调整回复风格。后端会存储到 `~/.picoclaw/user_profile.json`，并在每次对话时注入到 LLM 上下文中。

**请求**：

```json
{
  "action": "user_profile_update",
  "data": {
    "display_name": "小明",
    "role": "计算机专业",
    "language": "zh-CN",
    "chronotype": "night",
    "personality_tone": "阴阳怪气",
    "anxiety_level": 65,
    "pressure_level": "high",
    "extra": {
      "focus_windows": ["20:00-23:00"],
      "selected_breakers": ["考试", "作业"]
    }
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "user_profile_update",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| display_name | string | 否 | 用户昵称/称呼 |
| role | string | 否 | 用户身份/专业方向 |
| language | string | 否 | 首选语言（如 `zh-CN`、`en-US`） |
| chronotype | string | 否 | 作息类型：`morning`（晨型）/ `balanced`（均衡型）/ `night`（夜型） |
| personality_tone | string | 否 | 期望的对话风格（如 `阴阳怪气`、`甜心夹子`、`正常`） |
| anxiety_level | int | 否 | 焦虑指数 0-100 |
| pressure_level | string | 否 | 压力等级：`low` / `medium` / `high` / `critical` |
| extra | object | 否 | 其他扩展字段，前端传来的未知数据会以 `[key]: value` 格式注入 LLM |

**数据用途**：

1. **存储**：后端保存到 `~/.picoclaw/user_profile.json`（用户数据目录）
2. **LLM 上下文注入**：通过 `【用户档案】` 系统消息注入，包含：
   - 用户昵称、身份、语言偏好、作息类型、期望风格、压力等级
   - extra 中的所有字段（前端传来的未知参数）
3. **实时状态**：每个桌宠角色有独立的 `workspaces/{charID}/user_state.json`，存储 LLM 分析出的用户情绪状态（current_mood, energy_level, engagement_level, stress_trend）
4. **情绪事件记忆**：每次对话后，LLM 会分析用户情绪事件并保存到 memory store（`user_preference` 类型），带时间戳

**LLM 注入示例**：

```
【用户档案】
  用户昵称：小明
  身份/角色：计算机专业
  语言偏好：zh-CN
  作息类型：夜型（晚睡型）
  期望对话风格：阴阳怪气
  当前压力等级：high（焦虑指数 65%）
  [focus_windows]: [20:00-23:00]
  [selected_breakers]: [考试, 作业]

当前状态（来自pet_001的感知）：
  情绪状态：stressed
  精力水平：40%
  互动意愿：70%
  压力趋势：上升中
```

**注意**：
- 未知字段（extra）也会被记录并注入 LLM，让桌宠了解用户更多信息
- 实时状态由 LLM 每次对话后自动分析，前端无需发送
- 如果 profile 为空，LLM 会看到"用户尚未完成画像设置"

---

### 4.4 character_get - 获取角色配置

获取当前桌宠的角色配置信息。

**请求**：

```json
{
  "action": "character_get",
  "data": {}
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "character_get",
  "data": {
    "pet_id": "pet_001",
    "pet_name": "艾莉",
    "pet_persona": "温柔体贴，善于关心他人",
    "pet_persona_type": "gentle",
    "avatar": "default",
    "created_at": "2024-04-01T00:00:00Z",
    "updated_at": "2024-04-08T12:00:00Z"
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| pet_id | string | 桌宠ID |
| pet_name | string | 桌宠名称 |
| pet_persona | string | 性格描述 |
| pet_persona_type | string | 性格类型 |
| avatar | string | 头像/模型ID |
| created_at | string | 创建时间（ISO 8601） |
| updated_at | string | 更新时间（ISO 8601） |

---

### 4.4 character_update - 更新角色配置

修改桌宠的角色配置，修改后新对话立即生效。

**请求**：

```json
{
  "action": "character_update",
  "data": {
    "pet_id": "pet_001",
    "pet_name": "星璃",
    "pet_persona": "活泼可爱，精力充沛",
    "pet_persona_type": "playful"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "character_update",
  "data": {
    "pet_id": "pet_001",
    "pet_name": "星璃",
    "pet_persona": "活泼可爱，精力充沛",
    "pet_persona_type": "playful",
    "avatar": "default",
    "created_at": "2024-04-01T00:00:00Z",
    "updated_at": "2024-04-08T12:30:00Z"
  }
}
```

**注意**：修改后新的对话会立即使用新配置。

---

### 4.5 character_switch - 切换角色

切换当前激活的桌宠角色。

**请求**：

```json
{
  "action": "character_switch",
  "data": {
    "character_id": "pet_002"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "character_switch",
  "data": {
    "character_id": "pet_002"
  }
}
```

**推送**：角色切换成功后，所有客户端会收到 `character_switch` 推送，详见 3.6

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| character_id | string | 是 | 目标角色ID |

---

### 4.6 config_get - 获取应用配置

获取应用功能开关和设置。

**请求**：

```json
{
  "action": "config_get",
  "data": {}
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "config_get",
  "data": {
    "emotion_enabled": true,
    "reminder_enabled": true,
    "proactive_care": true,
    "proactive_interval_minutes": 30,
    "voice_enabled": false,
    "language": "zh-CN"
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| emotion_enabled | bool | 是否启用情绪表情 |
| reminder_enabled | bool | 是否启用提醒功能 |
| proactive_care | bool | 是否启用主动关怀 |
| proactive_interval_minutes | int | 主动关怀间隔（分钟） |
| voice_enabled | bool | 是否启用语音 |
| language | string | 语言设置 |

---

### 4.7 config_update - 更新应用配置

修改应用功能设置。

**请求**：

```json
{
  "action": "config_update",
  "data": {
    "emotion_enabled": true,
    "proactive_care": false,
    "language": "zh-CN"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "config_update",
  "data": {
    "emotion_enabled": true,
    "reminder_enabled": true,
    "proactive_care": false,
    "proactive_interval_minutes": 30,
    "voice_enabled": false,
    "language": "zh-CN"
  }
}
```

---

### 4.8 emotion_get - 获取情绪状态

获取桌宠当前的情绪状态。

**请求**：

```json
{
  "action": "emotion_get",
  "data": {}
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "emotion_get",
  "data": {
    "pet_id": "pet_001",
    "emotion": "joy",
    "joy": 65,
    "anger": 50,
    "sadness": 40,
    "disgust": 50,
    "surprise": 55,
    "fear": 50,
    "description": "开心"
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| pet_id | string | 桌宠ID |
| emotion | string | 主要情绪标签 |
| joy | int | 快乐值 0-100 |
| anger | int | 愤怒值 0-100 |
| sadness | int | 悲伤值 0-100 |
| disgust | int | 厌恶值 0-100 |
| surprise | int | 惊讶值 0-100 |
| fear | int | 恐惧值 0-100 |
| description | string | 情绪中文描述 |

---

### 4.9 health_check - 健康检查

检查服务健康状态和连接状态。

**请求**：

```json
{
  "action": "health_check",
  "data": {}
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "health_check",
  "data": {
    "status": "ok",
    "timestamp": 1712610000
  }
}
```

---

### 4.10 memory_search - 搜索记忆

搜索桌宠的记忆列表，支持按关键词、类型、权重过滤。

**请求**：

```json
{
  "action": "memory_search",
  "data": {
    "character_id": "pet_001",
    "keyword": "喜欢",
    "type": "preference",
    "min_weight": 60,
    "limit": 20,
    "offset": 0
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "memory_search",
  "data": {
    "memories": [
      {
        "id": 1,
        "type": "preference",
        "weight": 75,
        "content": "用户喜欢听古典音乐",
        "created_at": "2024-01-15T10:30:00Z"
      }
    ],
    "total": 15,
    "has_more": true
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| character_id | string | 是 | 角色ID |
| keyword | string | 否 | 关键词搜索（不区分大小写） |
| type | string | 否 | 记忆类型：`conversation`(对话) / `preference`(偏好) / `fact`(事实) |
| min_weight | int | 否 | 最低权重过滤（0-100） |
| limit | int | 否 | 返回条数限制，默认 20 |
| offset | int | 否 | 翻页偏移，默认 0 |

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| memories | array | 记忆列表，按权重从高到低排序 |
| memories[].id | int | 记忆ID |
| memories[].type | string | 记忆类型 |
| memories[].weight | int | 权重 0-100 |
| memories[].content | string | 记忆内容摘要 |
| memories[].created_at | string | 创建时间（ISO 8601） |
| total | int | 符合条件的总数量 |
| has_more | bool | 是否有更多数据 |

---

### 4.11 conversation_list - 对话历史

获取指定角色的对话历史记录。

**请求**：

```json
{
  "action": "conversation_list",
  "data": {
    "character_id": "pet_001",
    "limit": 50,
    "offset": 0
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "conversation_list",
  "data": {
    "conversations": [
      {
        "id": 1,
        "role": "user",
        "content": "你好呀",
        "timestamp": "2024-01-15T10:30:00Z",
        "compressed": false
      },
      {
        "id": 2,
        "role": "pet",
        "content": "你好！今天心情怎么样？",
        "timestamp": "2024-01-15T10:30:05Z",
        "compressed": false
      }
    ],
    "total": 100,
    "has_more": true
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| character_id | string | 是 | 角色ID |
| limit | int | 否 | 返回条数限制，默认 50 |
| offset | int | 否 | 翻页偏移，默认 0 |

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| conversations | array | 对话列表，按时间倒序（新的在前） |
| conversations[].id | int | 对话ID |
| conversations[].role | string | 角色：`user`(用户) / `pet`(宠物) |
| conversations[].content | string | 对话内容 |
| conversations[].timestamp | string | 对话时间（ISO 8601） |
| conversations[].compressed | bool | 是否已压缩（已压缩的对话会被合并为记忆） |
| total | int | 对话总数量（含已压缩） |
| has_more | bool | 是否有更多数据 |

---

### 4.12 model_list_get - 获取模型列表

获取 picoclaw 配置的所有模型列表。API Key 已掩码显示。

**请求**：

```json
{
  "action": "model_list_get",
  "data": {}
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "model_list_get",
  "data": {
    "models": [
      {
        "index": 0,
        "model_name": "gpt-4",
        "model": "openai/gpt-4",
        "api_base": "https://api.openai.com/v1",
        "api_key": "sk-****abcd",
        "proxy": "",
        "auth_method": "",
        "connect_mode": "",
        "workspace": "",
        "rpm": 60,
        "max_tokens_field": "",
        "request_timeout": 120,
        "thinking_level": "off",
        "extra_body": {},
        "enabled": true,
        "is_default": true,
        "is_virtual": false
      }
    ],
    "total": 1,
    "default_model": "gpt-4"
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| models | array | 模型列表 |
| models[].index | int | 模型索引（用于定位更新/删除） |
| models[].model_name | string | 模型别名/名称 |
| models[].model | string | 模型标识（如 `openai/gpt-4`） |
| models[].api_base | string | API 端点地址 |
| models[].api_key | string | API Key（掩码显示） |
| models[].proxy | string | 代理地址 |
| models[].auth_method | string | 认证方式 |
| models[].connect_mode | string | 连接模式（stdio/grpc） |
| models[].workspace | string | 工作区路径 |
| models[].rpm | int | 每分钟请求限制 |
| models[].max_tokens_field | string | max_tokens 字段名 |
| models[].request_timeout | int | 请求超时（秒） |
| models[].thinking_level | string | 思考级别（off/low/medium/high/xhigh/adaptive） |
| models[].extra_body | object | 额外的请求体字段 |
| models[].enabled | bool | 是否启用 |
| models[].is_default | bool | 是否为默认模型 |
| models[].is_virtual | bool | 是否为虚拟模型（多 key 展开生成） |
| total | int | 模型总数 |
| default_model | string | 当前默认模型名称 |

**API Key 掩码规则**：

| 原始 Key 长度 | 掩码示例 |
|---------------|----------|
| ≤8 字符 | `****` |
| 9-12 字符 | `sk-****89` |
| >12 字符 | `sk-****abcd` |

---

### 4.13 model_add - 添加模型

添加新的模型配置到 picoclaw。

**请求**：

```json
{
  "action": "model_add",
  "data": {
    "model_name": "my-gpt",
    "model": "openai/gpt-4o-mini",
    "api_key": "sk-xxxxx",
    "api_base": "https://api.openai.com/v1",
    "proxy": "",
    "auth_method": "bearer",
    "rpm": 60
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "model_add",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model_name | string | 是 | 模型别名（唯一标识） |
| model | string | 是 | 模型标识（如 `openai/gpt-4o-mini`） |
| api_key | string | 否 | API Key |
| api_base | string | 否 | API 端点地址 |
| proxy | string | 否 | 代理地址 |
| auth_method | string | 否 | 认证方式 |
| connect_mode | string | 否 | 连接模式（stdio/grpc） |
| workspace | string | 否 | 工作区路径（CLI 模式用） |
| rpm | int | 否 | 每分钟请求限制 |
| max_tokens_field | string | 否 | max_tokens 字段名 |
| request_timeout | int | 否 | 请求超时（秒） |
| thinking_level | string | 否 | 思考级别 |
| extra_body | object | 否 | 额外的请求体字段 |

---

### 4.14 model_update - 更新模型

更新指定模型的配置。按 `model_name` 定位模型。

**请求**：

```json
{
  "action": "model_update",
  "data": {
    "model_name": "my-gpt",
    "new_model": "openai/gpt-4o",
    "api_base": "https://api.openai.com/v1",
    "rpm": 100
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "model_update",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model_name | string | 是 | 要更新的模型名称 |
| new_model | string | 否 | 新的模型标识 |
| api_key | string | 否 | 新的 API Key（不传则保留原值） |
| api_base | string | 否 | 新的 API 端点 |
| proxy | string | 否 | 新的代理地址 |
| auth_method | string | 否 | 新的认证方式 |
| connect_mode | string | 否 | 新的连接模式 |
| workspace | string | 否 | 新的工作区路径 |
| rpm | int | 否 | 新的 RPM 限制 |
| max_tokens_field | string | 否 | 新的 max_tokens 字段名 |
| request_timeout | int | 否 | 新的请求超时 |
| thinking_level | string | 否 | 新的思考级别 |
| extra_body | object | 否 | 新的额外请求体字段 |

**注意**：`api_key` 为空字符串时不更新密钥，为 `null` 时清除密钥。

---

### 4.15 model_delete - 删除模型

删除指定的模型配置。

**请求**：

```json
{
  "action": "model_delete",
  "data": {
    "model_name": "my-gpt"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "model_delete",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model_name | string | 是 | 要删除的模型名称 |

**注意**：如果删除的是默认模型，会自动清除默认设置。

---

### 4.16 model_set_default - 设置默认模型

设置默认使用的模型。

**请求**：

```json
{
  "action": "model_set_default",
  "data": {
    "model_name": "my-gpt"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "model_set_default",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model_name | string | 是 | 要设为默认的模型名称 |

**注意**：虚拟模型（多 key 展开生成）不能设为默认。

---

### 4.17 cron_add - 添加定时任务

添加一个新的定时任务。任务触发时会通过 pet channel 发送消息，如果 `voice_enabled` 启用则同时触发语音合成。

**请求**：

```json
{
  "action": "cron_add",
  "data": {
    "name": "开会提醒",
    "message": "10分钟后要开会了",
    "at_seconds": 600
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "cron_add",
  "data": {
    "job_id": "abc123def456",
    "name": "开会提醒"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 任务名称 |
| message | string | 是 | 触发时发送的消息内容 |
| at_seconds | int | 否 | 一次性任务：从现在起多少秒后触发（与 every_seconds/cron_expr 互斥） |
| every_seconds | int | 否 | 周期性任务：每多少秒执行一次（与 at_seconds/cron_expr 互斥） |
| cron_expr | string | 否 | Cron 表达式：如 `"0 9 * * *"` 表示每天 9 点执行（与 at_seconds/every_seconds 互斥） |

**任务类型说明**：

| 类型 | 字段 | 示例 | 说明 |
|------|------|------|------|
| 一次性 | `at_seconds` | `600` | 600 秒后执行一次，然后自动删除 |
| 周期性 | `every_seconds` | `3600` | 每 3600 秒（1 小时）执行一次 |
| Cron | `cron_expr` | `"0 9 * * *"` | 每天 9:00 执行 |

---

### 4.18 cron_list - 列出定时任务

获取所有定时任务列表。

**请求**：

```json
{
  "action": "cron_list",
  "data": {
    "include_disabled": false
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "cron_list",
  "data": {
    "jobs": [
      {
        "id": "abc123def456",
        "name": "开会提醒",
        "enabled": true,
        "schedule_kind": "at",
        "at_ms": 1713001234567,
        "message": "10分钟后要开会了",
        "channel": "pet",
        "to": "default",
        "next_run_at_ms": 1713001234567,
        "last_run_at_ms": null,
        "last_status": "",
        "created_at_ms": 1713000634567
      },
      {
        "id": "xyz789ghi012",
        "name": "每小时提醒",
        "enabled": true,
        "schedule_kind": "every",
        "every_ms": 3600000,
        "message": "站起来活动一下吧",
        "channel": "pet",
        "to": "default",
        "next_run_at_ms": 1713004234567,
        "last_run_at_ms": 1713000634567,
        "last_status": "ok",
        "created_at_ms": 1713000634567
      }
    ]
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| include_disabled | bool | 否 | 是否包含已禁用的任务，默认 false |

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| jobs | array | 任务列表 |
| jobs[].id | string | 任务ID |
| jobs[].name | string | 任务名称 |
| jobs[].enabled | bool | 是否启用 |
| jobs[].schedule_kind | string | 调度类型：`at`(一次性) / `every`(周期性) / `cron`(Cron 表达式) |
| jobs[].at_ms | int | 一次性任务触发时间戳（毫秒） |
| jobs[].every_ms | int | 周期性任务间隔（毫秒） |
| jobs[].cron_expr | string | Cron 表达式 |
| jobs[].message | string | 触发时发送的消息 |
| jobs[].channel | string | 目标渠道（通常为 `pet`） |
| jobs[].to | string | 目标接收者（session ID） |
| jobs[].next_run_at_ms | int | 下次触发时间戳（毫秒） |
| jobs[].last_run_at_ms | int | 上次触发时间戳（毫秒） |
| jobs[].last_status | string | 上次执行状态：`ok` / `error` |
| jobs[].created_at_ms | int | 创建时间戳（毫秒） |

---

### 4.19 cron_remove - 删除定时任务

删除指定的定时任务。

**请求**：

```json
{
  "action": "cron_remove",
  "data": {
    "job_id": "abc123def456"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "cron_remove",
  "data": {
    "job_id": "abc123def456"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| job_id | string | 是 | 要删除的任务ID |

**错误**：`job xxx not found` - 任务不存在

---

### 4.20 cron_enable - 启用定时任务

启用指定的定时任务。

**请求**：

```json
{
  "action": "cron_enable",
  "data": {
    "job_id": "abc123def456"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "cron_enable",
  "data": {
    "job_id": "abc123def456",
    "enabled": true
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| job_id | string | 是 | 要启用的任务ID |

**错误**：`job xxx not found` - 任务不存在

---

### 4.21 cron_disable - 禁用定时任务

禁用指定的定时任务。

**请求**：

```json
{
  "action": "cron_disable",
  "data": {
    "job_id": "abc123def456"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "cron_disable",
  "data": {
    "job_id": "abc123def456",
    "enabled": false
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| job_id | string | 是 | 要禁用的任务ID |

**错误**：`job xxx not found` - 任务不存在

---

### 4.22 voice_model_list_get - 获取语音模型列表

获取所有语音模型配置（含预设供应商）。API Key 已掩码显示。

**请求**：

```json
{
  "action": "voice_model_list_get",
  "data": {}
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "voice_model_list_get",
  "data": {
    "models": [
      {
        "name": "minimax",
        "provider": "minimax",
        "api_base": "https://api.minimaxi.com/v1/t2a_v2",
        "model": "speech-2.8-hd",
        "voice_id": "",
        "api_key": "",
        "extra": {},
        "enabled": false,
        "is_default": false
      },
      {
        "name": "doubao",
        "provider": "doubao",
        "api_base": "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
        "model": "seed-tts-2.0-expressive",
        "voice_id": "",
        "api_key": "",
        "extra": {
          "accessKeyId": "",
          "secretAccessKey": "",
          "accessToken": "",
          "appId": "",
          "resourceId": "seed-tts-2.0"
        },
        "enabled": false,
        "is_default": false
      }
    ],
    "default": ""
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| models | array | 语音模型列表 |
| models[].name | string | 模型标识名称 |
| models[].provider | string | 供应商类型：`minimax` / `doubao` |
| models[].api_base | string | API 地址 |
| models[].model | string | 实际使用的模型 ID（如 `speech-2.8-hd`、`seed-tts-2.0-expressive`） |
| models[].voice_id | string | 音色 ID（未选则为空） |
| models[].api_key | string | API Key（已配置显示 `******`，未配置显示空） |
| models[].extra | object | 供应商特定参数 |
| models[].extra.accessKeyId | string | 豆包 AccessKeyId（敏感，已配置显示 `******`） |
| models[].extra.secretAccessKey | string | 豆包 SecretAccessKey（敏感，已配置显示 `******`） |
| models[].extra.accessToken | string | 豆包 AccessToken（敏感，已配置显示 `******`） |
| models[].extra.appId | string | 豆包 AppId（敏感，已配置显示 `******`） |
| models[].extra.resourceId | string | 豆包资源ID，如 `seed-tts-2.0`（非敏感字段，不掩码） |
| models[].enabled | bool | 是否启用 |
| models[].is_default | bool | 是否为默认模型 |
| default | string | 当前默认模型名称 |

**预设供应商**：

| 供应商 | API Base | 默认 Model | 说明 |
|--------|----------|------------|------|
| minimax | `https://api.minimaxi.com/v1/t2a_v2` | `speech-2.8-hd` | MiniMax TTS |
| doubao | `https://openspeech.bytedance.com/api/v3/tts/unidirectional` | `seed-tts-2.0-expressive` | 豆包 TTS V3 |

---

### 4.23 voice_model_get - 获取语音模型详情

获取指定语音模型的详细配置。

**请求**：

```json
{
  "action": "voice_model_get",
  "data": {
    "name": "minimax"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "voice_model_get",
  "data": {
    "name": "minimax",
    "provider": "minimax",
    "api_base": "https://api.minimaxi.com/v1/t2a_v2",
    "model": "speech-2.8-hd",
    "voice_id": "male-qn-qingse",
    "api_key": "******",
    "extra": {},
    "enabled": true,
    "is_default": true
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 模型名称 |

**错误**：`voice model xxx not found` - 模型不存在

---

### 4.24 voice_model_get_voices - 获取供应商可用音色

查询指定供应商的可用音色列表。如果不提供凭证，优先使用配置中存储的凭证。

**请求**：

```json
{
  "action": "voice_model_get_voices",
  "data": {
    "provider": "doubao",
    "model": "seed-tts-2.0",
    "api_key": "accessKeyId（可选，不提供则从配置获取）",
    "secret_key": "secretAccessKey（可选，不提供则从配置获取）"
  }
}
```

**说明**：
- `provider`：供应商名称（`minimax` / `doubao`），必填
- `model`：资源ID，如 `seed-tts-2.0`，可选，不提供则使用配置中的值
- `api_key`：供应商凭证，可选，不提供则从配置中获取
- `secret_key`：供应商凭证，可选，不提供则从配置中获取

**响应（豆包）**：

```json
{
  "status": "ok",
  "action": "voice_model_get_voices",
  "data": {
    "provider": "doubao",
    "volcengine_voices": [
      {
        "VoiceType": "zh_female_tianmeitaozi_mars_bigtts",
        "Name": "甜美桃子",
        "Gender": "女",
        "Age": "青年",
        "Description": "温柔的知心姐姐",
        "Language": "zh-cn",
        "Emotion": "normal"
      }
    ]
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| provider | string | 是 | 供应商类型：`minimax` / `doubao` |
| model | string | 否 | 模型版本（如 `seed-tts-2.0`），不提供则使用配置中的值 |
| api_key | string | 否 | API Key / AccessKeyId，不提供则从配置获取 |
| secret_key | string | 否 | Secret Key / SecretAccessKey，不提供则从配置获取 |

**凭证配置**：

豆包供应商需要在模型配置的 `extra` 字段中存储以下凭证，`model` 字段已使用 `VoiceModelConfig.model`：

| 字段 | 说明 |
|------|------|
| accessKeyId | HMAC 签名用的 AccessKeyId（用于获取音色列表） |
| secretAccessKey | HMAC 签名用的 SecretAccessKey |
| accessToken | 语音合成用的 Access Token |
| appId | 语音合成用的 AppId |

**错误**：`access_key_id is required` - 未提供凭证且配置中也没有存储

---

### 4.25 voice_model_update - 更新语音模型配置

更新指定语音模型的配置。

**请求**：

```json
{
  "action": "voice_model_update",
  "data": {
    "name": "minimax",
    "api_key": "用户的真实API Key",
    "voice_id": "male-qn-qingse",
    "extra": {
      "some_param": "value"
    }
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "voice_model_update",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 模型名称 |
| api_key | string | 否 | API Key |
| api_base | string | 否 | API 地址 |
| model | string | 否 | 模型 ID（如 `seed-tts-2.0-expressive`） |
| voice_id | string | 否 | 音色 ID |
| enabled | bool | 否 | 是否启用 |
| extra | object | 否 | 供应商特定参数 |

**extra 字段说明（豆包）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| extra.accessKeyId | string | 豆包 AccessKeyId（敏感） |
| extra.secretAccessKey | string | 豆包 SecretAccessKey（敏感） |
| extra.accessToken | string | 豆包 AccessToken（敏感） |
| extra.appId | string | 豆包 AppId（敏感） |
| extra.resourceId | string | 豆包资源ID，如 `seed-tts-2.0`（决定计费和模型版本） |

**注意**：
- `api_key` 和 `extra` 中的敏感信息以明文保存（用于实际调用），返回给前端时会脱敏
- 只有非空字段才会更新，空字符串字段保持原值

**热切换说明**：
- 当 `api_key`、`extra`、`model` 或 `voice_id` 变更时，会自动重新创建 TTS provider
- 确保配置变更立即生效，无需重启服务
- 正在进行的语音合成请求会使用旧的 provider 完成

**错误**：`voice model xxx not found` - 模型不存在

---

### 4.26 voice_model_set_default - 设置默认语音模型

设置默认使用的语音模型（热切换）。

**请求**：

```json
{
  "action": "voice_model_set_default",
  "data": {
    "name": "minimax"
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "voice_model_set_default",
  "data": {
    "status": "ok"
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 模型名称 |

**热切换说明**：
- 等待当前语音合成请求完成后切换
- 自动启用目标模型
- 更新 `default_model` 配置

**错误**：`voice model xxx not found` - 模型不存在

---

## 五、错误码

### 5.1 WebSocket 错误 (status: error)

| error | 说明 | 可能原因 |
|-------|------|----------|
| `invalid chat data` | 无效的聊天数据 | data 字段 JSON 格式错误或缺少必填字段 |
| `invalid onboarding config data` | 无效的配置数据 | 配置数据格式错误 |
| `invalid character data` | 无效的角色数据 | 角色数据格式错误 |
| `invalid config data` | 无效的配置数据 | 应用配置数据格式错误 |
| `invalid request data` | 无效的请求数据 | 请求数据 JSON 格式错误 |
| `unknown action: xxx` | 未知操作 | 发送了未定义的 action |
| `character store not available` | 角色存储不可用 | 服务未正确初始化 |
| `model config manager not available` | 模型配置不可用 | 服务未正确初始化 |
| `model_name is required` | 模型名称必填 | 缺少 model_name 字段 |
| `model is required` | 模型标识必填 | 添加模型时缺少 model 字段 |
| `model not found` | 模型不存在 | 要更新/删除/设置的模型不存在 |
| `cannot set virtual model as default` | 不能设虚拟模型为默认 | 虚拟模型由多 key 展开生成，不能设为默认 |
| `cron service not initialized` | Cron 服务未初始化 | 服务未正确初始化 |
| `name is required` | 任务名称必填 | 添加任务时缺少 name 字段 |
| `message is required` | 消息内容必填 | 添加任务时缺少 message 字段 |
| `one of at_seconds, every_seconds, or cron_expr is required` | 调度参数必填 | 需要指定 at_seconds、every_seconds 或 cron_expr 之一 |
| `job_id is required` | 任务ID必填 | 操作任务时缺少 job_id 字段 |
| `job xxx not found` | 任务不存在 | 要操作的任务不存在 |
| `voice model xxx not found` | 语音模型不存在 | 要更新/设置/获取的语音模型不存在 |
| `unsupported provider: xxx` | 不支持的供应商 | 供应商类型不是 `minimax` 或 `doubao` |
| `provider is required` | 供应商必填 | 查询音色时缺少 provider 字段 |
| `api_key is required` | API Key 必填 | 查询音色时缺少 api_key 字段 |

### 5.2 错误响应示例

```json
{
  "status": "error",
  "action": "chat",
  "data": {
    "error": "invalid chat data"
  }
}
```

---

## 六、客户端示例

### 6.1 JavaScript 客户端示例

```javascript
const ws = new WebSocket('ws://localhost:8080/ws?session=user_001');

ws.onopen = function() {
  console.log('Connected to Pet Channel');
};

ws.onmessage = function(event) {
  const msg = JSON.parse(event.data);

  // 处理 init_status 推送
  if (msg.push_type === 'init_status') {
    console.log('Init status:', msg.data);
    if (msg.data.need_config) {
      showOnboardingUI();
    } else {
      showChatUI();
    }
    return;
  }

  // 处理 AI 聊天流式推送
  if (msg.push_type === 'ai_chat') {
    const data = msg.data;
    if (data.type === 'text') {
      appendToChat(data.text);
    } else if (data.type === 'final') {
      finishChat();
    }
    return;
  }

  // 处理情绪变化推送
  if (msg.push_type === 'emotion_change') {
    updateEmotionDisplay(msg.data.emotion, msg.data.score);
    return;
  }

  // 处理动作触发推送
  if (msg.push_type === 'action_trigger') {
    playAction(msg.data.action);
    return;
  }

  // 处理角色切换推送
  if (msg.push_type === 'character_switch') {
    console.log('Character switched to:', msg.data.character_id);
    reloadCharacter(msg.data.character_id);
    return;
  }

  // 处理语音音频推送
  if (msg.push_type === 'ai_audio') {
    const data = msg.data;
    if (data.type === 'audio' && data.text) {
      const audioData = base64ToArrayBuffer(data.text);
      playAudioChunk(audioData);
    } else if (data.type === 'error') {
      console.error('Audio error:', data.text);
    }
    return;
  }

  // 处理心跳
  if (msg.push_type === 'heartbeat') {
    console.log('Heartbeat:', msg.data.timestamp);
    return;
  }
};

ws.onclose = function() {
  console.log('Disconnected');
  setTimeout(reconnect, 5000);
};
```

### 6.2 Python 客户端示例

```python
import asyncio
import websockets
import json

async def client():
    uri = "ws://localhost:8080/ws?session=user_001"
    async with websockets.connect(uri) as ws:
        while True:
            msg = await ws.recv()
            data = json.loads(msg)

            if data.get('push_type') == 'init_status':
                if data['data']['need_config']:
                    print("需要初始化配置")
                else:
                    print("已初始化，可以聊天")
                    await send_chat(ws, "你好")

            elif data.get('push_type') == 'ai_chat':
                chat_data = data.get('data', {})
                if chat_data.get('type') == 'text':
                    print(chat_data['text'], end='', flush=True)
                elif chat_data.get('type') == 'final':
                    print()

            elif data.get('push_type') == 'emotion_change':
                print(f"\n情绪: {data['data']['emotion']}")

            elif data.get('push_type') == 'action_trigger':
                print(f"\n动作: {data['data']['action']}")

            elif data.get('push_type') == 'character_switch':
                print(f"\n角色切换: {data['data']['character_id']}")

            elif data.get('push_type') == 'ai_audio':
                audio_data = data.get('data', {})
                if audio_data.get('type') == 'audio' and audio_data.get('text'):
                    audio_bytes = base64.b64decode(audio_data['text'])
                    play_audio_chunk(audio_bytes)
                elif audio_data.get('type') == 'error':
                    print(f"\n音频错误: {audio_data['text']}")

async def send_chat(ws, text):
    await ws.send(json.dumps({
        "action": "chat",
        "data": {"text": text, "session_key": "test"}
    }))
```

---

## 七、快速索引

### 7.1 action 快速索引

| action | 功能 | 用途 |
|--------|------|------|
| chat | 聊天交互 | 发送消息，获得 AI 回复（流式） |
| audio_done | 音频播放完毕 | 通知后端当前音频片段已播放完毕 |
| onboarding_config | 提交初始化配置 | 首次启动时提交配置 |
| user_profile_update | 更新用户画像 | 提交用户信息（昵称、角色、作息等），用于 LLM 上下文 |
| character_get | 获取角色配置 | 查看当前角色 |
| character_update | 更新角色配置 | 修改角色设置 |
| character_switch | 切换角色 | 切换当前激活的角色 |
| config_get | 获取应用配置 | 查看应用设置 |
| config_update | 更新应用配置 | 修改应用设置 |
| emotion_get | 获取情绪状态 | 查看当前情绪 |
| health_check | 健康检查 | 检测连接状态 |
| memory_search | 搜索记忆 | 搜索记忆列表（支持关键词、类型、权重过滤） |
| conversation_list | 对话历史 | 获取对话历史记录 |
| model_list_get | 获取模型列表 | 查看所有已配置的模型 |
| model_add | 添加模型 | 新增模型配置 |
| model_update | 更新模型 | 修改已有模型配置 |
| model_delete | 删除模型 | 删除模型配置 |
| model_set_default | 设置默认模型 | 将某模型设为默认 |
| cron_add | 添加定时任务 | 创建新的定时任务 |
| cron_list | 列出定时任务 | 查看所有定时任务 |
| cron_remove | 删除定时任务 | 删除指定的定时任务 |
| cron_enable | 启用定时任务 | 启用指定的定时任务 |
| cron_disable | 禁用定时任务 | 禁用指定的定时任务 |
| voice_model_list_get | 获取语音模型列表 | 查看所有语音模型（含预设供应商） |
| voice_model_get | 获取语音模型详情 | 查看指定模型的详细配置 |
| voice_model_get_voices | 获取可用音色 | 查询供应商的音色列表 |
| voice_model_update | 更新语音模型 | 修改模型的配置（API Key、音色等） |
| voice_model_set_default | 设置默认语音模型 | 热切换到指定模型 |

### 7.2 push_type 快速索引

| push_type | 触发时机 | 用途 |
|-----------|----------|------|
| init_status | 连接建立时 | 推送初始化状态，是否需要配置 |
| ai_chat | AI 回复时 | 流式推送 AI 回复文本 |
| emotion_change | 情绪变化时 | 推送情绪状态更新 |
| action_trigger | LLM 解析到动作时 | 推送动作触发 |
| character_switch | 角色切换后 | 推送切换后的角色ID |
| audio_and_voice | 语音流式合成 | 流式推送语音音频片段，按顺序播放 |
| heartbeat | 每 30 秒 | 保活检测 |

---

## 八、注意事项

1. **连接初始化**：连接建立后先等待 `init_status` 推送，根据 `need_config` 判断是否需要初始化。

2. **流式输出**：AI 回复通过 `ai_chat` 流式推送，前端应逐块追加显示，直到收到 `type: "final"`。

3. **情绪衰减**：情绪会每 5 秒自动衰减回归中性，变化幅度过大时推送 `emotion_change`。

4. **动作触发**：LLM 在回复中输出 `[action:xxx]` 标签时，后端自动解析并推送 `action_trigger`。

5. **错误处理**：收到 `status: error` 时，检查 `error` 字段获取具体错误信息。
