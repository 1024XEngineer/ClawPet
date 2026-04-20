package characters

import (
	"fmt"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/config"
	"github.com/sipeed/picoclaw/pkg/pet/emotion"
)

// Manager 角色管理器
// 负责管理所有角色，支持多角色切换
// 注意：所有配置统一由 config.Manager 管理，Manager 只负责内存中的角色对象
// 注意：所有访问 characters map 的方法都需要加锁保护
type Manager struct {
	mu            sync.RWMutex          // 保护 characters map 的读写锁
	characters    map[string]*Character // 所有角色映射
	configManager *config.Manager       // 配置管理器（统一配置管理）
}

// NewManager 从配置创建角色管理器
// 会根据配置初始化所有角色及其情绪、MBTI状态
func NewManager(cfg []*config.CharacterConfig, configManager *config.Manager) (*Manager, error) {
	if cfg == nil || len(cfg) == 0 {
		return nil, fmt.Errorf("no characters provided")
	}

	m := &Manager{
		characters:    make(map[string]*Character),
		configManager: configManager,
	}

	// 获取初始 activeID（从 configManager 获取，不需要锁）
	initialActiveID := ""
	if configManager != nil {
		initialActiveID = configManager.GetActiveID()
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 初始化所有角色
	for _, cc := range cfg {
		char := NewCharacter(cc.ID, cc.Name, cc.Persona, cc.PersonaType, cc.Avatar)

		// 尝试加载私有配置获取情绪状态和MBTI
		if configManager != nil {
			// 只加载当前角色的私有配置
			if cc.ID == configManager.GetActiveID() {
				if privateCfg := configManager.GetCharacterPrivateConfig(); privateCfg != nil {
					char.SetEmotions(emotion.SixEmotions{
						Joy:      privateCfg.EmotionState.Joy,
						Anger:    privateCfg.EmotionState.Anger,
						Sadness:  privateCfg.EmotionState.Sadness,
						Disgust:  privateCfg.EmotionState.Disgust,
						Surprise: privateCfg.EmotionState.Surprise,
						Fear:     privateCfg.EmotionState.Fear,
					})
					char.EmotionEngine.SetPersonality(emotion.MBTIPersonality{
						IE: privateCfg.MBTI.IE,
						SN: privateCfg.MBTI.SN,
						TF: privateCfg.MBTI.TF,
						JP: privateCfg.MBTI.JP,
					})

					// 设置波动系数
					if privateCfg.Volatility > 0 {
						char.EmotionEngine.SetVolatility(privateCfg.Volatility)
					}

					// 根据时间计算衰减
					if privateCfg.LastUpdate > 0 {
						lastUpdate := time.Unix(privateCfg.LastUpdate, 0)
						elapsed := time.Since(lastUpdate)
						if elapsed > 0 {
							char.EmotionEngine.ApplyDecay(elapsed)
						}
					}
				}
			}
		}

		m.characters[char.ID] = char
		logger.Infof("characters: loaded character id=%s, name=%s", char.ID, char.Name)
	}

	// 验证 activeID 是否有效
	activeID := configManager.GetActiveID()
	if _, ok := m.characters[activeID]; !ok {
		if len(m.characters) > 0 {
			// 如果配置的 activeID 无效，默认使用第一个角色
			for id := range m.characters {
				activeID = id
				break
			}
			configManager.SetActiveID(activeID)
		} else {
			return nil, fmt.Errorf("no valid active character ID")
		}
	}

	logger.Infof("characters: manager created with %d characters, active=%s", len(m.characters), initialActiveID)
	return m, nil
}

// GetCurrent 获取当前激活的角色
func (m *Manager) GetCurrent() *Character {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.characters[m.GetCurrentID()]
}

// GetCurrentID 获取当前激活角色的ID
// 统一从 config.Manager 获取，确保单一真相源
func (m *Manager) GetCurrentID() string {
	if m.configManager == nil {
		return ""
	}
	return m.configManager.GetActiveID()
}

// Switch 切换到指定角色
// 切换是即时完成的，同时更新 config.Manager 中的 activeID
func (m *Manager) Switch(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if id == m.GetCurrentID() {
		return nil // 已经是目标角色，无需切换
	}

	if _, ok := m.characters[id]; !ok {
		return fmt.Errorf("character %s not found", id)
	}

	logger.Infof("characters: switching from %s to %s", m.GetCurrentID(), id)

	// 更新 config.Manager 中的 activeID（会保存旧角色私有配置并加载新角色）
	m.configManager.SetActiveID(id)

	// 更新内存中当前角色的情绪和MBTI
	if char, ok := m.characters[id]; ok {
		if privateCfg := m.configManager.GetCharacterPrivateConfig(); privateCfg != nil {
			char.SetEmotions(emotion.SixEmotions{
				Joy:      privateCfg.EmotionState.Joy,
				Anger:    privateCfg.EmotionState.Anger,
				Sadness:  privateCfg.EmotionState.Sadness,
				Disgust:  privateCfg.EmotionState.Disgust,
				Surprise: privateCfg.EmotionState.Surprise,
				Fear:     privateCfg.EmotionState.Fear,
			})
			char.EmotionEngine.SetPersonality(emotion.MBTIPersonality{
				IE: privateCfg.MBTI.IE,
				SN: privateCfg.MBTI.SN,
				TF: privateCfg.MBTI.TF,
				JP: privateCfg.MBTI.JP,
			})
		}
	}

	return nil
}

// List 返回所有角色列表
func (m *Manager) List() []*Character {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Character, 0, len(m.characters))
	for _, c := range m.characters {
		result = append(result, c)
	}
	return result
}

// Get 根据ID获取指定角色
func (m *Manager) Get(id string) *Character {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.characters[id]
}

// Add 添加新角色到管理器
func (m *Manager) Add(c *Character) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.characters[c.ID] = c
}

// Remove 从管理器移除角色
// 不能移除当前激活的角色
func (m *Manager) Remove(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if id == m.GetCurrentID() {
		return fmt.Errorf("cannot remove active character")
	}
	if _, ok := m.characters[id]; !ok {
		return fmt.Errorf("character %s not found", id)
	}
	delete(m.characters, id)
	return nil
}

// UpdateCharacter 更新角色公开信息
func (m *Manager) UpdateCharacter(id string, name, persona, personaType string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if char, ok := m.characters[id]; ok {
		if name != "" {
			char.Name = name
		}
		if persona != "" {
			char.Persona = persona
		}
		if personaType != "" {
			char.PersonaType = personaType
		}

		// 同步到 configManager
		if m.configManager != nil {
			charCfg := &config.CharacterConfig{
				ID:          char.ID,
				Name:        char.Name,
				Persona:     char.Persona,
				PersonaType: char.PersonaType,
				Avatar:      char.Avatar,
			}
			m.configManager.SaveCharacterById(id, charCfg)
		}
	}
}

// SavePrivateConfig 保存当前角色的私有配置到 workspaces/{id}/config.json
// 包括情绪状态和MBTI
func (m *Manager) SavePrivateConfig() error {
	if m.configManager == nil {
		return nil
	}

	m.mu.RLock()
	char := m.characters[m.GetCurrentID()]
	m.mu.RUnlock()

	if char == nil {
		return nil
	}

	emo := char.GetEmotions()
	mbti := char.EmotionEngine.GetPersonality()
	volatility := char.EmotionEngine.GetVolatility()
	lastUpdate := time.Now().Unix()

	privateCfg := &config.CharacterPrivateConfig{
		ID: char.ID,
		EmotionState: &config.EmotionState{
			Joy:      emo.Joy,
			Anger:    emo.Anger,
			Sadness:  emo.Sadness,
			Disgust:  emo.Disgust,
			Surprise: emo.Surprise,
			Fear:     emo.Fear,
		},
		MBTI: &config.MBTIConfig{
			IE: mbti.IE,
			SN: mbti.SN,
			TF: mbti.TF,
			JP: mbti.JP,
		},
		LastUpdate: lastUpdate,
		Volatility: volatility,
	}

	return m.configManager.SavePrivateConfig(char.ID, privateCfg)
}

// ToPublicConfig 将当前状态转换为公开配置结构
// 只包含公开信息，不包含私有情绪/MBTI
func (m *Manager) ToPublicConfig() []*config.CharacterConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	characters := make([]*config.CharacterConfig, 0, len(m.characters))
	for _, c := range m.characters {
		characters = append(characters, &config.CharacterConfig{
			ID:          c.ID,
			Name:        c.Name,
			Persona:     c.Persona,
			PersonaType: c.PersonaType,
			Avatar:      c.Avatar,
		})
	}
	return characters
}
