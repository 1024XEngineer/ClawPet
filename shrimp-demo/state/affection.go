package state

// AffectionState 好感度状态 (0-1000)
type AffectionState struct {
	*BaseState
}

// NewAffectionState 创建好感度状态
func NewAffectionState() *AffectionState {
	// 好感度范围: 0-1000，默认值 500（中等）
	affection := &AffectionState{
		BaseState: NewBaseState(
			"affection",
			"小龙虾对用户的好感度，0表示讨厌，1000表示非常喜欢",
			0.0,
			1000.0,
			500.0,
		),
	}

	// 设置阈值
	affection.AddThreshold("hate", 200.0)    // 0-200: 讨厌
	affection.AddThreshold("dislike", 400.0) // 201-400: 不喜欢
	affection.AddThreshold("neutral", 600.0) // 401-600: 一般
	affection.AddThreshold("like", 800.0)    // 601-800: 喜欢
	affection.AddThreshold("love", 1000.0)   // 801-1000: 非常喜欢

	// 设置情感映射
	affection.AddEmotionMapping("hate", "0-200")
	affection.AddEmotionMapping("dislike", "201-400")
	affection.AddEmotionMapping("neutral", "401-600")
	affection.AddEmotionMapping("like", "601-800")
	affection.AddEmotionMapping("love", "801-1000")
	affection.AddEmotionMapping("default", "neutral")

	return affection
}

// EmotionForValue 根据值返回情感标签
func (a *AffectionState) EmotionForValue(v float64) string {
	switch {
	case v <= 200:
		return "hate"
	case v <= 400:
		return "dislike"
	case v <= 600:
		return "neutral"
	case v <= 800:
		return "like"
	default:
		return "love"
	}
}

// GetEmotionText 获取情感文本描述
func (a *AffectionState) GetEmotionText() string {
	value := a.Value()
	emotion := a.EmotionForValue(value)

	switch emotion {
	case "hate":
		return "讨厌 😠"
	case "dislike":
		return "不喜欢 🙁"
	case "neutral":
		return "一般 😐"
	case "like":
		return "喜欢 😊"
	case "love":
		return "非常喜欢 😍"
	default:
		return "一般 😐"
	}
}

// GetEmoji 获取表情符号
func (a *AffectionState) GetEmoji() string {
	value := a.Value()

	switch {
	case value <= 200:
		return "😠"
	case value <= 400:
		return "🙁"
	case value <= 600:
		return "😐"
	case value <= 800:
		return "😊"
	default:
		return "😍"
	}
}

// IsLiking 是否喜欢用户
func (a *AffectionState) IsLiking() bool {
	return a.Value() > 600
}

// IsDisliking 是否不喜欢用户
func (a *AffectionState) IsDisliking() bool {
	return a.Value() <= 400
}

// GetAffectionLevel 获取好感度等级
func (a *AffectionState) GetAffectionLevel() string {
	value := a.Value()

	switch {
	case value <= 200:
		return "一级（讨厌）"
	case value <= 400:
		return "二级（不喜欢）"
	case value <= 600:
		return "三级（一般）"
	case value <= 800:
		return "四级（喜欢）"
	default:
		return "五级（非常喜欢）"
	}
}
