package agent

import (
	"context"
	"fmt"
	"log"

	"github.com/sashabaranov/go-openai"
)

// AgentManager 管理工具并处理与 DeepSeek API 的交互
type AgentManager struct {
	client *openai.Client
	tools  map[string]Tool
}

// NewAgentManager 创建一个新的 AgentManager 实例
func NewAgentManager(apiKey, baseURL string) *AgentManager {
	config := openai.DefaultConfig(apiKey)
	if baseURL != "" {
		config.BaseURL = baseURL
	}
	client := openai.NewClientWithConfig(config)

	return &AgentManager{
		client: client,
		tools:  make(map[string]Tool),
	}
}

// RegisterTool 注册一个工具
func (m *AgentManager) RegisterTool(tool Tool) {
	m.tools[tool.Name()] = tool
}

// convertToOpenAITools 将本地注册的工具转换为 OpenAI 的工具定义
func (m *AgentManager) convertToOpenAITools() []openai.Tool {
	var openAITools []openai.Tool
	for _, tool := range m.tools {
		openAITools = append(openAITools, openai.Tool{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        tool.Name(),
				Description: tool.Description(),
				Parameters:  tool.Parameters(),
			},
		})
	}
	return openAITools
}

// Run 执行主循环处理用户请求
func (m *AgentManager) Run(ctx context.Context, model string, userMessage string) (string, error) {
	messages := []openai.ChatCompletionMessage{
		{
			Role:    openai.ChatMessageRoleUser,
			Content: userMessage,
		},
	}

	for {
		// 1. 发送请求给 DeepSeek API
		resp, err := m.client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
			Model:    model,
			Messages: messages,
			Tools:    m.convertToOpenAITools(),
		})
		if err != nil {
			return "", fmt.Errorf("ChatCompletion error: %v", err)
		}

		assistantMsg := resp.Choices[0].Message
		messages = append(messages, assistantMsg)

		// 2. 检查是否有工具调用
		if len(assistantMsg.ToolCalls) == 0 {
			// 没有工具调用，循环结束，返回模型的最终自然语言回复
			return assistantMsg.Content, nil
		}

		// 3. 处理模型返回的工具调用
		for _, toolCall := range assistantMsg.ToolCalls {
			toolName := toolCall.Function.Name
			toolArgs := toolCall.Function.Arguments

			log.Printf("Calling tool: %s with args: %s\n", toolName, toolArgs)

			tool, ok := m.tools[toolName]
			var result string
			if !ok {
				result = fmt.Sprintf("Error: Tool %s not found", toolName)
			} else {
				// 执行本地 Go 函数
				result = tool.Execute(toolArgs)
			}

			// 4. 将函数结果发回给模型
			messages = append(messages, openai.ChatCompletionMessage{
				Role:       openai.ChatMessageRoleTool,
				Content:    result,
				ToolCallID: toolCall.ID,
			})
		}
		// 继续循环，直到模型给出自然语言回复
	}
}
