package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gin-gonic/gin"

	"shrimp-demo/api"
	"shrimp-demo/service"
)

func main() {
	// 检查是否启用 LLM
	useLLM := os.Getenv("USE_LLM") == "true"
	apiKey := os.Getenv("DEEPSEEK_API_KEY")

	var shrimpService *service.ShrimpService

	if useLLM && apiKey != "" {
		fmt.Println("启用 DeepSeek LLM 集成...")
		shrimpService = service.NewShrimpServiceWithLLM(apiKey)
	} else {
		if useLLM {
			fmt.Println("警告: USE_LLM=true 但未设置 DEEPSEEK_API_KEY，使用基础模式")
		}
		shrimpService = service.NewShrimpService()
	}

	// 初始化 API 处理器
	handler := api.NewHandler(shrimpService)

	// 创建 Gin 引擎
	router := gin.Default()

	// 注册路由
	handler.RegisterRoutes(router)

	// 启动服务器
	port := ":8080"
	fmt.Printf("小龙虾桌宠服务启动中...\n")
	fmt.Printf("服务地址: http://localhost%s\n", port)
	fmt.Printf("LLM 模式: %v\n", useLLM && apiKey != "")
	fmt.Printf("API 文档:\n")
	fmt.Printf("  GET  /health                - 健康检查\n")
	fmt.Printf("  GET  /api/v1/status         - 获取当前状态\n")
	fmt.Printf("  GET  /api/v1/actions        - 获取所有动作\n")
	fmt.Printf("  POST /api/v1/message        - 处理用户消息（基础）\n")
	fmt.Printf("  POST /api/v1/message/llm    - 处理用户消息（LLM增强）\n")
	fmt.Printf("  POST /api/v1/search         - 触发搜索任务（基础）\n")
	fmt.Printf("  POST /api/v1/search/llm     - 触发搜索任务（LLM增强）\n")
	fmt.Printf("  POST /api/v1/think          - 触发思考任务（基础）\n")
	fmt.Printf("  POST /api/v1/think/llm      - 触发思考任务（LLM增强）\n")
	fmt.Printf("  POST /api/v1/reset          - 重置状态\n")
	fmt.Printf("\n环境变量:\n")
	fmt.Printf("  USE_LLM=true              - 启用 LLM 集成\n")
	fmt.Printf("  DEEPSEEK_API_KEY=<key>    - DeepSeek API 密钥\n")
	fmt.Printf("\n示例命令:\n")
	fmt.Printf("  # 基础模式\n")
	fmt.Printf("  curl -X GET http://localhost:8080/api/v1/status\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v1/message -H 'Content-Type: application/json' -d '{\"message\":\"帮我查一下明天面试这家公司的信息\"}'\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v1/search -H 'Content-Type: application/json' -d '{\"company\":\"腾讯\"}'\n")
	fmt.Printf("\n  # LLM 增强模式\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v1/message/llm -H 'Content-Type: application/json' -d '{\"message\":\"帮我查一下明天面试这家公司的信息\"}'\n")
	fmt.Printf("  curl -X POST http://localhost:8080/api/v1/search/llm -H 'Content-Type: application/json' -d '{\"company\":\"腾讯\"}'\n")

	if err := router.Run(port); err != nil {
		log.Fatalf("启动服务器失败: %v", err)
	}
}
