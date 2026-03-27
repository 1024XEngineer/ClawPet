package action

import (
	"time"
)

// ActionV2 新版动作接口（与状态解耦）
type ActionV2 interface {
	Name() string            // 动作名称
	Description() string     // 动作描述
	Duration() time.Duration // 动作持续时间
	Execute() error          // 执行动作
}

// BaseActionV2 基础动作实现
type BaseActionV2 struct {
	name        string
	description string
	duration    time.Duration
}

func (a *BaseActionV2) Name() string {
	return a.name
}

func (a *BaseActionV2) Description() string {
	return a.description
}

func (a *BaseActionV2) Duration() time.Duration {
	return a.duration
}

func (a *BaseActionV2) Execute() error {
	// 基础实现，子类可以重写
	return nil
}

// NewBaseActionV2 创建基础动作
func NewBaseActionV2(name, description string, duration time.Duration) *BaseActionV2 {
	return &BaseActionV2{
		name:        name,
		description: description,
		duration:    duration,
	}
}

// ActionExecutor 动作执行器
type ActionExecutor struct {
	currentAction ActionV2
	actionStart   time.Time
	isExecuting   bool
}

// NewActionExecutor 创建动作执行器
func NewActionExecutor() *ActionExecutor {
	return &ActionExecutor{
		currentAction: nil,
		actionStart:   time.Time{},
		isExecuting:   false,
	}
}

// Execute 执行动作
func (e *ActionExecutor) Execute(action ActionV2) error {
	e.currentAction = action
	e.actionStart = time.Now()
	e.isExecuting = true

	// 异步执行动作，持续时间后自动结束
	go func() {
		time.Sleep(action.Duration())
		e.isExecuting = false
	}()

	return action.Execute()
}

// CurrentAction 获取当前动作
func (e *ActionExecutor) CurrentAction() (ActionV2, bool) {
	if !e.isExecuting {
		return nil, false
	}
	return e.currentAction, true
}

// IsExecuting 是否正在执行动作
func (e *ActionExecutor) IsExecuting() bool {
	return e.isExecuting
}

// TimeRemaining 剩余执行时间
func (e *ActionExecutor) TimeRemaining() time.Duration {
	if !e.isExecuting || e.currentAction == nil {
		return 0
	}

	elapsed := time.Since(e.actionStart)
	remaining := e.currentAction.Duration() - elapsed

	if remaining < 0 {
		return 0
	}
	return remaining
}

// Stop 停止当前动作
func (e *ActionExecutor) Stop() {
	e.isExecuting = false
	e.currentAction = nil
}

// GetStatus 获取动作状态
func (e *ActionExecutor) GetStatus() map[string]interface{} {
	if !e.isExecuting || e.currentAction == nil {
		return map[string]interface{}{
			"is_executing": false,
		}
	}

	return map[string]interface{}{
		"is_executing": true,
		"action_name":  e.currentAction.Name(),
		"action_desc":  e.currentAction.Description(),
		"duration_ms":  e.currentAction.Duration().Milliseconds(),
		"elapsed_ms":   time.Since(e.actionStart).Milliseconds(),
		"remaining_ms": e.TimeRemaining().Milliseconds(),
	}
}
