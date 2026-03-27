package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/sashabaranov/go-openai"
)

// LLMService DeepSeek LLM 服务
type LLMService struct {
	client *openai.Client
	apiKey string
	model  string
}

// NewLLMService 创建 LLM 服务
func NewLLMService(apiKey string) *LLMService {
	// DeepSeek API 配置
	config := openai.DefaultConfig(apiKey)
	config.BaseURL = "https://api.deepseek.com/v1" // DeepSeek API 地址

	return &LLMService{
		client: openai.NewClientWithConfig(config),
		apiKey: apiKey,
		model:  "deepseek-chat", // DeepSeek 模型
	}
}

// Chat 与 LLM 对话
func (l *LLMService) Chat(ctx context.Context, userMessage string) (string, error) {
	// 构建系统提示词，让 LLM 理解桌宠角色
	systemPrompt := `你是一个可爱的小龙虾桌宠助手，帮助用户准备面试资料。
你的性格特点：
1. 活泼可爱，偶尔会兴奋
2. 做事认真专注
3. 发现有用信息时会很兴奋
4. 整理资料时很认真
5. 交付成果时很郑重

你可以执行以下动作：
1. search - 搜索信息：当用户需要查找公司信息时
2. focus - 专注阅读：当你在仔细研究信息时
3. excited - 兴奋发现：当你发现重要有用信息时
4. organize - 整理资料：当你整理分类信息时
5. deliver - 郑重交付：当你完成整理交付成果时
6. think - 思考问题：当你在思考如何回答问题时
7. standby - 安静待命：当你等待用户指令时

请根据对话内容，在回答时选择合适的动作表情。
格式：先输出动作标签，然后是回答内容。
例如：action:search 我正在帮你搜索这家公司的信息...

可用动作标签：action:search, action:focus, action:excited, action:organize, action:deliver, action:think, action:standby`

	resp, err := l.client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model: l.model,
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleSystem,
				Content: systemPrompt,
			},
			{
				Role:    openai.ChatMessageRoleUser,
				Content: userMessage,
			},
		},
		Temperature: 0.7,
		MaxTokens:   500,
	})

	if err != nil {
		return "", fmt.Errorf("LLM 调用失败: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("LLM 返回空响应")
	}

	return resp.Choices[0].Message.Content, nil
}

// AnalyzeMessage 分析用户消息，返回建议的动作和回答
func (l *LLMService) AnalyzeMessage(ctx context.Context, userMessage string) (string, string, error) {
	response, err := l.Chat(ctx, userMessage)
	if err != nil {
		return "", "", err
	}

	// 解析响应，提取动作标签
	action := "standby" // 默认动作
	content := response

	// 查找动作标签
	if strings.HasPrefix(response, "action:") {
		parts := strings.SplitN(response, " ", 2)
		if len(parts) > 0 {
			action = strings.TrimPrefix(parts[0], "action:")
			if len(parts) > 1 {
				content = parts[1]
			} else {
				content = ""
			}
		}
	}

	return action, content, nil
}

// SearchWithLLM 使用 LLM 进行智能搜索
func (l *LLMService) SearchWithLLM(ctx context.Context, company string) (string, error) {
	prompt := fmt.Sprintf(`请帮我搜索关于"%s"公司的信息，包括：
1. 公司基本背景
2. 近期业务动态
3. 可能的面试问题
4. 面试准备建议

请以小龙虾桌宠的口吻回答，并选择合适的动作标签。`, company)

	return l.Chat(ctx, prompt)
}

// ThinkWithLLM 使用 LLM 进行思考回答
func (l *LLMService) ThinkWithLLM(ctx context.Context, question string) (string, error) {
	prompt := fmt.Sprintf(`用户正在准备面试，遇到了这个问题："%s"
请帮用户思考如何回答这个问题，给出具体的回答思路和建议。

请以小龙虾桌宠的口吻回答，并选择合适的动作标签。`, question)

	return l.Chat(ctx, prompt)
}

// ChatWithSystemPrompt 使用自定义系统提示词与 LLM 对话
func (l *LLMService) ChatWithSystemPrompt(ctx context.Context, systemPrompt, userMessage string) (string, error) {
	req := openai.ChatCompletionRequest{
		Model: l.model,
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleSystem,
				Content: systemPrompt,
			},
			{
				Role:    openai.ChatMessageRoleUser,
				Content: userMessage,
			},
		},
		MaxTokens:   1000,
		Temperature: 0.7,
	}

	resp, err := l.client.CreateChatCompletion(ctx, req)
	if err != nil {
		return "", fmt.Errorf("LLM 调用失败: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("LLM 返回空响应")
	}
	return resp.Choices[0].Message.Content, nil
}
