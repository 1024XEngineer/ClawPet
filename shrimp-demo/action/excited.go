package action

// ExcitedAction 兴奋发现动作
type ExcitedAction struct {
	*BaseAction
}

// NewExcitedAction 创建兴奋动作
func NewExcitedAction() *ExcitedAction {
	return &ExcitedAction{
		BaseAction: NewBaseAction(
			"excited",
			"小龙虾突然兴奋起来，切换为「发现宝贝」动作，做出抓取的手势",
			"兴奋",
			[]string{"有用", "发现", "宝贝", "重要", "关键", "找到了", "这个好"},
		),
	}
}
