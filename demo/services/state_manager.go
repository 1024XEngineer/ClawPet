package services

import (
	"go-claw/models"
	"strings"
)

type StateManager struct {
	state *models.PetState
}

func NewStateManager() *StateManager {
	return &StateManager{
		state: models.NewDefaultState(),
	}
}

func (sm *StateManager) GetState() *models.PetState {
	return sm.state
}

func (sm *StateManager) UpdateState(message string) {
	message = strings.ToLower(message)

	if containsPositiveWords(message) {
		sm.state.Happiness += 10
		sm.state.Intimacy += 5
		sm.state.Frustration -= 5
	} else if containsNegativeWords(message) {
		sm.state.Happiness -= 10
		sm.state.Frustration += 10
		sm.state.Intimacy += 3
	} else if containsNeutralWords(message) {
		sm.state.Intimacy += 2
	}

	sm.state.Normalize()
}

func (sm *StateManager) ApplyStateChange(change *models.StateChange) {
	if change == nil {
		return
	}

	sm.state.Intimacy += change.IntimacyDelta
	sm.state.Frustration += change.FrustrationDelta
	sm.state.Happiness += change.HappinessDelta

	sm.state.Normalize()
}

func containsPositiveWords(message string) bool {
	positiveWords := []string{"开心", "高兴", "快乐", "喜欢", "爱", "谢谢", "好", "棒", "优秀", "完美"}
	for _, word := range positiveWords {
		if strings.Contains(message, word) {
			return true
		}
	}
	return false
}

func containsNegativeWords(message string) bool {
	negativeWords := []string{"难过", "伤心", "生气", "愤怒", "讨厌", "恨", "糟糕", "坏", "累", "疲惫", "压力"}
	for _, word := range negativeWords {
		if strings.Contains(message, word) {
			return true
		}
	}
	return false
}

func containsNeutralWords(message string) bool {
	neutralWords := []string{"你好", "早上好", "晚上好", "吃饭", "睡觉", "工作", "学习"}
	for _, word := range neutralWords {
		if strings.Contains(message, word) {
			return true
		}
	}
	return false
}
