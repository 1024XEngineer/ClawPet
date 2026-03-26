package state

import (
	"time"

	"shrimp-demo/action"
)

// State 定义桌宠状态
type State string

const (
	StateStandby  State = "standby"  // 待命状态
	StateSearch   State = "search"   // 搜索状态
	StateFocus    State = "focus"    // 专注状态
	StateExcited  State = "exciting" // 兴奋状态
	StateOrganize State = "organize" // 整理状态
	StateDeliver  State = "deliver"  // 交付状态
	StateThink    State = "think"    // 思考状态
)

// Machine 桌宠状态机
type Machine struct {
	currentState   State
	currentAction  action.Action
	lastActivity   time.Time
	actionRegistry *action.Registry
}

// NewMachine 创建状态机
func NewMachine(registry *action.Registry) *Machine {
	standbyAction, _ := registry.Get("standby")
	return &Machine{
		currentState:   StateStandby,
		currentAction:  standbyAction,
		lastActivity:   time.Now(),
		actionRegistry: registry,
	}
}

// CurrentState 获取当前状态
func (m *Machine) CurrentState() State {
	return m.currentState
}

// CurrentAction 获取当前动作
func (m *Machine) CurrentAction() action.Action {
	return m.currentAction
}

// UpdateLastActivity 更新最后活动时间
func (m *Machine) UpdateLastActivity() {
	m.lastActivity = time.Now()
}

// IsIdleTooLong 检查是否空闲太久（15分钟）
func (m *Machine) IsIdleTooLong() bool {
	return time.Since(m.lastActivity) > 15*time.Minute
}

// Transition 状态转换
func (m *Machine) Transition(newState State) bool {
	// 检查状态转换是否有效
	if !m.isValidTransition(newState) {
		return false
	}

	// 更新状态
	m.currentState = newState

	// 根据新状态设置对应的动作
	switch newState {
	case StateStandby:
		if action, exists := m.actionRegistry.Get("standby"); exists {
			m.currentAction = action
		}
	case StateSearch:
		if action, exists := m.actionRegistry.Get("search"); exists {
			m.currentAction = action
		}
	case StateFocus:
		if action, exists := m.actionRegistry.Get("focus"); exists {
			m.currentAction = action
		}
	case StateExcited:
		if action, exists := m.actionRegistry.Get("excited"); exists {
			m.currentAction = action
		}
	case StateOrganize:
		if action, exists := m.actionRegistry.Get("organize"); exists {
			m.currentAction = action
		}
	case StateDeliver:
		if action, exists := m.actionRegistry.Get("deliver"); exists {
			m.currentAction = action
		}
	case StateThink:
		if action, exists := m.actionRegistry.Get("think"); exists {
			m.currentAction = action
		}
	}

	// 更新活动时间
	m.UpdateLastActivity()

	return true
}

// isValidTransition 检查状态转换是否有效
func (m *Machine) isValidTransition(newState State) bool {
	// 定义状态转换规则
	transitionRules := map[State][]State{
		StateStandby:  {StateSearch, StateThink},
		StateSearch:   {StateFocus, StateExcited, StateStandby},
		StateFocus:    {StateExcited, StateOrganize, StateStandby},
		StateExcited:  {StateOrganize, StateFocus, StateStandby},
		StateOrganize: {StateDeliver, StateStandby},
		StateDeliver:  {StateStandby, StateThink},
		StateThink:    {StateStandby},
	}

	// 检查当前状态是否可以转换到新状态
	allowedStates, exists := transitionRules[m.currentState]
	if !exists {
		return false
	}

	for _, allowed := range allowedStates {
		if allowed == newState {
			return true
		}
	}

	return false
}

// ProcessMessage 处理用户消息，返回建议的动作
func (m *Machine) ProcessMessage(message string) []action.Action {
	// 更新活动时间
	m.UpdateLastActivity()

	// 根据消息内容查找匹配的动作
	return m.actionRegistry.FindByKeyword(message)
}
