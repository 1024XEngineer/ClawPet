package action

// SearchAction 搜索动作
type SearchAction struct {
	*BaseAction
}

// NewSearchAction 创建搜索动作
func NewSearchAction() *SearchAction {
	return &SearchAction{
		BaseAction: NewBaseAction(
			"search",
			"小龙虾开始执行搜索任务，切换为「出发」动作",
			"专注",
			[]string{"搜索", "查找", "查一下", "帮我查", "找找", "查询"},
		),
	}
}
