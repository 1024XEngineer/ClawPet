package pet

import "encoding/json"

// =============================================================================
// 请求类型定义
// =============================================================================

// Request 客户端请求结构
type Request struct {
	Action    string          `json:"action"`               // 操作类型，必填
	Data      json.RawMessage `json:"data"`                 // 请求数据
	RequestID string          `json:"request_id,omitempty"` // 请求ID，用于追踪响应
}

// =============================================================================
// Action 常量定义
// =============================================================================

// Action 请求动作类型
const (
	ActionChat             = "chat"              // 聊天交互
	ActionOnboardingConfig = "onboarding_config" // 提交初始化配置
	ActionCharacterGet     = "character_get"     // 获取角色配置
	ActionCharacterUpdate  = "character_update"  // 更新角色配置
	ActionConfigGet        = "config_get"        // 获取应用配置
	ActionConfigUpdate     = "config_update"     // 更新应用配置
	ActionEmotionGet       = "emotion_get"       // 获取情绪状态
	ActionHealthCheck      = "health_check"      // 健康检查
	ActionVoiceToggle      = "voice_toggle"      // 语音开关
)

// VoiceToggleRequest 语音开关请求数据
type VoiceToggleRequest struct {
	Enabled bool `json:"enabled"`
}

// VoiceToggleResponse 语音开关响应数据
type VoiceToggleResponse struct {
	VoiceEnabled bool `json:"voice_enabled"`
}

// =============================================================================
// PushType 常量定义
// =============================================================================

// PushType 推送类型
const (
	PushTypeAIChat        = "ai_chat"        // AI 聊天回复
	PushTypeEmotionChange = "emotion_change" // 情绪变化
	PushTypeActionTrigger = "action_trigger" // 动作触发
	PushTypeInitStatus    = "init_status"    // 初始化状态（连接建立时推送）
	PushTypeHeartbeat     = "heartbeat"      // 心跳保活
)

// =============================================================================
// Status 常量定义
// =============================================================================

// Status 响应状态
const (
	StatusOK      = "ok"      // 成功
	StatusError   = "error"   // 错误
	StatusPending = "pending" // 处理中
)

// =============================================================================
// 响应结构定义
// =============================================================================

// Response 服务端响应结构
type Response struct {
	Status    string          `json:"status"`               // 状态：ok/error/pending
	Action    string          `json:"action,omitempty"`     // 对应的 action
	Data      json.RawMessage `json:"data,omitempty"`       // 响应数据
	Error     string          `json:"error,omitempty"`      // 错误信息
	RequestID string          `json:"request_id,omitempty"` // 对应的请求ID
}

// Push 推送消息结构
type Push struct {
	Type      string          `json:"type"`      // 固定为 "push"
	PushType  string          `json:"push_type"` // 推送类型
	Data      json.RawMessage `json:"data"`      // 推送数据
	Timestamp int64           `json:"timestamp"` // 时间戳
}

// =============================================================================
// 请求数据定义
// =============================================================================

// ChatRequest 聊天请求数据
type ChatRequest struct {
	Text       string `json:"text"`        // 用户输入的文本内容
	SessionKey string `json:"session_key"` // 会话标识符
}

// OnboardingConfigRequest 初始化配置请求数据
type OnboardingConfigRequest struct {
	PetName        string `json:"pet_name"`         // 桌宠名称
	PetPersona     string `json:"pet_persona"`      // 性格描述
	PetPersonaType string `json:"pet_persona_type"` // 性格类型
}

// CharacterGetRequest 角色获取请求数据
type CharacterGetRequest struct {
	PetID string `json:"pet_id"` // 桌宠ID
}

// CharacterUpdateRequest 角色更新请求数据
type CharacterUpdateRequest struct {
	PetID          string `json:"pet_id"`           // 桌宠ID
	PetName        string `json:"pet_name"`         // 桌宠名称
	PetPersona     string `json:"pet_persona"`      // 性格描述
	PetPersonaType string `json:"pet_persona_type"` // 性格类型
}

// ConfigUpdateRequest 配置更新请求数据
type ConfigUpdateRequest struct {
	EmotionEnabled           *bool   `json:"emotion_enabled"`            // 是否启用情绪表情
	ReminderEnabled          *bool   `json:"reminder_enabled"`           // 是否启用提醒
	ProactiveCare            *bool   `json:"proactive_care"`             // 是否启用主动关怀
	ProactiveIntervalMinutes *int    `json:"proactive_interval_minutes"` // 主动关怀间隔（分钟）
	VoiceEnabled             *bool   `json:"voice_enabled"`              // 是否启用语音
	Language                 *string `json:"language"`                   // 语言设置
}

// EmotionGetRequest 情绪获取请求数据
type EmotionGetRequest struct {
	PetID string `json:"pet_id"` // 桌宠ID
}

// =============================================================================
// 响应数据定义
// =============================================================================

// OnboardingConfigResponse 初始化配置响应数据
type OnboardingConfigResponse struct {
	PetID string `json:"pet_id"` // 桌宠ID
}

// CharacterConfig 角色配置
type CharacterConfig struct {
	PetID          string `json:"pet_id"`           // 桌宠ID
	PetName        string `json:"pet_name"`         // 桌宠名称
	PetPersona     string `json:"pet_persona"`      // 性格描述
	PetPersonaType string `json:"pet_persona_type"` // 性格类型
	Avatar         string `json:"avatar,omitempty"` // 头像/模型ID
	CreatedAt      string `json:"created_at"`       // 创建时间
	UpdatedAt      string `json:"updated_at"`       // 更新时间
}

// MBTIConfig MBTI 性格四维配置
type MBTIConfig struct {
	IE int `json:"ie"` // 内向(I)-外向(E): 0-100, 50中性
	SN int `json:"sn"` // 实感(S)-直觉(N): 0-100, 50中性
	TF int `json:"tf"` // 理性(T)-感性(F): 0-100, 50中性
	JP int `json:"jp"` // 判断(J)-感知(P): 0-100, 50中性
}

// DefaultMBTI 返回默认的中性 MBTI 配置
func DefaultMBTI() MBTIConfig {
	return MBTIConfig{IE: 50, SN: 50, TF: 50, JP: 50}
}

// AppConfig 应用配置
type AppConfig struct {
	EmotionEnabled           bool   `json:"emotion_enabled"`            // 是否启用情绪表情
	ReminderEnabled          bool   `json:"reminder_enabled"`           // 是否启用提醒功能
	ProactiveCare            bool   `json:"proactive_care"`             // 是否启用主动关怀
	ProactiveIntervalMinutes int    `json:"proactive_interval_minutes"` // 主动关怀间隔（分钟）
	VoiceEnabled             bool   `json:"voice_enabled"`              // 是否启用语音
	Language                 string `json:"language"`                   // 语言设置
}

// EmotionState 情绪状态
type EmotionState struct {
	PetID       string `json:"pet_id"`      // 桌宠ID
	Emotion     string `json:"emotion"`     // 情绪标签 (neutral/joy/anger/sadness/disgust/surprise/fear)
	Joy         int    `json:"joy"`         // 快乐值 0-100
	Anger       int    `json:"anger"`       // 愤怒值 0-100
	Sadness     int    `json:"sadness"`     // 悲伤值 0-100
	Disgust     int    `json:"disgust"`     // 厌恶值 0-100
	Surprise    int    `json:"surprise"`    // 惊讶值 0-100
	Fear        int    `json:"fear"`        // 恐惧值 0-100
	Description string `json:"description"` // 情绪中文描述
}

// HealthCheckResponse 健康检查响应数据
type HealthCheckResponse struct {
	Status    string `json:"status"`    // 状态
	Timestamp int64  `json:"timestamp"` // 时间戳
}

// =============================================================================
// 推送数据定义
// =============================================================================

// InitStatusPush 初始化状态推送数据
// 连接建立时后端主动推送，告知前端是否需要配置
type InitStatusPush struct {
	NeedConfig   bool             `json:"need_config"`         // 是否需要配置
	HasCharacter bool             `json:"has_character"`       // 是否有角色配置
	Character    *CharacterConfig `json:"character,omitempty"` // 角色信息（如果有）
	MBTI         MBTIConfig       `json:"mbti"`                // MBTI 配置
	EmotionState EmotionState     `json:"emotion_state"`       // 当前情绪状态
}

// EmotionPush 情绪变化推送数据
type EmotionPush struct {
	Emotion     string `json:"emotion"`     // 情绪标签
	Score       int    `json:"score"`       // 情绪强度 0-100
	Description string `json:"description"` // 情绪描述
}

// ActionPush 动作触发推送数据
type ActionPush struct {
	Action     string `json:"action"`     // 动作名称
	Expression string `json:"expression"` // 表情标识
}

// StreamData 流式聊天数据
type StreamData struct {
	ChatID  int64  `json:"chat_id"`           // 聊天块ID
	Type    string `json:"type"`              // 内容类型：text/final
	Text    string `json:"text"`              // 文本内容
	Emotion string `json:"emotion,omitempty"` // 当前情绪标签
	Action  string `json:"action,omitempty"`  // 动作名称
}
