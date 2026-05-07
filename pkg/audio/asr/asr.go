package asr

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// petConfigASREntry is a minimal structure to read ASR models from pet_config.json
type petConfigASREntry struct {
	Name     string         `json:"name"`
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
	APIKey   string         `json:"api_key"`
	APIBase  string         `json:"api_base"`
	Extra    map[string]any `json:"extra"`
	Enabled  bool           `json:"enabled"`
}

type petConfigVoice struct {
	ModelList        interface{} `json:"model_list"`
	ASRModelList     []*petConfigASREntry `json:"asr_model_list"`
	DefaultModel     string    `json:"default_model"`
	ASREnabled       bool      `json:"asr_enabled"`
	DefaultASRModel string    `json:"default_asr_model"`
}

type petConfig struct {
	Voice *petConfigVoice `json:"voice"`
}

func loadPetConfigASRModels(workspacePath string) []*petConfigASREntry {
	petCfgPath := filepath.Join(workspacePath, "pet_config.json")
	data, err := os.ReadFile(petCfgPath)
	if err != nil {
		return nil
	}
	var cfg petConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	if cfg.Voice == nil {
		return nil
	}
	return cfg.Voice.ASRModelList
}

type Transcriber interface {
	Name() string
	Transcribe(ctx context.Context, audioFilePath string) (*TranscriptionResponse, error)
}

type TranscriptionResponse struct {
	Text     string  `json:"text"`
	Language string  `json:"language,omitempty"`
	Duration float64 `json:"duration,omitempty"`
}

func supportsAudioTranscription(model string) bool {
	protocol, _ := providers.ExtractProtocol(model)

	switch protocol {
	case "openai", "azure", "azure-openai",
		"litellm", "openrouter", "groq", "zhipu", "gemini", "nvidia",
		"ollama", "moonshot", "shengsuanyun", "deepseek", "cerebras",
		"vivgrid", "volcengine", "vllm", "qwen", "qwen-intl", "qwen-international", "dashscope-intl",
		"qwen-us", "dashscope-us", "mistral", "avian", "minimax", "longcat", "modelscope", "novita",
		"coding-plan", "alibaba-coding", "qwen-coding":
		// These protocols all go through the OpenAI-compatible or Azure provider path in
		// providers.CreateProviderFromConfig, so they are the only ones that can supply
		// the audio media payload shape expected by NewAudioModelTranscriber.

		// TODO: Further restrict this by modelID, since not every model under these
		// protocols supports audio transcription.
		return true
	default:
		return false
	}
}

func supportsWhisperTranscription(model string) bool {
	protocol, _ := providers.ExtractProtocol(model)

	switch protocol {
	case "openai", "litellm", "openrouter", "groq", "zhipu", "gemini", "nvidia",
		"ollama", "moonshot", "shengsuanyun", "deepseek", "cerebras",
		"vivgrid", "volcengine", "vllm", "qwen", "qwen-intl", "qwen-international", "dashscope-intl",
		"qwen-us", "dashscope-us", "mistral", "avian", "minimax", "longcat", "modelscope", "novita",
		"coding-plan", "alibaba-coding", "qwen-coding", "mimo":
		return true
	default:
		return false
	}
}

func whisperModelID(modelCfg *config.ModelConfig) string {
	if modelCfg == nil || modelCfg.APIKey() == "" {
		return ""
	}

	if !supportsWhisperTranscription(modelCfg.Model) {
		return ""
	}

	_, modelID := providers.ExtractProtocol(strings.TrimSpace(modelCfg.Model))
	if strings.Contains(strings.ToLower(modelID), "whisper") {
		return modelID
	}
	return ""
}

func transcriberFromModelConfig(modelCfg *config.ModelConfig) Transcriber {
	if modelCfg == nil {
		return nil
	}

	protocol, _ := providers.ExtractProtocol(modelCfg.Model)
	if protocol == "elevenlabs" && modelCfg.APIKey() != "" {
		return NewElevenLabsTranscriber(modelCfg.APIKey(), modelCfg.APIBase)
	}
	if protocol == "baidu" && modelCfg.APIKey() != "" {
		appID := ""
		secretKey := ""
		if modelCfg.ExtraBody != nil {
			if v, ok := modelCfg.ExtraBody["app_id"].(string); ok {
				appID = v
			}
			if v, ok := modelCfg.ExtraBody["secret_key"].(string); ok {
				secretKey = v
			}
		}
		if appID != "" && secretKey != "" {
			return NewBaiduTranscriber(appID, modelCfg.APIKey(), secretKey)
		}
		logger.WarnCF("voice", "Baidu ASR missing app_id or secret_key in ExtraBody", nil)
		return nil
	}
	if modelID := whisperModelID(modelCfg); modelID != "" {
		return NewWhisperTranscriber(modelCfg)
	}
	if supportsAudioTranscription(modelCfg.Model) {
		return NewAudioModelTranscriber(modelCfg)
	}
	return nil
}

// transcriberFromPetConfigASR creates a Transcriber from pet_config.json ASR model entry
func transcriberFromPetConfigASR(entry *petConfigASREntry) Transcriber {
	if entry == nil {
		return nil
	}

	apiKey := resolveAPIKey(entry.APIKey)
	model := entry.Model
	if entry.Provider == "whisper" && !strings.Contains(model, "/") {
		model = entry.Provider + "/" + model
	}

	switch entry.Provider {
	case "whisper":
		if apiKey != "" {
			return NewWhisperTranscriberFromAPI(apiKey, entry.APIBase, model)
		}
	case "baidu":
		if apiKey != "" {
			appID := ""
			secretKey := ""
			if entry.Extra != nil {
				if v, ok := entry.Extra["app_id"].(string); ok {
					appID = v
				}
				if v, ok := entry.Extra["secret_key"].(string); ok {
					secretKey = v
				}
			}
			if appID != "" && secretKey != "" {
				return NewBaiduTranscriber(appID, apiKey, secretKey)
			}
		}
	case "elevenlabs":
		if apiKey != "" {
			return NewElevenLabsTranscriber(apiKey, entry.APIBase)
		}
	case "audio_model":
		if apiKey != "" || entry.APIBase != "" {
			mc := &config.ModelConfig{
				ModelName: entry.Name,
				Model:     model,
				APIBase:   entry.APIBase,
			}
			mc.APIKeys = config.SecureStrings{config.NewSecureString(apiKey)}
			return NewAudioModelTranscriber(mc)
		}
	}
	return nil
}

// resolveAPIKey resolves API key from environment variable reference
func resolveAPIKey(apiKey string) string {
	if strings.HasPrefix(apiKey, "${") && strings.HasSuffix(apiKey, "}") {
		envName := strings.TrimPrefix(strings.TrimSuffix(apiKey, "}"), "${")
		return os.Getenv(envName)
	}
	return apiKey
}

func fallbackTranscriberFromModelConfig(modelCfg *config.ModelConfig) Transcriber {
	if modelCfg == nil {
		return nil
	}

	protocol, _ := providers.ExtractProtocol(modelCfg.Model)
	if protocol == "elevenlabs" && modelCfg.APIKey() != "" {
		return NewElevenLabsTranscriber(modelCfg.APIKey(), modelCfg.APIBase)
	}
	if modelID := whisperModelID(modelCfg); modelID != "" {
		return NewWhisperTranscriber(modelCfg)
	}
	return nil
}

// DetectTranscriber inspects cfg and returns the appropriate Transcriber, or
// nil if no supported transcription provider is configured.
func DetectTranscriber(cfg *config.Config) Transcriber {
	if cfg == nil {
		return nil
	}

	// Priority 1: pet_config.json ASR models (new unified config)
	workspacePath := cfg.WorkspacePath()
	if workspacePath != "" {
		if entries := loadPetConfigASRModels(workspacePath); entries != nil {
			for _, entry := range entries {
				if entry.Enabled {
					if tr := transcriberFromPetConfigASR(entry); tr != nil {
						return tr
					}
				}
			}
		}
	}

	// Priority 2: config.json Voice.ModelName
	if modelName := strings.TrimSpace(cfg.Voice.ModelName); modelName != "" {
		modelCfg, err := cfg.GetModelConfig(modelName)
		if err == nil {
			if tr := transcriberFromModelConfig(modelCfg); tr != nil {
				return tr
			}
		}
	}

	// Fall back to compatibility scanning for legacy auto-detected ASR providers.
	for _, mc := range cfg.ModelList {
		if tr := fallbackTranscriberFromModelConfig(mc); tr != nil {
			return tr
		}
	}
	return nil
}
