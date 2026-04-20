# PetClaw 语音接入说明

本文档说明当前仓库中“后端语音”是如何工作的，以及要真正启用语音还缺什么。

## 1. 当前语音链路

当前代码里的语音链路已经存在，路径如下：

1. `pet` 通道收到聊天请求
2. 后端生成文本回复
3. `PetChannel` 在文本流里触发语音合成
4. TTS provider 产生音频块
5. 后端通过 `push_type = "audio"` 推送给前端
6. `petclaw` 前端合并音频块并播放

关键代码：

- [channel.go](/D:/opencode/clawpet/GoClaw/pkg/channels/pet/channel.go)
- [sender.go](/D:/opencode/clawpet/GoClaw/pkg/pet/voice/sender.go)
- [synthesizer.go](/D:/opencode/clawpet/GoClaw/pkg/pet/voice/synthesizer.go)
- [loader.go](/D:/opencode/clawpet/GoClaw/pkg/pet/voice/loader.go)
- [minimax.go](/D:/opencode/clawpet/GoClaw/pkg/pet/voice/minimax.go)
- [use-chat.ts](/D:/opencode/clawpet/GoClaw/petclaw/hooks/use-chat.ts)

## 2. 前端其实已经接好了

前端不缺播放器。

在 [use-chat.ts](/D:/opencode/clawpet/GoClaw/petclaw/hooks/use-chat.ts) 中已经有：

- `audio` push 监听
- Base64 音频块解码
- 按 `chat_id` 聚合
- `is_final=true` 后合并播放
- Electron 小桌宠存在时，优先通过 `showBubble(..., audio)` 交给桌宠播放

也就是说，**当前语音没生效的主因不在前端播放层**。

## 3. 后端目前只支持一条 TTS 路径

从 [loader.go](/D:/opencode/clawpet/GoClaw/pkg/pet/voice/loader.go) 可以看到：

- 当前只支持 `MiniMax TTS`
- 通过 `newMinimaxTTS(...)` 创建 provider

也就是说，当前仓库的后端语音不是通用多 provider TTS，而是：

- `MinimaxTTS`
- 输出 `mp3`
- 通过 `audio` push 发给前端

## 4. 真正启用语音需要满足的条件

必须同时满足这 3 条：

1. `pet_config.json` 里 `app.voice_enabled = true`
2. `pet_config.json` 里 `voice.model_list` 至少有一个启用的语音模型
3. 该语音模型对应的 API key 能成功解析

当前你的运行配置是：

- `workspace/pet_config.json` 中 `voice.model_list = []`
- `voice.default_model = ""`
- `app.voice_enabled = false`

所以后端现在不会产出任何 `audio` push。

## 5. 当前配置为什么还不能发声

你当前仓库的运行配置文件：

- [pet_config.json](/D:/opencode/clawpet/GoClaw/.goclaw-runtime/workspace/pet_config.json)

里面是：

- 没有 voice model
- 没有默认 voice model
- `voice_enabled` 关闭

因此：

- `voiceLoader.GetProvider()` 最终拿不到可用 provider
- `PetChannel` 的 `voiceSynthesizer` 不会真正工作

## 6. 最小接入方案

如果你要启用后端语音，最小方案如下。

### 第一步：打开 app 级语音开关

在 `pet_config.json` 里把：

```json
"app": {
  "voice_enabled": true
}
```

### 第二步：配置一个语音模型

例如：

```json
"voice": {
  "default_model": "minimax-tts",
  "asr_enabled": false,
  "model_list": [
    {
      "name": "minimax-tts",
      "model": "speech-2.8-hd",
      "api_key": "$security:minimax-tts",
      "api_base": "https://api.minimaxi.com/v1/t2a_v2",
      "enabled": true
    }
  ]
}
```

### 第三步：在 `.security.yml` 中提供对应 key

当前 `loader.go` 的解析逻辑支持：

- `$security:minimax-tts`

因此 `.security.yml` 需要至少有：

```yaml
model_list:
  minimax-tts:
    api_keys:
      - YOUR_MINIMAX_TTS_API_KEY
```

## 7. 接入后的运行结果

配置正确后，预期行为是：

1. 前端发送 `chat`
2. 后端推送 `ai_chat`
3. 后端同时推送 `audio`
4. 前端合并 `audio` 块
5. 页面或桌宠播放语音

## 8. 当前建议

当前项目建议的处理顺序是：

1. 先固定只用 `pet channel`
2. 再启用 `voice_enabled`
3. 再补 `MiniMax TTS` 配置
4. 最后做 UI 开关

## 9. 现阶段结论

可以明确地说：

- `语音播放链路` 已经存在
- `pet channel` 已经承载语音推送
- `前端音频消费` 已经完成
- `当前不能发声` 的原因是 **缺少 TTS 模型配置与启用开关**

不是因为前端不会播，也不是因为 `pet channel` 不支持音频。

