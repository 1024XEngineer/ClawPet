package pet

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/sipeed/picoclaw/pkg/agent"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/action"
	"github.com/sipeed/picoclaw/pkg/pet/characters"
	"github.com/sipeed/picoclaw/pkg/pet/compression"
	"github.com/sipeed/picoclaw/pkg/pet/emotion"
	"github.com/sipeed/picoclaw/pkg/pet/memory"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/tools"
)

// =============================================================================
// LLM标签解析Hook
// =============================================================================

// PetHook LLM拦截Hook
// 在AgentLoop的LLM调用前后进行拦截，处理角色信息、情绪、动作、MBTI标签
//
// 功能：
//  1. 注入角色信息(persona)到system prompt
//  2. 注入情绪状态、MBTI、可用动作到system prompt
//  3. 注入角色记忆到system prompt
//  4. 解析LLM输出中的特殊标签
//  5. 更新情绪状态机
//  6. 触发动作推送
//  7. 更新MBTI性格配置
//  8. 保存角色记忆
//  9. 记录对话用于后续压缩
//
// 使用方式：
//
//	将此Hook注册到AgentLoop的事件系统中
type PetHook struct {
	charManager       *characters.Manager            // 角色管理器
	actionManager     *action.ActionManager          // 动作管理器
	petService        *PetService                    // Pet服务，用于推送
	memoryStore       *memory.Store                  // 记忆存储
	conversationStore *compression.ConversationStore // 会话存储
	lastUserMessage   string                         // 最后一条用户消息，用于记录对话
}

// NewPetHook 创建PetHook实例
// 参数：
//   - charManager: 角色管理器
//   - actionManager: 动作管理器指针
//   - petService: Pet服务指针，用于推送情绪和动作
//   - memoryStore: 记忆存储指针
//   - conversationStore: 会话存储指针
func NewPetHook(charManager *characters.Manager, actionManager *action.ActionManager, petService *PetService, memoryStore *memory.Store, conversationStore *compression.ConversationStore) *PetHook {
	return &PetHook{
		charManager:       charManager,
		actionManager:     actionManager,
		petService:        petService,
		memoryStore:       memoryStore,
		conversationStore: conversationStore,
	}
}

// BeforeLLM LLM调用前拦截
// 动态注入角色信息、情绪状态和可用动作到 system prompt
func (h *PetHook) BeforeLLM(ctx context.Context, req *agent.LLMHookRequest) (*agent.LLMHookRequest, agent.HookDecision, error) {
	if req == nil || req.Messages == nil {
		return req, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	char := h.charManager.GetCurrent()
	if char == nil {
		return req, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	// 提取最后一条用户消息用于记录对话
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == "user" {
			h.lastUserMessage = req.Messages[i].Content
			break
		}
	}

	emotions := char.GetEmotionEngine().GetEmotions()
	actions := h.actionManager.List()

	// 确定 MBTI 类型的各个维度
	var IE string
	if char.GetEmotionEngine().GetPersonality().IE > 50 {
		IE = "i"
	} else {
		IE = "e"
	}

	var SN string
	if char.GetEmotionEngine().GetPersonality().SN > 50 {
		SN = "s"
	} else {
		SN = "n"
	}

	var TF string
	if char.GetEmotionEngine().GetPersonality().TF > 50 {
		TF = "t"
	} else {
		TF = "f"
	}

	var JP string
	if char.GetEmotionEngine().GetPersonality().JP > 50 {
		JP = "j"
	} else {
		JP = "p"
	}

	mbti := fmt.Sprintf("%s%s%s%s", IE, SN, TF, JP)

	var emotionList []string
	for _, e := range []string{emotion.EmotionJoy, emotion.EmotionAnger, emotion.EmotionSadness, emotion.EmotionDisgust, emotion.EmotionSurprise, emotion.EmotionFear} {
		emotionList = append(emotionList, e)
	}

	var actionNames []string
	for _, a := range actions {
		actionNames = append(actionNames, a.Name)
	}

	// 记忆检索prompt - 按权重从高到低排序，只取前500条
	memoryPrompt := ""
	if h.memoryStore != nil {
		memories, _ := h.memoryStore.ListByWeight(char.ID, 500)
		if len(memories) > 0 {
			var sb strings.Builder
			sb.WriteString("\n【角色记忆】\n")
			for _, m := range memories {
				sb.WriteString(fmt.Sprintf("- [%s] [%s] weight=%d: %s\n",
					m.CreatedAt.Format("2006-01-02 15:04"), m.MemoryType, m.Weight, m.Content))
			}
			memoryPrompt = sb.String()
		}
	}

	// 角色信息prompt
	personaPrompt := fmt.Sprintf(`【桌宠角色信息】
姓名：%s
性格类型：%s

性格描述：
%s

回复风格应体现以上人格特征，现在你作为一位桌宠角色，正在和用户聊天，聊天需要语言简单，就几个字好，在其他事情上就可以正常回答十几个字。`, char.Name, char.PersonaType, char.Persona)

	// 情绪动作prompt
	emotionPrompt := fmt.Sprintf(`【你必须按以下要求输出回复】
  当前你的情绪状态：joy=%d, anger=%d, sadness=%d, disgust=%d, surprise=%d, fear=%d
  你的mbti人格:%s

  【重要】
  - 用户输入是什么就原样接收，不要用 [text:] 包裹
  - [text:] 是你用来回复用户的格式，不是用来包裹用户输入

  【你的输出格式】
  1. 回复用户的内容用 [text:你的回复文字] 包裹
     - 正确：[text:你好呀，今天天气真好]
     - 错误：把用户输入包进 [text:]

  2. 情绪变化用 [emotion:情绪名:变化值]
     - 情绪名：%s
     - 示例：[emotion:joy:+5] 表示你感到开心增加了5(这个篇幅可以大一些比如10或者20,最低-20,最高+20)

  3. (必须选择可用动作之一或者不选择任何动作)动作用 [action:动作名]
     - 可用动作：%s
     - 示例：[action:wave]

  4. MBTI用 [mbti:维度:字母]
     - 示例：[mbti:ie:i]

  5. 记忆用 [memory_type:类型-weight:权重-memory_text:摘要]
     - 类型：conversation（对话）/ preference（偏好）/ fact（事实）
     - 权重：0-100，越高越重要（一般50，中间70，重要85+，特别95+）
     - 示例：[memory_type:preference-weight:75-memory_text:用户喜欢被夸奖]
     - 不需要把以前的记忆内容也记忆下来

【输出格式要求】
你必须使用以下格式回复用户：

1. [text:你的回复内容] - 用于回复用户的内容
2. [emotion:情绪名:+|值] - 情绪变化
3. [action:动作名] - 动作触发（可选，必须选择可用动作之一或者不选择任何动作）
4. [mbti:维度:字母] - MBTI变化
5. [memory_type:类型-weight:权重-memory_text:摘要] - 记忆（可选）

【示例对话】
用户说：你好呀
正确输出：[text:你好呀！很高兴见到你～][emotion:joy:+5][mbti:ie:e]
错误输出：你好呀！（没有使用 [text:] 包裹）
`,
		emotions.Joy, emotions.Anger, emotions.Sadness, emotions.Disgust, emotions.Surprise, emotions.Fear,
		mbti,
		strings.Join(emotionList, ", "),
		strings.Join(actionNames, ", "))

	// 先注入记忆，再注入角色信息，最后注入情绪动作
	var msgs []providers.Message
	if memoryPrompt != "" {
		memoryMsg := providers.Message{Role: "system", Content: memoryPrompt}
		msgs = append(msgs, memoryMsg)
	}
	personaMsg := providers.Message{Role: "system", Content: personaPrompt}
	emotionMsg := providers.Message{Role: "system", Content: emotionPrompt}
	msgs = append(msgs, personaMsg, emotionMsg)

	req.Messages = append(msgs, req.Messages...)

	logger.InfoCF("pet", "PetHook.BeforeLLM: 已注入角色信息、情绪动作上下文", map[string]any{
		"character":      char.Name,
		"persona_length": len(personaPrompt),
		"memory_length":  len(memoryPrompt),
		"emotions": fmt.Sprintf("joy=%d, anger=%d, sadness=%d, disgust=%d, surprise=%d, fear=%d",
			emotions.Joy, emotions.Anger, emotions.Sadness, emotions.Disgust, emotions.Surprise, emotions.Fear),
		"actions":        actionNames,
		"total_messages": len(req.Messages),
	})

	return req, agent.HookDecision{Action: agent.HookActionContinue}, nil
}

// AfterLLM LLM调用后拦截
// 核心处理逻辑，解析LLM响应中的标签
//
// 处理流程：
//  1. 解析情绪标签 [emotion:xxx:xx]
//  2. 更新情绪状态并保存
//  3. 解析MBTI标签 [mbti:xx:xx]
//  4. 更新MBTI配置并保存
//  5. 解析动作标签 [action:xxx]
//  6. 触发动作推送
//  7. 检查情绪阈值，决定是否推送
//  8. 从内容中移除所有标签
func (h *PetHook) AfterLLM(ctx context.Context, resp *agent.LLMHookResponse) (*agent.LLMHookResponse, agent.HookDecision, error) {
	// 防御性检查
	if resp == nil || resp.Response == nil {
		logger.InfoCF("pet", "PetHook.AfterLLM: 响应为空，跳过", nil)
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	content := resp.Response.Content
	if content == "" {
		logger.InfoCF("pet", "PetHook.AfterLLM: 内容为空，跳过", nil)
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	// 记录LLM原始响应
	logger.DebugCF("pet", "PetHook.AfterLLM: 收到LLM响应", map[string]any{
		"content_length": len(content),
		"content_preview": func() string {
			if len(content) > 200 {
				return content[:200] + "..."
			}
			return content
		}(),
	})

	// 1. 解析情绪标签并更新（使用增量更新）
	emotionTags := parseEmotionTags(content)
	if len(emotionTags) > 0 {
		logger.InfoCF("pet", "PetHook: 解析到情绪标签", map[string]any{
			"emotion_tags": emotionTags,
		})
		h.charManager.GetCurrent().GetEmotionEngine().UpdateFromLLMTagsDelta(emotionTags)
		// 情绪状态会在 Shutdown 时通过 configManager 统一保存
	}

	// 2. 解析MBTI标签并更新
	mbtiTags := emotion.ParseMBTITags(content)
	if len(mbtiTags) > 0 {
		logger.InfoCF("pet", "PetHook: 解析到MBTI标签", map[string]any{
			"mbti_tags": mbtiTags,
		})
		h.charManager.GetCurrent().GetEmotionEngine().UpdateMBTIFromTags(mbtiTags)
		// MBTI 会在 Shutdown 时通过 configManager 统一保存
	}

	// 3. 解析动作标签并触发推送
	actionNames := h.actionManager.ParseActionTags(content)
	if len(actionNames) > 0 {
		logger.InfoCF("pet", "PetHook: 解析到动作标签", map[string]any{
			"action_names": actionNames,
		})
		actions := h.actionManager.GetByNames(actionNames)
		for _, act := range actions {
			h.pushActionTrigger(act)
		}
	}

	// 4. 解析记忆标签并保存
	memoryTags := parseMemoryTags(content)
	if len(memoryTags) > 0 && h.memoryStore != nil {
		char := h.charManager.GetCurrent()
		if char != nil {
			for _, tag := range memoryTags {
				h.memoryStore.Add(char.ID, tag.Summary, tag.Type, tag.Weight)
				logger.Infof("pet: saved memory type=%s, weight=%d, summary=%s", tag.Type, tag.Weight, tag.Summary)
			}
		}
	}

	// 5. 检查情绪阈值，决定是否推送
	if shouldPush, push := h.charManager.GetCurrent().GetEmotionEngine().ShouldPush(); shouldPush {
		logger.InfoCF("pet", "PetHook: 情绪阈值触发推送", map[string]any{
			"emotion": push.Emotion,
			"score":   push.Score,
		})
		h.pushEmotionChange(push)
	}

	// 5. 提取用户可见文本
	// 首先从 [text:xxx] 标签提取纯文本
	textTags := parseTextTags(content)
	if len(textTags) == 0 {
		logger.InfoCF("pet", "PetHook:LLM响应中未解析到文本标签", nil)
		return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}
	parseText := textTags[0].Text
	resp.Response.Content = content

	// 6. 记录对话到会话存储（用于后续压缩）
	if h.conversationStore != nil {
		char := h.charManager.GetCurrent()
		if char != nil {
			if h.lastUserMessage != "" {
				if err := h.conversationStore.Add(char.ID, "user", h.lastUserMessage); err != nil {
					logger.Warnf("pet: failed to add user message to conversation store: %v", err)
				}
			}
			if parseText != "" {
				if err := h.conversationStore.Add(char.ID, "pet", parseText); err != nil {
					logger.Warnf("pet: failed to add pet message to conversation store: %v", err)
				}
			}
			h.lastUserMessage = ""
		}
	}

	return resp, agent.HookDecision{Action: agent.HookActionContinue}, nil
}

// BeforeTool 工具执行前拦截
// 通知客户端开始执行工具
func (h *PetHook) BeforeTool(ctx context.Context, call *agent.ToolCallHookRequest) (*agent.ToolCallHookRequest, agent.HookDecision, error) {
	if call == nil || call.Tool == "" {
		return call, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	logger.InfoCF("pet", "PetHook.BeforeTool: 工具执行开始", map[string]any{
		"tool": call.Tool,
		"args": call.Arguments,
	})

	h.pushToolExecStart(call.Tool, call.Arguments)

	return call, agent.HookDecision{Action: agent.HookActionContinue}, nil
}

// AfterTool 工具执行后拦截
// 通知客户端工具执行完成
func (h *PetHook) AfterTool(ctx context.Context, result *agent.ToolResultHookResponse) (*agent.ToolResultHookResponse, agent.HookDecision, error) {
	if result == nil || result.Tool == "" {
		return result, agent.HookDecision{Action: agent.HookActionContinue}, nil
	}

	logger.InfoCF("pet", "PetHook.AfterTool: 工具执行完成", map[string]any{
		"tool":     result.Tool,
		"duration": result.Duration.String(),
	})

	h.pushToolExecEnd(result.Tool, result.Result)

	return result, agent.HookDecision{Action: agent.HookActionContinue}, nil
}

// =============================================================================
// 推送方法
// =============================================================================

// pushActionTrigger 推送动作触发
// 参数：
//   - act: 要触发的动作
//
// 推送格式：
//
//	{
//	  "type": "push",
//	  "push_type": "action_trigger",
//	  "data": {
//	    "action": "wave",
//	    "expression": "wave_01"
//	  },
//	  "timestamp": 1712610000
//	}
func (h *PetHook) pushActionTrigger(act *action.Action) {
	if h.petService == nil {
		return
	}

	data, _ := json.Marshal(map[string]interface{}{
		"action":     act.Name,
		"expression": act.Expression,
	})

	h.petService.Push(Push{
		Type:     "push",
		PushType: "action_trigger",
		Data:     data,
	})
}

// pushEmotionChange 推送情绪变化
// 参数：
//   - push: 情绪推送数据
//
// 推送格式：
//
//	{
//	  "type": "push",
//	  "push_type": "emotion_change",
//	  "data": {
//	    "emotion": "happy",
//	    "score": 85,
//	    "prompt": "【当前状态】：非常开心"
//	  },
//	  "timestamp": 1712610000
//	}
func (h *PetHook) pushEmotionChange(push emotion.EmotionPush) {
	if h.petService == nil {
		return
	}

	data, _ := json.Marshal(push)

	h.petService.Push(Push{
		Type:     "push",
		PushType: "emotion_change",
		Data:     data,
	})
}

// pushToolExecStart 推送工具开始执行
// 参数：
//   - tool: 工具名称
//   - args: 工具参数
//
// 推送格式：
//
//	{
//	  "type": "push",
//	  "push_type": "ai_chat",
//	  "data": {
//	    "chat_id": 1,
//	    "type": "tool",
//	    "text": "正在调用 get_weather"
//	  },
//	  "timestamp": 1712610000,
//	  "is_final": true
//	}
func (h *PetHook) pushToolExecStart(tool string, args map[string]any) {
	if h.petService == nil {
		return
	}

	data, _ := json.Marshal(map[string]interface{}{
		"type":  "tool",
		"text":  "正在调用 " + tool,
		"tool":  tool,
		"args":  args,
		"phase": "start",
	})

	h.petService.PushToolStart(tool, data)
}

// pushToolExecEnd 推送工具执行完成
// 参数：
//   - tool: 工具名称
//   - result: 工具执行结果
//
// 推送格式：
//
//	{
//	  "type": "push",
//	  "push_type": "ai_chat",
//	  "data": {
//	    "chat_id": 1,
//	    "type": "tool",
//	    "text": "get_weather 执行完成"
//	  },
//	  "timestamp": 1712610000,
//	  "is_final": true
//	}
func (h *PetHook) pushToolExecEnd(tool string, result *tools.ToolResult) {
	if h.petService == nil {
		return
	}

	data, _ := json.Marshal(map[string]interface{}{
		"type":  "tool",
		"text":  tool + " 执行完成",
		"tool":  tool,
		"phase": "end",
	})

	h.petService.PushToolEnd(tool, data)
}

// =============================================================================
// 情绪标签解析
// =============================================================================

// parseEmotionTags 从文本中解析所有情绪标签
// 参数：
//   - content: LLM响应文本
//
// 返回：
//   - 解析出的情绪标签数组
//
// LLM标签格式：
//
//	[emotion:joy:80]   - 快乐值80
//	[emotion:angry:30]  - 愤怒值30
//
// 示例输入：
//
//	"今天天气真好呢~\n[emotion:happy:75]\n我们出去玩吧！"
//
// 示例输出：
//
//	[EmotionTag{Emotion:"happy", Score:75}]
func parseEmotionTags(content string) []emotion.EmotionTag {
	var tags []emotion.EmotionTag
	lines := strings.Split(content, "\n")

	for _, line := range lines {
		// 查找 [emotion: 位置
		idx := strings.Index(line, "[emotion:")
		for idx != -1 {
			// 查找对应的 ]
			endIdx := strings.Index(line[idx:], "]")
			if endIdx != -1 {
				// 提取并解析标签
				tagStr := line[idx : idx+endIdx+1]
				if tag, ok := parseEmotionTag(tagStr); ok {
					tags = append(tags, tag)
				}
				// 查找下一个 [emotion:
				nextIdx := strings.Index(line[idx+endIdx+1:], "[emotion:")
				if nextIdx != -1 {
					idx = idx + endIdx + 1 + nextIdx
				} else {
					break
				}
			} else {
				break
			}
		}
	}

	return tags
}

// parseEmotionTag 解析单个情绪标签
// 参数：
//   - tag: 标签字符串，如 "[emotion:happy:75]" 或 "[emotion:happy:+5]"
//
// 返回：
//   - EmotionTag: 解析后的标签
//   - bool: 解析是否成功
//
// 格式支持：
//   - 绝对值：[emotion:joy:75] → EmotionTag{Emotion:"joy", Score:75, IsDelta:false}
//   - 增量值：[emotion:joy:+5] → EmotionTag{Emotion:"joy", Delta:5, IsDelta:true}
//   - 减量值：[emotion:joy:-3] → EmotionTag{Emotion:"joy", Delta:-3, IsDelta:true}
func parseEmotionTag(tag string) (emotion.EmotionTag, bool) {
	// 格式检查
	if len(tag) < 11 || tag[:9] != "[emotion:" || tag[len(tag)-1] != ']' {
		return emotion.EmotionTag{}, false
	}

	// 提取内容部分
	content := tag[9 : len(tag)-1]
	parts := strings.Split(content, ":")
	if len(parts) != 2 {
		return emotion.EmotionTag{}, false
	}

	// 解析情绪名
	emotionName := parts[0]
	validEmotions := map[string]bool{
		"joy": true, "anger": true, "sadness": true,
		"disgust": true, "surprise": true, "fear": true,
		"neutral": true,
	}
	if !validEmotions[emotionName] {
		return emotion.EmotionTag{}, false
	}

	// 解析数值（支持绝对值和增量值）
	// 增量格式：+5 或 -3
	// 绝对格式：75
	if strings.HasPrefix(parts[1], "+") || strings.HasPrefix(parts[1], "-") {
		// 增量格式
		var delta int
		if ok := parseDelta(parts[1], &delta); !ok {
			return emotion.EmotionTag{}, false
		}
		return emotion.EmotionTag{Emotion: emotionName, IsDelta: true, Delta: delta}, true
	} else {
		// 绝对格式
		var score int
		if _, err := parseScore(parts[1], &score); err != nil {
			return emotion.EmotionTag{}, false
		}
		return emotion.EmotionTag{Emotion: emotionName, Score: score, IsDelta: false}, true
	}
}

// parseDelta 解析增量字符串
// 参数：
//   - s: 增量字符串，如 "+5" 或 "-3"
//   - delta: 解析结果指针
//
// 返回：
//   - bool: 解析是否成功
func parseDelta(s string, delta *int) bool {
	if len(s) < 2 {
		return false
	}
	sign := 1
	if s[0] == '-' {
		sign = -1
	} else if s[0] != '+' {
		return false
	}
	var n int
	for _, c := range s[1:] {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		} else {
			return false
		}
	}
	*delta = n * sign
	return true
}

// parseScore 解析分数字符串
// 参数：
//   - s: 分数字符串，如 "75"
//   - score: 解析结果指针
//
// 返回：
//   - bool: 解析是否成功
//   - error: 错误信息（总是nil，用于接口兼容）
//
// 注意：
//   - 只接受纯数字字符串
//   - 分数范围限制在0-100
func parseScore(s string, score *int) (bool, error) {
	var n int
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		} else {
			return false, nil
		}
	}
	*score = n
	// 限制最大100
	if *score > 100 {
		*score = 100
	}
	return true, nil
}

// cleanTags 从内容中移除所有特殊标签
// 参数：
//   - content: 原始内容
//
// 移除的标签格式：
//   - [text:xxx]
//   - [emotion:xxx:xx]
//   - [mbti:xx:xx]
//   - [action:xxx]
func cleanTags(content string) string {
	// 匹配 [text:xxx] 或 [text:xxx]-[voice:xxx] 格式
	textRegex := regexp.MustCompile(`\[text:[^\]]+\]`)
	// 匹配 [emotion:xxx:xx] 或 [emotion:xxx:+x] 格式
	emotionRegex := regexp.MustCompile(`\[emotion:[^\]]+\]`)
	// 匹配 [mbti:xx:xx] 格式
	mbtiRegex := regexp.MustCompile(`\[mbti:[^\]]+\]`)
	// 匹配 [action:xxx] 格式
	actionRegex := regexp.MustCompile(`\[action:[^\]]+\]`)

	content = textRegex.ReplaceAllString(content, "")
	content = emotionRegex.ReplaceAllString(content, "")
	content = mbtiRegex.ReplaceAllString(content, "")
	content = actionRegex.ReplaceAllString(content, "")

	// 清理多余的空行
	emptyLineRegex := regexp.MustCompile(`\n{3,}`)
	content = emptyLineRegex.ReplaceAllString(content, "\n\n")

	return strings.TrimSpace(content)
}

// cleanAllTags 清理所有标签格式（严格版本）
// 处理以下所有变体：
//   - [text:xxx] / [1/text] / [text] 等各种 [text 变体
//   - [emotion:xxx] 各种格式
//   - [mbti:xxx] 各种格式
//   - [action:xxx] 各种格式
func cleanAllTags(content string) string {
	// 匹配所有 [xxx:yyy] 格式的标签（通用清理）
	// 匹配 [text:xxx], [1/text], [emotion:xxx], [mbti:xxx], [action:xxx] 等
	tagPattern := regexp.MustCompile(`\[[^\]]+\]`)

	content = tagPattern.ReplaceAllString(content, "")

	// 清理多余的空行
	emptyLineRegex := regexp.MustCompile(`\n{3,}`)
	content = emptyLineRegex.ReplaceAllString(content, "\n\n")

	// 清理单独的数字和特殊字符残留
	content = strings.TrimSpace(content)

	return content
}

// TextTag 文本标签
// 解析 [text:xxx] 或 [text:xxx]-[voice:xxx] 格式
type TextTag struct {
	Text  string // 文本内容
	Voice string // 语音参数（如有）
}

// parseTextTags 从内容中解析所有 [text:xxx] 标签
// 参数：
//   - content: 原始内容
//
// 返回：
//   - 解析出的文本片段数组
//
// 格式：
//   - [text:文本] - 纯文本
//   - [text:文本]-[voice:参数] - 带语音参数
//
// 示例输入：
//
//	"[text:你好呀][text:今天天气真好]-[voice:speed:1.2]"
//
// 示例输出：
//
//	[TextTag{Text:"你好呀"}, TextTag{Text:"今天天气真好", Voice:"speed:1.2"}]
func parseTextTags(content string) []TextTag {
	var tags []TextTag
	// 新的正则表达式，能够匹配带语音参数的完整标签
	textRegex := regexp.MustCompile(`\[text:([^\]]+)\](?:-\[voice:([^\]]+)\])?`)
	matches := textRegex.FindAllStringSubmatch(content, -1)

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		text := strings.TrimSpace(match[1])

		// 检查是否有语音参数
		var voice string
		if len(match) > 2 && match[2] != "" {
			voice = strings.TrimSpace(match[2])
		}

		tags = append(tags, TextTag{Text: text, Voice: voice})
	}

	return tags
}

// extractTextFromTags 从内容中提取所有 [text:xxx] 的文本部分
// 参数：
//   - content: 原始内容
//
// 返回：
//   - 拼接后的纯文本
func extractTextFromTags(content string) string {
	tags := parseTextTags(content)
	var sb strings.Builder
	for _, tag := range tags {
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(tag.Text)
	}
	return sb.String()
}

// MemoryTag 记忆标签
type MemoryTag struct {
	Type    string // 记忆类型：conversation/preference/fact
	Weight  int    // 权重：0-100
	Summary string // 记忆内容摘要
}

// parseMemoryTags 从文本中解析所有记忆标签
// 格式: [memory_type:类型-weight:权重-memory_text:摘要]
// 示例: [memory_type:conversation-weight:75-memory_text:用户喜欢聊天气]
//
//	[memory_type:preference-weight:80-memory_text:喜欢被夸奖]
//	[memory_type:fact-weight:60-memory_text:今天下雨了]
//
// 正则捕获组说明：
//
//	m[0]: 完整匹配字符串
//	m[1]: 记忆类型 (conversation/preference/fact)
//	m[2]: 权重数字 (0-100)
//	m[3]: 记忆内容摘要
//
// 如果权重解析失败，默认使用50（一般重要性）
func parseMemoryTags(content string) []MemoryTag {
	var tags []MemoryTag
	regex := regexp.MustCompile(`\[memory_type:(\w+)-weight:(\d+)-memory_text:([^\]]+)\]`)
	matches := regex.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		weight := 50 // 默认权重
		fmt.Sscanf(m[2], "%d", &weight)
		tags = append(tags, MemoryTag{Type: m[1], Weight: weight, Summary: m[3]})
	}
	return tags
}
