package voice

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/config"
	"gopkg.in/yaml.v3"
)

// Loader 语音服务加载器
// 根据配置初始化TTS提供者
type Loader struct {
	cfg      *config.VoiceConfig // 语音配置
	provider StreamingTTS        // TTS提供者实例
}

// NewLoader 创建语音加载器实例
func NewLoader(cfg *config.VoiceConfig) *Loader {
	return &Loader{cfg: cfg}
}

// Load 根据配置加载并初始化TTS提供者
// 会根据DefaultModel或第一个启用的模型来确定使用哪个TTS
func (l *Loader) Load() error {
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

	// 创建TTS提供者（目前仅支持Minimax）
	// 先尝试从环境变量解析，再从 security.yml 解析
	apiKey := resolveEnvVar(modelCfg.APIKey)
	apiKey = resolveSecurityRef(apiKey, modelCfg.Name)
	if apiKey == "" || apiKey == "$security:minimax-tts" {
		logger.Warnf("pet voice: API key not resolved, security ref may have failed")
	}
	l.provider = newMinimaxTTS(modelCfg.APIBase, apiKey, modelCfg.Model)
	return nil
}

// GetProvider 返回已加载的TTS提供者
func (l *Loader) GetProvider() StreamingTTS {
	return l.provider
}

// IsASREnabled 检查ASR（语音识别）功能是否启用
func (l *Loader) IsASREnabled() bool {
	return l.cfg != nil && l.cfg.ASREnabled
}

// resolveEnvVar 解析配置值中的环境变量引用
// 格式: ${ENV_VAR_NAME}，会替换为对应环境变量的值
func resolveEnvVar(value string) string {
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		envKey := value[2 : len(value)-1]
		return os.Getenv(envKey)
	}
	return value
}

// resolveSecurityRef 解析对 .security.yml 中 API key 的引用
// 格式: $security:model_name，会从 .security.yml 的 model_list 中获取 API key
func resolveSecurityRef(value string, modelName string) string {
	if !strings.HasPrefix(value, "$security:") {
		return value
	}

	refName := strings.TrimPrefix(value, "$security:")
	if refName == "" {
		refName = modelName
	}

	// 获取用户目录
	securityPaths := []string{}
	if configPath := strings.TrimSpace(os.Getenv("PICOCLAW_CONFIG")); configPath != "" {
		securityPaths = append(securityPaths, filepath.Join(filepath.Dir(configPath), ".security.yml"))
	}
	if picoHome := strings.TrimSpace(os.Getenv("PICOCLAW_HOME")); picoHome != "" {
		securityPaths = append(securityPaths, filepath.Join(picoHome, ".security.yml"))
	}
	if homeDir, err := os.UserHomeDir(); err == nil {
		securityPaths = append(securityPaths, filepath.Join(homeDir, ".picoclaw", ".security.yml"))
	}

	var data []byte
	var err error
	var resolvedPath string
	for _, securityPath := range securityPaths {
		if strings.TrimSpace(securityPath) == "" {
			continue
		}
		data, err = os.ReadFile(securityPath)
		if err == nil {
			resolvedPath = securityPath
			break
		}
	}
	if len(data) == 0 {
		logger.Warnf("pet voice: failed to read .security.yml from candidate paths")
		return value
	}

	// 解析 YAML
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
			logger.Infof("pet voice: resolved API key from %s for %s", resolvedPath, refName)
			return model.APIKeys[0]
		}
	}

	logger.Warnf("pet voice: no API key found in .security.yml for %s", refName)
	return value
}
