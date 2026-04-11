package tts

import (
	"fmt"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/providers"
)

func CreateTTSProvider(mc *config.ModelConfig) BatchTTSProvider {
	if mc == nil || mc.APIKey() == "" {
		return nil
	}

	protocol, modelID := providers.ExtractProtocol(mc.Model)
	if modelID == "" {
		modelID = strings.TrimSpace(mc.Model)
	}

	switch protocol {
	case "mimo":
		return NewMimoTTSProvider(mc.APIKey(), providers.ResolveAPIBase(mc), modelID, mc.Proxy)
	case "minimax":
		return NewMinimaxBatchProvider(mc.APIKey(), providers.ResolveAPIBase(mc), modelID, mc.Proxy)
	default:
		return NewOpenAITTSProvider(mc.APIKey(), providers.ResolveAPIBase(mc), mc.Proxy, modelID)
	}
}

func CreateStreamingTTSProvider(mc *config.ModelConfig) StreamingTTSProvider {
	if mc == nil || mc.APIKey() == "" {
		logger.DebugCF("tts", "CreateStreamingTTSProvider: mc is nil or apiKey empty", map[string]any{
			"mc_nil": mc == nil,
			"apiKey_len": func() int {
				if mc == nil {
					return 0
				}
				return len(mc.APIKey())
			}(),
		})
		return nil
	}

	protocol, _ := providers.ExtractProtocol(mc.Model)

	logger.DebugCF("tts", "CreateStreamingTTSProvider: protocol check", map[string]any{
		"protocol": protocol,
		"model":    mc.Model,
	})

	switch protocol {
	case "minimax":
		modelID := strings.TrimPrefix(mc.Model, protocol+"/")
		return NewMinimaxStreamingProvider(mc.APIKey(), providers.ResolveAPIBase(mc), modelID, mc.ExtraBody)
	default:
		logger.DebugCF("tts", "CreateStreamingTTSProvider: protocol not supported for streaming", map[string]any{
			"protocol": protocol,
		})
		return nil
	}
}

func DetectStreamingTTS(cfg *config.Config) StreamingTTSProvider {
	if cfg == nil {
		logger.DebugCF("tts", "DetectStreamingTTS: cfg is nil", nil)
		return nil
	}

	logger.DebugCF("tts", "DetectStreamingTTS: voice config check", map[string]any{
		"voice_enabled":    cfg.Voice.Enabled,
		"voice_stream":     cfg.Voice.StreamEnabled,
		"tts_model_name":   cfg.Voice.TTSModelName,
		"voice_id":         cfg.Voice.VoiceID,
		"default_voice_id": cfg.Voice.DefaultVoiceID,
	})

	if !cfg.Voice.Enabled {
		logger.DebugCF("tts", "DetectStreamingTTS: voice.enabled is false", nil)
		return nil
	}

	modelName := strings.TrimSpace(cfg.Voice.TTSModelName)
	logger.DebugCF("tts", "DetectStreamingTTS: looking for model", map[string]any{
		"tts_model_name": modelName,
		"model_list_len": len(cfg.ModelList),
	})

	if modelName == "" {
		logger.DebugCF("tts", "DetectStreamingTTS: tts_model_name is empty, searching model_list...", nil)
		for i, mc := range cfg.ModelList {
			logger.DebugCF("tts", fmt.Sprintf("DetectStreamingTTS: checking model_list[%d]", i), map[string]any{
				"model_name": mc.ModelName,
				"model":      mc.Model,
				"has_apiKey": mc.APIKey() != "",
			})
			if strings.Contains(strings.ToLower(mc.Model), "speech") && mc.APIKey() != "" {
				logger.DebugCF("tts", "DetectStreamingTTS: found speech model in model_list", map[string]any{
					"index":      i,
					"model_name": mc.ModelName,
					"model":      mc.Model,
				})
				if provider := CreateStreamingTTSProvider(mc); provider != nil {
					return provider
				}
			}
		}
		return nil
	}

	mc, err := cfg.GetModelConfig(modelName)
	if err != nil {
		logger.DebugCF("tts", "DetectStreamingTTS: GetModelConfig failed", map[string]any{
			"model_name": modelName,
			"error":      err.Error(),
		})
		return nil
	}

	logger.DebugCF("tts", "DetectStreamingTTS: found model config", map[string]any{
		"model_name": mc.ModelName,
		"model":      mc.Model,
		"api_base":   mc.APIBase,
		"has_apiKey": mc.APIKey() != "",
	})

	provider := CreateStreamingTTSProvider(mc)
	if provider == nil {
		logger.DebugCF("tts", "DetectStreamingTTS: CreateStreamingTTSProvider returned nil", map[string]any{
			"model_name": modelName,
		})
	}
	return provider
}

func GetVoiceID(cfg *config.Config) string {
	if voiceID := cfg.Voice.VoiceID; voiceID != "" {
		return voiceID
	}
	if voiceID := cfg.Voice.DefaultVoiceID; voiceID != "" {
		return voiceID
	}
	return DefaultVoiceID
}

func ResolveVoiceID(voiceID string, cfg *config.Config) string {
	if voiceID != "" {
		return voiceID
	}
	return GetVoiceID(cfg)
}

func IsVoiceEnabled(cfg *config.Config) bool {
	if cfg == nil {
		return false
	}
	return cfg.Voice.Enabled
}

func IsStreamEnabled(cfg *config.Config) bool {
	if cfg == nil {
		return false
	}
	return cfg.Voice.StreamEnabled
}
