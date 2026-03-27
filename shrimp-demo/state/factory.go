package state

import (
	"fmt"
)

// DefaultStateManager 创建默认状态管理器
func DefaultStateManager() *StateManager {
	manager := NewStateManager()

	// 注册核心状态
	manager.Register(NewMoodState())
	manager.Register(NewAffectionState())
	manager.Register(NewFrustrationState())

	return manager
}

// CreateStateManagerWithStates 创建带有指定状态的状态管理器
func CreateStateManagerWithStates(states ...StateInterface) *StateManager {
	manager := NewStateManager()

	for _, state := range states {
		manager.Register(state)
	}

	return manager
}

// GetDefaultStates 获取默认状态列表
func GetDefaultStates() []StateInterface {
	return []StateInterface{
		NewMoodState(),
		NewAffectionState(),
		NewFrustrationState(),
	}
}

// CreateCustomState 创建自定义状态
func CreateCustomState(name, description string, min, max, defaultValue float64) *BaseState {
	return NewBaseState(name, description, min, max, defaultValue)
}

// BuildStatePrompt 构建状态提示词
func BuildStatePrompt(manager *StateManager) string {
	states := manager.GetAll()

	prompt := ""

	for name, state := range states {
		currentValue := state.Value()
		minValue := state.MinValue()
		maxValue := state.MaxValue()
		description := state.Description()
		emotion := state.EmotionForValue(currentValue)

		prompt += fmt.Sprintf("- %s: %.0f/%s (%.0f-%.0f) - %s - 当前情感: %s\n",
			name, currentValue, formatMaxValue(maxValue), minValue, maxValue, description, emotion)
	}

	return prompt
}

// BuildStateResponse 构建状态响应
func BuildStateResponse(manager *StateManager) string {
	states := manager.GetAll()
	prompt := ""

	for name := range states {
		prompt += fmt.Sprintf("%s:<变化值，从-10至10，步长为1>\n", name)
	}

	return prompt
}

// formatMaxValue 格式化最大值显示
func formatMaxValue(max float64) string {
	if max == 1000 {
		return "1000"
	}
	return fmt.Sprintf("%.0f", max)
}

// GetStateSummaryForJSON 获取状态摘要用于JSON输出
func GetStateSummaryForJSON(manager *StateManager) map[string]interface{} {
	states := manager.GetAll()
	summary := make(map[string]interface{})

	for name, state := range states {
		value := state.Value()
		emotion := state.EmotionForValue(value)

		stateSummary := map[string]interface{}{
			"value":   value,
			"min":     state.MinValue(),
			"max":     state.MaxValue(),
			"emotion": emotion,
		}

		// 添加特定状态的方法
		switch s := state.(type) {
		case *MoodState:
			stateSummary["emoji"] = s.GetEmoji()
			stateSummary["emotion_text"] = s.GetEmotionText()
			stateSummary["is_happy"] = s.IsHappy()
			stateSummary["is_sad"] = s.IsSad()
		case *AffectionState:
			stateSummary["emoji"] = s.GetEmoji()
			stateSummary["emotion_text"] = s.GetEmotionText()
			stateSummary["is_liking"] = s.IsLiking()
			stateSummary["is_disliking"] = s.IsDisliking()
			stateSummary["level"] = s.GetAffectionLevel()
		case *FrustrationState:
			stateSummary["emoji"] = s.GetEmoji()
			stateSummary["emotion_text"] = s.GetEmotionText()
			stateSummary["is_frustrated"] = s.IsFrustrated()
			stateSummary["needs_comfort"] = s.NeedsComfort()
			stateSummary["level"] = s.GetFrustrationLevel()
		}

		summary[name] = stateSummary
	}

	return summary
}

// ParseStateChanges 解析状态变化字符串
func ParseStateChanges(input string, manager *StateManager) (map[string]float64, error) {
	changes := make(map[string]float64)
	lines := splitLines(input)

	for _, line := range lines {
		line = trimSpace(line)
		if line == "" || !contains(line, ":") {
			continue
		}

		parts := split(line, ":")
		if len(parts) != 2 {
			continue
		}

		stateName := trimSpace(parts[0])
		changeStr := trimSpace(parts[1])

		// 检查状态是否存在
		if _, exists := manager.Get(stateName); !exists {
			continue
		}

		// 解析变化值
		var change float64
		n, err := fmt.Sscanf(changeStr, "%f", &change)
		if err != nil || n != 1 {
			// 尝试解析带符号的值
			n, err = fmt.Sscanf(changeStr, "%f", &change)
			if err != nil || n != 1 {
				continue
			}
		}

		changes[stateName] = change
	}

	return changes, nil
}

// 辅助函数
func splitLines(s string) []string {
	var result []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		result = append(result, s[start:])
	}
	return result
}

func trimSpace(s string) string {
	// 简化实现
	start := 0
	end := len(s)

	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r') {
		start++
	}

	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r' || s[end-1] == '\n') {
		end--
	}

	return s[start:end]
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && s[:len(substr)] == substr
}

func split(s string, sep string) []string {
	idx := -1
	for i := 0; i < len(s); i++ {
		if s[i] == sep[0] {
			idx = i
			break
		}
	}

	if idx == -1 {
		return []string{s}
	}

	return []string{s[:idx], s[idx+1:]}
}
