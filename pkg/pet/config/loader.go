package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/compression"
)

// ConfigLoader 配置加载器
// 负责从工作区加载和管理pet_config.json统一配置
type ConfigLoader struct {
	config        *PetConfig // 统一配置
	workspacePath string     // 工作区目录路径 (e.g., ~/.picoclaw/workspace)
	homePath      string     // 根目录路径 (e.g., ~/.picoclaw)
}

// NewConfigLoader 创建配置加载器实例
// homePath: 根目录路径 (e.g., ~/.picoclaw)
// workspacePath: 工作区目录路径 (e.g., ~/.picoclaw/workspace)
func NewConfigLoader(homePath, workspacePath string) *ConfigLoader {
	return &ConfigLoader{
		config:        nil,
		homePath:      homePath,
		workspacePath: workspacePath,
	}
}

// WorkspacePath 返回工作区路径
func (l *ConfigLoader) WorkspacePath() string {
	return l.workspacePath
}

// HomePath 返回根目录路径
func (l *ConfigLoader) HomePath() string {
	return l.homePath
}

// migrateFromOldPathIfNeeded 检查并迁移旧路径的配置到新路径
// 返回：是否发生了迁移，新路径是否已存在
func (l *ConfigLoader) migrateFromOldPathIfNeeded() (migrated bool, err error) {
	newPath := filepath.Join(l.workspacePath, PetConfigFile)
	oldPath := filepath.Join(l.homePath, PetConfigFile)

	// 检查新路径是否已存在
	newExists, _ := fileExists(newPath)
	if newExists {
		logger.Debugf("pet config: new path already exists at %s, no migration needed", newPath)
		return false, nil
	}

	// 检查旧路径是否存在
	oldExists, err := fileExists(oldPath)
	if err != nil {
		return false, fmt.Errorf("failed to check old path: %w", err)
	}
	if !oldExists {
		// 旧路径也不存在，无需迁移
		logger.Debugf("pet config: no old config found at %s, will use defaults", oldPath)
		return false, nil
	}

	// 旧路径存在但新路径不存在，需要迁移
	logger.Infof("pet config: migrating config from old path %s to new path %s", oldPath, newPath)

	// 确保新路径的目录存在
	if err := os.MkdirAll(l.workspacePath, 0755); err != nil {
		return false, fmt.Errorf("failed to create workspace directory: %w", err)
	}

	// 读取旧配置
	oldData, err := os.ReadFile(oldPath)
	if err != nil {
		return false, fmt.Errorf("failed to read old config: %w", err)
	}

	// 写入新路径
	if err := os.WriteFile(newPath, oldData, 0644); err != nil {
		return false, fmt.Errorf("failed to write migrated config: %w", err)
	}

	logger.Infof("pet config: successfully migrated config from %s to %s", oldPath, newPath)
	return true, nil
}

// fileExists 检查文件是否存在
func fileExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// Load 加载统一配置文件pet_config.json
// 支持从新路径加载，同时兼容旧路径（用于迁移）
func (l *ConfigLoader) Load() error {
	// 1. 首先尝试迁移旧配置到新路径
	migrated, err := l.migrateFromOldPathIfNeeded()
	if err != nil {
		// 迁移失败，回退到旧路径
		logger.Warnf("pet config: migration failed, will try old path: %v", err)
	}

	// 2. 确定加载路径（新路径优先，但兼容旧路径）
	newPath := filepath.Join(l.workspacePath, PetConfigFile)
	oldPath := filepath.Join(l.homePath, PetConfigFile)

	var path string
	if migrated {
		// 如果迁移成功了，使用新路径
		path = newPath
		logger.Debugf("pet config: using migrated config from %s", path)
	} else {
		// 检查新路径是否存在
		newExists, _ := fileExists(newPath)
		if newExists {
			path = newPath
			logger.Debugf("pet config: using new config path %s", path)
		} else {
			// 新路径不存在，尝试旧路径
			path = oldPath
			logger.Debugf("pet config: new path not found, trying old path %s", path)
		}
	}

	logger.Debugf("pet config: loading config from %s", path)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// 文件不存在，使用默认配置
			l.config = DefaultPetConfig()
			logger.Infof("pet config: no config file found at any path, using defaults")
			return nil
		}
		return fmt.Errorf("failed to read %s: %w", path, err)
	}

	var cfg PetConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("failed to parse %s: %w", path, err)
	}

	// 至少需要一个角色
	if len(cfg.Characters) == 0 {
		cfg.Characters = []*CharacterConfig{DefaultCharacterConfig()}
	}

	// 如果没有设置激活角色，默认激活第一个
	if cfg.ActiveID == "" {
		cfg.ActiveID = cfg.Characters[0].ID
	}

	// 确保voice和app不为nil
	if cfg.Voice == nil {
		cfg.Voice = DefaultVoiceConfig()
	}
	if cfg.App == nil {
		cfg.App = DefaultAppConfig()
	}
	// 确保 memory 和 compression 配置存在，使用默认值
	if cfg.Memory == nil {
		cfg.Memory = DefaultMemoryConfig()
	}
	if cfg.Memory.Types == nil {
		cfg.Memory.Types = DefaultMemoryTypes()
	}
	if cfg.Compression == nil {
		cfg.Compression = DefaultCompressionConfig()
	}

	l.config = &cfg

	logger.Infof("pet config: loaded config, active_id=%s, voice_enabled=%v", cfg.ActiveID, cfg.App.VoiceEnabled)
	return nil
}

// Save 保存配置到pet_config.json
func (l *ConfigLoader) Save() error {

	if l.config == nil {
		return fmt.Errorf("config not loaded")
	}

	path := filepath.Join(l.workspacePath, PetConfigFile)

	// 确保目录存在
	if err := os.MkdirAll(l.workspacePath, 0755); err != nil {
		return fmt.Errorf("failed to create workspace dir: %w", err)
	}

	data, err := json.MarshalIndent(l.config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}

	logger.Infof("pet config: saved to %s", path)
	return nil
}

// GetConfig 返回完整配置（只读）
func (l *ConfigLoader) GetConfig() *PetConfig {
	if l.config == nil {
		return nil
	}
	cfg := *l.config // 返回副本
	return &cfg
}

// GetActiveID 返回当前激活的角色ID（只读）
func (l *ConfigLoader) GetActiveID() string {
	if l.config == nil {
		return ""
	}
	return l.config.ActiveID
}

// GetCharacters 返回角色列表（只读）
func (l *ConfigLoader) GetCharacters() []*CharacterConfig {
	if l.config == nil || l.config.Characters == nil {
		return []*CharacterConfig{}
	}
	return l.config.Characters
}

// GetVoice 返回语音配置（深拷贝，避免共享状态）
func (l *ConfigLoader) GetVoice() *VoiceConfig {
	if l.config == nil || l.config.Voice == nil {
		return DefaultVoiceConfig()
	}
	return l.config.Voice.DeepCopy()
}

// GetApp 返回应用配置（只读）
func (l *ConfigLoader) GetApp() *AppConfig {
	if l.config == nil || l.config.App == nil {
		return DefaultAppConfig()
	}
	cfg := *l.config.App
	return &cfg
}

// GetMemory 获取记忆配置
func (l *ConfigLoader) GetMemory() *MemoryConfig {
	if l.config == nil || l.config.Memory == nil {
		return DefaultMemoryConfig()
	}
	cfg := *l.config.Memory
	return &cfg
}

// GetMemoryTypes 获取可用记忆类型 map
func (l *ConfigLoader) GetMemoryTypes() map[string]string {
	if l.config == nil || l.config.Memory == nil || l.config.Memory.Types == nil {
		return DefaultMemoryTypes()
	}
	return l.config.Memory.Types
}

// GetCompression 获取压缩配置
func (l *ConfigLoader) GetCompression() *compression.CompressionConfig {
	if l.config == nil || l.config.Compression == nil {
		return compression.DefaultCompressionConfig()
	}
	cfg := *l.config.Compression
	return &cfg
}

// GetVoiceModelConfig 根据名称获取语音模型配置
func (l *ConfigLoader) GetVoiceModelConfig(name string) *VoiceModelConfig {

	if l.config == nil || l.config.Voice == nil {
		return nil
	}

	for _, m := range l.config.Voice.ModelList {
		if m.Name == name {
			return m
		}
	}
	return nil
}

// GetVoiceModelList 获取所有语音模型（TTS）列表
func (l *ConfigLoader) GetVoiceModelList() []*VoiceModelConfig {
	if l.config == nil || l.config.Voice == nil {
		return nil
	}
	return l.config.Voice.ModelList
}

// GetDefaultVoiceModelName 获取默认语音模型名称
func (l *ConfigLoader) GetDefaultVoiceModelName() string {
	if l.config == nil || l.config.Voice == nil {
		return ""
	}
	return l.config.Voice.DefaultModel
}

// GetASRModelConfig 根据名称获取ASR模型配置
func (l *ConfigLoader) GetASRModelConfig(name string) *ASRModelConfig {
	if l.config == nil || l.config.Voice == nil {
		return nil
	}

	for _, m := range l.config.Voice.ASRModelList {
		if m.Name == name {
			return m
		}
	}
	return nil
}

// GetDefaultASRModel 获取默认ASR模型配置
func (l *ConfigLoader) GetDefaultASRModel() *ASRModelConfig {
	if l.config == nil || l.config.Voice == nil || l.config.Voice.DefaultASRModel == "" {
		return nil
	}

	for _, m := range l.config.Voice.ASRModelList {
		if m.Name == l.config.Voice.DefaultASRModel {
			return m
		}
	}
	return nil
}

// GetASRModelList 获取ASR模型列表
func (l *ConfigLoader) GetASRModelList() []*ASRModelConfig {
	if l.config == nil || l.config.Voice == nil {
		return nil
	}
	return l.config.Voice.ASRModelList
}

// GetDefaultASRModelName 获取默认ASR模型名称
func (l *ConfigLoader) GetDefaultASRModelName() string {
	if l.config == nil || l.config.Voice == nil {
		return ""
	}
	return l.config.Voice.DefaultASRModel
}

// LoadCharacterPrivateConfig 加载角色私有配置
func (l *ConfigLoader) LoadCharacterPrivateConfig(charID string) (*CharacterPrivateConfig, error) {

	charPath := filepath.Join(l.workspacePath, WorkspacePath, charID, CharacterConfigFile)

	data, err := os.ReadFile(charPath)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultCharacterPrivateConfig(charID), nil
		}
		return nil, fmt.Errorf("failed to read %s: %w", charPath, err)
	}

	var cfg CharacterPrivateConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", charPath, err)
	}

	return &cfg, nil
}

// SaveCharacterPrivateConfig 保存角色私有配置
func (l *ConfigLoader) SaveCharacterPrivateConfig(cfg *CharacterPrivateConfig) error {
	if cfg == nil {
		return fmt.Errorf("config is nil")
	}

	charDir := filepath.Join(l.workspacePath, WorkspacePath, cfg.ID)
	if err := os.MkdirAll(charDir, 0755); err != nil {
		return fmt.Errorf("failed to create character dir: %w", err)
	}

	charPath := filepath.Join(charDir, CharacterConfigFile)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal: %w", err)
	}

	if err := os.WriteFile(charPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", charPath, err)
	}

	return nil
}

// EnsureDefaultConfig 确保配置目录中存在默认配置文件
func EnsureDefaultConfig(workspacePath string) error {
	configPath := filepath.Join(workspacePath, PetConfigFile)

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		defaultCfg := DefaultPetConfig()
		data, _ := json.MarshalIndent(defaultCfg, "", "  ")
		if err := os.WriteFile(configPath, data, 0644); err != nil {
			return fmt.Errorf("failed to create default %s: %w", configPath, err)
		}
		logger.Infof("pet config: created default %s", configPath)
	}

	// 同时确保私有配置目录存在
	privatePath := filepath.Join(workspacePath, "workspaces")
	if err := os.MkdirAll(privatePath, 0755); err != nil {
		return fmt.Errorf("failed to create workspaces dir: %w", err)
	}

	return nil
}

// SavePetConfig 保存完整的 PetConfig 到文件
func (l *ConfigLoader) SavePetConfig(cfg *PetConfig) error {
	path := filepath.Join(l.workspacePath, PetConfigFile)

	if err := os.MkdirAll(l.workspacePath, 0755); err != nil {
		return fmt.Errorf("failed to create workspace dir: %w", err)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", tmpPath, err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename %s: %w", path, err)
	}

	logger.Infof("pet config: saved to %s", path)
	return nil
}
