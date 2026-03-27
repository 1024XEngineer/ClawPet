package main

import (
	"fmt"
	"log"
	"os"
	"shrimp-demo/pkg/logger"

	"github.com/gin-gonic/gin"

	"shrimp-demo/api"
	"shrimp-demo/service"
)

func main() {

	logger.Init()
	defer logger.Sync()

	logger.Log.Info("服务启动中...")

	// 检查是否启用 LLM
	useLLM := os.Getenv("USE_LLM") == "true"
	apiKey := os.Getenv("DEEPSEEK_API_KEY")

	var coordinator *service.Coordinator
	var llmService *service.LLMService

	// 初始化 LLM 服务（如果启用）
	if useLLM && apiKey != "" {
		logger.Log.Info("启用 DeepSeek LLM 集成...")
		llmService = service.NewLLMService(apiKey)
		coordinator = service.NewCoordinator(llmService)
	} else {
		if useLLM {
			logger.Log.Warn("警告: USE_LLM=true 但未设置 DEEPSEEK_API_KEY，使用基础模式")
		}
		// 即使没有 LLM，也创建协调器（使用简单模式）
		coordinator = service.NewCoordinator(nil)
	}

	// 初始化 API 处理器（新版）
	logger.Log.Info("初始化 API 处理器（新版）...")
	handlerV2 := api.NewHandlerV2(coordinator)

	// 创建 Gin 引擎
	logger.Log.Info("创建 Gin 引擎...")
	router := gin.Default()

	// 注册路由（新版）
	logger.Log.Info("注册路由")
	handlerV2.RegisterRoutes(router)

	// 启动服务器
	port := ":8080"
	fmt.Printf("小龙虾桌宠服务启动中...\n")
	fmt.Printf("服务地址: http://localhost%s\n", port)
	fmt.Printf("LLM 模式: %v\n", useLLM && apiKey != "")
	fmt.Printf("架构版本: v2 (解耦状态-动作架构)\n")
	fmt.Printf("\nAPI 文档:\n")
	fmt.Printf("  GET  /health                - 健康检查\n")
	fmt.Printf("\n  === v2 API (新版解耦架构) ===\n")
	fmt.Printf("  GET  /api/v2/status         - 获取数值化状态\n")
	fmt.Printf("  GET  /api/v2/actions        - 获取所有动作信息\n")
	fmt.Printf("  POST /api/v2/message        - 处理用户消息（通过 use_llm 参数选择模式）\n")
	fmt.Printf("  POST /api/v2/action         - 强制执行指定动作\n")
	fmt.Printf("  POST /api/v2/reset          - 重置状态\n")
	fmt.Printf("\n环境变量:\n")
	fmt.Printf("  USE_LLM=true              - 启用 LLM 集成\n")
	fmt.Printf("  DEEPSEEK_API_KEY=<key>    - DeepSeek API 密钥\n")
	fmt.Printf("\n示例命令:\n")
	fmt.Printf("  # 基础操作\n")
	fmt.Printf("  curl -X GET http://localhost:8080/api/v2/status\n")
	fmt.Printf("  curl -X GET http://localhost:8080/api/v2/actions\n")
	fmt.Printf("\n  # 简单消息处理（无 LLM）\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v2/message \\\n")
	fmt.Printf("    -H 'Content-Type: application/json' \\\n")
	fmt.Printf("    -d '{\"message\":\"你好\"}'\n")
	fmt.Printf("\n  # LLM 消息处理\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v2/message \\\n")
	fmt.Printf("    -H 'Content-Type: application/json' \\\n")
	fmt.Printf("    -d '{\"message\":\"帮我查一下腾讯公司的信息\", \"use_llm\":true}'\n")
	fmt.Printf("\n  # 强制执行动作\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v2/action \\\n")
	fmt.Printf("    -H 'Content-Type: application/json' \\\n")
	fmt.Printf("    -d '{\"action\":\"search\", \"params\":{\"query\":\"阿里巴巴\"}}'\n")
	fmt.Printf("\n  # 重置状态\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v2/reset\n")

	if err := router.Run(port); err != nil {
		log.Fatalf("启动服务器失败: %v", err)
	}
}
