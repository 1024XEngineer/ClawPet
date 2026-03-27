package state

// FrustrationState 沮丧度状态 (0-100)
type FrustrationState struct {
	*BaseState
}

// NewFrustrationState 创建沮丧度状态
func NewFrustrationState() *FrustrationState {
	// 沮丧度范围: 0-100，默认值 20（较低）
	frustration := &FrustrationState{
		BaseState: NewBaseState(
			"frustration",
			"小龙虾的沮丧程度，0表示完全不沮丧，100表示非常沮丧",
			0.0,
			100.0,
			20.0,
		),
	}

	// 设置阈值
	frustration.AddThreshold("none", 20.0)       // 0-20: 无沮丧
	frustration.AddThreshold("low", 40.0)        // 21-40: 轻度沮丧
	frustration.AddThreshold("medium", 60.0)     // 41-60: 中度沮丧
	frustration.AddThreshold("high", 80.0)       // 61-80: 重度沮丧
	frustration.AddThreshold("very_high", 100.0) // 81-100: 非常沮丧

	// 设置情感映射
	frustration.AddEmotionMapping("none", "0-20")
	frustration.AddEmotionMapping("low", "21-40")
	frustration.AddEmotionMapping("medium", "41-60")
	frustration.AddEmotionMapping("high", "61-80")
	frustration.AddEmotionMapping("very_high", "81-100")
	frustration.AddEmotionMapping("default", "none")

	return frustration
}

// EmotionForValue 根据值返回情感标签
func (f *FrustrationState) EmotionForValue(v float64) string {
	switch {
	case v <= 20:
		return "none"
	case v <= 40:
		return "low"
	case v <= 60:
		return "medium"
	case v <= 80:
		return "high"
	default:
		return "very_high"
	}
}

// GetEmotionText 获取情感文本描述
func (f *FrustrationState) GetEmotionText() string {
	value := f.Value()
	emotion := f.EmotionForValue(value)

	switch emotion {
	case "none":
		return "无沮丧 😊"
	case "low":
		return "轻度沮丧 😕"
	case "medium":
		return "中度沮丧 😟"
	case "high":
		return "重度沮丧 😫"
	case "very_high":
		return "非常沮丧 😭"
	default:
		return "无沮丧 😊"
	}
}

// GetEmoji 获取表情符号
func (f *FrustrationState) GetEmoji() string {
	value := f.Value()

	switch {
	case value <= 20:
		return "😊"
	case value <= 40:
		return "😕"
	case value <= 60:
		return "😟"
	case value <= 80:
		return "😫"
	default:
		return "😭"
	}
}

// IsFrustrated 是否沮丧
func (f *FrustrationState) IsFrustrated() bool {
	return f.Value() > 40
}

// IsVeryFrustrated 是否非常沮丧
func (f *FrustrationState) IsVeryFrustrated() bool {
	return f.Value() > 80
}

// NeedsComfort 是否需要安慰
func (f *FrustrationState) NeedsComfort() bool {
	return f.Value() > 60
}

// GetFrustrationLevel 获取沮丧度等级
func (f *FrustrationState) GetFrustrationLevel() string {
	value := f.Value()

	switch {
	case value <= 20:
		return "一级（无沮丧）"
	case value <= 40:
		return "二级（轻度沮丧）"
	case value <= 60:
		return "三级（中度沮丧）"
	case value <= 80:
		return "四级（重度沮丧）"
	default:
		return "五级（非常沮丧）"
	}
}
