package compression

import "time"

// ConversationEntry 对话条目
// 存储单条对话记录，用于后续压缩生成记忆
type ConversationEntry struct {
	ID        int64     // 对话唯一ID，对应数据库主键
	Role      string    // 角色：user(用户) / pet(宠物)
	Content   string    // 对话内容
	Timestamp time.Time // 对话时间
}

// CompressionResult 压缩结果
// LLM 压缩对话后生成的单条记忆
type CompressionResult struct {
	MemoryType string // 记忆类型：conversation(对话) / preference(偏好) / fact(事实)
	Weight     int    // 权重：0-100，越高越重要
	Content    string // 记忆内容摘要
}

// OnThresholdCallback 达到阈值时的回调函数
// 当未压缩对话数达到 threshold 时触发
// characterID: 角色ID
// entries: 待压缩的对话条目列表
type OnThresholdCallback func(characterID string, entries []*ConversationEntry)

// CompressionConfig 压缩配置
// 控制对话压缩和行为的所有参数
type CompressionConfig struct {
	Model                string `json:"model,omitempty"`        // model_name，压缩用的模型名
	Enabled              bool   `json:"enabled"`                // 是否启用压缩功能
	Threshold            int    `json:"threshold"`              // 触发压缩的消息数阈值
	MergeIntervalMinutes int    `json:"merge_interval_minutes"` // 低权重合并检查间隔（分钟）
	LowWeightThreshold   int    `json:"low_weight_threshold"`   // 低权重合并触发数量
	RetainCompressedDays int    `json:"retain_compressed_days"` // 已压缩对话保留天数
}

// DefaultCompressionConfig 返回默认压缩配置
// 启用压缩，20条消息触发压缩，5分钟检查一次，30天保留对话
func DefaultCompressionConfig() *CompressionConfig {
	return &CompressionConfig{
		Enabled:              true,
		Threshold:            20,
		MergeIntervalMinutes: 5,
		LowWeightThreshold:   10,
		RetainCompressedDays: 30,
	}
}

// DefaultThreshold 默认消息阈值
// 当未压缩对话数达到此值时触发压缩
const DefaultThreshold = 20
