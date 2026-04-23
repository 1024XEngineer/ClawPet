package config

import "github.com/sipeed/picoclaw/pkg/pet/compression"

const (
	PetConfigFile       = "pet_config.json" // 统一配置文件名
	CharacterConfigFile = "config.json"     // 角色私有配置文件文件名
	WorkspacePath       = "workspaces"      // 私有配置目录路径
)

// PetConfig Pet统一配置结构
// 包含所有pet相关配置，统一加载和保存
type PetConfig struct {
	Characters  []*CharacterConfig             `json:"characters"`  // 角色列表
	ActiveID    string                         `json:"active_id"`   // 当前激活的角色ID
	Voice       *VoiceConfig                   `json:"voice"`       // 语音配置
	App         *AppConfig                     `json:"app"`         // 应用运行时配置
	Memory      *MemoryConfig                  `json:"memory"`      // 记忆配置
	Compression *compression.CompressionConfig `json:"compression"` // 压缩配置
}

// AppConfig 应用运行时配置
// 控制pet应用的行为开关
type AppConfig struct {
	EmotionEnabled           bool   `json:"emotion_enabled"`            // 是否启用情绪表情
	ReminderEnabled          bool   `json:"reminder_enabled"`           // 是否启用提醒
	ProactiveCare            bool   `json:"proactive_care"`             // 是否启用主动关怀
	ProactiveIntervalMinutes int    `json:"proactive_interval_minutes"` // 主动关怀间隔（分钟）
	VoiceEnabled             bool   `json:"voice_enabled"`              // 是否启用语音播报
	Language                 string `json:"language"`                   // 语言设置
}

// DefaultAppConfig 返回默认的应用配置
func DefaultAppConfig() *AppConfig {
	return &AppConfig{
		EmotionEnabled:           true,
		ReminderEnabled:          true,
		ProactiveCare:            true,
		ProactiveIntervalMinutes: 30,
		VoiceEnabled:             false,
		Language:                 "zh-CN",
	}
}

// MemoryConfig 记忆配置
// 控制记忆存储和显示的相关参数
type MemoryConfig struct {
	MaxMemories int               `json:"max_memories"` // 最大显示记忆数
	Types       map[string]string `json:"types"`        // 可用记忆类型 map[类型名]描述
}

// DefaultMemoryConfig 返回默认的记忆配置
func DefaultMemoryConfig() *MemoryConfig {
	return &MemoryConfig{
		MaxMemories: 500,
		Types:       DefaultMemoryTypes(),
	}
}

// DefaultMemoryTypes 返回默认的记忆类型定义
func DefaultMemoryTypes() map[string]string {
	return map[string]string{
		MemoryTypeConversation:   "对话记忆",
		MemoryTypePreference:     "宠物偏好",
		MemoryTypeFact:           "事实知识",
		MemoryTypeUserProfile:    "用户基础信息",
		MemoryTypeUserPreference: "用户偏好",
	}
}

// 推荐记忆类型常量（供 LLM 和开发者参考，不强制）
const (
	MemoryTypeConversation   = "conversation"    // 对话记忆
	MemoryTypePreference     = "preference"      // 宠物偏好
	MemoryTypeFact           = "fact"            // 事实知识
	MemoryTypeUserProfile    = "user_profile"    // 用户基础信息
	MemoryTypeUserPreference = "user_preference" // 用户偏好
)

// DefaultCompressionConfig 返回默认的压缩配置
// 委托给 compression 包提供默认值
func DefaultCompressionConfig() *compression.CompressionConfig {
	return compression.DefaultCompressionConfig()
}

// CharactersConfig 多角色配置结构（向后兼容）
type CharactersConfig struct {
	Characters []*CharacterConfig `json:"characters"` // 角色列表
	ActiveID   string             `json:"active_id"`  // 当前激活的角色ID
}

// CharacterConfig 单个角色的公开配置
// 包含角色的基本信息（私有数据在workspaces/{id}/config.json）
type CharacterConfig struct {
	ID          string `json:"id"`           // 角色唯一标识
	Name        string `json:"name"`         // 角色名称
	Persona     string `json:"persona"`      // 性格描述
	PersonaType string `json:"persona_type"` // 性格类型（如gentle/playful等）
	Avatar      string `json:"avatar"`       // 头像/模型ID
}

// CharacterPrivateConfig 角色私有配置
// 存储在workspaces/{id}/config.json
type CharacterPrivateConfig struct {
	ID           string        `json:"id"`            // 角色唯一标识
	EmotionState *EmotionState `json:"emotion_state"` // 情绪状态
	MBTI         *MBTIConfig   `json:"mbti"`          // MBTI配置
	LastUpdate   int64         `json:"last_update"`   // 最后更新时间（Unix时间戳）
	Volatility   float64       `json:"volatility"`    // 情绪波动系数
}

// EmotionState 情绪状态配置
// 六大基础情绪的强度值，50为中性
type EmotionState struct {
	Joy      int `json:"joy"`      // 快乐值 0-100
	Anger    int `json:"anger"`    // 愤怒值 0-100
	Sadness  int `json:"sadness"`  // 悲伤值 0-100
	Disgust  int `json:"disgust"`  // 厌恶值 0-100
	Surprise int `json:"surprise"` // 惊讶值 0-100
	Fear     int `json:"fear"`     // 恐惧值 0-100
}

// ToSixEmotions 转换为emotion包的SixEmotions结构
func (e *EmotionState) ToSixEmotions() SixEmotions {
	return SixEmotions{
		Joy:      e.Joy,
		Anger:    e.Anger,
		Sadness:  e.Sadness,
		Disgust:  e.Disgust,
		Surprise: e.Surprise,
		Fear:     e.Fear,
	}
}

// SixEmotions 六维情绪结构（用于内部计算）
type SixEmotions struct {
	Joy      int // 快乐
	Anger    int // 愤怒
	Sadness  int // 悲伤
	Disgust  int // 厌恶
	Surprise int // 惊讶
	Fear     int // 恐惧
}

// MBTIConfig MBTI性格四维配置
// 每个维度0-100，50为中心点
type MBTIConfig struct {
	IE float64 `json:"ie"` // 内向(I)-外向(E)：<50偏内向，>50偏外向
	SN float64 `json:"sn"` // 实感(S)-直觉(N)：<50偏实感，>50偏直觉
	TF float64 `json:"tf"` // 理性(T)-感性(F)：<50偏理性，>50偏感性
	JP float64 `json:"jp"` // 判断(J)-感知(P)：<50偏判断，>50偏感知
}

// VoiceConfig 语音配置结构
// 包含TTS模型列表和ASR设置
type VoiceConfig struct {
	ModelList    []*VoiceModelConfig `json:"model_list"`    // 可用的语音模型列表
	DefaultModel string              `json:"default_model"` // 默认使用的模型名称
	ASREnabled   bool                `json:"asr_enabled"`   // 是否启用语音识别
}

// VoiceModelConfig 语音模型配置
// 支持多种TTS服务商
type VoiceModelConfig struct {
	Name     string         `json:"name"`     // 模型标识名称
	Provider string         `json:"provider"` // 供应商类型：minimax / doubao
	Model    string         `json:"model"`    // 实际使用的模型ID（如speech-2.8-hd）
	APIKey   string         `json:"api_key"`  // API密钥（支持${ENV_VAR}格式）
	APIBase  string         `json:"api_base"` // API地址
	VoiceID  string         `json:"voice_id"` // 音色ID
	Extra    map[string]any `json:"extra"`    // 供应商特定参数（如 secret_key）
	Enabled  bool           `json:"enabled"`  // 是否启用
}

// MaskedAPIKey 返回脱敏后的 APIKey（已配置则显示 "******"）
func (c *VoiceModelConfig) MaskedAPIKey() string {
	if c.APIKey != "" {
		return "******"
	}
	return ""
}

var sensitiveExtraKeys = []string{
	"accessKeyId",
	"secretAccessKey",
	"accessToken",
	"appId",
	"apiKey",
	"secret_key",
}

func isSensitiveExtraKey(key string) bool {
	for _, k := range sensitiveExtraKeys {
		if k == key {
			return true
		}
	}
	return false
}

// MaskedExtra 返回脱敏后的 Extra
func (c *VoiceModelConfig) MaskedExtra() map[string]any {
	if c.Extra == nil {
		return nil
	}
	result := make(map[string]any)
	for k, v := range c.Extra {
		if isSensitiveExtraKey(k) && v != "" {
			result[k] = "******"
		} else {
			result[k] = v
		}
	}
	return result
}

// DefaultEmotionState 返回默认的中性情绪状态
func DefaultEmotionState() *EmotionState {
	return &EmotionState{
		Joy:      50,
		Anger:    50,
		Sadness:  50,
		Disgust:  50,
		Surprise: 50,
		Fear:     50,
	}
}

// DefaultMBTI 返回默认的MBTI配置
func DefaultMBTI() *MBTIConfig {
	return &MBTIConfig{
		IE: 50.0,
		SN: 50.0,
		TF: 50.0,
		JP: 50.0,
	}
}

// DefaultCharacterConfig 返回默认的角色公开配置
func DefaultCharacterConfig() *CharacterConfig {
	return &CharacterConfig{
		ID:          "pet_001",
		Name:        "艾莉",
		Persona:     "温柔体贴，善于关心他人",
		PersonaType: "gentle",
		Avatar:      "default",
	}
}

// DefaultCharacterPrivateConfig 返回默认的角色私有配置
func DefaultCharacterPrivateConfig(id string) *CharacterPrivateConfig {
	return &CharacterPrivateConfig{
		ID:           id,
		EmotionState: DefaultEmotionState(),
		MBTI:         DefaultMBTI(),
	}
}

// DefaultVoiceConfig 返回默认的语音配置
func DefaultVoiceConfig() *VoiceConfig {
	return &VoiceConfig{
		ModelList: []*VoiceModelConfig{
			{
				Name:     "doubao-tts",
				Provider: "doubao",
				Model:    "chatSpeech_t茄子_turbo_online",
				APIBase:  "https://openspeech.bytedance.com/api/v1/tts",
				VoiceID:  "BV001_tutorial",
				Extra: map[string]any{
					"secret_key": "",
				},
				Enabled: false,
			},
		},
		DefaultModel: "doubao-tts",
		ASREnabled:   false,
	}
}

// DefaultPetConfig 返回默认的统一配置
func DefaultPetConfig() *PetConfig {
	return &PetConfig{
		Characters: []*CharacterConfig{DefaultCharacterConfig()},
		ActiveID:   "pet_001",
		Voice:      DefaultVoiceConfig(),
		App:        DefaultAppConfig(),
	}
}
