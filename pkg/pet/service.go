package pet

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/cron"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/action"
	"github.com/sipeed/picoclaw/pkg/pet/characters"
	"github.com/sipeed/picoclaw/pkg/pet/compression"
	petconfig "github.com/sipeed/picoclaw/pkg/pet/config"
	"github.com/sipeed/picoclaw/pkg/pet/memory"
	"github.com/sipeed/picoclaw/pkg/pet/modelconfig"
	"github.com/sipeed/picoclaw/pkg/pet/userprofile"
	"github.com/sipeed/picoclaw/pkg/pet/voice"
	"github.com/sipeed/picoclaw/pkg/providers"
)

type PushHandler func(push any)

type PetService struct {
	msgBus      *bus.MessageBus
	config      PetServiceConfig
	pushHandler PushHandler
	provider    providers.LLMProvider

	configManager      *petconfig.Manager
	charManager        *characters.Manager
	actionManager      *action.ActionManager
	memoryStore        *memory.Store
	voiceLoader        *voice.Loader
	conversationStore  *compression.ConversationStore
	compressionSvc     *compression.CompressionService
	modelConfigManager *modelconfig.Manager
	cronService        *cron.CronService
	userProfileManager *userprofile.Manager

	connSessions map[string]string

	mu sync.RWMutex

	ctx         context.Context
	cancel      context.CancelFunc
	decayTicker *time.Ticker
}

type PetServiceConfig struct {
	WorkspacePath string
	Config        *config.Config
	ConfigPath    string
}

func NewPetService(msgBus *bus.MessageBus, cfg PetServiceConfig) (*PetService, error) {
	ctx, cancel := context.WithCancel(context.Background())
	s := &PetService{
		msgBus:        msgBus,
		config:        cfg,
		actionManager: action.NewActionManager(cfg.WorkspacePath),
		connSessions:  make(map[string]string),
		ctx:           ctx,
		cancel:        cancel,
	}
	workspacePath := cfg.WorkspacePath
	if workspacePath != "" {
		logger.Debugf("pet: workspacePath=%s", workspacePath)
		s.configManager = petconfig.NewManager(workspacePath)
		if s.configManager == nil {
			return nil, fmt.Errorf("failed to create config manager")
		}

		var err error
		s.charManager, err = characters.NewManager(s.configManager.GetCharacters(), s.configManager)
		if err != nil {
			fmt.Printf("pet: failed to create character manager: %v\n", err)
			return nil, err
		}

		s.voiceLoader = voice.NewLoader(s.configManager.GetVoice())
		if err := s.voiceLoader.Load(); err != nil {
			fmt.Printf("pet: failed to load voice: %v\n", err)
		}
		if s.voiceLoader.GetProvider() != nil {
			fmt.Println("pet: voice provider loaded successfully")
		} else {
			fmt.Println("pet: voice provider is nil after loading")
		}

		s.memoryStore, err = memory.NewStore(cfg.WorkspacePath)
		if err != nil {
			fmt.Printf("pet: failed to create memory store: %v\n", err)
		}

		if err := s.actionManager.Load(); err != nil {
			fmt.Printf("pet: failed to load actions: %v\n", err)
		}

		defaultModelName := ""
		if cfg.Config != nil {
			defaultModelName = cfg.Config.Agents.Defaults.GetModelName()
		}

		if s.memoryStore != nil {
			// 获取压缩配置
			compressionConfig := s.configManager.GetCompression()
			threshold := compression.DefaultThreshold
			if compressionConfig != nil && compressionConfig.Threshold > 0 {
				threshold = compressionConfig.Threshold
			}

			// 对话存储的回调函数：当对话数达到阈值时触发压缩（异步）
			callback := func(characterID string, entries []*compression.ConversationEntry) {
				if s.compressionSvc != nil {
					go func() {
						if err := s.compressionSvc.Compress(characterID, entries); err != nil {
							logger.Warnf("compression: failed to compress: %v", err)
						}
					}()
				}
			}

			// 创建对话存储（使用 SQLite 持久化）
			s.conversationStore, err = compression.NewConversationStore(cfg.WorkspacePath, threshold, callback)
			if err != nil {
				logger.Warnf("pet: failed to create conversation store: %v", err)
			}

			// 统一使用 Agents.Defaults 的模型
			var provider providers.LLMProvider
			var modelCfg *config.ModelConfig
			if cfg.Config != nil {
				rawModel := defaultModelName
				for _, m := range cfg.Config.ModelList {
					if m.Model == rawModel {
						modelCfg = m
						break
					}
				}
				if modelCfg != nil {
					provider, _, err = providers.CreateProviderFromConfig(modelCfg)
					if err != nil {
						logger.Warnf("pet: failed to create provider for agents default model: %v", err)
					}
				}
			}

			// 创建压缩服务并设置 Provider（仅当压缩功能启用时）
			if compressionConfig != nil && compressionConfig.Enabled && provider != nil {
				s.provider = provider
				s.compressionSvc = compression.NewCompressionService(compressionConfig, s.memoryStore, s.conversationStore)
				s.compressionSvc.SetProvider(provider, modelCfg)
			}

			// 创建用户画像管理器
			s.userProfileManager = userprofile.NewManager(
				workspacePath,
				s.memoryStore,
				s.charManager,
				provider,
				defaultModelName,
			)
		}
		if s.userProfileManager == nil {
			s.userProfileManager = userprofile.NewManager(
				workspacePath,
				s.memoryStore,
				s.charManager,
				nil,
				defaultModelName,
			)
		}
		if cfg.ConfigPath != "" {
			s.modelConfigManager = modelconfig.NewManager(cfg.ConfigPath)
		}
		// 初始化 cron 服务
		cronStorePath := filepath.Join(workspacePath, "cron", "jobs.json")
		s.cronService = cron.NewCronService(cronStorePath, nil)
		logger.DebugCF("pet", "PetService: cron service initialized, store=", map[string]any{
			"store_path": cronStorePath,
		})
	}

	return s, nil
}

func (s *PetService) Start() {
	s.decayTicker = time.NewTicker(5 * time.Second)
	go s.runEmotionDecay()
	if s.compressionSvc != nil {
		s.compressionSvc.Start()
	}
	logger.DebugCF("pet", "PetService: PetService started, emotion decay ticker running", nil)
}

func (s *PetService) runEmotionDecay() {
	for {
		select {
		case <-s.ctx.Done():
			logger.DebugCF("pet", "PetService: emotion decay ticker stopped", nil)
			return
		case <-s.decayTicker.C:
			if char := s.charManager.GetCurrent(); char != nil {
				char.GetEmotionEngine().ApplyDecay(5 * time.Second)
				if shouldPush, push := char.GetEmotionEngine().ShouldPush(); shouldPush {
					s.Push(push)
				}
			}
		}
	}
}

func (s *PetService) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	if s.decayTicker != nil {
		s.decayTicker.Stop()
	}
	if s.compressionSvc != nil {
		s.compressionSvc.Stop()
	}
	if s.memoryStore != nil {
		s.memoryStore.Close()
	}
	s.Shutdown()
	fmt.Println("pet: PetService stopped")
}

func (s *PetService) Shutdown() {
	fmt.Println("pet: Shutdown called")
	if s.charManager != nil {
		if err := s.charManager.SavePrivateConfig(); err != nil {
			fmt.Printf("pet: failed to save private config: %v\n", err)
		}
	}
	if s.configManager != nil {
		fmt.Println("pet: calling configManager.Save()")
		if err := s.configManager.Save(); err != nil {
			fmt.Printf("pet: failed to save config: %v\n", err)
		}
	}
}

func (s *PetService) ConfigManager() *petconfig.Manager {
	return s.configManager
}

func (s *PetService) CharManager() *characters.Manager {
	return s.charManager
}

func (s *PetService) ActionManager() *action.ActionManager {
	return s.actionManager
}

func (s *PetService) MemoryStore() *memory.Store {
	return s.memoryStore
}

func (s *PetService) ConversationStore() *compression.ConversationStore {
	return s.conversationStore
}

func (s *PetService) VoiceLoader() *voice.Loader {
	return s.voiceLoader
}

func (s *PetService) UserProfileManager() *userprofile.Manager {
	return s.userProfileManager
}

func (s *PetService) SetPushHandler(handler PushHandler) {
	s.pushHandler = handler
}

func (s *PetService) Push(push any) {
	if s.pushHandler != nil {
		s.pushHandler(push)
	}
}

func (s *PetService) PushToolStart(tool string, data json.RawMessage) {
	if s.pushHandler == nil {
		return
	}

	streamData := map[string]interface{}{
		"type":  "tool",
		"text":  "正在调用 " + tool,
		"tool":  tool,
		"phase": "start",
	}

	push := map[string]interface{}{
		"type":      "push",
		"push_type": "ai_chat",
		"data":      streamData,
		"timestamp": time.Now().Unix(),
		"is_final":  true,
	}

	s.pushHandler(push)
}

func (s *PetService) PushToolEnd(tool string, data json.RawMessage) {
	if s.pushHandler == nil {
		return
	}

	streamData := map[string]interface{}{
		"type":  "tool",
		"text":  tool + " 执行完成",
		"tool":  tool,
		"phase": "end",
	}

	push := map[string]interface{}{
		"type":      "push",
		"push_type": "ai_chat",
		"data":      streamData,
		"timestamp": time.Now().Unix(),
		"is_final":  true,
	}

	s.pushHandler(push)
}

func (s *PetService) RegisterSession(connID, sessionID string) {
	s.mu.Lock()
	s.connSessions[connID] = sessionID
	s.mu.Unlock()
}

func (s *PetService) UnregisterSession(connID string) {
	s.mu.Lock()
	delete(s.connSessions, connID)
	s.mu.Unlock()
}

func (s *PetService) GetSessionByConnID(connID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connSessions[connID]
}

func (s *PetService) PushInitStatus(sessionID string) {
	char := s.charManager.GetCurrent()

	var character *CharacterConfig
	var mbti MBTIConfig
	var emotionState EmotionState

	if char != nil {
		emotions := char.GetEmotions()
		mbtiCfg := char.EmotionEngine.GetPersonality()
		emoEngine := char.GetEmotionEngine()
		dominantEmotion, emotionScore := emoEngine.GetDominantEmotion()

		character = &CharacterConfig{
			PetID:          char.ID,
			PetName:        char.Name,
			PetPersona:     char.Persona,
			PetPersonaType: char.PersonaType,
			Avatar:         char.Avatar,
		}
		mbti = MBTIConfig{
			IE: mbtiCfg.IE,
			SN: mbtiCfg.SN,
			TF: mbtiCfg.TF,
			JP: mbtiCfg.JP,
		}
		emotionState = EmotionState{
			PetID:       char.ID,
			Emotion:     dominantEmotion,
			Joy:         emotions.Joy,
			Anger:       emotions.Anger,
			Sadness:     emotions.Sadness,
			Disgust:     emotions.Disgust,
			Surprise:    emotions.Surprise,
			Fear:        emotions.Fear,
			Description: GetEmotionDescription(dominantEmotion, emotionScore),
		}
	} else {
		mbti = DefaultMBTI()
		emotionState = EmotionState{
			PetID:       "pet_001",
			Emotion:     "neutral",
			Joy:         50,
			Anger:       50,
			Sadness:     50,
			Disgust:     50,
			Surprise:    50,
			Fear:        50,
			Description: "平静",
		}
	}

	s.sendPush(sessionID, PushTypeInitStatus, InitStatusPush{
		NeedConfig:   char == nil,
		HasCharacter: char != nil,
		Character:    character,
		MBTI:         mbti,
		EmotionState: emotionState,
	})
}

func (s *PetService) HandleRequest(connID string, req Request) error {
	sessionID := s.GetSessionByConnID(connID)

	switch req.Action {
	case ActionChat:
		return s.handleChat(sessionID, req)
	case ActionOnboardingConfig:
		return s.handleOnboardingConfig(sessionID, req)
	case ActionUserProfileUpdate:
		return s.handleUserProfileUpdate(sessionID, req)
	case ActionCharacterGet:
		return s.handleCharacterGet(sessionID, req)
	case ActionCharacterUpdate:
		return s.handleCharacterUpdate(sessionID, req)
	case ActionCharacterSwitch:
		return s.handleCharacterSwitch(sessionID, req)
	case ActionConfigGet:
		return s.handleConfigGet(sessionID, req)
	case ActionConfigUpdate:
		return s.handleConfigUpdate(sessionID, req)
	case ActionEmotionGet:
		return s.handleEmotionGet(sessionID, req)
	case ActionHealthCheck:
		return s.handleHealthCheck(sessionID, req)
	case ActionMemorySearch:
		return s.handleMemorySearch(sessionID, req)
	case ActionConversationList:
		return s.handleConversationList(sessionID, req)
	case ActionModelListGet:
		return s.handleModelListGet(sessionID, req)
	case ActionModelAdd:
		return s.handleModelAdd(sessionID, req)
	case ActionModelUpdate:
		return s.handleModelUpdate(sessionID, req)
	case ActionModelDelete:
		return s.handleModelDelete(sessionID, req)
	case ActionModelSetDefault:
		return s.handleModelSetDefault(sessionID, req)
	case ActionCronAdd:
		return s.handleCronAdd(sessionID, req)
	case ActionCronList:
		return s.handleCronList(sessionID, req)
	case ActionCronRemove:
		return s.handleCronRemove(sessionID, req)
	case ActionCronEnable:
		return s.handleCronEnable(sessionID, req)
	case ActionCronDisable:
		return s.handleCronDisable(sessionID, req)
	default:
		return s.sendError(sessionID, req.Action, fmt.Sprintf("unknown action: %s", req.Action))
	}
}

func (s *PetService) handleChat(sessionID string, req Request) error {
	var chatReq ChatRequest
	if err := json.Unmarshal(req.Data, &chatReq); err != nil {
		return s.sendError(sessionID, req.Action, "invalid chat data")
	}

	inbound := bus.InboundMessage{
		Channel:  "pet",
		ChatID:   sessionID,
		Content:  chatReq.Text,
		Metadata: map[string]string{"type": "chat", "conn_id": req.RequestID},
	}

	if err := s.msgBus.PublishInbound(context.Background(), inbound); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"session_key": chatReq.SessionKey})
}

func (s *PetService) handleOnboardingConfig(sessionID string, req Request) error {
	var data OnboardingConfigRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid onboarding config data")
	}

	char := s.charManager.GetCurrent()
	if char != nil {
		char.Name = data.PetName
		char.Persona = data.PetPersona
		char.PersonaType = data.PetPersonaType
		s.charManager.UpdateCharacter(char.ID, data.PetName, data.PetPersona, data.PetPersonaType)
		// 保存会在 shutdown 时统一进行
	}

	return s.sendResponse(sessionID, req.Action, OnboardingConfigResponse{PetID: char.ID})
}

func (s *PetService) handleCharacterGet(sessionID string, req Request) error {
	char := s.charManager.GetCurrent()
	if char == nil {
		return s.sendError(sessionID, req.Action, "no active character")
	}

	charConfig := CharacterConfig{
		PetID:          char.ID,
		PetName:        char.Name,
		PetPersona:     char.Persona,
		PetPersonaType: char.PersonaType,
		Avatar:         char.Avatar,
	}
	return s.sendResponse(sessionID, req.Action, charConfig)
}

func (s *PetService) handleCharacterUpdate(sessionID string, req Request) error {
	var data CharacterUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid character data")
	}

	char := s.charManager.GetCurrent()
	if char != nil {
		if data.PetName != "" {
			char.Name = data.PetName
		}
		if data.PetPersona != "" {
			char.Persona = data.PetPersona
		}
		if data.PetPersonaType != "" {
			char.PersonaType = data.PetPersonaType
		}
		s.charManager.UpdateCharacter(char.ID, data.PetName, data.PetPersona, data.PetPersonaType)
		data.PetID = char.ID
	}

	return s.sendResponse(sessionID, req.Action, data)
}

func (s *PetService) handleCharacterSwitch(sessionID string, req Request) error {
	var data CharacterSwitchRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid character switch data")
	}

	if err := s.charManager.Switch(data.CharacterID); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	s.sendPush(sessionID, PushTypeCharacterSwitch, CharacterSwitchPush{
		CharacterID: s.charManager.GetCurrentID(),
	})

	return s.sendResponse(sessionID, req.Action, map[string]string{"character_id": data.CharacterID})
}

func (s *PetService) handleConfigGet(sessionID string, req Request) error {
	cfg := s.configManager.GetApp()
	return s.sendResponse(sessionID, req.Action, cfg)
}

func (s *PetService) handleConfigUpdate(sessionID string, req Request) error {
	var data ConfigUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid config data")
	}

	cfg := s.configManager.GetApp()

	if data.EmotionEnabled != nil {
		cfg.EmotionEnabled = *data.EmotionEnabled
	}
	if data.ReminderEnabled != nil {
		cfg.ReminderEnabled = *data.ReminderEnabled
	}
	if data.ProactiveCare != nil {
		cfg.ProactiveCare = *data.ProactiveCare
	}
	if data.ProactiveIntervalMinutes != nil {
		cfg.ProactiveIntervalMinutes = *data.ProactiveIntervalMinutes
	}
	if data.VoiceEnabled != nil {
		cfg.VoiceEnabled = *data.VoiceEnabled
	}
	if data.Language != nil {
		cfg.Language = *data.Language
	}

	s.configManager.SetAppConfig(cfg)

	return s.sendResponse(sessionID, req.Action, cfg)
}

func (s *PetService) handleEmotionGet(sessionID string, req Request) error {
	char := s.charManager.GetCurrent()
	if char == nil {
		return s.sendError(sessionID, req.Action, "no active character")
	}

	emotions := char.GetEmotions()
	emoEngine := char.GetEmotionEngine()
	dominantEmotion, emotionScore := emoEngine.GetDominantEmotion()

	emo := EmotionState{
		PetID:       char.ID,
		Emotion:     dominantEmotion,
		Joy:         emotions.Joy,
		Anger:       emotions.Anger,
		Sadness:     emotions.Sadness,
		Disgust:     emotions.Disgust,
		Surprise:    emotions.Surprise,
		Fear:        emotions.Fear,
		Description: GetEmotionDescription(dominantEmotion, emotionScore),
	}
	return s.sendResponse(sessionID, req.Action, emo)
}

func (s *PetService) handleHealthCheck(sessionID string, req Request) error {
	return s.sendResponse(sessionID, req.Action, HealthCheckResponse{
		Status:    "ok",
		Timestamp: time.Now().Unix(),
	})
}

func (s *PetService) handleUserProfileUpdate(sessionID string, req Request) error {
	if s.userProfileManager == nil {
		return s.sendError(sessionID, req.Action, "user profile manager not available")
	}

	var data userprofile.UserProfileUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid user profile data")
	}

	s.userProfileManager.UpdateProfile(&data)

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) sendResponse(sessionID, action string, data interface{}) error {
	rawData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	resp := Response{
		Status: StatusOK,
		Action: action,
		Data:   rawData,
	}

	if s.pushHandler == nil {
		return nil
	}
	s.pushHandler(resp)
	return nil
}

func (s *PetService) sendError(sessionID, action, errMsg string) error {
	data := map[string]string{"error": errMsg}
	resp := Response{
		Status: StatusError,
		Action: action,
		Data:   mustMarshal(data),
	}

	if s.pushHandler == nil {
		return fmt.Errorf("%s", errMsg)
	}
	s.pushHandler(resp)
	return fmt.Errorf("%s", errMsg)
}

func (s *PetService) sendPush(sessionID, pushType string, data interface{}) error {
	rawData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	push := Push{
		Type:      "push",
		PushType:  pushType,
		Data:      rawData,
		Timestamp: time.Now().Unix(),
	}

	if s.pushHandler == nil {
		return nil
	}
	s.pushHandler(push)
	return nil
}

func (s *PetService) AppConfig() *petconfig.AppConfig {
	return s.configManager.GetApp()
}

// handleMemorySearch 处理记忆搜索请求
// 支持按关键词、类型、最低权重过滤，按权重排序
func (s *PetService) handleMemorySearch(sessionID string, req Request) error {
	var searchReq MemorySearchRequest
	if err := json.Unmarshal(req.Data, &searchReq); err != nil {
		return s.sendError(sessionID, req.Action, "invalid memory search data")
	}

	if searchReq.CharacterID == "" {
		return s.sendError(sessionID, req.Action, "character_id is required")
	}

	// 获取所有记忆
	allMemories, err := s.memoryStore.List(searchReq.CharacterID)
	if err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to list memories: %v", err))
	}

	// 过滤记忆
	var filtered []*memory.Memory
	for _, m := range allMemories {
		// 关键词过滤（不区分大小写）
		if searchReq.Keyword != "" {
			if !containsIgnoreCase(m.Content, searchReq.Keyword) {
				continue
			}
		}
		// 类型过滤
		if searchReq.Type != "" && m.MemoryType != searchReq.Type {
			continue
		}
		// 最低权重过滤
		if searchReq.MinWeight > 0 && m.Weight < searchReq.MinWeight {
			continue
		}
		filtered = append(filtered, m)
	}

	// 排序：按权重从高到低
	sortMemoriesByWeight(filtered)

	// 统计总数
	total := len(filtered)

	// 分页
	limit := searchReq.Limit
	if limit <= 0 {
		limit = 20 // 默认20条
	}
	offset := searchReq.Offset
	if offset < 0 {
		offset = 0
	}

	end := offset + limit
	if end > total {
		end = total
	}
	if offset >= total {
		filtered = []*memory.Memory{}
	} else {
		filtered = filtered[offset:end]
	}

	// 转换为响应格式
	memoryItems := make([]MemoryItem, 0, len(filtered))
	for _, m := range filtered {
		memoryItems = append(memoryItems, MemoryItem{
			ID:        m.ID,
			Type:      m.MemoryType,
			Weight:    m.Weight,
			Content:   m.Content,
			CreatedAt: m.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	hasMore := offset+limit < total

	return s.sendResponse(sessionID, req.Action, MemorySearchResponse{
		Memories: memoryItems,
		Total:    total,
		HasMore:  hasMore,
	})
}

// handleConversationList 处理对话列表请求
// 获取指定角色的对话历史，按时间倒序
func (s *PetService) handleConversationList(sessionID string, req Request) error {
	var listReq ConversationListRequest
	if err := json.Unmarshal(req.Data, &listReq); err != nil {
		return s.sendError(sessionID, req.Action, "invalid conversation list data")
	}

	if listReq.CharacterID == "" {
		return s.sendError(sessionID, req.Action, "character_id is required")
	}

	// 获取所有对话
	limit := listReq.Limit
	if limit <= 0 {
		limit = 50 // 默认50条
	}
	offset := listReq.Offset
	if offset < 0 {
		offset = 0
	}

	// 获取所有对话用于统计总数
	allConversations, err := s.conversationStore.GetAll(listReq.CharacterID, 10000)
	if err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to get conversations: %v", err))
	}
	total := len(allConversations)

	// 分页获取
	pageConversations, err := s.conversationStore.GetAll(listReq.CharacterID, limit+offset)
	if err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to get conversations: %v", err))
	}

	// 跳过 offset 条
	if offset >= len(pageConversations) {
		pageConversations = []*compression.ConversationEntry{}
	} else {
		pageConversations = pageConversations[offset:]
		if len(pageConversations) > limit {
			pageConversations = pageConversations[:limit]
		}
	}

	// 转换为响应格式
	conversationItems := make([]ConversationItem, 0, len(pageConversations))
	for _, c := range pageConversations {
		conversationItems = append(conversationItems, ConversationItem{
			ID:         c.ID,
			Role:       c.Role,
			Content:    c.Content,
			Timestamp:  c.Timestamp.Format("2006-01-02T15:04:05Z"),
			Compressed: false, // GetAll 不返回压缩状态，需要单独查询
		})
	}

	hasMore := offset+limit < total

	return s.sendResponse(sessionID, req.Action, ConversationListResponse{
		Conversations: conversationItems,
		Total:         total,
		HasMore:       hasMore,
	})
}

func (s *PetService) handleModelListGet(sessionID string, req Request) error {
	if s.modelConfigManager == nil {
		return s.sendError(sessionID, req.Action, "model config manager not available")
	}

	resp, err := s.modelConfigManager.List()
	if err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, resp)
}

func (s *PetService) handleModelAdd(sessionID string, req Request) error {
	if s.modelConfigManager == nil {
		return s.sendError(sessionID, req.Action, "model config manager not available")
	}

	var data modelconfig.AddModelRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if err := s.modelConfigManager.Add(&data); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleModelUpdate(sessionID string, req Request) error {
	if s.modelConfigManager == nil {
		return s.sendError(sessionID, req.Action, "model config manager not available")
	}

	var data modelconfig.UpdateModelRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if err := s.modelConfigManager.Update(&data); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleModelDelete(sessionID string, req Request) error {
	if s.modelConfigManager == nil {
		return s.sendError(sessionID, req.Action, "model config manager not available")
	}

	var data modelconfig.DeleteModelRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if err := s.modelConfigManager.Delete(&data); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleModelSetDefault(sessionID string, req Request) error {
	if s.modelConfigManager == nil {
		return s.sendError(sessionID, req.Action, "model config manager not available")
	}

	var data modelconfig.SetDefaultRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if err := s.modelConfigManager.SetDefault(&data); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

// sortMemoriesByWeight 按权重从高到低排序
func sortMemoriesByWeight(memories []*memory.Memory) {
	for i := 0; i < len(memories); i++ {
		for j := i + 1; j < len(memories); j++ {
			if memories[j].Weight > memories[i].Weight {
				memories[i], memories[j] = memories[j], memories[i]
			}
		}
	}
}

// containsIgnoreCase 字符串包含检查（不区分大小写）
func containsIgnoreCase(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	if len(s) < len(substr) {
		return false
	}
	// 转小写比较
	sLower := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		sLower[i] = c
	}
	substrLower := make([]byte, len(substr))
	for i := 0; i < len(substr); i++ {
		c := substr[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		substrLower[i] = c
	}
	for i := 0; i <= len(sLower)-len(substrLower); i++ {
		match := true
		for j := 0; j < len(substrLower); j++ {
			if sLower[i+j] != substrLower[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func mustMarshal(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{"error": "marshal error"}`)
	}
	return data
}

var EmotionDescriptions = map[string][]string{
	"joy":      {"很不开心", "有点不开心", "有点开心", "很开心"},
	"sadness":  {"很平静", "有点难过", "比较难过", "非常难过"},
	"anger":    {"很平静", "有点生气", "比较生气", "非常生气"},
	"fear":     {"很平静", "有点害怕", "比较害怕", "非常害怕"},
	"disgust":  {"很平静", "有点厌恶", "比较厌恶", "非常厌恶"},
	"surprise": {"很平静", "有点惊讶", "比较惊讶", "非常惊讶"},
}

func scoreToIndex(score int) int {
	switch {
	case score < 20:
		return 0
	case score < 50:
		return 1
	case score < 80:
		return 2
	default:
		return 3
	}
}

func GetEmotionDescription(emotion string, score int) string {
	if emotion == "neutral" || score == 50 {
		return "平静"
	}

	descriptions, ok := EmotionDescriptions[emotion]
	if !ok {
		return "平静"
	}

	idx := scoreToIndex(score)
	return descriptions[idx]
}

func (s *PetService) handleCronAdd(sessionID string, req Request) error {
	if s.cronService == nil {
		return s.sendError(sessionID, req.Action, "cron service not initialized")
	}

	var r CronAddRequest
	if err := json.Unmarshal(req.Data, &r); err != nil {
		return s.sendError(sessionID, req.Action, "invalid cron add data")
	}

	if r.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}
	if r.Message == "" {
		return s.sendError(sessionID, req.Action, "message is required")
	}

	var schedule cron.CronSchedule
	if r.AtSeconds > 0 {
		atMS := time.Now().UnixMilli() + r.AtSeconds*1000
		schedule = cron.CronSchedule{Kind: "at", AtMS: &atMS}
	} else if r.EverySeconds > 0 {
		everyMS := r.EverySeconds * 1000
		schedule = cron.CronSchedule{Kind: "every", EveryMS: &everyMS}
	} else if r.CronExpr != "" {
		schedule = cron.CronSchedule{Kind: "cron", Expr: r.CronExpr}
	} else {
		return s.sendError(sessionID, req.Action, "one of at_seconds, every_seconds, or cron_expr is required")
	}

	job, err := s.cronService.AddJob(r.Name, schedule, r.Message, "pet", sessionID)
	if err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to add cron job: %v", err))
	}

	return s.sendResponse(sessionID, req.Action, CronAddResponse{
		JobID: job.ID,
		Name:  job.Name,
	})
}

func (s *PetService) handleCronList(sessionID string, req Request) error {
	if s.cronService == nil {
		return s.sendError(sessionID, req.Action, "cron service not initialized")
	}

	// 重新加载 jobs.json，获取最新数据（包括 picoclaw 创建的任务）
	if err := s.cronService.Load(); err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to load cron jobs: %v", err))
	}

	var r CronListRequest
	if err := json.Unmarshal(req.Data, &r); err != nil {
		r = CronListRequest{}
	}

	jobs := s.cronService.ListJobs(r.IncludeDisabled)

	var jobInfos []CronJobInfo
	for _, job := range jobs {
		jobInfos = append(jobInfos, CronJobInfo{
			ID:           job.ID,
			Name:         job.Name,
			Enabled:      job.Enabled,
			ScheduleKind: job.Schedule.Kind,
			EveryMS:      job.Schedule.EveryMS,
			CronExpr:     job.Schedule.Expr,
			AtMS:         job.Schedule.AtMS,
			Message:      job.Payload.Message,
			Channel:      job.Payload.Channel,
			To:           job.Payload.To,
			NextRunAtMS:  job.State.NextRunAtMS,
			LastRunAtMS:  job.State.LastRunAtMS,
			LastStatus:   job.State.LastStatus,
			CreatedAtMS:  job.CreatedAtMS,
		})
	}

	return s.sendResponse(sessionID, req.Action, CronListResponse{Jobs: jobInfos})
}

func (s *PetService) handleCronRemove(sessionID string, req Request) error {
	if s.cronService == nil {
		return s.sendError(sessionID, req.Action, "cron service not initialized")
	}

	var r CronRemoveRequest
	if err := json.Unmarshal(req.Data, &r); err != nil {
		return s.sendError(sessionID, req.Action, "invalid cron remove data")
	}

	if r.JobID == "" {
		return s.sendError(sessionID, req.Action, "job_id is required")
	}

	if !s.cronService.RemoveJob(r.JobID) {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("job %s not found", r.JobID))
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"job_id": r.JobID})
}

func (s *PetService) handleCronEnable(sessionID string, req Request) error {
	if s.cronService == nil {
		return s.sendError(sessionID, req.Action, "cron service not initialized")
	}

	var r CronEnableRequest
	if err := json.Unmarshal(req.Data, &r); err != nil {
		return s.sendError(sessionID, req.Action, "invalid cron enable data")
	}

	if r.JobID == "" {
		return s.sendError(sessionID, req.Action, "job_id is required")
	}

	job := s.cronService.EnableJob(r.JobID, true)
	if job == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("job %s not found", r.JobID))
	}

	return s.sendResponse(sessionID, req.Action, map[string]any{"job_id": job.ID, "enabled": job.Enabled})
}

func (s *PetService) handleCronDisable(sessionID string, req Request) error {
	if s.cronService == nil {
		return s.sendError(sessionID, req.Action, "cron service not initialized")
	}

	var r CronEnableRequest
	if err := json.Unmarshal(req.Data, &r); err != nil {
		return s.sendError(sessionID, req.Action, "invalid cron disable data")
	}

	if r.JobID == "" {
		return s.sendError(sessionID, req.Action, "job_id is required")
	}

	job := s.cronService.EnableJob(r.JobID, false)
	if job == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("job %s not found", r.JobID))
	}

	return s.sendResponse(sessionID, req.Action, map[string]any{"job_id": job.ID, "enabled": job.Enabled})
}
