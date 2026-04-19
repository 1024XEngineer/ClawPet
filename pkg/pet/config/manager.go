package config

import (
	"fmt"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/compression"
	"sync"
)

type Manager struct {
	mu sync.RWMutex

	configLoader *ConfigLoader

	managerPath            string
	characters             []*CharacterConfig
	voiceConfig            *VoiceConfig
	appConfig              *AppConfig
	activeID               string
	characterPrivateConfig *CharacterPrivateConfig
	memoryConfig           *MemoryConfig
	compressionConfig      *compression.CompressionConfig
}

func NewManager(managerPath string) *Manager {
	configLoader := NewConfigLoader(managerPath)
	err := configLoader.Load()
	if err != nil {
		logger.Errorf("pet config: failed to load config, err=%v", err)
		return nil
	}

	characterPrivateConfig, err := configLoader.LoadCharacterPrivateConfig(configLoader.GetActiveID())
	if err != nil {
		logger.Errorf("pet config: failed to load character private config, err=%v", err)
		return nil
	}

	return &Manager{
		managerPath:            managerPath,
		configLoader:           configLoader,
		characters:             configLoader.GetCharacters(),
		voiceConfig:            configLoader.GetVoice(),
		appConfig:              configLoader.GetApp(),
		activeID:               configLoader.GetActiveID(),
		characterPrivateConfig: characterPrivateConfig,
		memoryConfig:           configLoader.GetMemory(),
		compressionConfig:      configLoader.GetCompression(),
	}
}

// Save 保存所有配置到文件
func (m *Manager) Save() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	fmt.Println("pet config: Manager.Save() called")

	// 构建完整 PetConfig（包含 memory 和 compression 配置）
	petCfg := &PetConfig{
		Characters:  m.characters,
		ActiveID:    m.activeID,
		Voice:       m.voiceConfig,
		App:         m.appConfig,
		Memory:      m.memoryConfig,
		Compression: m.compressionConfig,
	}

	err := m.configLoader.SavePetConfig(petCfg)
	if err != nil {
		fmt.Printf("pet config: Manager.Save() failed: %v\n", err)
	} else {
		fmt.Println("pet config: Manager.Save() success")
	}
	return err
}

// GetCharacterByID 根据ID获取角色配置
func (m *Manager) GetCharacterByID(id string) *CharacterConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, char := range m.characters {
		if char.ID == id {
			return char
		}
	}
	return nil
}

// GetActiveCharacter 获取当前激活角色配置
func (m *Manager) GetActiveCharacter() *CharacterConfig {
	return m.GetCharacterByID(m.activeID)
}

// GetCharacters 获取所有角色配置
func (m *Manager) GetCharacters() []*CharacterConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.characters
}

// GetVoice 获取语音配置
func (m *Manager) GetVoice() *VoiceConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.voiceConfig
}

// GetApp 获取应用配置
func (m *Manager) GetApp() *AppConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.appConfig
}

// GetActiveID 获取当前激活角色ID
func (m *Manager) GetActiveID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeID
}

// GetCharacterPrivateConfig 获取当前激活角色的私有配置
func (m *Manager) GetCharacterPrivateConfig() *CharacterPrivateConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.characterPrivateConfig
}

// GetMemory 获取记忆配置
func (m *Manager) GetMemory() *MemoryConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.memoryConfig
}

// GetMemoryTypes 获取可用记忆类型 map
func (m *Manager) GetMemoryTypes() map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.memoryConfig == nil || m.memoryConfig.Types == nil {
		return DefaultMemoryTypes()
	}
	return m.memoryConfig.Types
}

// GetCompression 获取压缩配置
func (m *Manager) GetCompression() *compression.CompressionConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.compressionConfig
}

// GetManagerPath 获取配置管理器的工作空间路径
func (m *Manager) GetManagerPath() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.managerPath
}

// SetActiveID 设置当前激活角色ID
func (m *Manager) SetActiveID(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	err := m.configLoader.SaveCharacterPrivateConfig(m.characterPrivateConfig)
	if err != nil {
		logger.Errorf("pet config: failed to save character private config, err=%v", err)
	}
	m.activeID = id
	characterPrivateConfig, err := m.configLoader.LoadCharacterPrivateConfig(id)
	if err != nil {
		logger.Errorf("pet config: failed to load character private config, err=%v", err)
	}
	m.characterPrivateConfig = characterPrivateConfig
}

// SetCharacterPrivateConfig 设置当前激活角色的私有配置
func (m *Manager) SetCharacterPrivateConfig(config *CharacterPrivateConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.characterPrivateConfig = config
}

// SavePrivateConfig 保存指定角色的私有配置到 workspaces/{id}/config.json
func (m *Manager) SavePrivateConfig(id string, cfg *CharacterPrivateConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.configLoader.SaveCharacterPrivateConfig(cfg)
}

func (m *Manager) SaveCharacterById(id string, char *CharacterConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.characters {
		if m.characters[i].ID == id {
			m.characters[i] = char
			break
		}
	}
}

// AppendCharacter 添加角色配置
func (m *Manager) AppendCharacter(char *CharacterConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.characters = append(m.characters, char)
}

// SetAsrEnabled 设置是否启用语音识别
func (m *Manager) SetAsrEnabled(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.voiceConfig.ASREnabled = enabled
}

// AppendVoiceModel 添加语音模型
func (m *Manager) AppendVoiceModel(model *VoiceModelConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.voiceConfig.ModelList = append(m.voiceConfig.ModelList, model)
}

// SelectVoiceModel 选择语音模型
func (m *Manager) SelectVoiceModel(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.voiceConfig == nil {
		return
	}
	for _, model := range m.voiceConfig.ModelList {
		if model.Name == name {
			m.voiceConfig.DefaultModel = model.Name
			return
		}
	}
	logger.Infof("pet config: voice model %s not found", name)
}

// SetAppConfig 设置应用配置
func (m *Manager) SetAppConfig(config *AppConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.appConfig = config
}
