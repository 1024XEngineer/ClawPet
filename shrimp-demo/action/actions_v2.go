package action

import (
	"fmt"
	"time"
)

// FocusActionV2 专注动作
type FocusActionV2 struct {
	*BaseActionV2
}

// NewFocusActionV2 创建专注动作
func NewFocusActionV2() *FocusActionV2 {
	return &FocusActionV2{
		BaseActionV2: NewBaseActionV2(
			"focus",
			"小龙虾动作从「翻找」逐渐变为「专注阅读」，头微微前倾，偶尔点头",
			8*time.Second,
		),
	}
}

// Execute 执行专注
func (f *FocusActionV2) Execute() error {
	fmt.Println("小龙虾正在专注阅读...")
	return nil
}

// ExcitedActionV2 兴奋动作
type ExcitedActionV2 struct {
	*BaseActionV2
}

// NewExcitedActionV2 创建兴奋动作
func NewExcitedActionV2() *ExcitedActionV2 {
	return &ExcitedActionV2{
		BaseActionV2: NewBaseActionV2(
			"excited",
			"小龙虾突然兴奋起来，切换为「发现宝贝」动作，做出抓取的手势",
			5*time.Second,
		),
	}
}

// Execute 执行兴奋
func (e *ExcitedActionV2) Execute() error {
	fmt.Println("小龙虾兴奋地发现了重要信息！")
	return nil
}

// ThinkActionV2 思考动作
type ThinkActionV2 struct {
	*BaseActionV2
	question string // 思考的问题
}

// NewThinkActionV2 创建思考动作
func NewThinkActionV2(question string) *ThinkActionV2 {
	return &ThinkActionV2{
		BaseActionV2: NewBaseActionV2(
			"think",
			"小龙虾进入「思考模式」，动作切换为「托腮」",
			12*time.Second,
		),
		question: question,
	}
}

// Execute 执行思考
func (t *ThinkActionV2) Execute() error {
	fmt.Printf("小龙虾正在思考问题: %s\n", t.question)
	return nil
}

// StandbyActionV2 待命动作
type StandbyActionV2 struct {
	*BaseActionV2
}

// NewStandbyActionV2 创建待命动作
func NewStandbyActionV2() *StandbyActionV2 {
	return &StandbyActionV2{
		BaseActionV2: NewBaseActionV2(
			"standby",
			"小龙虾切换为「安静待命」动作，缩到屏幕角落",
			30*time.Second,
		),
	}
}

// Execute 执行待命
func (s *StandbyActionV2) Execute() error {
	fmt.Println("小龙虾正在安静待命...")
	return nil
}

// PlayActionV2 玩耍动作
type PlayActionV2 struct {
	*BaseActionV2
}

// NewPlayActionV2 创建玩耍动作
func NewPlayActionV2() *PlayActionV2 {
	return &PlayActionV2{
		BaseActionV2: NewBaseActionV2(
			"play",
			"小龙虾切换为「玩耍」动作，开心地游来游去",
			20*time.Second,
		),
	}
}

// Execute 执行玩耍
func (p *PlayActionV2) Execute() error {
	fmt.Println("小龙虾正在开心地玩耍...")
	return nil
}

// ComfortActionV2 安慰动作
type ComfortActionV2 struct {
	*BaseActionV2
}

// NewComfortActionV2 创建安慰动作
func NewComfortActionV2() *ComfortActionV2 {
	return &ComfortActionV2{
		BaseActionV2: NewBaseActionV2(
			"comfort",
			"小龙虾切换为「安慰」动作，轻轻拍打用户",
			10*time.Second,
		),
	}
}

// Execute 执行安慰
func (c *ComfortActionV2) Execute() error {
	fmt.Println("小龙虾正在安慰用户...")
	return nil
}

// RestActionV2 休息动作
type RestActionV2 struct {
	*BaseActionV2
}

// NewRestActionV2 创建休息动作
func NewRestActionV2() *RestActionV2 {
	return &RestActionV2{
		BaseActionV2: NewBaseActionV2(
			"rest",
			"小龙虾切换为「休息」动作，安静地睡觉",
			25*time.Second,
		),
	}
}

// Execute 执行休息
func (r *RestActionV2) Execute() error {
	fmt.Println("小龙虾正在休息...")
	return nil
}
