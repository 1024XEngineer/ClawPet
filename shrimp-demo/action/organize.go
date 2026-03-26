package action

// OrganizeAction 整理资料动作
type OrganizeAction struct {
	*BaseAction
}

// NewOrganizeAction 创建整理动作
func NewOrganizeAction() *OrganizeAction {
	return &OrganizeAction{
		BaseAction: NewBaseAction(
			"organize",
			"小龙虾切换为「整理资料」状态，有条不紊地将信息分类",
			"认真",
			[]string{"整理", "分类", "汇总", "归纳", "总结", "梳理"},
		),
	}
}
