package voice

import (
	"encoding/base64"

	"github.com/sipeed/picoclaw/pkg/logger"
)

// Sender forwards synthesized voice payloads to clients.
type Sender struct {
	sendFunc func(sessionID string, pushType string, data any) error
}

func inferAudioMimeFromBytes(raw []byte) string {
	if len(raw) >= 3 && raw[0] == 0x49 && raw[1] == 0x44 && raw[2] == 0x33 {
		return "audio/mpeg"
	}
	if len(raw) >= 2 && raw[0] == 0xFF && (raw[1]&0xE0) == 0xE0 {
		return "audio/mpeg"
	}
	if len(raw) >= 4 && raw[0] == 0x52 && raw[1] == 0x49 && raw[2] == 0x46 && raw[3] == 0x46 {
		return "audio/wav"
	}
	if len(raw) >= 4 && raw[0] == 0x4F && raw[1] == 0x67 && raw[2] == 0x67 && raw[3] == 0x53 {
		return "audio/ogg"
	}
	if len(raw) >= 4 && raw[0] == 0x66 && raw[1] == 0x4C && raw[2] == 0x61 && raw[3] == 0x43 {
		return "audio/flac"
	}
	return ""
}

// NewSender creates a sender with a transport callback.
func NewSender(sendFunc func(sessionID string, pushType string, data any) error) *Sender {
	return &Sender{sendFunc: sendFunc}
}

// SendAudioChunk serializes one audio chunk into WS push payload.
func (s *Sender) SendAudioChunk(sessionID string, chatID int64, chunk AudioChunk) error {
	if s.sendFunc == nil {
		return nil
	}
	if len(chunk.Data) == 0 && !chunk.IsLast {
		logger.WarnCF("pet-voice", "skip empty non-final audio chunk", map[string]any{
			"session_id": sessionID,
			"chat_id":    chatID,
		})
		return nil
	}

	encoded := base64.StdEncoding.EncodeToString(chunk.Data)
	audioMime := inferAudioMimeFromBytes(chunk.Data)
	if audioMime == "" {
		audioMime = "audio/mpeg"
	}
	if chunk.Info != nil {
		switch chunk.Info.Format {
		case "wav":
			audioMime = "audio/wav"
		case "ogg", "opus":
			audioMime = "audio/ogg"
		case "flac":
			audioMime = "audio/flac"
		default:
			audioMime = "audio/mpeg"
		}
	}

	data := map[string]any{
		"chat_id":    chatID,
		"type":       "audio",
		"audio":      encoded, // Primary payload for newer clients.
		"audio_mime": audioMime,
		"text":       encoded, // Legacy clients still read audio from text.
		"is_final":   chunk.IsLast,
	}

	if err := s.sendFunc(sessionID, "audio", data); err != nil {
		logger.WarnCF("pet-voice", "failed to send audio chunk", map[string]any{
			"session_id": sessionID,
			"chat_id":    chatID,
			"error":      err,
		})
		return err
	}

	if chunk.IsLast {
		logger.DebugCF("pet-voice", "sent final audio chunk", map[string]any{
			"session_id": sessionID,
			"chat_id":    chatID,
			"info":       chunk.Info,
		})
	}

	return nil
}

// SendError pushes a voice-channel error payload.
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
