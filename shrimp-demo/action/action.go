package action

// Action 定义桌宠动作接口
type Action interface {
	Name() string
	Description() string
	TriggerKeywords() []string
	Emotion() string
}

// BaseAction 提供动作的基础实现
type BaseAction struct {
	name            string
	description     string
	triggerKeywords []string
	emotion         string
}

func (a *BaseAction) Name() string {
	return a.name
}

func (a *BaseAction) Description() string {
	return a.description
}

func (a *BaseAction) TriggerKeywords() []string {
	return a.triggerKeywords
}

func (a *BaseAction) Emotion() string {
	return a.emotion
}

// NewBaseAction 创建基础动作
func NewBaseAction(name, description, emotion string, keywords []string) *BaseAction {
	return &BaseAction{
		name:            name,
		description:     description,
		triggerKeywords: keywords,
		emotion:         emotion,
	}
}
