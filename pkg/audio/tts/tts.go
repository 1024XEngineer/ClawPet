package tts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/media"
	"github.com/sipeed/picoclaw/pkg/providers"
)

type TTSProvider interface {
	Name() string
	Synthesize(ctx context.Context, text string) (io.ReadCloser, error)
}

// petConfigTTSEntry is a minimal structure to read TTS models from pet_config.json
type petConfigTTSEntry struct {
	Name     string         `json:"name"`
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
	APIKey   string         `json:"api_key"`
	APIBase  string         `json:"api_base"`
	VoiceID  string         `json:"voice_id"`
	Extra    map[string]any `json:"extra"`
	Enabled  bool           `json:"enabled"`
}

type petConfigVoiceTTS struct {
	ModelList      []*petConfigTTSEntry `json:"model_list"`
	DefaultModel   string               `json:"default_model"`
	TTSEnabled    bool                 `json:"tts_enabled"`
	TTSModelName  string               `json:"tts_model_name"`
}

type petConfigTTS struct {
	Voice *petConfigVoiceTTS `json:"voice"`
}

func loadPetConfigTTSModels(workspacePath string) []*petConfigTTSEntry {
	petCfgPath := filepath.Join(workspacePath, "pet_config.json")
	data, err := os.ReadFile(petCfgPath)
	if err != nil {
		return nil
	}
	var cfg petConfigTTS
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	if cfg.Voice == nil {
		return nil
	}
	return cfg.Voice.ModelList
}

func resolveTTSAPIKey(apiKey string) string {
	if strings.HasPrefix(apiKey, "${") && strings.HasSuffix(apiKey, "}") {
		envName := strings.TrimPrefix(strings.TrimSuffix(apiKey, "}"), "${")
		return os.Getenv(envName)
	}
	return apiKey
}

func providerFromPetConfigTTS(entry *petConfigTTSEntry) TTSProvider {
	if entry == nil {
		return nil
	}

	apiKey := resolveTTSAPIKey(entry.APIKey)
	if apiKey == "" {
		return nil
	}

	modelID := entry.Model
	if modelID == "" {
		modelID = strings.TrimSpace(entry.Model)
	}

	switch entry.Provider {
	case "doubao":
		if apiBase := entry.APIBase; apiBase != "" {
			return NewOpenAITTSProvider(apiKey, apiBase, "", modelID)
		}
	case "minimax":
		if apiBase := entry.APIBase; apiBase != "" {
			return NewOpenAITTSProvider(apiKey, apiBase, "", modelID)
		}
	case "mimo":
		if apiBase := entry.APIBase; apiBase != "" {
			return NewMimoTTSProvider(apiKey, apiBase, modelID, "")
		}
	default:
		if apiBase := entry.APIBase; apiBase != "" {
			return NewOpenAITTSProvider(apiKey, apiBase, "", modelID)
		}
	}
	return nil
}

func providerFromModelConfig(mc *config.ModelConfig) TTSProvider {
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
	default:
		return NewOpenAITTSProvider(mc.APIKey(), providers.ResolveAPIBase(mc), mc.Proxy, modelID)
	}
}

func DetectTTS(cfg *config.Config) TTSProvider {
	if cfg == nil {
		return nil
	}

	// Priority 1: pet_config.json TTS models (new unified config)
	workspacePath := cfg.WorkspacePath()
	if workspacePath != "" {
		if entries := loadPetConfigTTSModels(workspacePath); entries != nil {
			for _, entry := range entries {
				if entry.Enabled {
					if provider := providerFromPetConfigTTS(entry); provider != nil {
						return provider
					}
				}
			}
		}
	}

	// Priority 2: config.json Voice.TTSModelName
	if modelName := strings.TrimSpace(cfg.Voice.TTSModelName); modelName != "" {
		if mc, err := cfg.GetModelConfig(modelName); err == nil {
			if provider := providerFromModelConfig(mc); provider != nil {
				return provider
			}
		}
	}

	// Fall back to compatibility scanning for legacy TTS providers in ModelList.
	for _, mc := range cfg.ModelList {
		if strings.Contains(strings.ToLower(mc.Model), "tts") && mc.APIKey() != "" {
			if provider := providerFromModelConfig(mc); provider != nil {
				return provider
			}
		}
	}
	return nil
}

// SynthesizeAndStore synthesizes text to speech and registers it in the media store, returning the media reference.
func SynthesizeAndStore(
	ctx context.Context,
	provider TTSProvider,
	store media.MediaStore,
	text string,
	filename string,
	channel string,
	chatID string,
) (string, error) {
	if provider == nil {
		return "", fmt.Errorf("tts provider is not configured")
	}
	if store == nil {
		return "", fmt.Errorf("media store not configured")
	}
	if channel == "" || chatID == "" {
		return "", fmt.Errorf("no target channel/chat available")
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("text is required")
	}

	stream, err := provider.Synthesize(ctx, text)
	if err != nil {
		return "", fmt.Errorf("tts synthesize failed: %w", err)
	}
	defer stream.Close()

	err = os.MkdirAll(media.TempDir(), 0o700)
	if err != nil {
		return "", fmt.Errorf("failed to create media temp dir: %w", err)
	}

	fileExt := ".ogg"
	contentType := "audio/ogg"
	if provider.Name() == "mimo-tts" {
		fileExt = ".mp3"
		contentType = "audio/mpeg"
	}

	file, err := os.CreateTemp(media.TempDir(), "tts-*"+fileExt)
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}

	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(file.Name())
		}
	}()

	_, err = io.Copy(file, stream)
	if err != nil {
		file.Close()
		return "", fmt.Errorf("failed to write tts audio: %w", err)
	}

	err = file.Close()
	if err != nil {
		return "", fmt.Errorf("failed to close tts audio file: %w", err)
	}

	filename = strings.TrimSpace(filename)
	if filename == "" {
		filename = fmt.Sprintf("tts-%d%s", time.Now().Unix(), fileExt)
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		filename += fileExt
	} else if ext != fileExt {
		filename = strings.TrimSuffix(filename, filepath.Ext(filename)) + fileExt
	}

	scope := fmt.Sprintf("tool:send_tts:%s:%s:%d", channel, chatID, time.Now().UnixNano())
	ref, err := store.Store(file.Name(), media.MediaMeta{
		Filename:    filename,
		ContentType: contentType,
		Source:      "tool:send_tts",
	}, scope)
	if err != nil {
		return "", fmt.Errorf("failed to register audio: %w", err)
	}
	removeTemp = false

	return ref, nil
}
