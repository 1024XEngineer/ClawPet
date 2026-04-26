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
	ActionChat                 = "chat"                    // 聊天交互
	ActionOnboardingConfig     = "onboarding_config"       // 提交初始化配置
	ActionUserProfileUpdate    = "user_profile_update"     // 用户画像更新
	ActionCharacterGet         = "character_get"           // 获取角色配置
	ActionCharacterUpdate      = "character_update"        // 更新角色配置
	ActionCharacterSwitch      = "character_switch"        // 切换角色
	ActionConfigGet            = "config_get"              // 获取应用配置
	ActionConfigUpdate         = "config_update"           // 更新应用配置
	ActionEmotionGet           = "emotion_get"             // 获取情绪状态
	ActionHealthCheck          = "health_check"            // 健康检查
	ActionMemorySearch         = "memory_search"           // 搜索记忆
	ActionConversationList     = "conversation_list"       // 对话列表
	ActionModelListGet         = "model_list_get"          // 获取模型列表
	ActionModelAdd             = "model_add"               // 添加模型
	ActionModelUpdate          = "model_update"            // 更新模型
	ActionModelDelete          = "model_delete"            // 删除模型
	ActionModelSetDefault      = "model_set_default"       // 设置默认模型
	ActionCronAdd              = "cron_add"                // 添加定时任务
	ActionCronList             = "cron_list"               // 列出定时任务
	ActionCronRemove           = "cron_remove"             // 删除定时任务
	ActionCronEnable           = "cron_enable"             // 启用定时任务
	ActionCronDisable          = "cron_disable"            // 禁用定时任务
	ActionVoiceModelListGet    = "voice_model_list_get"    // 获取语音模型列表
	ActionVoiceModelGet        = "voice_model_get"         // 获取语音模型详情
	ActionVoiceModelUpdate     = "voice_model_update"      // 更新语音模型配置
	ActionVoiceModelSetDefault = "voice_model_set_default" // 设置默认语音模型
	ActionVoiceModelGetVoices  = "voice_model_get_voices"  // 获取供应商可用音色
	ActionSkillList            = "skill_list"              // 列出 skills
	ActionSkillSearch          = "skill_search"            // 搜索 skills
	ActionSkillInstall         = "skill_install"           // 安装 skill
	ActionSkillRemove          = "skill_remove"            // 删除 skill
	ActionSkillGet             = "skill_get"               // 获取 skill 内容
	ActionCharacterCreate      = "character_create"        // 创建角色
	ActionUserProfileGet       = "user_profile_get"        // 获取用户画像
)

// =============================================================================
// PushType 常量定义
// =============================================================================

// PushType 推送类型
const (
	// PushType 推送类型
	PushTypeAIChat          = "ai_chat"          // AI 聊天回复
	PushTypeEmotionChange   = "emotion_change"   // 情绪变化
	PushTypeActionTrigger   = "action_trigger"   // 动作触发
	PushTypeInitStatus      = "init_status"      // 初始化状态（连接建立时推送）
	PushTypeHeartbeat       = "heartbeat"        // 心跳保活
	PushTypeCharacterSwitch = "character_switch" // 角色切换
	PushTypeAudio           = "audio"            // 音频播放
	PushTypeTextAndAudio    = "text_and_audio"   // 文本和音频同时推送
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

// UserProfileUpdateRequest 用户画像更新请求
type UserProfileUpdateRequest struct {
	DisplayName     string         `json:"display_name"`
	Role            string         `json:"role"`
	Language        string         `json:"language"`
	Chronotype      string         `json:"chronotype"`
	PersonalityTone string         `json:"personality_tone"`
	AnxietyLevel    int            `json:"anxiety_level"`
	PressureLevel   string         `json:"pressure_level"`
	Extra           map[string]any `json:"extra"`
}

// UserProfileDataRequest 用户实时状态更新请求
type UserProfileDataRequest struct {
	CurrentMood     string `json:"current_mood"`
	EnergyLevel     int    `json:"energy_level"`
	EngagementLevel int    `json:"engagement_level"`
	StressTrend     string `json:"stress_trend"`
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
	SpeechTone     string `json:"speech_tone"`      // 说话风格
	Catchphrase    string `json:"catchphrase"`      // 口头禅
	Hobbies        string `json:"hobbies"`          // 兴趣爱好
	Background     string `json:"background"`       // 背景设定
	Preferences    string `json:"preferences"`      // 偏好
}

// CharacterSwitchRequest 角色切换请求数据
type CharacterSwitchRequest struct {
	CharacterID string `json:"character_id"` // 目标角色ID
}

// CharacterCreateRequest 创建角色请求数据
type CharacterCreateRequest struct {
	PetName        string `json:"pet_name"`         // 桌宠名称
	PetPersona     string `json:"pet_persona"`      // 性格描述
	PetPersonaType string `json:"pet_persona_type"` // 性格类型
	SpeechTone     string `json:"speech_tone"`      // 说话风格
	Catchphrase    string `json:"catchphrase"`      // 口头禅
	Hobbies        string `json:"hobbies"`          // 兴趣爱好
	Background     string `json:"background"`       // 背景设定
	Preferences    string `json:"preferences"`      // 偏好
	Avatar         string `json:"avatar"`           // 头像/模型ID
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

// MemorySearchRequest 搜索记忆请求
type MemorySearchRequest struct {
	CharacterID string `json:"character_id"`         // 角色ID，必填
	Keyword     string `json:"keyword,omitempty"`    // 关键词搜索
	Type        string `json:"type,omitempty"`       // 记忆类型过滤
	MinWeight   int    `json:"min_weight,omitempty"` // 最低权重
	Limit       int    `json:"limit,omitempty"`      // 返回条数限制
	Offset      int    `json:"offset,omitempty"`     // 翻页偏移
}

// MemoryItem 记忆条目（用于响应）
type MemoryItem struct {
	ID        int64  `json:"id"`         // 记忆ID
	Type      string `json:"type"`       // 记忆类型
	Weight    int    `json:"weight"`     // 权重 0-100
	Content   string `json:"content"`    // 记忆内容
	CreatedAt string `json:"created_at"` // 创建时间
}

// MemorySearchResponse 搜索记忆响应
type MemorySearchResponse struct {
	Memories []MemoryItem `json:"memories"` // 记忆列表
	Total    int          `json:"total"`    // 总数量
	HasMore  bool         `json:"has_more"` // 是否有更多
}

// ConversationListRequest 对话列表请求
type ConversationListRequest struct {
	CharacterID string `json:"character_id"`         // 角色ID，必填
	SessionID   string `json:"session_id,omitempty"` // 会话ID，可选
	Limit       int    `json:"limit,omitempty"`      // 返回条数限制
	Offset      int    `json:"offset,omitempty"`     // 翻页偏移
}

// ConversationItem 对话条目（用于响应）
type ConversationItem struct {
	ID         int64  `json:"id"`         // 对话ID
	SessionID  string `json:"session_id"` // 会话ID
	Role       string `json:"role"`       // 角色：user/assistant
	Content    string `json:"content"`    // 对话内容
	Timestamp  string `json:"timestamp"`  // 对话时间
	Compressed bool   `json:"compressed"` // 是否已压缩
}

// ConversationListResponse 对话列表响应
type ConversationListResponse struct {
	Conversations []ConversationItem `json:"conversations"` // 对话列表
	Total         int                `json:"total"`         // 总数量
	HasMore       bool               `json:"has_more"`      // 是否有更多
}

// =============================================================================
// Cron 定时任务请求和响应定义
// =============================================================================

// CronAddRequest 添加定时任务请求数据
type CronAddRequest struct {
	Name         string `json:"name"`                    // 任务名称
	Message      string `json:"message"`                 // 触发时发送的消息
	EverySeconds int64  `json:"every_seconds,omitempty"` // 周期性任务间隔（秒）
	CronExpr     string `json:"cron_expr,omitempty"`     // Cron 表达式
	AtSeconds    int64  `json:"at_seconds,omitempty"`    // 一次性任务延迟（秒，从现在起）
}

// CronListRequest 列出定时任务请求数据
type CronListRequest struct {
	IncludeDisabled bool `json:"include_disabled"` // 是否包含已禁用的任务
}

// CronRemoveRequest 删除定时任务请求数据
type CronRemoveRequest struct {
	JobID string `json:"job_id"` // 任务ID
}

// CronEnableRequest 启用/禁用定时任务请求数据
type CronEnableRequest struct {
	JobID   string `json:"job_id"`  // 任务ID
	Enabled bool   `json:"enabled"` // 是否启用
}

// CronJobInfo 定时任务信息（用于响应）
type CronJobInfo struct {
	ID           string `json:"id"`                       // 任务ID
	Name         string `json:"name"`                     // 任务名称
	Enabled      bool   `json:"enabled"`                  // 是否启用
	ScheduleKind string `json:"schedule_kind"`            // 调度类型: at, every, cron
	EveryMS      *int64 `json:"every_ms,omitempty"`       // 周期（毫秒）
	CronExpr     string `json:"cron_expr,omitempty"`      // Cron 表达式
	AtMS         *int64 `json:"at_ms,omitempty"`          // 一次性触发时间戳
	Message      string `json:"message"`                  // 触发时发送的消息
	Channel      string `json:"channel"`                  // 目标渠道
	To           string `json:"to"`                       // 目标接收者
	NextRunAtMS  *int64 `json:"next_run_at_ms,omitempty"` // 下次触发时间戳
	LastRunAtMS  *int64 `json:"last_run_at_ms,omitempty"` // 上次触发时间戳
	LastStatus   string `json:"last_status,omitempty"`    // 上次执行状态
	CreatedAtMS  int64  `json:"created_at_ms"`            // 创建时间戳
}

// CronListResponse 定时任务列表响应
type CronListResponse struct {
	Jobs []CronJobInfo `json:"jobs"` // 任务列表
}

// CronAddResponse 添加定时任务响应
type CronAddResponse struct {
	JobID string `json:"job_id"` // 新创建的任务ID
	Name  string `json:"name"`   // 任务名称
}

// =============================================================================
// Skills 请求和响应定义
// =============================================================================

// SkillListRequest 列出 skills 请求数据
type SkillListRequest struct {
}

// SkillSearchRequest 搜索 skills 请求数据
type SkillSearchRequest struct {
	Query string `json:"query"` // 搜索关键词
	Limit int    `json:"limit"` // 返回条数限制
}

// SkillInstallRequest 安装 skill 请求数据
type SkillInstallRequest struct {
	Slug     string `json:"slug"`     // skill slug
	Registry string `json:"registry"` // registry 名称
	Version  string `json:"version"`  // 版本（可选）
}

// SkillRemoveRequest 删除 skill 请求数据
type SkillRemoveRequest struct {
	Name string `json:"name"` // skill 名称
}

// SkillGetRequest 获取 skill 内容请求数据
type SkillGetRequest struct {
	Name string `json:"name"` // skill 名称
}

// SkillInfo skill 信息
type SkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Path        string `json:"path"`
	Source      string `json:"source"`
}

// SkillDetailResponse skill 详情响应
type SkillDetailResponse struct {
	Name    string `json:"name"`
	Content string `json:"content"`
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
	PetID          string `json:"pet_id"`                // 桌宠ID
	PetName        string `json:"pet_name"`              // 桌宠名称
	PetPersona     string `json:"pet_persona"`           // 性格描述
	PetPersonaType string `json:"pet_persona_type"`      // 性格类型
	SpeechTone     string `json:"speech_tone,omitempty"` // 说话风格
	Catchphrase    string `json:"catchphrase,omitempty"` // 口头禅
	Hobbies        string `json:"hobbies,omitempty"`     // 兴趣爱好
	Background     string `json:"background,omitempty"`  // 背景设定
	Preferences    string `json:"preferences,omitempty"` // 偏好
	Avatar         string `json:"avatar,omitempty"`      // 头像/模型ID
	CreatedAt      string `json:"created_at"`            // 创建时间
	UpdatedAt      string `json:"updated_at"`            // 更新时间
}

// CharacterCreateResponse 创建角色响应数据
type CharacterCreateResponse struct {
	PetID          string `json:"pet_id"`           // 桌宠ID
	PetName        string `json:"pet_name"`         // 桌宠名称
	PetPersona     string `json:"pet_persona"`      // 性格描述
	PetPersonaType string `json:"pet_persona_type"` // 性格类型
	SpeechTone     string `json:"speech_tone"`      // 说话风格
	Catchphrase    string `json:"catchphrase"`      // 口头禅
	Hobbies        string `json:"hobbies"`          // 兴趣爱好
	Background     string `json:"background"`       // 背景设定
	Preferences    string `json:"preferences"`      // 偏好
	Avatar         string `json:"avatar"`           // 头像/模型ID
	CreatedAt      string `json:"created_at"`       // 创建时间
	UpdatedAt      string `json:"updated_at"`       // 更新时间
}

// MBTIConfig MBTI 性格四维配置
type MBTIConfig struct {
	IE float64 `json:"ie"` // 内向(I)-外向(E): 0-100, 50中性
	SN float64 `json:"sn"` // 实感(S)-直觉(N): 0-100, 50中性
	TF float64 `json:"tf"` // 理性(T)-感性(F): 0-100, 50中性
	JP float64 `json:"jp"` // 判断(J)-感知(P): 0-100, 50中性
}

// DefaultMBTI 返回默认的中性 MBTI 配置
func DefaultMBTI() MBTIConfig {
	return MBTIConfig{IE: 50.0, SN: 50.0, TF: 50.0, JP: 50.0}
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

// CharacterSwitchPush 角色切换推送数据
type CharacterSwitchPush struct {
	CharacterID string `json:"character_id"` // 切换后的角色ID
}

// StreamData 流式聊天数据
type StreamData struct {
	ChatID  int64  `json:"chat_id"`           // 聊天块ID
	Type    string `json:"type"`              // 内容类型：text/final
	Text    string `json:"text"`              // 文本内容
	Emotion string `json:"emotion,omitempty"` // 当前情绪标签
	Action  string `json:"action,omitempty"`  // 动作名称
}
