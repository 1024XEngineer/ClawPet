package action

// FocusAction 专注阅读动作
type FocusAction struct {
	*BaseAction
}

// NewFocusAction 创建专注动作
func NewFocusAction() *FocusAction {
	return &FocusAction{
		BaseAction: NewBaseAction(
			"focus",
			"小龙虾动作从「翻找」逐渐变为「专注阅读」，头微微前倾，偶尔点头",
			"专注",
			[]string{"专注", "认真", "仔细", "研究", "分析", "阅读"},
		),
	}
}
