package action

// StandbyAction 待命动作
type StandbyAction struct {
	*BaseAction
}

// NewStandbyAction 创建待命动作
func NewStandbyAction() *StandbyAction {
	return &StandbyAction{
		BaseAction: NewBaseAction(
			"standby",
			"小龙虾切换为「安静待命」动作，缩到屏幕角落",
			"安静",
			[]string{"待命", "安静", "休息", "等待", "好了", "完成"},
		),
	}
}
