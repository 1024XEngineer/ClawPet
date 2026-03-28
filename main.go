package main

import (
	"fmt"
	"os"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"go-claw/config"
	"go-claw/handlers"
	"go-claw/services"
	"go-claw/storage"
	"go-claw/utils"
)

func main() {
	if err := utils.InitLogger(); err != nil {
		fmt.Printf("Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}

	logger := utils.GetLogger()
	defer logger.Sync()

	logger.Info("Starting ClawPet API Server")

	cfg := config.NewDefaultConfig()

	if apiKey := os.Getenv("DEEPSEEK_API_KEY"); apiKey != "" {
		cfg.DeepSeek.APIKey = apiKey
		logger.Info("Using DeepSeek API key from environment variable")
	} else {
		logger.Warn("DEEPSEEK_API_KEY environment variable not set, using empty key")
	}

	if port := os.Getenv("PORT"); port != "" {
		cfg.Server.Port = port
	}

	store := storage.NewMemoryStore()
	stateManager := services.NewStateManager()
	deepSeekService := services.NewDeepSeekService(cfg)

	actionHandler := handlers.NewActionHandler(store)
	chatHandler := handlers.NewChatHandler(cfg, store, stateManager, deepSeekService)

	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "ok",
			"service": "clawpet-api",
		})
	})

	api := router.Group("/api")
	{
		api.POST("/actions/register", actionHandler.RegisterAction)
		api.GET("/actions", actionHandler.GetActions)

		api.POST("/chat", chatHandler.Chat)
		api.GET("/chat/context", chatHandler.GetContext)
		api.DELETE("/chat/context", chatHandler.ClearContext)
	}

	address := fmt.Sprintf(":%s", cfg.Server.Port)
	logger.Info("Server starting", zap.String("address", address))

	if err := router.Run(address); err != nil {
		logger.Error("Failed to start server", zap.Error(err))
		os.Exit(1)
	}
}
