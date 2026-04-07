package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"go-claw/models"
	"go-claw/storage"
	"go-claw/utils"
)

type ActionHandler struct {
	store  *storage.MemoryStore
	logger *zap.Logger
}

func NewActionHandler(store *storage.MemoryStore) *ActionHandler {
	return &ActionHandler{
		store:  store,
		logger: utils.GetLogger(),
	}
}

func (h *ActionHandler) RegisterAction(c *gin.Context) {
	var req models.ActionRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Error("Invalid request body", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	action := models.Action{
		Name:        req.Name,
		Description: req.Description,
	}

	id := h.store.SaveAction(action)

	h.logger.Info("Action registered",
		zap.String("id", id),
		zap.String("name", action.Name))

	c.JSON(http.StatusOK, gin.H{
		"id":          id,
		"name":        action.Name,
		"description": action.Description,
	})
}

func (h *ActionHandler) GetActions(c *gin.Context) {
	actions := h.store.GetAllActions()

	c.JSON(http.StatusOK, gin.H{
		"actions": actions,
		"count":   len(actions),
	})
}
