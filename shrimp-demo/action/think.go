package action

// ThinkAction 思考动作
type ThinkAction struct {
	*BaseAction
}

// NewThinkAction 创建思考动作
func NewThinkAction() *ThinkAction {
	return &ThinkAction{
		BaseAction: NewBaseAction(
			"think",
			"小龙虾进入「思考模式」，动作切换为「托腮」",
			"思考",
			[]string{"思考", "想想", "考虑", "琢磨", "怎么答", "如何回答"},
		),
	}
}
