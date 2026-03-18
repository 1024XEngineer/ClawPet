package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"GoClaw/pkg/agent"

	"github.com/joho/godotenv"
)

func main() {
	// 加载 .env 文件
	if err := godotenv.Load(); err != nil {
		log.Println("Note: No .env file found or error loading it:", err)
	}

	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	if apiKey == "" {
		log.Println("Error: DEEPSEEK_API_KEY environment variable is still not set after loading .env")
		// 只是示例，你可以手动设置或从配置文件读取
		apiKey = "YOUR_DEEPSEEK_API_KEY"
	} else {
		log.Printf("Successfully loaded API Key: %s...%s\n", apiKey[:5], apiKey[len(apiKey)-5:])
	}

	// DeepSeek API 通常与 OpenAI API 兼容，基础 URL 需要根据官方文档设置
	baseURL := "https://api.deepseek.com"

	// 初始化管理器
	manager := agent.NewAgentManager(apiKey, baseURL)

	// 注册工具
	manager.RegisterTool(&agent.WeatherTool{})
	manager.RegisterTool(&agent.CalculatorTool{})
	manager.RegisterTool(&agent.ReadFileTool{})
	manager.RegisterTool(&agent.WriteFileTool{})
	manager.RegisterTool(&agent.BashExecTool{})

	// 启动 Agent 执行循环
	ctx := context.Background()
	userQuery := "请先列出当前目录的文件，然后计算 1024 的 10 次方等于多少（请使用 go run 一个临时文件来计算），最后把结果告诉我。"
	model := "deepseek-chat" // 替换为 DeepSeek 的具体模型名称

	fmt.Printf("User: %s\n", userQuery)
	fmt.Println("--- Agent Execution Loop Start ---")

	response, err := manager.Run(ctx, model, userQuery)
	if err != nil {
		log.Fatalf("Agent error: %v", err)
	}

	fmt.Println("--- Agent Execution Loop End ---")
	fmt.Printf("DeepSeek Final Response: %s\n", response)
}
