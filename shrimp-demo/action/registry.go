package action

// Registry 动作注册表，管理所有可用动作
type Registry struct {
	actions map[string]Action
}

// NewRegistry 创建动作注册表
func NewRegistry() *Registry {
	registry := &Registry{
		actions: make(map[string]Action),
	}

	// 注册所有动作
	registry.Register(NewSearchAction())
	registry.Register(NewFocusAction())
	registry.Register(NewExcitedAction())
	registry.Register(NewOrganizeAction())
	registry.Register(NewDeliverAction())
	registry.Register(NewThinkAction())
	registry.Register(NewStandbyAction())

	return registry
}

// Register 注册动作
func (r *Registry) Register(action Action) {
	r.actions[action.Name()] = action
}

// Get 获取动作
func (r *Registry) Get(name string) (Action, bool) {
	action, exists := r.actions[name]
	return action, exists
}

// GetAll 获取所有动作
func (r *Registry) GetAll() []Action {
	actions := make([]Action, 0, len(r.actions))
	for _, action := range r.actions {
		actions = append(actions, action)
	}
	return actions
}

// FindByKeyword 根据关键词查找匹配的动作
func (r *Registry) FindByKeyword(keyword string) []Action {
	matched := make([]Action, 0)

	for _, action := range r.actions {
		for _, trigger := range action.TriggerKeywords() {
			if contains(keyword, trigger) {
				matched = append(matched, action)
				break
			}
		}
	}

	return matched
}

// contains 检查字符串是否包含子串（简单实现）
func contains(s, substr string) bool {
	// 在实际应用中，这里可以使用更复杂的匹配逻辑
	// 比如：字符串包含、正则匹配等
	return len(s) >= len(substr) && s[:len(substr)] == substr
}
