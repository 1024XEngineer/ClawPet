package pet

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/agent"
	"github.com/sipeed/picoclaw/pkg/audio"
	"github.com/sipeed/picoclaw/pkg/audio/tts"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/action"
	"github.com/sipeed/picoclaw/pkg/pet/emotion"
)

type VoiceHook struct {
	emotionEngine *emotion.EmotionEngine
	actionManager *action.ActionManager
	petService    *PetService
	ttsProvider   tts.StreamingTTSProvider
	voiceID       string
	enabled       bool
	mu            sync.RWMutex
	segmenter     *audio.TextSegmenter
}

func NewVoiceHook(
	emotionEngine *emotion.EmotionEngine,
	actionManager *action.ActionManager,
	petService *PetService,
	ttsProvider tts.StreamingTTSProvider,
	voiceID string,
) *VoiceHook {
	return &VoiceHook{
		emotionEngine: emotionEngine,
		actionManager: actionManager,
		petService:    petService,
		ttsProvider:   ttsProvider,
		voiceID:       voiceID,
		enabled:       ttsProvider != nil,
		segmenter:     audio.NewTextSegmenter(),
	}
}

func (h *VoiceHook) Name() string {
	return "VoiceHook"
}

func (h *VoiceHook) Enabled() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.enabled
}

func (h *VoiceHook) SetEnabled(enabled bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.enabled = enabled
}

func (h *VoiceHook) IsEnabled() bool {
	return h.Enabled()
}

func (h *VoiceHook) BeforeLLM(ctx context.Context, req *agent.LLMHookRequest) (*agent.LLMHookRequest, agent.HookDecision, error) {
	return req, agent.HookDecision{Action: agent.HookActionContinue}, nil
}

func (h *VoiceHook) AfterLLM(ctx context.Context, resp *agent.LLMHookResponse) (*agent.LLMHookResponse, agent.HookDecision, error) {
	if !h.Enabled() {
		logger.DebugCF("pet", "VoiceHook: AfterLLM skipped, not enabled", nil)
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	if resp == nil || resp.Response == nil || resp.Response.Content == "" {
		logger.DebugCF("pet", "VoiceHook: AfterLLM skipped, empty response", nil)
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	logger.DebugCF("pet", "VoiceHook: AfterLLM called", map[string]any{
		"content": resp.Response.Content,
	})

	textTags := parseTextTags(resp.Response.Content)
	if len(textTags) == 0 {
		logger.DebugCF("pet", "VoiceHook: no text tags found", map[string]any{
			"content": resp.Response.Content,
		})
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	logger.DebugCF("pet", "VoiceHook: parsed text tags", map[string]any{
		"tag_count": len(textTags),
	})

	var fullText strings.Builder
	for _, tag := range textTags {
		fullText.WriteString(tag.Text)
	}
	text := fullText.String()

	if text == "" {
		logger.DebugCF("pet", "VoiceHook: empty full text after parsing", nil)
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	logger.DebugCF("pet", "VoiceHook: full text extracted", map[string]any{
		"text":     text,
		"text_len": len(text),
		"voice_id": h.voiceID,
	})

	emotionParams := tts.MapEmotionToParams(h.emotionEngine, h.voiceID)
	logger.DebugCF("pet", "VoiceHook: emotion params", map[string]any{
		"emotion":          emotionParams.Emotion,
		"pitch":            emotionParams.Pitch,
		"modify_pitch":     emotionParams.ModifyPitch,
		"modify_intensity": emotionParams.ModifyIntensity,
		"modify_timbre":    emotionParams.ModifyTimbre,
	})

	segmentCount := 0
	var wg sync.WaitGroup
	wg.Add(1)

	go func() {
		defer wg.Done()
		h.segmenter.SegmentBySentence(text, func(seg audio.Segment) bool {
			segmentCount++
			chatID := segmentCount

			logger.DebugCF("pet", "VoiceHook: processing segment", map[string]any{
				"segment":  segmentCount,
				"text":     seg.Text,
				"is_final": seg.IsFinal,
			})

			h.pushText(chatID, seg.Text, false)

			logger.DebugCF("pet", "VoiceHook: calling TTS provider", map[string]any{
				"provider": h.ttsProvider.Name(),
				"text":     seg.Text,
			})

			ttsCtx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			defer cancel()

			err := h.ttsProvider.SynthesizeStream(ttsCtx, seg.Text, emotionParams, func(chunk tts.VoiceSegment) error {
				logger.DebugCF("pet", "VoiceHook: received audio chunk", map[string]any{
					"text":       chunk.Text,
					"audio_size": len(chunk.HexAudio),
					"is_final":   chunk.IsFinal,
				})
				h.pushVoiceChunk(chatID, seg.Text, chunk.HexAudio, chunk.IsFinal)
				return nil
			})

			if err != nil {
				logger.ErrorCF("pet", "VoiceHook: TTS failed", map[string]any{
					"error": err.Error(),
					"text":  seg.Text,
				})
				h.pushError(chatID, fmt.Sprintf("语音合成失败: %s", err.Error()))
			}

			return true
		})
	}()

	wg.Wait()
	return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
}

func (h *VoiceHook) pushText(chatID int, text string, isFinal bool) {
	if h.petService == nil {
		return
	}

	data := map[string]interface{}{
		"chat_id": chatID,
		"type":    "text",
		"text":    text,
	}

	push := map[string]interface{}{
		"type":      "push",
		"push_type": "ai_chat",
		"data":      data,
		"is_final":  isFinal,
	}

	h.petService.Push(push)
}

func (h *VoiceHook) pushVoiceChunk(chatID int, text, hexAudio string, isFinal bool) {
	if h.petService == nil {
		return
	}

	data := map[string]interface{}{
		"chat_id":   chatID,
		"type":      "voice",
		"text":      text,
		"hex_audio": hexAudio,
		"is_final":  isFinal,
	}

	push := map[string]interface{}{
		"type":      "push",
		"push_type": "ai_chat",
		"data":      data,
		"is_final":  isFinal,
	}

	h.petService.Push(push)
}

func (h *VoiceHook) pushError(chatID int, message string) {
	if h.petService == nil {
		return
	}

	data := map[string]interface{}{
		"chat_id": chatID,
		"type":    "error",
		"message": message,
	}

	push := map[string]interface{}{
		"type":      "push",
		"push_type": "ai_chat",
		"data":      data,
		"is_final":  true,
	}

	h.petService.Push(push)
}

func MarshalJSON(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
