# PR: 修复语音流式模式下 final 标志重复和情绪丢失问题

## 基本信息

- **分支**: `fix/voice-streaming-final`
- **目标分支**: `dev`
- **仓库**: `origin`（上游仓库）

## 问题描述

### 问题1: final 标志重复
当语音模式开启时，异步语音合成完成后会发送带有 `is_final=true` 的 audio chunk，但 `Finalize` 方法也会发送 final 标志，导致客户端收到两个 final 信号。

### 问题2: 语音关闭时仍执行语音合成
在 `Update` 方法中，当语音配置关闭时（`voiceEnabled=false`），`sendVoice()` 函数仍然会被调用并尝试执行 `voiceSynthesizer.ParseAndSynthesize`，导致无效的语音合成操作。

## 修复内容

### 修复1: 删除无效的 sendVoice 调用
当语音配置关闭时，不再调用 `sendVoice()` 函数进行语音合成，避免无效操作。

修改位置: `pkg/channels/pet/channel.go` - `Update` 方法

### 修复2: Finalize 中添加 voiceEnabled 判断
只有当语音关闭时才发送 final 标志（`if !s.voiceEnabled`）。语音开启时，由最后一个 audio chunk 发送 `is_final=true` 来表示结束。

修改位置: `pkg/channels/pet/channel.go` - `Finalize` 方法

### 修复3: audio chunk 中添加 emotion 字段
在 `sendAudioSegmentAsync` 方法中，audio chunk 发送时携带当前情绪状态，让客户端能够获取到正确的 emotion 信息。

修改位置: `pkg/channels/pet/channel.go` - `sendAudioSegmentAsync` 方法

## 测试建议

1. **语音模式开启测试**:
   - 发送 LLM 请求，验证只有 audio chunk 的最后一个包携带 `is_final=true`
   - 验证 audio chunk 中包含正确的 `emotion` 字段
   - 验证 `Finalize` 不再发送 final 标志

2. **语音模式关闭测试**:
   - 发送 LLM 请求，验证 `Finalize` 正常发送 final 标志
   - 验证不会有无效的语音合成操作

3. **情绪同步测试**:
   - 在对话过程中观察情绪变化
   - 验证 audio chunk 中的 emotion 与实际情绪状态一致

## 相关文件

- `pkg/channels/pet/channel.go`

## Diff

```diff
diff --git a/pkg/channels/pet/channel.go b/pkg/channels/pet/channel.go
--- a/pkg/channels/pet/channel.go
+++ b/pkg/channels/pet/channel.go
@@ -634,19 +634,6 @@ func (s *petStreamer) Update(ctx context.Context, content string) error {
 	// 语音关闭：使用原来的流式文本逻辑
 	s.voiceEnabled = false

-	sendVoice := func() {
-		if s.voiceSynthesizer != nil {
-			emotion := ""
-			if char := s.channel.service.CharManager().GetCurrent(); char != nil {
-				emotion, _ = char.GetEmotionEngine().GetDominantEmotion()
-			}
-			rawText := s.textVoiceBuffer.String()
-			parsedText := parsePureText(rawText)
-			go s.voiceSynthesizer.ParseAndSynthesize(s.sessionID, s.chatID, parsedText, emotion)
-		}
-		s.textVoiceBuffer.Reset()
-	}
-
 	sendPending := func() {
 		if len(s.buffer) > 0 {
 			textToSend := s.buffer
@@ -662,7 +649,6 @@ func (s *petStreamer) Update(ctx context.Context, content string) error {
 				s.inTextTag = false
 				i := strings.Index(s.buffer, "]")
 				s.buffer = s.buffer[:i]
-				sendVoice()
 			}
 			sendPending()
 		} else if strings.Contains(s.buffer, "[text:") {
@@ -721,9 +707,11 @@ func (s *petStreamer) Finalize(ctx context.Context, content string) error {
 	s.hasSentFirst = false
 	s.hasReadyAudioCount = 0

-	// 发送最终状态块（带情绪状态）
-	s.chatID++
-	s.channel.sendStreamChunk(s.sessionID, s.chatID, "final", "", true)
+	// 只有语音关闭时才发送 final（语音开启时由最后一个 audio chunk 发送）
+	if !s.voiceEnabled {
+		s.chatID++
+		s.channel.sendStreamChunk(s.sessionID, s.chatID, "final", "", true)
+	}

 	return nil
 }
@@ -1197,6 +1185,7 @@ func (s *petStreamer) sendAudioSegmentAsync(seg *voice.AudioSegment, isFinal boo
 			"duration": 0,
 			"is_final": isFinal,
 			"error":    seg.Error,
+			"emotion":  "",
 		}
 		s.channel.sendVoicePush(s.sessionID, "audio_and_voice", data)
 		return
@@ -1205,12 +1194,19 @@ func (s *petStreamer) sendAudioSegmentAsync(seg *voice.AudioSegment, isFinal boo
 	// Base64编码音频
 	encoded := base64.StdEncoding.EncodeToString(seg.AudioData)

+	// 获取当前情绪
+	emotion := ""
+	if char := s.channel.service.CharManager().GetCurrent(); char != nil {
+		emotion, _ = char.GetEmotionEngine().GetDominantEmotion()
+	}
+
 	data := map[string]any{
 		"seq":      seg.Seq,
 		"text":     seg.Text,
 		"audio":    encoded,
 		"duration": seg.Duration,
 		"is_final": isFinal,
+		"emotion":  emotion,
 	}

 	logger.DebugCF("pet", "sendAudioSegmentAsync", map[string]any{
```
