package action

import (
	"fmt"
	"time"
)

// ActionFactoryV2 动作工厂
type ActionFactoryV2 struct {
	actionCreators map[string]func(params map[string]interface{}) (ActionV2, error)
}

// NewActionFactoryV2 创建动作工厂
func NewActionFactoryV2() *ActionFactoryV2 {
	factory := &ActionFactoryV2{
		actionCreators: make(map[string]func(params map[string]interface{}) (ActionV2, error)),
	}

	// 注册所有动作
	factory.RegisterDefaultActions()

	return factory
}

// Register 注册动作创建器
func (f *ActionFactoryV2) Register(actionName string, creator func(params map[string]interface{}) (ActionV2, error)) {
	f.actionCreators[actionName] = creator
}

// RegisterDefaultActions 注册默认动作
func (f *ActionFactoryV2) RegisterDefaultActions() {
	// 搜索动作
	f.Register("search", func(params map[string]interface{}) (ActionV2, error) {
		company, ok := params["company"].(string)
		if !ok {
			company = "未知公司"
		}
		return NewSearchActionV2(company), nil
	})

	// 专注动作
	f.Register("focus", func(params map[string]interface{}) (ActionV2, error) {
		return NewFocusActionV2(), nil
	})

	// 兴奋动作
	f.Register("excited", func(params map[string]interface{}) (ActionV2, error) {
		return NewExcitedActionV2(), nil
	})

	// 思考动作
	f.Register("think", func(params map[string]interface{}) (ActionV2, error) {
		question, ok := params["question"].(string)
		if !ok {
			question = "未知问题"
		}
		return NewThinkActionV2(question), nil
	})

	// 待命动作
	f.Register("standby", func(params map[string]interface{}) (ActionV2, error) {
		return NewStandbyActionV2(), nil
	})

	// 玩耍动作
	f.Register("play", func(params map[string]interface{}) (ActionV2, error) {
		return NewPlayActionV2(), nil
	})

	// 安慰动作
	f.Register("comfort", func(params map[string]interface{}) (ActionV2, error) {
		return NewComfortActionV2(), nil
	})

	// 休息动作
	f.Register("rest", func(params map[string]interface{}) (ActionV2, error) {
		return NewRestActionV2(), nil
	})

	// 整理动作
	f.Register("organize", func(params map[string]interface{}) (ActionV2, error) {
		return NewBaseActionV2(
			"organize",
			"小龙虾切换为「整理资料」状态，有条不紊地将信息分类",
			8*time.Second,
		), nil
	})

	// 交付动作
	f.Register("deliver", func(params map[string]interface{}) (ActionV2, error) {
		return NewBaseActionV2(
			"deliver",
			"小龙虾切换为「郑重交付」动作，双手托起，向用户方向推出",
			6*time.Second,
		), nil
	})

	// 鼓励动作
	f.Register("encourage", func(params map[string]interface{}) (ActionV2, error) {
		return NewBaseActionV2(
			"encourage",
			"小龙虾鼓励用户，做出加油的动作",
			5*time.Second,
		), nil
	})
}

// Create 创建动作
func (f *ActionFactoryV2) Create(actionName string, params map[string]interface{}) (ActionV2, error) {
	creator, exists := f.actionCreators[actionName]
	if !exists {
		return nil, fmt.Errorf("动作不存在: %s", actionName)
	}

	return creator(params)
}

// GetAvailableActions 获取可用动作列表
func (f *ActionFactoryV2) GetAvailableActions() []string {
	actions := make([]string, 0, len(f.actionCreators))
	for actionName := range f.actionCreators {
		actions = append(actions, actionName)
	}
	return actions
}

// GetActionDescription 获取动作描述
func (f *ActionFactoryV2) GetActionDescription(actionName string) (string, error) {
	// 创建临时动作来获取描述
	action, err := f.Create(actionName, map[string]interface{}{})
	if err != nil {
		return "", err
	}
	return action.Description(), nil
}

// GetActionsInfo 获取所有动作信息
func (f *ActionFactoryV2) GetActionsInfo() map[string]interface{} {
	info := make(map[string]interface{})

	for actionName := range f.actionCreators {
		action, err := f.Create(actionName, map[string]interface{}{})
		if err != nil {
			continue
		}

		info[actionName] = map[string]interface{}{
			"description": action.Description(),
			"duration_ms": action.Duration().Milliseconds(),
		}
	}

	return info
}

// BuildActionResponse 构建动作响应
func BuildActionResponse(factory *ActionFactoryV2) string {
	availableActions := factory.GetAvailableActions()
	prompt := ""
	for _, act := range availableActions {
		desc, err := factory.GetActionDescription(act)
		if err == nil {
			prompt += fmt.Sprintf("- %s: %s\n", act, desc)
		}
	}
	return prompt
}

// DefaultActionFactory 默认动作工厂（单例）
var defaultActionFactory *ActionFactoryV2

// GetDefaultActionFactory 获取默认动作工厂
func GetDefaultActionFactory() *ActionFactoryV2 {
	if defaultActionFactory == nil {
		defaultActionFactory = NewActionFactoryV2()
	}
	return defaultActionFactory
}

// CreateActionFromLLM 从LLM响应创建动作
func CreateActionFromLLM(llmResponse string, factory *ActionFactoryV2) (ActionV2, map[string]float64, string, error) {
	// 解析LLM响应格式:
	// action:<动作名称>
	// <状态1>:<变化值>
	// <状态2>:<变化值>
	// text:<回复内容>

	lines := splitLines(llmResponse)
	var actionName string
	stateChanges := make(map[string]float64)
	var textReply string

	for _, line := range lines {
		line = trimSpace(line)
		if line == "" {
			continue
		}

		if startsWith(line, "action:") {
			actionName = line[7:] // 去掉 "action:"
		} else if containsStr(line, ":") && !startsWith(line, "text:") {
			parts := split(line, ":")
			if len(parts) == 2 {
				stateName := trimSpace(parts[0])
				changeStr := trimSpace(parts[1])

				// 解析变化值
				var change float64
				_, err := fmt.Sscanf(changeStr, "%f", &change)
				if err == nil {
					stateChanges[stateName] = change
				}
			}
		} else if startsWith(line, "text:") {
			textReply = line[5:] // 去掉 "text:"
		}
	}

	if actionName == "" {
		return nil, nil, "", fmt.Errorf("LLM响应中没有找到动作名称")
	}

	// 创建动作
	action, err := factory.Create(actionName, map[string]interface{}{})
	if err != nil {
		return nil, nil, "", err
	}

	return action, stateChanges, textReply, nil
}

// 辅助函数
func splitLines(s string) []string {
	var result []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		result = append(result, s[start:])
	}
	return result
}

func trimSpace(s string) string {
	start := 0
	end := len(s)

	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r') {
		start++
	}

	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r' || s[end-1] == '\n') {
		end--
	}

	return s[start:end]
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func split(s string, sep string) []string {
	for i := 0; i < len(s); i++ {
		if s[i] == sep[0] {
			return []string{s[:i], s[i+1:]}
		}
	}
	return []string{s}
}
