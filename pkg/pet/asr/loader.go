package asr

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/sipeed/picoclaw/pkg/audio/asr"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/config"
	"github.com/sipeed/picoclaw/pkg/providers"
	"gopkg.in/yaml.v3"

	sysconfig "github.com/sipeed/picoclaw/pkg/config"
)

// 默认ASR模型配置（预设）
var defaultASRModels = []*config.ASRModelConfig{
	{
		Name:     "whisper",
		Provider: "whisper",
		Model:    "whisper-1",
		APIKey:   "",
		APIBase:  "",
		Extra:    nil,
		Enabled:  false,
	},
}

// RegisterDefaultProviders 注册默认的ASR提供者
func init() {
	RegisterProvider("whisper", newWhisperFactory())
	RegisterProvider("baidu", newBaiduFactory())
	RegisterProvider("elevenlabs", newElevenLabsFactory())
	RegisterProvider("audio_model", newAudioModelFactory())
}

// NewLoader 创建ASR加载器
func NewLoader(cfg *config.VoiceConfig) *Loader {
	return &Loader{
		cfg:          cfg,
		transcriber:  nil,
		currentModel: "",
	}
}

// Load 加载并初始化ASR提供者
func (l *Loader) Load() error {
	if l.cfg == nil {
		return fmt.Errorf("VoiceConfig is nil")
	}

	if !l.cfg.ASREnabled {
		logger.DebugCF("pet-asr", "ASR is disabled in config", nil)
		return nil
	}

	mergedModels := l.mergeDefaultModels()

	modelName := l.cfg.DefaultASRModel
	if modelName == "" {
		modelName = l.findFirstEnabledModelFromList(mergedModels)
	}

	if modelName == "" {
		logger.WarnCF("pet-asr", "No ASR model found to load", nil)
		return nil
	}

	return l.loadModel(modelName)
}

func (l *Loader) findFirstEnabledModelFromList(models []*config.ASRModelConfig) string {
	for _, m := range models {
		if m.Enabled {
			return m.Name
		}
	}
	return ""
}

// mergeDefaultModels 将默认模型合并到配置中（仅用于加载，不修改原始配置）
func (l *Loader) mergeDefaultModels() []*config.ASRModelConfig {
	existingNames := make(map[string]bool)
	for _, m := range l.cfg.ASRModelList {
		existingNames[m.Name] = true
	}

	merged := make([]*config.ASRModelConfig, len(l.cfg.ASRModelList))
	copy(merged, l.cfg.ASRModelList)

	for _, defaultModel := range defaultASRModels {
		if !existingNames[defaultModel.Name] {
			merged = append(merged, defaultModel)
			logger.Infof("pet asr: added default model %s", defaultModel.Name)
		}
	}
	return merged
}

// findFirstEnabledModel 返回第一个启用的模型名称
func (l *Loader) findFirstEnabledModel() string {
	for _, m := range l.cfg.ASRModelList {
		if m.Enabled {
			return m.Name
		}
	}
	return ""
}

// loadModel 加载指定模型
func (l *Loader) loadModel(modelName string) error {
	var modelCfg *config.ASRModelConfig
	for _, m := range l.cfg.ASRModelList {
		if m.Name == modelName {
			modelCfg = m
			break
		}
	}

	if modelCfg == nil {
		return fmt.Errorf("ASR model not found: %s", modelName)
	}

	if !modelCfg.Enabled {
		return fmt.Errorf("ASR model %s is not enabled", modelName)
	}

	apiKey := resolveAPIKey(modelCfg.APIKey)
	if apiKey == "" && modelCfg.Provider != "audio_model" {
		logger.WarnCF("pet-asr", "API key is empty for model", map[string]any{"model": modelName})
	}

	factory, ok := providerRegistry[modelCfg.Provider]
	if !ok {
		return fmt.Errorf("unsupported ASR provider: %s", modelCfg.Provider)
	}

	transcriber := factory(modelCfg)
	if transcriber == nil {
		return fmt.Errorf("failed to create transcriber for %s", modelName)
	}

	l.mu.Lock()
	l.transcriber = transcriber
	l.currentModel = modelName
	l.mu.Unlock()

	logger.Infof("pet asr: loaded model %s (provider: %s)", modelName, modelCfg.Provider)
	return nil
}

// resolveAPIKey 解析 API Key，支持环境变量和 $security: 引用
func resolveAPIKey(value string) string {
	if value == "" {
		return ""
	}
	// 解析环境变量 ${VAR_NAME}
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		envKey := value[2 : len(value)-1]
		if envVal := os.Getenv(envKey); envVal != "" {
			return envVal
		}
	}
	// 解析安全引用 $security:modelName
	if strings.HasPrefix(value, "$security:") {
		return resolveSecurityRef(value)
	}
	return value
}

// defaultAPIBases 常用协议的默认 API Base
var defaultAPIBases = map[string]string{
	"openai":            "https://api.openai.com/v1",
	"groq":              "https://api.groq.com/openai/v1",
	"openrouter":        "https://openrouter.ai/api/v1",
	"minimax":           "https://api.minimaxi.com/v1",
	"doubao":            "https://openspeech.bytedance.com/api/v3/tts",
	"volcengine":        "https://ark.cn-beijing.volces.com/api/v3",
	"zhipu":             "https://open.bigmodel.cn/api/paas/v4",
	"gemini":            "https://generativelanguage.googleapis.com/v1beta",
	"moonshot":          "https://api.moonshot.cn/v1",
	"deepseek":          "https://api.deepseek.com/v1",
	"ollama":            "http://localhost:11434/v1",
	"elevenlabs":        "https://api.elevenlabs.io",
}

// resolveAPIBase 解析 API Base 地址
func resolveAPIBase(apiBase, provider, model string) string {
	if apiBase != "" {
		return strings.TrimRight(apiBase, "/")
	}
	// 尝试从 provider/model 中提取协议
	protocol, _ := providers.ExtractProtocol(provider + "/" + model)
	if base, ok := defaultAPIBases[protocol]; ok {
		return base
	}
	return ""
}

// resolveSecurityRef 解析对 .security.yml 中 API key 的引用
func resolveSecurityRef(value string) string {
	refName := strings.TrimPrefix(value, "$security:")
	if refName == "" {
		return value
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		logger.Warnf("pet asr: failed to get user home dir: %v", err)
		return value
	}

	securityPath := filepath.Join(homeDir, ".picoclaw", ".security.yml")
	data, err := os.ReadFile(securityPath)
	if err != nil {
		logger.Warnf("pet asr: failed to read .security.yml: %v", err)
		return value
	}

	var secCfg struct {
		ModelList map[string]struct {
			APIKeys []string `yaml:"api_keys"`
		} `yaml:"model_list"`
	}
	if err := yaml.Unmarshal(data, &secCfg); err != nil {
		logger.Warnf("pet asr: failed to parse .security.yml: %v", err)
		return value
	}

	if model, ok := secCfg.ModelList[refName]; ok {
		if len(model.APIKeys) > 0 {
			logger.Infof("pet asr: resolved API key from .security.yml for %s", refName)
			return model.APIKeys[0]
		}
	}

	logger.Warnf("pet asr: no API key found in .security.yml for %s", refName)
	return value
}

// SwitchModel 切换到指定模型（等待活跃请求结束后切换）
func (l *Loader) SwitchModel(modelName string, configManager ConfigManager) error {
	if modelName == l.GetCurrentModel() {
		return nil
	}

	l.mu.RLock()
	closed := l.closed
	l.mu.RUnlock()

	if closed {
		return fmt.Errorf("loader is closed")
	}

	// 等待活跃请求结束
	l.activeReqs.Wait()

	l.mu.Lock()
	if l.transcriber != nil {
		if c, ok := l.transcriber.(interface{ Close() error }); ok {
			_ = c.Close()
		}
		l.transcriber = nil
	}
	l.mu.Unlock()

	if err := l.loadModel(modelName); err != nil {
		return err
	}

	if configManager != nil {
		configManager.SelectASRModel(modelName)
		if err := configManager.SaveVoiceConfig(); err != nil {
			logger.WarnCF("pet-asr", "failed to save config after model switch", map[string]any{
				"error": err.Error(),
			})
		}
	}

	return nil
}

// toModelConfig 将ASRModelConfig转换为config.ModelConfig（用于 WhisperTranscriber）
func toModelConfig(asicfg *config.ASRModelConfig, apiKey string) *sysconfig.ModelConfig {
	model := asicfg.Model
	if asicfg.Provider == "whisper" && !strings.Contains(model, "/") {
		model = asicfg.Provider + "/" + model
	}

	mc := &sysconfig.ModelConfig{
		ModelName: asicfg.Name,
		Model:     model,
		APIBase:   asicfg.APIBase,
		Enabled:   asicfg.Enabled,
	}

	if apiKey != "" {
		mc.APIKeys = sysconfig.SecureStrings{sysconfig.NewSecureString(apiKey)}
	}

	if asicfg.Extra != nil {
		mc.ExtraBody = make(map[string]any)
		for k, v := range asicfg.Extra {
			mc.ExtraBody[k] = v
		}
	}

	return mc
}

// ---- Provider Factories ----

func newWhisperFactory() ASRFactory {
	return func(modelCfg *config.ASRModelConfig) asr.Transcriber {
		apiKey := resolveAPIKey(modelCfg.APIKey)
		if apiKey == "" {
			logger.WarnCF("pet-asr", "whisper: API key is empty", nil)
			return nil
		}

		cfg := toModelConfig(modelCfg, apiKey)

		apiBase := resolveAPIBase(modelCfg.APIBase, modelCfg.Provider, modelCfg.Model)
		if apiBase != "" {
			cfg.APIBase = apiBase
		}

		return asr.NewWhisperTranscriber(cfg)
	}
}

func newBaiduFactory() ASRFactory {
	return func(modelCfg *config.ASRModelConfig) asr.Transcriber {
		apiKey := resolveAPIKey(modelCfg.APIKey)
		if apiKey == "" {
			logger.WarnCF("pet-asr", "baidu: API key is empty", nil)
			return nil
		}

		appID := ""
		secretKey := ""
		if modelCfg.Extra != nil {
			if v, ok := modelCfg.Extra["app_id"].(string); ok {
				appID = v
			}
			if v, ok := modelCfg.Extra["secret_key"].(string); ok {
				secretKey = v
			}
		}

		if appID == "" || secretKey == "" {
			logger.WarnCF("pet-asr", "baidu: missing app_id or secret_key in Extra", nil)
			return nil
		}

		return asr.NewBaiduTranscriber(appID, apiKey, secretKey)
	}
}

func newElevenLabsFactory() ASRFactory {
	return func(modelCfg *config.ASRModelConfig) asr.Transcriber {
		apiKey := resolveAPIKey(modelCfg.APIKey)
		if apiKey == "" {
			logger.WarnCF("pet-asr", "elevenlabs: API key is empty", nil)
			return nil
		}

		apiBase := modelCfg.APIBase
		if apiBase == "" {
			apiBase = "https://api.elevenlabs.io"
		}

		return asr.NewElevenLabsTranscriber(apiKey, apiBase)
	}
}

func newAudioModelFactory() ASRFactory {
	return func(modelCfg *config.ASRModelConfig) asr.Transcriber {
		apiKey := resolveAPIKey(modelCfg.APIKey)

		cfg := toModelConfig(modelCfg, apiKey)

		cfg.APIBase = resolveAPIBase(modelCfg.APIBase, modelCfg.Provider, modelCfg.Model)

		return asr.NewAudioModelTranscriber(cfg)
	}
}