package state

import (
	"fmt"
	"sync"
)

// StateInterface 状态接口定义
type StateInterface interface {
	Name() string                   // 状态名称
	Value() float64                 // 当前值
	SetValue(float64)               // 设置值
	MinValue() float64              // 最小值
	MaxValue() float64              // 最大值
	DefaultValue() float64          // 默认值
	Description() string            // 状态描述
	Thresholds() map[string]float64 // 阈值映射：名称 -> 值
	EmotionForValue(float64) string // 根据值返回情感标签
}

// BaseState 基础状态实现
type BaseState struct {
	name         string
	value        float64
	minValue     float64
	maxValue     float64
	defaultValue float64
	description  string
	thresholds   map[string]float64
	emotionMap   map[string]string // 情感标签映射
}

func (s *BaseState) Name() string {
	return s.name
}

func (s *BaseState) Value() float64 {
	return s.value
}

func (s *BaseState) SetValue(v float64) {
	// 确保值在范围内
	if v < s.minValue {
		s.value = s.minValue
	} else if v > s.maxValue {
		s.value = s.maxValue
	} else {
		s.value = v
	}
}

func (s *BaseState) MinValue() float64 {
	return s.minValue
}

func (s *BaseState) MaxValue() float64 {
	return s.maxValue
}

func (s *BaseState) DefaultValue() float64 {
	return s.defaultValue
}

func (s *BaseState) Description() string {
	return s.description
}

func (s *BaseState) Thresholds() map[string]float64 {
	return s.thresholds
}

func (s *BaseState) EmotionForValue(v float64) string {
	// 根据值查找对应的情感标签
	for emotionName, valueRange := range s.emotionMap {
		if emotionName == "default" {
			continue
		}
		// 这里简化处理，实际应该根据阈值范围判断
		// 暂时返回默认情感
		_ = valueRange // 避免未使用错误
	}

	if defaultEmotion, ok := s.emotionMap["default"]; ok {
		return defaultEmotion
	}
	return "neutral"
}

// NewBaseState 创建基础状态
func NewBaseState(name, description string, min, max, defaultValue float64) *BaseState {
	return &BaseState{
		name:         name,
		value:        defaultValue,
		minValue:     min,
		maxValue:     max,
		defaultValue: defaultValue,
		description:  description,
		thresholds:   make(map[string]float64),
		emotionMap:   make(map[string]string),
	}
}

// AddThreshold 添加阈值
func (s *BaseState) AddThreshold(name string, value float64) {
	s.thresholds[name] = value
}

// AddEmotionMapping 添加情感映射
func (s *BaseState) AddEmotionMapping(emotionName string, valueRange string) {
	// valueRange 可以是 "0-30", "31-70", "71-100" 等格式
	s.emotionMap[emotionName] = valueRange
}

// StateManager 状态管理器
type StateManager struct {
	states map[string]StateInterface
	mu     sync.RWMutex
}

// NewStateManager 创建状态管理器
func NewStateManager() *StateManager {
	return &StateManager{
		states: make(map[string]StateInterface),
	}
}

// Register 注册状态
func (sm *StateManager) Register(state StateInterface) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.states[state.Name()] = state
}

// Get 获取状态
func (sm *StateManager) Get(name string) (StateInterface, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	state, exists := sm.states[name]
	return state, exists
}

// GetAll 获取所有状态
func (sm *StateManager) GetAll() map[string]StateInterface {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	// 返回副本
	result := make(map[string]StateInterface)
	for k, v := range sm.states {
		result[k] = v
	}
	return result
}

// GetValues 获取所有状态的值
func (sm *StateManager) GetValues() map[string]float64 {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make(map[string]float64)
	for name, state := range sm.states {
		result[name] = state.Value()
	}
	return result
}

// ApplyChange 应用状态变化
func (sm *StateManager) ApplyChange(name string, delta float64) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	state, exists := sm.states[name]
	if !exists {
		return fmt.Errorf("状态不存在: %s", name)
	}

	newValue := state.Value() + delta
	state.SetValue(newValue)
	return nil
}

// ApplyChanges 批量应用状态变化
func (sm *StateManager) ApplyChanges(changes map[string]float64) map[string]error {
	errors := make(map[string]error)

	for name, delta := range changes {
		if err := sm.ApplyChange(name, delta); err != nil {
			errors[name] = err
		}
	}

	return errors
}

// Reset 重置所有状态为默认值
func (sm *StateManager) Reset() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for _, state := range sm.states {
		state.SetValue(state.DefaultValue())
	}
}

// GetSummary 获取状态摘要
func (sm *StateManager) GetSummary() map[string]interface{} {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	summary := make(map[string]interface{})
	for name, state := range sm.states {
		summary[name] = map[string]interface{}{
			"value":       state.Value(),
			"min":         state.MinValue(),
			"max":         state.MaxValue(),
			"default":     state.DefaultValue(),
			"description": state.Description(),
			"emotion":     state.EmotionForValue(state.Value()),
		}
	}
	return summary
}

// GetEmotionSummary 获取情感摘要
func (sm *StateManager) GetEmotionSummary() map[string]string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	emotions := make(map[string]string)
	for name, state := range sm.states {
		emotions[name] = state.EmotionForValue(state.Value())
	}
	return emotions
}
