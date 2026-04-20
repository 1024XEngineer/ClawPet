package voice

import (
	"encoding/base64"

	"github.com/sipeed/picoclaw/pkg/logger"
)

// Sender 消息发送者
// 负责将语音数据发送到客户端
type Sender struct {
	sendFunc func(sessionID string, pushType string, data any) error
}

// NewSender 创建Sender实例
// sendFunc: 实际执行发送的回调函数
func NewSender(sendFunc func(sessionID string, pushType string, data any) error) *Sender {
	return &Sender{sendFunc: sendFunc}
}

// SendAudioChunk 发送音频块到客户端
// 音频数据会被Base64编码后发送
func (s *Sender) SendAudioChunk(sessionID string, chatID int64, chunk AudioChunk) error {
	if s.sendFunc == nil {
		return nil
	}

	encoded := base64.StdEncoding.EncodeToString(chunk.Data)

	data := map[string]any{
		"chat_id":  chatID,
		"type":     "audio",
		"text":     encoded,      // Base64编码音频
		"is_final": chunk.IsLast, // 标记是否为最后一块
	}

	if err := s.sendFunc(sessionID, "audio", data); err != nil {
		logger.WarnCF("pet-voice", "failed to send audio chunk", map[string]any{
			"session_id": sessionID,
			"chat_id":    chatID,
			"error":      err,
		})
		return err
	}

	logger.InfoCF("pet-voice", "audio chunk sent", map[string]any{
		"session_id": sessionID,
		"chat_id":    chatID,
		"is_final":   chunk.IsLast,
		"size":       len(chunk.Data),
	})

	if chunk.IsLast {
		logger.DebugCF("pet-voice", "sent final audio chunk", map[string]any{
			"session_id": sessionID,
			"chat_id":    chatID,
			"info":       chunk.Info,
		})
	}

	return nil
}

// SendError 发送错误信息到客户端
func (s *Sender) SendError(sessionID string, chatID int64, errMsg string) error {
	if s.sendFunc == nil {
		return nil
	}

	data := map[string]any{
		"chat_id": chatID,
		"type":    "error",
		"text":    errMsg,
	}

	return s.sendFunc(sessionID, "audio", data)
}
