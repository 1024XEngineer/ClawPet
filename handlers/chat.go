package handlers

import (
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"go-claw/config"
	"go-claw/models"
	"go-claw/services"
	"go-claw/storage"
	"go-claw/utils"
)

type ChatHandler struct {
	cfg          *config.Config
	store        *storage.MemoryStore
	stateManager *services.StateManager
	deepSeek     *services.DeepSeekService
	context      *models.ChatContext
	contextMutex sync.RWMutex
	logger       *zap.Logger
}

func NewChatHandler(
	cfg *config.Config,
	store *storage.MemoryStore,
	stateManager *services.StateManager,
	deepSeek *services.DeepSeekService,
) *ChatHandler {
	return &ChatHandler{
		cfg:          cfg,
		store:        store,
		stateManager: stateManager,
		deepSeek:     deepSeek,
		context:      models.NewChatContext(),
		logger:       utils.GetLogger(),
	}
}

func (h *ChatHandler) Chat(c *gin.Context) {
	var req models.ChatRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Error("Invalid request body", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	h.contextMutex.Lock()
	h.context.AddMessage("user", req.Message)
	contextMessages := h.context.GetLastN(h.cfg.State.MaxContextSize)
	h.contextMutex.Unlock()

	// 先使用本地规则更新状态（作为基础）
	h.stateManager.UpdateState(req.Message)
	currentState := h.stateManager.GetState()

	actions := h.store.GetAllActions()

	response, selectedAction, stateChange, err := h.deepSeek.GenerateResponse(
		req.Message,
		currentState,
		actions,
		contextMessages,
	)

	if err != nil {
		h.logger.Error("Failed to generate response", zap.Error(err))

		fallbackResponse := h.generateFallbackResponse(req.Message, currentState)
		c.JSON(http.StatusOK, models.ChatResponse{
			Response:       fallbackResponse,
			SelectedAction: "",
			State:          currentState,
		})
		return
	}

	// 应用大模型建议的状态变化
	if stateChange != nil {
		h.stateManager.ApplyStateChange(stateChange)
		currentState = h.stateManager.GetState()

		h.logger.Info("Applied state change from LLM",
			zap.Int("intimacy_delta", stateChange.IntimacyDelta),
			zap.Int("frustration_delta", stateChange.FrustrationDelta),
			zap.Int("happiness_delta", stateChange.HappinessDelta))
	}

	h.contextMutex.Lock()
	h.context.AddMessage("assistant", response)
	h.contextMutex.Unlock()

	h.logger.Info("Chat response generated",
		zap.String("user_message", req.Message),
		zap.String("selected_action", selectedAction))

	c.JSON(http.StatusOK, models.ChatResponse{
		Response:       response,
		SelectedAction: selectedAction,
		State:          currentState,
	})
}

func (h *ChatHandler) generateFallbackResponse(message string, state *models.PetState) string {
	if state.Happiness > 70 {
		return "我听到你说：" + message + "。我现在心情很好，有什么可以帮你的吗？"
	} else if state.Frustration > 50 {
		return message + "... 听起来你有点沮丧，我在这里陪着你。"
	} else {
		return "我明白你说：" + message + "。我会一直在这里陪伴你。"
	}
}

func (h *ChatHandler) GetContext(c *gin.Context) {
	h.contextMutex.RLock()
	defer h.contextMutex.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"messages": h.context.Messages,
		"count":    len(h.context.Messages),
	})
}

func (h *ChatHandler) ClearContext(c *gin.Context) {
	h.contextMutex.Lock()
	h.context.Clear()
	h.contextMutex.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"message": "Context cleared successfully",
	})
}
