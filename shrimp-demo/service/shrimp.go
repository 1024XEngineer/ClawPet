package service

import (
	"context"
	"fmt"
	"sync"

	"shrimp-demo/action"
	"shrimp-demo/state"
)

// ShrimpService 桌宠核心服务
type ShrimpService struct {
	stateMachine   *state.Machine
	actionRegistry *action.Registry
	llmService     *LLMService
	mu             sync.RWMutex
}

// NewShrimpService 创建桌宠服务（不带 LLM）
func NewShrimpService() *ShrimpService {
	registry := action.NewRegistry()
	stateMachine := state.NewMachine(registry)

	return &ShrimpService{
		stateMachine:   stateMachine,
		actionRegistry: registry,
		llmService:     nil, // 默认不启用 LLM
	}
}

// NewShrimpServiceWithLLM 创建带 LLM 的桌宠服务
func NewShrimpServiceWithLLM(apiKey string) *ShrimpService {
	registry := action.NewRegistry()
	stateMachine := state.NewMachine(registry)
	llmService := NewLLMService(apiKey)

	return &ShrimpService{
		stateMachine:   stateMachine,
		actionRegistry: registry,
		llmService:     llmService,
	}
}

// GetCurrentStatus 获取当前状态
func (s *ShrimpService) GetCurrentStatus() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	currentAction := s.stateMachine.CurrentAction()

	return map[string]interface{}{
		"state": string(s.stateMachine.CurrentState()),
		"action": map[string]string{
			"name":        currentAction.Name(),
			"description": currentAction.Description(),
			"emotion":     currentAction.Emotion(),
		},
		"idle_too_long": s.stateMachine.IsIdleTooLong(),
	}
}

// ProcessUserMessage 处理用户消息（基础版）
func (s *ShrimpService) ProcessUserMessage(message string) map[string]interface{} {
	return s.processUserMessageInternal(message, false, "")
}

// ProcessUserMessageWithLLM 使用 LLM 处理用户消息
func (s *ShrimpService) ProcessUserMessageWithLLM(ctx context.Context, message string) map[string]interface{} {
	if s.llmService == nil {
		// 如果没有 LLM 服务，回退到基础版
		return s.processUserMessageInternal(message, false, "")
	}

	// 使用 LLM 分析消息
	action, llmResponse, err := s.llmService.AnalyzeMessage(ctx, message)
	if err != nil {
		// LLM 失败时回退到基础版
		fmt.Printf("LLM 分析失败: %v\n", err)
		return s.processUserMessageInternal(message, false, "")
	}

	// 使用 LLM 建议的动作
	return s.processUserMessageInternal(message, true, action, llmResponse)
}

// processUserMessageInternal 内部消息处理方法
func (s *ShrimpService) processUserMessageInternal(message string, useLLM bool, llmData ...string) map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 根据消息内容查找匹配的动作
	matchedActions := s.stateMachine.ProcessMessage(message)

	// 决定状态转换
	var newState state.State
	var llmAction string
	var llmResponse string

	if useLLM && len(llmData) >= 2 {
		// 使用 LLM 建议的动作
		llmAction = llmData[0]
		llmResponse = llmData[1]
		newState = s.getStateFromAction(llmAction)
	} else {
		// 使用关键词匹配
		newState = s.getStateFromKeywords(message)
	}

	// 尝试状态转换
	transitionSuccess := s.stateMachine.Transition(newState)

	// 准备响应
	response := map[string]interface{}{
		"message":            message,
		"matched_actions":    make([]map[string]string, 0),
		"new_state":          string(newState),
		"transition_success": transitionSuccess,
		"suggested_action":   "",
		"use_llm":            useLLM,
	}

	// 添加 LLM 响应
	if useLLM {
		response["llm_action"] = llmAction
		response["llm_response"] = llmResponse
	}

	// 添加匹配的动作
	for _, action := range matchedActions {
		response["matched_actions"] = append(response["matched_actions"].([]map[string]string), map[string]string{
			"name":        action.Name(),
			"description": action.Description(),
			"emotion":     action.Emotion(),
		})
	}

	// 如果有匹配的动作，建议第一个
	if len(matchedActions) > 0 {
		response["suggested_action"] = matchedActions[0].Name()
	}

	return response
}

// getStateFromKeywords 根据关键词获取状态
func (s *ShrimpService) getStateFromKeywords(message string) state.State {
	switch {
	case containsAny(message, []string{"搜索", "查找", "查一下", "帮我查"}):
		return state.StateSearch
	case containsAny(message, []string{"专注", "认真", "仔细"}):
		return state.StateFocus
	case containsAny(message, []string{"有用", "发现", "宝贝"}):
		return state.StateExcited
	case containsAny(message, []string{"整理", "分类", "汇总"}):
		return state.StateOrganize
	case containsAny(message, []string{"好了", "完成", "给你"}):
		return state.StateDeliver
	case containsAny(message, []string{"思考", "想想", "怎么答"}):
		return state.StateThink
	default:
		return state.StateStandby
	}
}

// getStateFromAction 根据动作名称获取状态
func (s *ShrimpService) getStateFromAction(action string) state.State {
	switch action {
	case "search":
		return state.StateSearch
	case "focus":
		return state.StateFocus
	case "excited":
		return state.StateExcited
	case "organize":
		return state.StateOrganize
	case "deliver":
		return state.StateDeliver
	case "think":
		return state.StateThink
	default:
		return state.StateStandby
	}
}

// GetAllActions 获取所有可用动作
func (s *ShrimpService) GetAllActions() []map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	actions := s.actionRegistry.GetAll()
	result := make([]map[string]string, 0, len(actions))

	for _, action := range actions {
		result = append(result, map[string]string{
			"name":        action.Name(),
			"description": action.Description(),
			"emotion":     action.Emotion(),
			"keywords":    stringSliceToString(action.TriggerKeywords()),
		})
	}

	return result
}

// containsAny 检查字符串是否包含任意一个子串
func containsAny(s string, substrings []string) bool {
	for _, substr := range substrings {
		if len(s) >= len(substr) && s[:len(substr)] == substr {
			return true
		}
	}
	return false
}

// SearchWithLLM 使用 LLM 进行智能搜索
func (s *ShrimpService) SearchWithLLM(ctx context.Context, company string) map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 转换到搜索状态
	s.stateMachine.Transition(state.StateSearch)

	response := map[string]interface{}{
		"company": company,
		"status":  "searching",
		"use_llm": s.llmService != nil,
	}

	// 如果有 LLM 服务，使用 LLM 进行智能搜索
	if s.llmService != nil {
		llmResponse, err := s.llmService.SearchWithLLM(ctx, company)
		if err == nil {
			response["llm_response"] = llmResponse
			response["search_method"] = "llm_enhanced"

			// 解析 LLM 响应中的动作
			if len(llmResponse) > 0 {
				// 简单解析动作标签
				if containsAny(llmResponse, []string{"action:search", "搜索"}) {
					s.stateMachine.Transition(state.StateSearch)
				} else if containsAny(llmResponse, []string{"action:focus", "专注"}) {
					s.stateMachine.Transition(state.StateFocus)
				} else if containsAny(llmResponse, []string{"action:excited", "兴奋", "发现"}) {
					s.stateMachine.Transition(state.StateExcited)
				}
			}
		} else {
			response["llm_error"] = err.Error()
			response["search_method"] = "basic"
		}
	} else {
		// 基础搜索模拟
		response["search_method"] = "basic"
		response["steps"] = []string{
			"搜索公司官网",
			"查找近期新闻",
			"分析业务动态",
			"整理招聘信息",
		}
		response["estimated_time"] = "45秒"
	}

	return response
}

// ThinkWithLLM 使用 LLM 进行思考回答
func (s *ShrimpService) ThinkWithLLM(ctx context.Context, question string) map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 转换到思考状态
	s.stateMachine.Transition(state.StateThink)

	response := map[string]interface{}{
		"question": question,
		"status":   "thinking",
		"use_llm":  s.llmService != nil,
	}

	// 如果有 LLM 服务，使用 LLM 进行思考
	if s.llmService != nil {
		llmResponse, err := s.llmService.ThinkWithLLM(ctx, question)
		if err == nil {
			response["llm_response"] = llmResponse
			response["think_method"] = "llm_enhanced"
		} else {
			response["llm_error"] = err.Error()
			response["think_method"] = "basic"
			response["suggestions"] = []string{
				"从你的项目经验说起",
				"连接到公司业务需求",
				"展示你的技术能力",
				"表达你的学习意愿",
			}
		}
	} else {
		// 基础思考模拟
		response["think_method"] = "basic"
		response["suggestions"] = []string{
			"从你的项目经验说起",
			"连接到公司业务需求",
			"展示你的技术能力",
			"表达你的学习意愿",
		}
	}

	return response
}

// stringSliceToString 将字符串切片转换为逗号分隔的字符串
func stringSliceToString(slice []string) string {
	result := ""
	for i, s := range slice {
		if i > 0 {
			result += ", "
		}
		result += s
	}
	return result
}
