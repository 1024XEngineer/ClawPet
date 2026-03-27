package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"shrimp-demo/service"
)

// HandlerV2 新版API处理器
type HandlerV2 struct {
	coordinator *service.Coordinator
}

// NewHandlerV2 创建新版API处理器
func NewHandlerV2(coordinator *service.Coordinator) *HandlerV2 {
	return &HandlerV2{
		coordinator: coordinator,
	}
}

// RegisterRoutes 注册路由
func (h *HandlerV2) RegisterRoutes(router *gin.Engine) {
	// 健康检查
	router.GET("/health", h.healthCheck)

	// 桌宠 API v2
	v2 := router.Group("/api/v2")
	{
		v2.GET("/status", h.getStatus)
		v2.GET("/actions", h.getActions)
		v2.POST("/message", h.processMessage)
		v2.POST("/action", h.forceAction)
		v2.POST("/reset", h.reset)
	}
}

// healthCheck 健康检查
func (h *HandlerV2) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "healthy",
		"service": "shrimp-demo-v2",
		"version": "2.0.0",
	})
}

// getStatus 获取当前状态
func (h *HandlerV2) getStatus(c *gin.Context) {
	status := h.coordinator.GetCurrentStatus()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    status,
	})
}

// getActions 获取可用动作
func (h *HandlerV2) getActions(c *gin.Context) {
	actions := h.coordinator.GetAvailableActions()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"actions": actions,
			"count":   len(actions),
		},
	})
}

// processMessage 处理用户消息
func (h *HandlerV2) processMessage(c *gin.Context) {
	var request struct {
		Message string `json:"message" binding:"required"`
		UseLLM  bool   `json:"use_llm"` // 是否使用LLM
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求格式",
		})
		return
	}

	var response map[string]interface{}
	var err error

	if request.UseLLM {
		// 使用LLM处理
		response, err = h.coordinator.ProcessMessage(c.Request.Context(), request.Message)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   err.Error(),
			})
			return
		}
	} else {
		// 使用简单处理
		response = h.coordinator.SimpleProcess(request.Message)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// forceAction 强制执行动作
func (h *HandlerV2) forceAction(c *gin.Context) {
	var request struct {
		Action string                 `json:"action" binding:"required"`
		Params map[string]interface{} `json:"params"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求格式",
		})
		return
	}

	if err := h.coordinator.ForceAction(request.Action, request.Params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 返回执行后的状态
	status := h.coordinator.GetCurrentStatus()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "动作执行成功",
		"data":    status,
	})
}

// reset 重置状态
func (h *HandlerV2) reset(c *gin.Context) {
	h.coordinator.Reset()

	status := h.coordinator.GetCurrentStatus()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "状态已重置",
		"data":    status,
	})
}
