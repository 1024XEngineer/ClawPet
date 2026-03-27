package service

import (
	"context"
	"fmt"
	"go.uber.org/zap"
	"shrimp-demo/pkg/logger"
	"strings"
	"time"

	"shrimp-demo/action"
	"shrimp-demo/state"
)

// Coordinator LLM协调器
type Coordinator struct {
	llmService     *LLMService
	stateManager   *state.StateManager
	actionExecutor *action.ActionExecutor
	actionFactory  *action.ActionFactoryV2
}

// NewCoordinator 创建协调器
func NewCoordinator(llmService *LLMService) *Coordinator {
	return &Coordinator{
		llmService:     llmService,
		stateManager:   state.DefaultStateManager(),
		actionExecutor: action.NewActionExecutor(),
		actionFactory:  action.GetDefaultActionFactory(),
	}
}

// NewCoordinatorWithState 创建带自定义状态管理器的协调器
func NewCoordinatorWithState(llmService *LLMService, stateManager *state.StateManager) *Coordinator {
	return &Coordinator{
		llmService:     llmService,
		stateManager:   stateManager,
		actionExecutor: action.NewActionExecutor(),
		actionFactory:  action.GetDefaultActionFactory(),
	}
}

// ProcessMessage 处理用户消息
func (c *Coordinator) ProcessMessage(ctx context.Context, userMessage string) (map[string]interface{}, error) {
	// 1. 构建动态提示词
	systemPrompt := c.buildPrompt()

	logger.Log.Info("系统提示词:", zap.String("prompt", systemPrompt))

	// 2. 调用LLM（使用系统提示词）
	llmResponse, err := c.llmService.ChatWithSystemPrompt(ctx, systemPrompt, userMessage)
	if err != nil {
		return nil, fmt.Errorf("LLM调用失败: %w", err)
	}

	logger.Log.Info("LLM 响应:", zap.String("response", llmResponse))

	// 3. 解析LLM响应
	actionObj, stateChanges, textReply, err := action.CreateActionFromLLM(llmResponse, c.actionFactory)
	if err != nil {
		return nil, fmt.Errorf("解析LLM响应失败: %w", err)
	}

	// 4. 应用状态变化
	if len(stateChanges) > 0 {
		c.stateManager.ApplyChanges(stateChanges)
	}

	// 5. 执行动作
	var actionErr error
	if actionObj != nil {
		actionErr = c.actionExecutor.Execute(actionObj)
	}

	// 6. 构建响应（不再有动作的额外状态影响）
	response := c.buildResponse(userMessage, textReply, actionObj, stateChanges, actionErr)

	return response, nil
}

// buildPrompt 构建动态提示词
func (c *Coordinator) buildPrompt() string {

	prompt := "你是一个小龙虾桌宠助手。你有以下状态：\n"

	// 获取状态提示词
	statePrompt := state.BuildStatePrompt(c.stateManager)

	prompt += statePrompt

	prompt += "\n你当前可用动作:\n"

	actionResponse := action.BuildActionResponse(c.actionFactory)
	prompt += actionResponse

	prompt += "\n你可以执行可用动作的其中一个动作：\n"
	prompt += "\n请根据用户消息和当前状态：\n"
	prompt += "1. 选择一个合适的动作（必须）\n"
	prompt += "2. 决定状态变化（格式: 状态名:±数值）\n"
	prompt += "3. 生成回复文本\n\n"

	prompt += "响应格式：\n"
	prompt += "action:<动作名称>\n"

	stateResponse := state.BuildStateResponse(c.stateManager)
	prompt += stateResponse

	prompt += "text:你的回复内容\n"

	prompt += "\n\n请根据以上信息生成响应。"

	return prompt
}

// buildResponse 构建响应
func (c *Coordinator) buildResponse(
	userMessage string,
	textReply string,
	actionObj action.ActionV2,
	stateChanges map[string]float64,
	actionErr error,
) map[string]interface{} {
	// 获取当前状态摘要
	stateSummary := state.GetStateSummaryForJSON(c.stateManager)

	// 获取动作状态
	actionStatus := c.actionExecutor.GetStatus()

	// 构建响应
	response := map[string]interface{}{
		"user_message": userMessage,
		"text_reply":   textReply,
		"states":       stateSummary,
		"action":       nil,
		"state_changes": map[string]interface{}{
			"from_llm": stateChanges,
			"total":    stateChanges, // 现在只有LLM决定的状态变化
		},
		"action_status": actionStatus,
		"timestamp":     time.Now().Unix(),
	}

	// 添加动作信息
	if actionObj != nil {
		response["action"] = map[string]interface{}{
			"name":        actionObj.Name(),
			"description": actionObj.Description(),
			"duration_ms": actionObj.Duration().Milliseconds(),
			"error":       nil,
		}

		if actionErr != nil {
			response["action"].(map[string]interface{})["error"] = actionErr.Error()
		}
	}

	// 添加情感摘要
	emotionSummary := c.getEmotionSummary()
	response["emotion_summary"] = emotionSummary

	return response
}

// getEmotionSummary 获取情感摘要
func (c *Coordinator) getEmotionSummary() map[string]interface{} {
	states := c.stateManager.GetAll()
	summary := make(map[string]interface{})

	for name, stateObj := range states {
		// 使用类型断言获取具体状态的方法
		switch s := stateObj.(type) {
		case *state.MoodState:
			summary[name] = map[string]interface{}{
				"emoji":        s.GetEmoji(),
				"emotion_text": s.GetEmotionText(),
				"is_happy":     s.IsHappy(),
				"is_sad":       s.IsSad(),
			}
		case *state.AffectionState:
			summary[name] = map[string]interface{}{
				"emoji":           s.GetEmoji(),
				"emotion_text":    s.GetEmotionText(),
				"is_liking":       s.IsLiking(),
				"is_disliking":    s.IsDisliking(),
				"affection_level": s.GetAffectionLevel(),
			}
		case *state.FrustrationState:
			summary[name] = map[string]interface{}{
				"emoji":             s.GetEmoji(),
				"emotion_text":      s.GetEmotionText(),
				"is_frustrated":     s.IsFrustrated(),
				"needs_comfort":     s.NeedsComfort(),
				"frustration_level": s.GetFrustrationLevel(),
			}
		default:
			summary[name] = map[string]interface{}{
				"value":   stateObj.Value(),
				"emotion": stateObj.EmotionForValue(stateObj.Value()),
			}
		}
	}

	return summary
}

// GetCurrentStatus 获取当前状态
func (c *Coordinator) GetCurrentStatus() map[string]interface{} {
	stateSummary := state.GetStateSummaryForJSON(c.stateManager)
	actionStatus := c.actionExecutor.GetStatus()
	emotionSummary := c.getEmotionSummary()

	return map[string]interface{}{
		"states":          stateSummary,
		"action_status":   actionStatus,
		"emotion_summary": emotionSummary,
		"timestamp":       time.Now().Unix(),
	}
}

// GetAvailableActions 获取可用动作
func (c *Coordinator) GetAvailableActions() map[string]interface{} {
	return c.actionFactory.GetActionsInfo()
}

// ForceAction 强制执行动作（用于测试或特殊情况）
func (c *Coordinator) ForceAction(actionName string, params map[string]interface{}) error {
	actionObj, err := c.actionFactory.Create(actionName, params)
	if err != nil {
		return err
	}

	// 执行动作
	if err := c.actionExecutor.Execute(actionObj); err != nil {
		return err
	}

	// 注意：强制执行动作时不会自动改变状态
	// 状态变化应该由LLM在响应中指定
	return nil
}

// Reset 重置状态和动作
func (c *Coordinator) Reset() {
	c.stateManager.Reset()
	c.actionExecutor.Stop()
}

// mergeChanges 合并状态变化
func mergeChanges(changes1, changes2 map[string]float64) map[string]float64 {
	result := make(map[string]float64)

	// 复制第一个map
	for k, v := range changes1 {
		result[k] = v
	}

	// 合并第二个map
	for k, v := range changes2 {
		if existing, exists := result[k]; exists {
			result[k] = existing + v
		} else {
			result[k] = v
		}
	}

	return result
}

// ParseLLMResponse 解析LLM响应（公开方法）
func (c *Coordinator) ParseLLMResponse(llmResponse string) (action.ActionV2, map[string]float64, string, error) {
	return action.CreateActionFromLLM(llmResponse, c.actionFactory)
}

// SimpleProcess 简化处理（不使用LLM，用于测试）
func (c *Coordinator) SimpleProcess(userMessage string) map[string]interface{} {
	// 根据消息内容选择简单动作
	var actionName string
	var stateChanges map[string]float64
	var textReply string

	// 简单规则匹配
	if strings.Contains(userMessage, "搜索") || strings.Contains(userMessage, "查找") {
		actionName = "search"
		textReply = "小龙虾正在帮你搜索信息..."
		stateChanges = map[string]float64{
			"affection": +10,
			"mood":      +5,
		}
	} else if strings.Contains(userMessage, "思考") || strings.Contains(userMessage, "怎么回答") {
		actionName = "think"
		textReply = "小龙虾正在认真思考这个问题..."
		stateChanges = map[string]float64{
			"affection":   +8,
			"frustration": +3,
		}
	} else if strings.Contains(userMessage, "开心") || strings.Contains(userMessage, "高兴") {
		actionName = "play"
		textReply = "小龙虾也很开心，一起玩耍吧~"
		stateChanges = map[string]float64{
			"mood":        +15,
			"affection":   +10,
			"frustration": -10,
		}
	} else {
		actionName = "standby"
		textReply = "小龙虾在待命，有什么需要帮助的吗？"
		stateChanges = map[string]float64{
			"mood":        +1,
			"frustration": -2,
		}
	}

	// 应用状态变化
	if len(stateChanges) > 0 {
		c.stateManager.ApplyChanges(stateChanges)
	}

	// 执行动作
	var actionObj action.ActionV2
	var actionErr error
	if actionName != "" {
		actionObj, actionErr = c.actionFactory.Create(actionName, map[string]interface{}{})
		if actionErr == nil {
			c.actionExecutor.Execute(actionObj)

		}
	}

	// 构建响应
	return c.buildResponse(userMessage, textReply, actionObj, stateChanges, actionErr)
}
