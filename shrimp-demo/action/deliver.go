package action

// DeliverAction 郑重交付动作
type DeliverAction struct {
	*BaseAction
}

// NewDeliverAction 创建交付动作
func NewDeliverAction() *DeliverAction {
	return &DeliverAction{
		BaseAction: NewBaseAction(
			"deliver",
			"小龙虾切换为「郑重交付」动作，双手托起，向用户方向推出",
			"郑重",
			[]string{"好了", "完成", "给你", "交付", "整理好了", "准备好了"},
		),
	}
}
