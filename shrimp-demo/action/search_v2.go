package action

import (
	"fmt"
	"time"
)

// SearchActionV2 搜索动作（新版）
type SearchActionV2 struct {
	*BaseActionV2
	company string // 搜索的公司
}

// NewSearchActionV2 创建搜索动作
func NewSearchActionV2(company string) *SearchActionV2 {
	return &SearchActionV2{
		BaseActionV2: NewBaseActionV2(
			"search",
			"小龙虾开始执行搜索任务，切换为「出发」动作",
			10*time.Second, // 搜索持续10秒
		),
		company: company,
	}
}

// Execute 执行搜索
func (s *SearchActionV2) Execute() error {
	fmt.Printf("小龙虾正在搜索公司: %s\n", s.company)
	// 这里可以添加实际的搜索逻辑
	return nil
}

// GetCompany 获取搜索的公司
func (s *SearchActionV2) GetCompany() string {
	return s.company
}
