package state

// MoodState 心情状态 (0-100)
type MoodState struct {
	*BaseState
}

// NewMoodState 创建心情状态
func NewMoodState() *MoodState {
	// 心情范围: 0-100，默认值 70（中等偏上）
	mood := &MoodState{
		BaseState: NewBaseState(
			"mood",
			"小龙虾的心情状态，0表示非常难过，100表示非常开心",
			0.0,
			100.0,
			70.0,
		),
	}

	// 设置阈值
	mood.AddThreshold("very_sad", 20.0)    // 0-20: 非常难过
	mood.AddThreshold("sad", 40.0)         // 21-40: 难过
	mood.AddThreshold("neutral", 60.0)     // 41-60: 平静
	mood.AddThreshold("happy", 80.0)       // 61-80: 开心
	mood.AddThreshold("very_happy", 100.0) // 81-100: 非常开心

	// 设置情感映射
	mood.AddEmotionMapping("very_sad", "0-20")
	mood.AddEmotionMapping("sad", "21-40")
	mood.AddEmotionMapping("neutral", "41-60")
	mood.AddEmotionMapping("happy", "61-80")
	mood.AddEmotionMapping("very_happy", "81-100")
	mood.AddEmotionMapping("default", "neutral")

	return mood
}

// EmotionForValue 根据值返回情感标签
func (m *MoodState) EmotionForValue(v float64) string {
	switch {
	case v <= 20:
		return "very_sad"
	case v <= 40:
		return "sad"
	case v <= 60:
		return "neutral"
	case v <= 80:
		return "happy"
	default:
		return "very_happy"
	}
}

// GetEmotionText 获取情感文本描述
func (m *MoodState) GetEmotionText() string {
	value := m.Value()
	emotion := m.EmotionForValue(value)

	switch emotion {
	case "very_sad":
		return "非常难过 😭"
	case "sad":
		return "难过 😔"
	case "neutral":
		return "平静 😐"
	case "happy":
		return "开心 😊"
	case "very_happy":
		return "非常开心 😄"
	default:
		return "平静 😐"
	}
}

// GetEmoji 获取表情符号
func (m *MoodState) GetEmoji() string {
	value := m.Value()

	switch {
	case value <= 20:
		return "😭"
	case value <= 40:
		return "😔"
	case value <= 60:
		return "😐"
	case value <= 80:
		return "😊"
	default:
		return "😄"
	}
}

// IsHappy 是否开心
func (m *MoodState) IsHappy() bool {
	return m.Value() > 60
}

// IsSad 是否难过
func (m *MoodState) IsSad() bool {
	return m.Value() <= 40
}
