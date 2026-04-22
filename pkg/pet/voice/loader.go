package voice

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/config"
	"gopkg.in/yaml.v3"
)

// Loader 语音服务加载器
// 根据配置初始化TTS提供者
type Loader struct {
	cfg          *config.VoiceConfig // 语音配置
	provider     StreamingTTS        // TTS提供者实例
	currentModel string              // 当前模型名称
	mu           sync.RWMutex        // 保护并发访问
	activeReqs   sync.WaitGroup      // 活跃请求计数
}

// TTSFactory TTS提供者工厂函数类型
type TTSFactory func(apiBase, apiKey, model, voiceID string, extra map[string]any) StreamingTTS

// providerRegistry 供应商注册表
var providerRegistry = make(map[string]TTSFactory)

// ConfigManager 配置管理器接口（用于持久化）
type ConfigManager interface {
	SelectVoiceModel(name string)
	SaveVoiceConfig() error
}

// 默认语音模型配置（预设）
var defaultVoiceModels = []*config.VoiceModelConfig{
	{
		Name:     "minimax",
		Provider: "minimax",
		APIBase:  "https://api.minimaxi.com/v1/t2a_v2",
		Model:    "speech-2.8-hd",
		VoiceID:  "",
		APIKey:   "",
		Extra:    nil,
		Enabled:  false,
	},
	{
		Name:     "doubao",
		Provider: "doubao",
		APIBase:  "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
		Model:    "seed-tts-2.0-expressive",
		VoiceID:  "",
		APIKey:   "",
		Extra: map[string]any{
			"accessKeyId":     "",
			"secretAccessKey": "",
			"accessToken":     "",
			"appId":           "",
			"resourceId":      "seed-tts-2.0",
		},
		Enabled: false,
	},
}

// RegisterProvider 注册 TTS 供应商
func RegisterProvider(name string, factory TTSFactory) {
	providerRegistry[name] = factory
	logger.DebugCF("pet-voice", "Registered provider", map[string]any{
		"provider": name,
	})
}

// mergeDefaultModels 将默认模型合并到配置中（如果不存在）
func (l *Loader) mergeDefaultModels() {
	if l.cfg == nil {
		return
	}

	existingNames := make(map[string]bool)
	for _, m := range l.cfg.ModelList {
		existingNames[m.Name] = true
	}

	for _, defaultModel := range defaultVoiceModels {
		if !existingNames[defaultModel.Name] {
			// 模型不存在，直接添加
			l.cfg.ModelList = append(l.cfg.ModelList, defaultModel)
			logger.Infof("pet voice: added default model %s", defaultModel.Name)
		} else {
			// 模型已存在，合并 Extra 字段（补充缺失的字段）
			l.mergeModelExtra(defaultModel)
		}
	}
}

// mergeModelExtra 合并模型的 Extra 字段（补充缺失字段，不覆盖已存在的）
func (l *Loader) mergeModelExtra(defaultModel *config.VoiceModelConfig) {
	for _, m := range l.cfg.ModelList {
		if m.Name == defaultModel.Name && defaultModel.Extra != nil {
			if m.Extra == nil {
				m.Extra = make(map[string]any)
			}
			for k, v := range defaultModel.Extra {
				if _, exists := m.Extra[k]; !exists {
					m.Extra[k] = v
					logger.DebugCF("pet-voice", "merged extra field", map[string]any{
						"model": m.Name,
						"field": k,
						"value": v,
					})
				}
			}
		}
	}
}

// NewLoader 创建语音加载器实例
func NewLoader(cfg *config.VoiceConfig) *Loader {
	return &Loader{cfg: cfg}
}

// Load 根据配置加载并初始化TTS提供者
func (l *Loader) Load() error {
	// 合并默认模型：如果 cfg 中没有 minimax/doubao，自动加入
	l.mergeDefaultModels()

	if l.cfg == nil || len(l.cfg.ModelList) == 0 {
		logger.Warnf("pet voice: no voice models configured")
		return nil
	}

	// 确定要加载的模型名称：优先使用默认模型，否则选择第一个启用的
	modelName := l.cfg.DefaultModel
	if modelName == "" {
		for _, m := range l.cfg.ModelList {
			if m.Enabled {
				modelName = m.Name
				break
			}
		}
	}

	if modelName == "" {
		logger.Warnf("pet voice: no enabled voice model found")
		return nil
	}

	// 查找模型配置
	var modelCfg *config.VoiceModelConfig
	for _, m := range l.cfg.ModelList {
		if m.Name == modelName {
			modelCfg = m
			break
		}
	}

	if modelCfg == nil {
		return fmt.Errorf("voice model %s not found in model_list", modelName)
	}

	if !modelCfg.Enabled {
		return fmt.Errorf("voice model %s is disabled", modelName)
	}

	// 解析 APIKey
	apiKey := resolveEnvVar(modelCfg.APIKey)
	if apiKey == "" || strings.HasPrefix(apiKey, "$security:") {
		apiKey = resolveSecurityRef(modelCfg.APIKey, modelCfg.Name)
	}
	if apiKey == "" {
		logger.Warnf("pet voice: API key not resolved")
	}

	// 根据 provider 从注册表获取工厂函数
	factory, ok := providerRegistry[modelCfg.Provider]
	if !ok {
		return fmt.Errorf("unsupported provider: %s", modelCfg.Provider)
	}

	l.provider = factory(modelCfg.APIBase, apiKey, modelCfg.Model, modelCfg.VoiceID, modelCfg.Extra)
	l.currentModel = modelName
	return nil
}

// GetProvider 返回已加载的TTS提供者
func (l *Loader) GetProvider() StreamingTTS {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.provider
}

// GetCurrentModel 返回当前使用的模型名称
func (l *Loader) GetCurrentModel() string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.currentModel
}

// ListModels 返回所有语音模型配置
func (l *Loader) ListModels() []*config.VoiceModelConfig {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.cfg == nil {
		return nil
	}
	return l.cfg.ModelList
}

// GetModel 获取指定模型配置
func (l *Loader) GetModel(name string) *config.VoiceModelConfig {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.cfg == nil {
		return nil
	}
	for _, m := range l.cfg.ModelList {
		if m.Name == name {
			return m
		}
	}
	return nil
}

// GetModelByProvider 根据 provider 类型获取第一个匹配的配置
func (l *Loader) GetModelByProvider(provider string) *config.VoiceModelConfig {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.cfg == nil {
		return nil
	}
	for _, m := range l.cfg.ModelList {
		if m.Provider == provider {
			return m
		}
	}
	return nil
}

// SwitchModel 切换到指定模型（热切换）
func (l *Loader) SwitchModel(name string, configManager ConfigManager) error {
	// 等待活跃请求完成
	l.activeReqs.Wait()

	l.mu.Lock()
	defer l.mu.Unlock()

	// 查找目标模型
	var targetModel *config.VoiceModelConfig
	for _, m := range l.cfg.ModelList {
		if m.Name == name {
			targetModel = m
			break
		}
	}

	if targetModel == nil {
		return fmt.Errorf("voice model %s not found", name)
	}

	// 自动启用目标模型
	if !targetModel.Enabled {
		targetModel.Enabled = true
		logger.Infof("pet voice: auto enabled model %s for switch", name)
	}

	// 关闭旧 provider
	if l.provider != nil {
		l.provider.Close()
		l.provider = nil
	}

	// 解析 APIKey
	apiKey := resolveEnvVar(targetModel.APIKey)
	if apiKey == "" || strings.HasPrefix(apiKey, "$security:") {
		apiKey = resolveSecurityRef(targetModel.APIKey, targetModel.Name)
	}

	// 根据 provider 从注册表获取工厂函数
	factory, ok := providerRegistry[targetModel.Provider]
	if !ok {
		return fmt.Errorf("unsupported provider: %s", targetModel.Provider)
	}

	l.provider = factory(targetModel.APIBase, apiKey, targetModel.Model, targetModel.VoiceID, targetModel.Extra)
	l.currentModel = name

	// 更新配置
	l.cfg.DefaultModel = name

	// 持久化配置
	if configManager != nil {
		configManager.SelectVoiceModel(name)
		if err := configManager.SaveVoiceConfig(); err != nil {
			logger.Warnf("pet voice: failed to save config after switch: %v", err)
		}
	}

	logger.Infof("pet voice: switched to model %s", name)
	return nil
}

// AddRequest 增加活跃请求计数
func (l *Loader) AddRequest() {
	l.activeReqs.Add(1)
}

// DoneRequest 减少活跃请求计数
func (l *Loader) DoneRequest() {
	l.activeReqs.Done()
}

// IsASREnabled 检查ASR（语音识别）功能是否启用
func (l *Loader) IsASREnabled() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.cfg != nil && l.cfg.ASREnabled
}

// resolveEnvVar 解析配置值中的环境变量引用
func resolveEnvVar(value string) string {
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		envKey := value[2 : len(value)-1]
		return os.Getenv(envKey)
	}
	return value
}

// ResolveAPIKey 解析 API Key，支持环境变量和 $security: 引用
func ResolveAPIKey(value, modelName string) string {
	// 先解析环境变量
	value = resolveEnvVar(value)
	// 再解析安全引用
	value = resolveSecurityRef(value, modelName)
	return value
}

// resolveSecurityRef 解析对 .security.yml 中 API key 的引用
func resolveSecurityRef(value string, modelName string) string {
	if !strings.HasPrefix(value, "$security:") {
		return value
	}

	refName := strings.TrimPrefix(value, "$security:")
	if refName == "" {
		refName = modelName
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		logger.Warnf("pet voice: failed to get user home dir: %v", err)
		return value
	}

	securityPath := filepath.Join(homeDir, ".picoclaw", ".security.yml")
	data, err := os.ReadFile(securityPath)
	if err != nil {
		logger.Warnf("pet voice: failed to read .security.yml: %v", err)
		return value
	}

	var secCfg struct {
		ModelList map[string]struct {
			APIKeys []string `yaml:"api_keys"`
		} `yaml:"model_list"`
	}
	if err := yaml.Unmarshal(data, &secCfg); err != nil {
		logger.Warnf("pet voice: failed to parse .security.yml: %v", err)
		return value
	}

	if model, ok := secCfg.ModelList[refName]; ok {
		if len(model.APIKeys) > 0 {
			logger.Infof("pet voice: resolved API key from .security.yml for %s", refName)
			return model.APIKeys[0]
		}
	}

	logger.Warnf("pet voice: no API key found in .security.yml for %s", refName)
	return value
}

// GetVoices 获取指定供应商的可用音色列表
func GetVoices(provider, apiKey, secretKey, model string) (*VoicesResult, error) {
	switch provider {
	case "minimax":
		voices, err := GetMinimaxVoices(apiKey)
		if err != nil {
			return nil, err
		}
		return &VoicesResult{
			Provider:      "minimax",
			MinimaxVoices: voices,
		}, nil
	case "doubao":
		voices, err := GetVolcEngineVoices(apiKey, secretKey, model)
		if err != nil {
			return nil, err
		}
		return &VoicesResult{
			Provider:         "doubao",
			VolcEngineVoices: voices,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported provider: %s", provider)
	}
}
