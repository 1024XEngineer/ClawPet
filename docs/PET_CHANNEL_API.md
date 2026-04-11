# Pet Channel API 接口文档

> 版本：v2.1  
> 日期：2026-04-11  
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

AI 回复时推送，支持流式输出和语音合成。

#### 3.2.1 文本推送

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

#### 3.2.2 语音推送（voice）

当语音功能启用时，后端会自动将文本转换为语音并推送。

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {
    "chat_id": 1,
    "type": "voice",
    "text": "你好呀",
    "hex_audio": "c2VjcmV0YW5kcm9pZA==...",
    "is_final": false
  },
  "timestamp": 1712610000,
  "is_final": false
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| chat_id | int | 聊天块序号，逐块递增 |
| type | string | 内容类型：`text`=文本块, `voice`=语音块, `final`=结束标记 |
| text | string | AI 回复文本 |
| hex_audio | string | hex 编码的 MP3 音频数据 |
| emotion | string | 当前情绪标签（voice 类型时） |
| is_final | bool | 是否为最终块 |

#### 3.2.3 结束推送（final）

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

#### 3.2.4 错误推送（error）

语音合成失败时推送。

```json
{
  "type": "push",
  "push_type": "ai_chat",
  "data": {
    "chat_id": 1,
    "type": "error",
    "message": "语音合成失败: API error"
  },
  "timestamp": 1712610000,
  "is_final": true
}
```

**前端处理逻辑**：
1. 收到 `type: "text"` 时，将 text 追加显示到聊天界面
2. 收到 `type: "voice"` 时，先显示 text，再播放 hex_audio 音频
3. 收到 `type: "final"` 时，清除当前对话状态
4. 收到 `type: "error"` 时，显示错误提示

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

## 四、请求接口

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

### 4.3 character_get - 获取角色配置

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

### 4.5 config_get - 获取应用配置

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

### 4.6 config_update - 更新应用配置

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

### 4.7 emotion_get - 获取情绪状态

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

### 4.8 health_check - 健康检查

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

### 4.9 voice_toggle - 语音开关

运行时动态开关语音功能。

**请求**：

```json
{
  "action": "voice_toggle",
  "data": {
    "enabled": true
  }
}
```

**响应**：

```json
{
  "status": "ok",
  "action": "voice_toggle",
  "data": {
    "voice_enabled": true
  }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enabled | bool | 是 | true=开启语音, false=关闭语音 |

---

## 五、错误码

### 5.1 WebSocket 错误 (status: error)

| error | 说明 | 可能原因 |
|-------|------|----------|
| `invalid chat data` | 无效的聊天数据 | data 字段 JSON 格式错误或缺少必填字段 |
| `invalid onboarding config data` | 无效的配置数据 | 配置数据格式错误 |
| `invalid character data` | 无效的角色数据 | 角色数据格式错误 |
| `invalid config data` | 无效的配置数据 | 应用配置数据格式错误 |
| `unknown action: xxx` | 未知操作 | 发送了未定义的 action |
| `character store not available` | 角色存储不可用 | 服务未正确初始化 |

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
| onboarding_config | 提交初始化配置 | 首次启动时提交配置 |
| character_get | 获取角色配置 | 查看当前角色 |
| character_update | 更新角色配置 | 修改角色设置 |
| config_get | 获取应用配置 | 查看应用设置 |
| config_update | 更新应用配置 | 修改应用设置 |
| emotion_get | 获取情绪状态 | 查看当前情绪 |
| health_check | 健康检查 | 检测连接状态 |
| voice_toggle | 语音开关 | 动态开关语音功能 |

### 7.2 push_type 快速索引

| push_type | 触发时机 | 用途 |
|-----------|----------|------|
| init_status | 连接建立时 | 推送初始化状态，是否需要配置 |
| ai_chat | AI 回复时 | 流式推送 AI 回复文本/语音 |
| emotion_change | 情绪变化时 | 推送情绪状态更新 |
| action_trigger | LLM 解析到动作时 | 推送动作触发 |
| heartbeat | 每 30 秒 | 保活检测 |

---

## 八、注意事项

1. **连接初始化**：连接建立后先等待 `init_status` 推送，根据 `need_config` 判断是否需要初始化。

2. **流式输出**：AI 回复通过 `ai_chat` 流式推送，前端应逐块追加显示，直到收到 `type: "final"`。

3. **情绪衰减**：情绪会每 5 秒自动衰减回归中性，变化幅度过大时推送 `emotion_change`。

4. **动作触发**：LLM 在回复中输出 `[action:xxx]` 标签时，后端自动解析并推送 `action_trigger`。

5. **错误处理**：收到 `status: error` 时，检查 `error` 字段获取具体错误信息。

6. **语音功能**：需要后端配置 TTS 提供商（支持 Minimax）。语音功能启用后，AI 回复会自动合成语音并通过 `type: "voice"` 推送。

---

## 九、语音功能配置

### 9.1 后端配置示例

```json
{
  "voice": {
    "enabled": true,
    "stream_enabled": true,
    "tts_model_name": "minimax-speech",
    "voice_id": "Chinese (Mandarin)_Lyrical_Voice"
  },
  "model_list": [
    {
      "model_name": "minimax-speech",
      "model": "minimax/speech-2.8-hd",
      "api_base": "https://api.minimaxi.com",
      "api_keys": ["your-minimax-api-key"]
    }
  ]
}
```

### 9.2 支持的 TTS 模型

| 模型 | 说明 |
|------|------|
| `speech-2.8-hd` | 高清语音，质量最好 |
| `speech-2.8-turbo` | 快速语音，延迟更低 |
| `speech-2.6-hd` | 高清语音 v2 |
| `speech-2.6-turbo` | 快速语音 v2 |
| `speech-02-hd` | 新版高清 |
| `speech-02-turbo` | 新版快速 |
| `speech-01-hd` | 新版高清 |
| `speech-01-turbo` | 新版快速 |

### 9.3 支持的中文音色

| voice_id | 说明 |
|----------|------|
| `Chinese (Mandarin)_Lyrical_Voice` | 中文抒情语音（推荐） |
| `Chinese (Mandarin)_HK_Flight_Attendant` | 香港航空乘务员音色 |
| `moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85` | 系统音色 |
| `moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d` | 系统音色 |

---

## 十、语音客户端示例

### 10.1 JavaScript 语音播放示例

```javascript
class PetVoicePlayer {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.currentSource = null;
  }

  // 将 hex 音频数据转换为 AudioBuffer 并播放
  async playHexAudio(hexAudio) {
    try {
      // 将 hex 转换为二进制数据
      const binaryString = atob(hexAudio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 解码为 AudioBuffer
      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);

      // 停止当前播放
      if (this.currentSource) {
        this.currentSource.stop();
      }

      // 创建播放源
      this.currentSource = this.audioContext.createBufferSource();
      this.currentSource.buffer = audioBuffer;
      this.currentSource.connect(this.audioContext.destination);
      this.currentSource.start();

      return audioBuffer.duration;
    } catch (error) {
      console.error('Audio playback error:', error);
      throw error;
    }
  }

  // 保存音频为文件
  saveAudioFile(hexAudio, filename = 'voice.mp3') {
    const binaryString = atob(hexAudio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 使用示例
const player = new PetVoicePlayer();

// WebSocket 消息处理
ws.onmessage = function(event) {
  const msg = JSON.parse(event.data);

  if (msg.push_type === 'ai_chat') {
    const data = msg.data;

    if (data.type === 'text') {
      // 显示文本
      appendToChat(data.text);
    } 
    else if (data.type === 'voice') {
      // 显示文本
      appendToChat(data.text);
      // 播放语音
      player.playHexAudio(data.hex_audio).catch(console.error);
    }
    else if (data.type === 'final') {
      finishChat();
    }
    else if (data.type === 'error') {
      showToast('语音错误: ' + data.message);
    }
  }
};
```

### 10.2 Python 语音播放示例

```python
import asyncio
import websockets
import json
import base64
import os
import pygame

class PetVoicePlayer:
    def __init__(self):
        pygame.mixer.init()
        self.current_sound = None

    def play_hex_audio(self, hex_audio):
        """播放 hex 编码的 MP3 音频"""
        try:
            # 将 hex 转换为二进制
            audio_data = bytes.fromhex(hex_audio)
            
            # 保存为临时文件
            temp_file = f"temp_voice_{int(asyncio.get_event_loop().time())}.mp3"
            with open(temp_file, "wb") as f:
                f.write(audio_data)
            
            # 播放
            pygame.mixer.music.load(temp_file)
            pygame.mixer.music.play()
            
            # 等待播放完成
            while pygame.mixer.music.get_busy():
                pygame.time.Clock().tick(10)
            
            # 清理临时文件
            os.remove(temp_file)
            
        except Exception as e:
            print(f"音频播放错误: {e}")

    def save_audio_file(self, hex_audio, filename="voice.mp3"):
        """保存音频为文件"""
        audio_data = bytes.fromhex(hex_audio)
        with open(filename, "wb") as f:
            f.write(audio_data)
        print(f"音频已保存: {filename}")

async def main():
    player = PetVoicePlayer()
    
    uri = "ws://localhost:8080/ws?session=test"
    async with websockets.connect(uri) as ws:
        # 开启语音
        await ws.send(json.dumps({
            "action": "voice_toggle",
            "data": {"enabled": True}
        }))
        
        # 接收消息
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            
            if data.get("push_type") == "ai_chat":
                chat_data = data.get("data", {})
                msg_type = chat_data.get("type")
                
                if msg_type == "text":
                    print(f"[文本] {chat_data.get('text')}")
                    
                elif msg_type == "voice":
                    text = chat_data.get("text", "")
                    hex_audio = chat_data.get("hex_audio", "")
                    print(f"[语音] {text}")
                    player.play_hex_audio(hex_audio)
                    
                elif msg_type == "final":
                    print("[结束]")
                    break
                    
                elif msg_type == "error":
                    print(f"[错误] {chat_data.get('message')}")

if __name__ == "__main__":
    asyncio.run(main())
```

### 10.3 Python WebSocket 语音客户端（完整版）

```python
#!/usr/bin/env python3
"""
Pet Channel WebSocket 语音客户端
支持语音接收、播放、保存
"""

import asyncio
import websockets
import json
import base64
import time
import hashlib
import os
import pygame

class PetVoiceClient:
    def __init__(self, host="localhost", port=8080, session="test"):
        self.uri = f"ws://{host}:{port}/ws?session={session}"
        self.ws = None
        self.session = session
        self.running = True
        self.voice_enabled = False
        self.audio_buffers = {}  # chat_id -> hex audio
        self.player = None
        
    def init_audio(self):
        """初始化音频播放器"""
        try:
            pygame.init()
            pygame.mixer.init()
            self.player = pygame.mixer
            print("[音频] 播放器初始化成功")
        except Exception as e:
            print(f"[音频] 播放器初始化失败: {e}")
            self.player = None
    
    async def connect(self):
        """连接 WebSocket"""
        print(f"[连接] {self.uri}")
        self.ws = await websockets.connect(self.uri)
        
        msg = await self.ws.recv()
        data = json.loads(msg)
        if data.get("push_type") == "init_status":
            char = data.get("data", {}).get("character", {})
            self.voice_enabled = data.get("data", {}).get("voice_enabled", False)
            print(f"[初始化] Pet: {char.get('pet_name', 'Unknown')}")
            print(f"[状态] voice_enabled={self.voice_enabled}")
        
        return True
    
    async def toggle_voice(self, enabled):
        """开关语音"""
        await self.ws.send(json.dumps({
            "action": "voice_toggle",
            "data": {"enabled": enabled}
        }))
        resp = await self.ws.recv()
        data = json.loads(resp)
        if data.get("status") == "ok":
            self.voice_enabled = data['data'].get('voice_enabled', enabled)
            print(f"[语音] {'开启' if self.voice_enabled else '关闭'}")
    
    async def receive_messages(self, timeout=120):
        """接收消息"""
        start_time = time.time()
        
        while time.time() - start_time < timeout and self.running:
            try:
                msg = await asyncio.wait_for(self.ws.recv(), timeout=5)
                data = json.loads(msg)
                
                if data.get("type") == "push":
                    push_type = data.get("push_type")
                    push_data = data.get("data", {})
                    
                    if push_type == "ai_chat":
                        chat_id = push_data.get("chat_id", 0)
                        msg_type = push_data.get("type")
                        
                        if msg_type == "text":
                            text = push_data.get("text", "")
                            print(f"[文本] {text}")
                            
                        elif msg_type == "voice":
                            text = push_data.get("text", "")
                            hex_audio = push_data.get("hex_audio", "")
                            is_final = push_data.get("is_final", False)
                            
                            print(f"[语音] chat_id={chat_id} text={text} size={len(hex_audio)}")
                            
                            # 收集音频片段
                            if chat_id not in self.audio_buffers:
                                self.audio_buffers[chat_id] = ""
                            self.audio_buffers[chat_id] += hex_audio
                            
                            # 收到最终块时播放
                            if is_final:
                                await self.play_audio(chat_id)
                                    
                        elif msg_type == "final":
                            emotion = push_data.get("emotion", "")
                            action = push_data.get("action", "")
                            print(f"[结束] emotion={emotion} action={action}")
                            return True
                            
                        elif msg_type == "error":
                            message = push_data.get("message", "")
                            print(f"[错误] {message}")
                            
                    elif push_type == "emotion_change":
                        print(f"[情绪] {push_data.get('emotion')} ({push_data.get('score')})")
                        
                    elif push_type == "action_trigger":
                        print(f"[动作] {push_data.get('action')}")
                        
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                print(f"[异常] {e}")
                
        return False
    
    async def play_audio(self, chat_id):
        """播放收集到的音频"""
        if chat_id not in self.audio_buffers or not self.audio_buffers[chat_id]:
            return
        
        hex_audio = self.audio_buffers[chat_id]
        del self.audio_buffers[chat_id]
        
        if not self.player:
            print("[警告] 音频播放器未初始化")
            return
        
        try:
            audio_data = bytes.fromhex(hex_audio)
            temp_file = f"temp_{chat_id}_{int(time.time())}.mp3"
            
            with open(temp_file, "wb") as f:
                f.write(audio_data)
            
            print(f"[播放] {temp_file} ({len(audio_data)} bytes)")
            
            self.player.music.load(temp_file)
            self.player.music.play()
            
            # 等待播放完成
            while self.player.music.get_busy():
                await asyncio.sleep(0.1)
            
            os.remove(temp_file)
            
        except Exception as e:
            print(f"[播放错误] {e}")
    
    async def save_audio(self, chat_id, filename=None):
        """保存音频为文件"""
        if chat_id not in self.audio_buffers:
            return
        
        hex_audio = self.audio_buffers[chat_id]
        
        if not filename:
            filename = f"voice_{chat_id}_{int(time.time())}.mp3"
        
        try:
            audio_data = bytes.fromhex(hex_audio)
            with open(filename, "wb") as f:
                f.write(audio_data)
            print(f"[保存] {filename} ({len(audio_data)} bytes)")
        except Exception as e:
            print(f"[保存错误] {e}")
    
    async def send_chat(self, text):
        """发送聊天消息"""
        request_id = hashlib.md5(str(time.time()).encode()).hexdigest()[:8]
        
        await self.ws.send(json.dumps({
            "action": "chat",
            "data": {
                "text": text,
                "session_key": f"pet:default:{self.session}"
            },
            "request_id": request_id
        }))
        print(f"[发送] {text}")
    
    async def close(self):
        """关闭连接"""
        self.running = False
        if self.ws:
            await self.ws.close()
        print("[断开]")


async def main():
    print("=" * 60)
    print("Pet Channel 语音客户端")
    print("=" * 60)
    
    client = PetVoiceClient(host="localhost", port=8080, session="test")
    
    try:
        await client.connect()
        client.init_audio()
        
        # 开启语音
        await client.toggle_voice(True)
        
        # 测试对话
        messages = ["你好", "你叫什么名字？"]
        
        for msg in messages:
            print(f"\n{'='*60}")
            print(f"测试: {msg}")
            print("="*60)
            
            await client.send_chat(msg)
            await client.receive_messages(timeout=60)
            
            await asyncio.sleep(1)
        
        print("\n测试完成！")
        
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 十一、依赖说明

### JavaScript 客户端

无需额外依赖，使用浏览器内置的 `AudioContext` 和 `atob`。

### Python 客户端

```bash
pip install websockets pygame
```

| 依赖 | 用途 |
|------|------|
| websockets | WebSocket 客户端 |
| pygame | 音频播放 |
