package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"shrimp-demo/service"
)

// Handler API 处理器
type Handler struct {
	shrimpService *service.ShrimpService
}

// NewHandler 创建 API 处理器
func NewHandler(shrimpService *service.ShrimpService) *Handler {
	return &Handler{
		shrimpService: shrimpService,
	}
}

// RegisterRoutes 注册路由
func (h *Handler) RegisterRoutes(router *gin.Engine) {
	// 健康检查
	router.GET("/health", h.healthCheck)

	// 桌宠 API
	v1 := router.Group("/api/v1")
	{
		v1.GET("/status", h.getStatus)
		v1.GET("/actions", h.getAllActions)
		v1.POST("/message", h.processMessage)
		v1.POST("/message/llm", h.processMessageWithLLM) // LLM 增强版
		v1.POST("/search", h.triggerSearch)
		v1.POST("/search/llm", h.triggerSearchWithLLM) // LLM 增强版
		v1.POST("/think", h.triggerThink)
		v1.POST("/think/llm", h.triggerThinkWithLLM) // LLM 增强版
		v1.POST("/reset", h.resetState)
	}
}

// healthCheck 健康检查
func (h *Handler) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "healthy",
		"service": "shrimp-demo",
		"version": "1.0.0",
	})
}

// getStatus 获取当前状态
func (h *Handler) getStatus(c *gin.Context) {
	status := h.shrimpService.GetCurrentStatus()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    status,
	})
}

// getAllActions 获取所有可用动作
func (h *Handler) getAllActions(c *gin.Context) {
	actions := h.shrimpService.GetAllActions()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"actions": actions,
			"count":   len(actions),
		},
	})
}

// processMessage 处理用户消息
func (h *Handler) processMessage(c *gin.Context) {
	var request struct {
		Message string `json:"message" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求格式",
		})
		return
	}

	response := h.shrimpService.ProcessUserMessage(request.Message)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// triggerSearch 触发搜索任务
func (h *Handler) triggerSearch(c *gin.Context) {
	var request struct {
		Company string `json:"company" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "需要提供公司名称",
		})
		return
	}

	// 模拟搜索过程
	response := h.shrimpService.ProcessUserMessage("搜索 " + request.Company)

	// 添加搜索特定信息
	response["search_info"] = gin.H{
		"company": request.Company,
		"status":  "searching",
		"steps": []string{
			"搜索公司官网",
			"查找近期新闻",
			"分析业务动态",
			"整理招聘信息",
		},
		"estimated_time": "45秒",
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// triggerThink 触发思考任务
func (h *Handler) triggerThink(c *gin.Context) {
	var request struct {
		Question string `json:"question" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "需要提供问题",
		})
		return
	}

	response := h.shrimpService.ProcessUserMessage("思考 " + request.Question)

	// 添加思考特定信息
	response["think_info"] = gin.H{
		"question": request.Question,
		"status":   "thinking",
		"suggestions": []string{
			"从你的项目经验说起",
			"连接到公司业务需求",
			"展示你的技术能力",
			"表达你的学习意愿",
		},
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// resetState 重置状态
func (h *Handler) resetState(c *gin.Context) {
	// 重新创建服务以重置状态
	h.shrimpService = service.NewShrimpService()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "状态已重置",
		"data":    h.shrimpService.GetCurrentStatus(),
	})
}

// processMessageWithLLM 使用 LLM 处理用户消息
func (h *Handler) processMessageWithLLM(c *gin.Context) {
	var request struct {
		Message string `json:"message" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求格式",
		})
		return
	}

	response := h.shrimpService.ProcessUserMessageWithLLM(c.Request.Context(), request.Message)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// triggerSearchWithLLM 使用 LLM 触发搜索任务
func (h *Handler) triggerSearchWithLLM(c *gin.Context) {
	var request struct {
		Company string `json:"company" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "需要提供公司名称",
		})
		return
	}

	// 使用 LLM 进行智能搜索
	response := h.shrimpService.SearchWithLLM(c.Request.Context(), request.Company)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// triggerThinkWithLLM 使用 LLM 触发思考任务
func (h *Handler) triggerThinkWithLLM(c *gin.Context) {
	var request struct {
		Question string `json:"question" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "需要提供问题",
		})
		return
	}

	// 使用 LLM 进行思考
	response := h.shrimpService.ThinkWithLLM(c.Request.Context(), request.Question)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}
