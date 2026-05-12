package pet

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/cron"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/action"
	"github.com/sipeed/picoclaw/pkg/pet/activity"
	"github.com/sipeed/picoclaw/pkg/pet/asr"
	"github.com/sipeed/picoclaw/pkg/pet/characters"
	"github.com/sipeed/picoclaw/pkg/pet/compression"
	petconfig "github.com/sipeed/picoclaw/pkg/pet/config"
	perr "github.com/sipeed/picoclaw/pkg/pet/err"
	"github.com/sipeed/picoclaw/pkg/pet/memory"
	"github.com/sipeed/picoclaw/pkg/pet/modelconfig"
	"github.com/sipeed/picoclaw/pkg/pet/proactive"
	"github.com/sipeed/picoclaw/pkg/pet/skills"
	"github.com/sipeed/picoclaw/pkg/pet/userprofile"
	"github.com/sipeed/picoclaw/pkg/pet/voice"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/tools"
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
	asrLoader          *asr.Loader
	conversationStore  *compression.ConversationStore
	compressionSvc     *compression.CompressionService
	modelConfigManager *modelconfig.Manager
	cronService        *cron.CronService
	userProfileManager *userprofile.Manager
	skillsMgr          *skills.Manager
	activityStore      *activity.Store
	proactiveManager   *proactive.Manager

	connSessions        map[string]string
	activeSessionID     string
	activeCharacterID   string
	lastSessionActiveAt time.Time

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
	homePath := config.GetHome()
	s := &PetService{
		msgBus:       msgBus,
		config:       cfg,
		connSessions: make(map[string]string),
		ctx:          ctx,
		cancel:       cancel,
	}
	workspacePath := cfg.WorkspacePath
	if workspacePath != "" {
		s.configManager = petconfig.NewManager(homePath, workspacePath)
		if s.configManager == nil {
			return nil, fmt.Errorf("failed to create config manager")
		}
		// 创建角色管理器
		var err error
		s.charManager, err = characters.NewManager(s.configManager.GetCharacters(), s.configManager)
		if err != nil {
			fmt.Printf("pet: failed to create character manager: %v\n", err)
			return nil, err
		}
		// 创建语音加载器
		s.voiceLoader = voice.NewLoader(s.configManager.GetVoice())
		if err := s.voiceLoader.Load(); err != nil {
			fmt.Printf("pet: failed to load voice: %v\n", err)
		}
		if s.voiceLoader.GetProvider() != nil {
			fmt.Println("pet: voice provider loaded successfully")
		} else {
			fmt.Println("pet: voice provider is nil after loading")
		}

		// 创建 ASR 加载器
		s.asrLoader = asr.NewLoader(s.configManager.GetVoice())
		if err := s.asrLoader.Load(); err != nil {
			fmt.Printf("pet: failed to load ASR: %v\n", err)
		}
		if s.asrLoader.IsEnabled() {
			fmt.Println("pet: ASR enabled, provider:", s.asrLoader.GetCurrentModel())
		} else {
			fmt.Println("pet: ASR is not enabled or not loaded")
		}

		// 创建动作管理器
		s.actionManager = action.NewActionManager(homePath)

		// 创建记忆内存存储
		s.memoryStore, err = memory.NewStore(homePath)
		if err != nil {
			fmt.Printf("pet: failed to create memory store: %v\n", err)
		}

		if err := s.actionManager.Load(); err != nil {
			fmt.Printf("pet: failed to load actions: %v\n", err)
		}
		ensureDefaultActions(s.actionManager)

		// 创建对话存储
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
			s.conversationStore, err = compression.NewConversationStore(homePath, threshold, callback)
			if err != nil {
				logger.Warnf("pet: failed to create conversation store: %v", err)
			}

			// 统一使用 Agents.Defaults 的模型
			var provider providers.LLMProvider
			var modelCfg *config.ModelConfig
			if cfg.Config != nil {
				rawModel := cfg.Config.Agents.Defaults.GetModelName()
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
				homePath,
				s.memoryStore,
				s.charManager,
				provider,
				cfg.Config.Agents.Defaults.GetModelName(),
			)
		}
		// 创建用户画像管理器
		if s.userProfileManager == nil {
			s.userProfileManager = userprofile.NewManager(
				homePath,
				s.memoryStore,
				s.charManager,
				nil,
				cfg.Config.Agents.Defaults.GetModelName(),
			)
		}
	}

	if cfg.ConfigPath != "" {
		s.modelConfigManager = modelconfig.NewManager(cfg.ConfigPath)
	}

	if workspacePath != "" {
		// activityStore 负责把“用户让桌宠干过什么”沉淀成结构化记录，
		// 后面的 weekly_report 和 progress_nudge 都会依赖它。
		var err error
		s.activityStore, err = activity.NewStore(workspacePath)
		if err != nil {
			logger.WarnCF("pet", "PetService: failed to create activity store", map[string]any{"error": err.Error()})
		}
		// 初始化 cron 服务（仅当未通过 SetCronService 注入外部实例时）
		if s.cronService == nil {
			cronStorePath := filepath.Join(workspacePath, "cron", "jobs.json")
			s.cronService = cron.NewCronService(cronStorePath, nil)
			logger.DebugCF("pet", "PetService: cron service initialized, store=", map[string]any{
				"store_path": cronStorePath,
			})
		} else {
			logger.DebugCF("pet", "PetService: using externally provided cron service", nil)
		}
		// 初始化 skills 管理器
		if cfg.Config != nil {
			var err error
			s.skillsMgr, err = skills.NewManager(cfg.Config)
			if err != nil {
				logger.WarnCF("pet", "PetService: failed to create skills manager", map[string]any{"error": err.Error()})
			} else {
				logger.DebugCF("pet", "PetService: skills manager initialized", nil)
			}
		}
		// proactiveManager 是主动性系统的总入口。
		// 当前先把快照、可打扰判断、policy 这几层底座跑通。
		historyStore := proactive.NewHistoryStore(workspacePath)
		providers := []proactive.Provider{
			proactive.NewWeeklyReportProvider(s.activityStore, proactive.NewWeeklyReportStateStore(workspacePath)),
			proactive.NewProgressNudgeProvider(s.activityStore, historyStore),
		}
		s.proactiveManager = proactive.NewManager(
			historyStore,
			func(reason string) proactive.Snapshot {
				return proactive.BuildSnapshot(time.Now(), proactive.SnapshotDependencies{
					ActivityStore:      s.activityStore,
					ConfigManager:      s.configManager,
					UserProfileManager: s.userProfileManager,
					CharacterProvider:  s.charManager,
					LastPushAt: func() time.Time {
						if s.proactiveManager == nil {
							return time.Time{}
						}
						return s.proactiveManager.LastPushAt()
					},
					ActiveSessionID: func() string {
						return s.resolveActiveDeliverySession()
					},
					CurrentSessionBusy: func(now time.Time) bool {
						return s.isCurrentSessionBusy(now)
					},
				})
			},
			providers,
			func(intent proactive.Intent, level proactive.DeliveryLevel) error {
				return s.deliverProactiveIntent(intent, level)
			},
		)
	}

	return s, nil
}

func (s *PetService) Start() {
	s.decayTicker = time.NewTicker(5 * time.Second)
	go s.runEmotionDecay()
	if s.proactiveManager != nil {
		// 主动性系统是后台循环，不阻塞桌宠主链路。
		go s.proactiveManager.Start(s.ctx)
	}
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

func (s *PetService) ASRLoader() *asr.Loader {
	return s.asrLoader
}

func (s *PetService) UserProfileManager() *userprofile.Manager {
	return s.userProfileManager
}

func (s *PetService) SetPushHandler(handler PushHandler) {
	s.pushHandler = handler
}

func (s *PetService) SetCronService(cs *cron.CronService) {
	s.cronService = cs
	logger.DebugCF("pet", "PetService: using externally provided cron service", nil)
}

func (s *PetService) Push(push any) {
	if s.pushHandler != nil {
		s.pushHandler(push)
	}
}

func (s *PetService) recordToolCallActivity(sessionID, tool string, args map[string]any) {
	if s == nil || s.activityStore == nil || s.charManager == nil || tool == "" {
		return
	}
	charID := s.charManager.GetCurrentID()
	if charID == "" {
		return
	}
	if err := s.activityStore.Append(activity.BuildToolCallEvent(charID, sessionID, tool, args)); err != nil {
		logger.WarnCF("pet", "PetService: failed to append tool call activity", map[string]any{
			"tool":  tool,
			"error": err.Error(),
		})
	}
}

func (s *PetService) recordToolResultActivity(sessionID, tool string, result *tools.ToolResult) {
	if s == nil || s.activityStore == nil || s.charManager == nil || tool == "" || result == nil {
		return
	}
	charID := s.charManager.GetCurrentID()
	if charID == "" {
		return
	}
	if err := s.activityStore.Append(activity.BuildToolResultEvent(charID, sessionID, tool, result)); err != nil {
		logger.WarnCF("pet", "PetService: failed to append tool result activity", map[string]any{
			"tool":  tool,
			"error": err.Error(),
		})
	}
}

func (s *PetService) recordUserActivity(sessionID, text string) {
	if s.activityStore == nil || s.charManager == nil {
		return
	}
	charID := s.charManager.GetCurrentID()
	if charID == "" {
		return
	}
	// 这里只记录最基础的一类活动：用户消息。
	// 后续再逐步把 tool result / file output 也补进来。
	if err := s.activityStore.Append(activity.BuildUserMessageEvent(charID, sessionID, text)); err != nil {
		logger.WarnCF("pet", "PetService: failed to append activity event", map[string]any{"error": err.Error()})
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
	if sessionID != "" && s.activeSessionID == "" {
		s.activeSessionID = sessionID
		if s.charManager != nil {
			s.activeCharacterID = s.charManager.GetCurrentID()
		}
	}
	s.mu.Unlock()
}

func (s *PetService) UnregisterSession(connID string) {
	s.mu.Lock()
	sessionID := s.connSessions[connID]
	delete(s.connSessions, connID)
	if len(s.connSessions) == 0 {
		s.activeSessionID = ""
		s.activeCharacterID = ""
		s.lastSessionActiveAt = time.Time{}
		s.mu.Unlock()
		return
	}
	if sessionID != "" && s.activeSessionID == sessionID {
		s.activeSessionID = ""
		s.activeCharacterID = ""
		s.lastSessionActiveAt = time.Time{}
		for _, candidateSessionID := range s.connSessions {
			if candidateSessionID == "" {
				continue
			}
			s.activeSessionID = candidateSessionID
			if s.charManager != nil {
				s.activeCharacterID = s.charManager.GetCurrentID()
			}
			break
		}
	}
	s.mu.Unlock()
}

func (s *PetService) GetSessionByConnID(connID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connSessions[connID]
}

func (s *PetService) markSessionInteraction(sessionID string) {
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeSessionID = sessionID
	s.lastSessionActiveAt = time.Now()
	if s.charManager != nil {
		s.activeCharacterID = s.charManager.GetCurrentID()
	}
}

func (s *PetService) resolveActiveDeliverySession() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.activeSessionID == "" {
		return ""
	}
	if s.activeCharacterID != "" && s.charManager != nil && s.charManager.GetCurrentID() != s.activeCharacterID {
		return ""
	}
	return s.activeSessionID
}

func (s *PetService) ResolveReminderDeliverySession() string {
	return s.resolveActiveDeliverySession()
}

func (s *PetService) isCurrentSessionBusy(now time.Time) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.activeSessionID == "" || s.lastSessionActiveAt.IsZero() {
		return false
	}
	if now.IsZero() {
		now = time.Now()
	}
	return now.Sub(s.lastSessionActiveAt) < 90*time.Second
}

func (s *PetService) TriggerTaskDeadlineReminderWithRetry(sessionID string, jobID string, delay time.Duration) error {
	if s.proactiveManager == nil {
		return fmt.Errorf("proactive manager not initialized")
	}
	reason := "task_deadline:" + jobID
	_ = s.proactiveManager.EvaluateNow(reason)
	return nil
}

func (s *PetService) EvaluateTaskDeadlineReminder(sessionID string, jobID string, retryCount int) proactive.EvaluationResult {
	if sessionID != "" {
		s.markSessionInteraction(sessionID)
	}
	if s == nil || s.proactiveManager == nil {
		return proactive.EvaluationResult{}
	}
	reason := "task_deadline"
	if jobID != "" {
		reason = "task_deadline:" + jobID
		if retryCount > 0 {
			reason += fmt.Sprintf(":%d", retryCount)
		}
	}
	return s.proactiveManager.EvaluateNow(reason)
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
	case ActionCharacterCreate:
		return s.handleCharacterCreate(sessionID, req)
	case ActionUserProfileGet:
		return s.handleUserProfileGet(sessionID, req)
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
	case ActionCronUpdate:
		return s.handleCronUpdate(sessionID, req)
	case ActionCronList:
		return s.handleCronList(sessionID, req)
	case ActionCronRemove:
		return s.handleCronRemove(sessionID, req)
	case ActionCronEnable:
		return s.handleCronEnable(sessionID, req)
	case ActionCronDisable:
		return s.handleCronDisable(sessionID, req)
	case ActionVoiceModelListGet:
		return s.handleVoiceModelListGet(sessionID, req)
	case ActionVoiceModelGet:
		return s.handleVoiceModelGet(sessionID, req)
	case ActionVoiceModelAdd:
		return s.handleVoiceModelAdd(sessionID, req)
	case ActionVoiceModelUpdate:
		return s.handleVoiceModelUpdate(sessionID, req)
	case ActionVoiceModelSetDefault:
		return s.handleVoiceModelSetDefault(sessionID, req)
	case ActionVoiceModelGetVoices:
		return s.handleVoiceModelGetVoices(sessionID, req)
	case ActionVoiceModelDelete:
		return s.handleVoiceModelDelete(sessionID, req)
	case ActionASRModelListGet:
		return s.handleASRModelListGet(sessionID, req)
	case ActionASRModelGet:
		return s.handleASRModelGet(sessionID, req)
	case ActionASRModelAdd:
		return s.handleASRModelAdd(sessionID, req)
	case ActionASRModelUpdate:
		return s.handleASRModelUpdate(sessionID, req)
	case ActionASRModelSetDefault:
		return s.handleASRModelSetDefault(sessionID, req)
	case ActionASRModelDelete:
		return s.handleASRModelDelete(sessionID, req)
	case ActionSkillList:
		return s.handleSkillList(sessionID, req)
	case ActionSkillSearch:
		return s.handleSkillSearch(sessionID, req)
	case ActionSkillInstall:
		return s.handleSkillInstall(sessionID, req)
	case ActionSkillRemove:
		return s.handleSkillRemove(sessionID, req)
	case ActionSkillGet:
		return s.handleSkillGet(sessionID, req)
	case ActionAudioFrame:
		return s.handleAudioFrame(sessionID, req)
	case ActionVoiceConfigGet:
		return s.handleVoiceConfigGet(sessionID, req)
	case ActionVoiceConfigUpdate:
		return s.handleVoiceConfigUpdate(sessionID, req)
	default:
		return s.sendError(sessionID, req.Action, fmt.Sprintf("unknown action: %s", req.Action))
	}
}

func (s *PetService) handleChat(sessionID string, req Request) error {
	var chatReq ChatRequest
	if err := json.Unmarshal(req.Data, &chatReq); err != nil {
		logger.WarnCF("pet", "PetService: handleChat invalid chat data", map[string]any{
			"session_id": sessionID,
			"request_id": req.RequestID,
			"raw_data":   string(req.Data),
			"error":      err.Error(),
		})
		return s.sendError(sessionID, req.Action, "invalid chat data")
	}
	logger.InfoCF("pet", "PetService: handleChat received", map[string]any{
		"session_id":       sessionID,
		"request_id":       req.RequestID,
		"session_key":      chatReq.SessionKey,
		"text_len":         len(chatReq.Text),
		"text_preview":     chatReq.Text,
		"text_is_empty":    chatReq.Text == "",
		"session_key_empty": chatReq.SessionKey == "",
	})

	char := s.charManager.GetCurrent()
	if char == nil {
		logger.WarnCF("pet", "PetService: handleChat no active character", map[string]any{
			"session_id": sessionID,
			"request_id": req.RequestID,
		})
		return s.sendError(sessionID, req.Action, "no active character")
	}

	// 用户一说话，就顺手记一笔活动记录，
	// 同时触发一次主动性“即时评估”。
	s.markSessionInteraction(sessionID)
	s.recordUserActivity(sessionID, chatReq.Text)
	if s.proactiveManager != nil {
		s.proactiveManager.Trigger("user_message")
	}

	inbound := bus.InboundMessage{
		Channel:    "pet",
		ChatID:     sessionID,
		SessionKey: chatReq.SessionKey,
		Peer: bus.Peer{
			Kind: char.ID,
			ID:   chatReq.SessionKey,
		},
		Content:  chatReq.Text,
		Metadata: map[string]string{"type": "chat", "conn_id": req.RequestID},
	}
	logger.InfoCF("pet", "PetService: handleChat publishing inbound", map[string]any{
		"session_id":   sessionID,
		"request_id":   req.RequestID,
		"session_key":  chatReq.SessionKey,
		"peer_kind":    char.ID,
		"content_len":  len(chatReq.Text),
		"content_text": chatReq.Text,
	})

	if err := s.msgBus.PublishInbound(context.Background(), inbound); err != nil {
		logger.WarnCF("pet", "PetService: handleChat publish inbound failed", map[string]any{
			"session_id":  sessionID,
			"request_id":  req.RequestID,
			"session_key": chatReq.SessionKey,
			"error":       err.Error(),
		})
		return s.sendError(sessionID, req.Action, err.Error())
	}
	logger.InfoCF("pet", "PetService: handleChat publish inbound succeeded", map[string]any{
		"session_id":  sessionID,
		"request_id":  req.RequestID,
		"session_key": chatReq.SessionKey,
	})

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
		s.charManager.UpdateCharacter(char.ID, data.PetName, data.PetPersona, data.PetPersonaType, "", "", "", "", "")
		// 保存会在 shutdown 时统一进行
	}

	return s.sendResponse(sessionID, req.Action, OnboardingConfigResponse{PetID: char.ID})
}

func (s *PetService) handleCharacterGet(sessionID string, req Request) error {
	var data CharacterGetRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		data = CharacterGetRequest{}
	}

	var char *characters.Character
	if data.PetID != "" {
		char = s.charManager.Get(data.PetID)
		if char == nil {
			return s.sendError(sessionID, req.Action, "character not found")
		}
	} else {
		char = s.charManager.GetCurrent()
		if char == nil {
			return s.sendError(sessionID, req.Action, "no active character")
		}
	}

	charConfig := CharacterConfig{
		PetID:          char.ID,
		PetName:        char.Name,
		PetPersona:     char.Persona,
		PetPersonaType: char.PersonaType,
		SpeechTone:     char.SpeechTone,
		Catchphrase:    char.Catchphrase,
		Hobbies:        char.Hobbies,
		Background:     char.Background,
		Preferences:    char.Preferences,
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
		if data.SpeechTone != "" {
			char.SpeechTone = data.SpeechTone
		}
		if data.Catchphrase != "" {
			char.Catchphrase = data.Catchphrase
		}
		if data.Hobbies != "" {
			char.Hobbies = data.Hobbies
		}
		if data.Background != "" {
			char.Background = data.Background
		}
		if data.Preferences != "" {
			char.Preferences = data.Preferences
		}
		s.charManager.UpdateCharacter(char.ID, data.PetName, data.PetPersona, data.PetPersonaType, data.SpeechTone, data.Catchphrase, data.Hobbies, data.Background, data.Preferences)
		data.PetID = char.ID
	}

	return s.sendResponse(sessionID, req.Action, data)
}

func (s *PetService) handleCharacterCreate(sessionID string, req Request) error {
	var data CharacterCreateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid character create data")
	}

	if data.PetName == "" {
		return s.sendError(sessionID, req.Action, "pet_name is required")
	}

	if s.charManager == nil || s.configManager == nil {
		return s.sendError(sessionID, req.Action, "character manager not available")
	}

	existingChars := s.charManager.List()
	var maxID int
	for _, c := range existingChars {
		var idNum int
		fmt.Sscanf(c.ID, "pet_%d", &idNum)
		if idNum > maxID {
			maxID = idNum
		}
	}
	newIDNum := maxID + 1
	newID := fmt.Sprintf("pet_%03d", newIDNum)

	avatar := data.Avatar
	if avatar == "" {
		avatar = "cute_cat"
	}

	newChar := characters.NewCharacter(
		newID,
		data.PetName,
		data.PetPersona,
		data.PetPersonaType,
		data.SpeechTone,
		data.Catchphrase,
		data.Hobbies,
		data.Background,
		data.Preferences,
		avatar,
	)

	s.charManager.Add(newChar)

	charCfg := &petconfig.CharacterConfig{
		ID:          newID,
		Name:        data.PetName,
		Persona:     data.PetPersona,
		PersonaType: data.PetPersonaType,
		SpeechTone:  data.SpeechTone,
		Catchphrase: data.Catchphrase,
		Hobbies:     data.Hobbies,
		Background:  data.Background,
		Preferences: data.Preferences,
		Avatar:      avatar,
	}
	s.configManager.AppendCharacter(charCfg)
	s.configManager.Save()

	now := time.Now().Format(time.RFC3339)
	resp := CharacterCreateResponse{
		PetID:          newID,
		PetName:        data.PetName,
		PetPersona:     data.PetPersona,
		PetPersonaType: data.PetPersonaType,
		SpeechTone:     data.SpeechTone,
		Catchphrase:    data.Catchphrase,
		Hobbies:        data.Hobbies,
		Background:     data.Background,
		Preferences:    data.Preferences,
		Avatar:         avatar,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	return s.sendResponse(sessionID, req.Action, resp)
}

func (s *PetService) handleUserProfileGet(sessionID string, req Request) error {
	if s.userProfileManager == nil {
		return s.sendError(sessionID, req.Action, "user profile manager not available")
	}

	profile := s.userProfileManager.LoadProfile()

	resp := map[string]interface{}{
		"display_name":     profile.DisplayName,
		"role":             profile.Role,
		"language":         profile.Language,
		"chronotype":       profile.Chronotype,
		"personality_tone": profile.PersonalityTone,
		"anxiety_level":    profile.AnxietyLevel,
		"pressure_level":   profile.PressureLevel,
		"extra":            profile.Extra,
	}

	return s.sendResponse(sessionID, req.Action, resp)
}

func (s *PetService) handleCharacterSwitch(sessionID string, req Request) error {
	var data CharacterSwitchRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid character switch data")
	}

	if err := s.charManager.Switch(data.CharacterID); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	// 应用角色偏好音色
	privateCfg := s.configManager.GetCharacterPrivateConfig()
	if privateCfg != nil && privateCfg.VoiceModel != "" && privateCfg.VoiceID != "" {
		// 更新全局模型的 VoiceID 为角色的偏好音色
		if model := s.voiceLoader.GetModel(privateCfg.VoiceModel); model != nil {
			model.VoiceID = privateCfg.VoiceID
			// 持久化到全局配置
			if err := s.configManager.UpdateVoiceModel(model); err != nil {
				logger.Warnf("pet: failed to update voice model: %v", err)
			}
		}
		// 切换到角色偏好的模型
		if err := s.voiceLoader.SwitchModel(privateCfg.VoiceModel, s.configManager); err != nil {
			logger.Warnf("pet: failed to switch voice model: %v", err)
		} else {
			logger.Infof("pet: switched to voice %s (%s)", privateCfg.VoiceModel, privateCfg.VoiceID)
		}
	}

	s.sendPush(sessionID, PushTypeCharacterSwitch, CharacterSwitchPush{
		CharacterID: s.charManager.GetCurrentID(),
	})

	return s.sendResponse(sessionID, req.Action, map[string]string{"character_id": data.CharacterID})
}

func (s *PetService) handleConfigGet(sessionID string, req Request) error {
	cfg := s.configManager.GetApp()
	cfg.ASREnabled = s.configManager.GetVoice().ASREnabled
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
	if data.WeeklyReportEnabled != nil {
		cfg.WeeklyReportEnabled = *data.WeeklyReportEnabled
	}
	if data.ProgressNudgeEnabled != nil {
		cfg.ProgressNudgeEnabled = *data.ProgressNudgeEnabled
	}
	if data.ProactiveCheckMinutes != nil {
		cfg.ProactiveCheckMinutes = *data.ProactiveCheckMinutes
	}
	if data.GlobalCooldownMinutes != nil {
		cfg.GlobalCooldownMinutes = *data.GlobalCooldownMinutes
	}
	if data.VoiceEnabled != nil {
		cfg.VoiceEnabled = *data.VoiceEnabled
	}
	if data.Language != nil {
		cfg.Language = *data.Language
	}

	s.configManager.SetAppConfig(cfg)

	if data.ASREnabled != nil {
		s.configManager.SetAsrEnabled(*data.ASREnabled)
	}

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

func (s *PetService) deliverProactiveIntent(intent proactive.Intent, level proactive.DeliveryLevel) error {
	if s == nil || s.proactiveManager == nil {
		return nil
	}

	sessionID := ""
	s.mu.RLock()
	for _, sid := range s.connSessions {
		sessionID = sid
		break
	}
	s.mu.RUnlock()
	if sessionID == "" {
		return nil
	}

	var pushType string
	switch intent.Type {
	case "weekly_report":
		pushType = PushTypeWeeklyReport
	case "progress_nudge":
		pushType = PushTypeProgressNudge
	default:
		return nil
	}

	payload := map[string]any{
		"delivery_level": string(level),
	}
	for k, v := range intent.Payload {
		payload[k] = v
	}

	eventID := ""
	if id, ok := intent.Payload["report_id"].(string); ok {
		eventID = id
	}
	if id, ok := intent.Payload["nudge_id"].(string); ok && eventID == "" {
		eventID = id
	}
	if eventID == "" {
		eventID = intent.Type + "-" + time.Now().Format("20060102150405")
	}

	if err := s.sendPush(sessionID, pushType, payload); err != nil {
		return err
	}
	return s.proactiveManager.RecordDelivery(intent.Type, eventID, s.charManager.GetCurrentID())
}

func (s *PetService) AppConfig() *petconfig.AppConfig {
	return s.configManager.GetApp()
}

func (s *PetService) WorkspacePath() string {
	if s == nil {
		return ""
	}
	return s.config.WorkspacePath
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
	allConversations, err := s.conversationStore.GetAll(listReq.CharacterID, listReq.SessionID, 10000)
	if err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to get conversations: %v", err))
	}
	total := len(allConversations)

	// 分页获取
	pageConversations, err := s.conversationStore.GetAll(listReq.CharacterID, listReq.SessionID, limit+offset)
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
			SessionID:  c.SessionID,
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
	message := r.Message
	if message == "" {
		message = r.Description
	}
	if message == "" {
		return s.sendError(sessionID, req.Action, "message or description is required")
	}

	channel := r.Channel
	if channel == "" {
		channel = "pet"
	}
	to := r.To
	if to == "" {
		to = sessionID
	}

	var schedule cron.CronSchedule
	if r.AtMS != nil && *r.AtMS > 0 {
		schedule = cron.CronSchedule{Kind: "at", AtMS: r.AtMS}
	} else if r.AtSeconds > 0 {
		atMS := time.Now().UnixMilli() + r.AtSeconds*1000
		schedule = cron.CronSchedule{Kind: "at", AtMS: &atMS}
	} else if r.EverySeconds > 0 {
		everyMS := r.EverySeconds * 1000
		schedule = cron.CronSchedule{Kind: "every", EveryMS: &everyMS}
	} else if r.CronExpr != "" {
		schedule = cron.CronSchedule{Kind: "cron", Expr: r.CronExpr}
	} else {
		return s.sendError(sessionID, req.Action, "one of at_seconds/at_ms, every_seconds, or cron_expr is required")
	}

	job, err := s.cronService.AddJob(r.Name, schedule, message, channel, to)
	if err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to add cron job: %v", err))
	}
	if r.Description != "" {
		job.Payload.Description = r.Description
	}
	if r.Command != "" {
		job.Payload.Command = r.Command
	}
	if r.Description != "" || r.Command != "" {
		_ = s.cronService.UpdateJob(job)
	}
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	if !enabled {
		s.cronService.EnableJob(job.ID, false)
	}

	info := toCronJobInfo(job)
	return s.sendResponse(sessionID, req.Action, CronAddResponse{
		JobID: job.ID,
		Name:  job.Name,
		Job:   info,
	})
}

func toCronJobInfo(job *cron.CronJob) *CronJobInfo {
	if job == nil {
		return nil
	}
	info := &CronJobInfo{
		ID:           job.ID,
		Name:         job.Name,
		Description:  job.Payload.Description,
		Enabled:      job.Enabled,
		ScheduleKind: job.Schedule.Kind,
		EveryMS:      job.Schedule.EveryMS,
		CronExpr:     job.Schedule.Expr,
		AtMS:         job.Schedule.AtMS,
		Message:      job.Payload.Message,
		Command:      job.Payload.Command,
		Channel:      job.Payload.Channel,
		To:           job.Payload.To,
		NextRunAtMS:  job.State.NextRunAtMS,
		LastRunAtMS:  job.State.LastRunAtMS,
		LastStatus:   job.State.LastStatus,
		LastError:    job.State.LastError,
		CreatedAtMS:  job.CreatedAtMS,
		UpdatedAtMS:  job.UpdatedAtMS,
	}
	if job.Schedule.EveryMS != nil {
		everySec := *job.Schedule.EveryMS / 1000
		info.EverySeconds = &everySec
	}
	// Build schedule label
	switch job.Schedule.Kind {
	case "at":
		if job.Schedule.AtMS != nil {
			info.Schedule = fmt.Sprintf("at:%d", *job.Schedule.AtMS)
		}
	case "every":
		if job.Schedule.EveryMS != nil {
			info.Schedule = fmt.Sprintf("every:%d", *job.Schedule.EveryMS)
		}
	case "cron":
		info.Schedule = fmt.Sprintf("cron:%s", job.Schedule.Expr)
	}
	info.ScheduleType = job.Schedule.Kind
	return info
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
		info := toCronJobInfo(&job)
		if info != nil {
			jobInfos = append(jobInfos, *info)
		}
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

func (s *PetService) handleCronUpdate(sessionID string, req Request) error {
	if s.cronService == nil {
		return s.sendError(sessionID, req.Action, "cron service not initialized")
	}

	var r CronUpdateRequest
	if err := json.Unmarshal(req.Data, &r); err != nil {
		return s.sendError(sessionID, req.Action, "invalid cron update data")
	}

	if r.JobID == "" {
		return s.sendError(sessionID, req.Action, "job_id is required")
	}

	// 先获取原任务
	oldJob := s.cronService.GetJob(r.JobID)
	if oldJob == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("job %s not found", r.JobID))
	}

	// 原地更新字段
	if r.Name != "" {
		oldJob.Name = r.Name
	}
	if r.Description != "" {
		oldJob.Payload.Description = r.Description
	}
	message := r.Message
	if message == "" {
		message = r.Description
	}
	if message != "" {
		oldJob.Payload.Message = message
	}
	if r.Command != "" {
		oldJob.Payload.Command = r.Command
	}
	if r.Channel != "" {
		oldJob.Payload.Channel = r.Channel
	}
	if r.To != "" {
		oldJob.Payload.To = r.To
	}
	if r.Enabled != nil {
		oldJob.Enabled = *r.Enabled
	}

	// 更新调度
	if r.AtMS != nil && *r.AtMS > 0 {
		oldJob.Schedule = cron.CronSchedule{Kind: "at", AtMS: r.AtMS}
	} else if r.AtSeconds > 0 {
		atMS := time.Now().UnixMilli() + r.AtSeconds*1000
		oldJob.Schedule = cron.CronSchedule{Kind: "at", AtMS: &atMS}
	} else if r.EverySeconds > 0 {
		everyMS := r.EverySeconds * 1000
		oldJob.Schedule = cron.CronSchedule{Kind: "every", EveryMS: &everyMS}
	} else if r.CronExpr != "" {
		oldJob.Schedule = cron.CronSchedule{Kind: "cron", Expr: r.CronExpr}
	}

	if err := s.cronService.UpdateJob(oldJob); err != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to update cron job: %v", err))
	}

	// 如果 enabled 被设为 false，额外调用 Disable 以确保状态更新
	if r.Enabled != nil && !*r.Enabled {
		s.cronService.EnableJob(r.JobID, false)
	}

	info := toCronJobInfo(oldJob)
	resp := struct {
		Job *CronJobInfo `json:"job"`
	}{Job: info}
	return s.sendResponse(sessionID, req.Action, resp)
}

func enableDisableResponse(job *cron.CronJob) map[string]any {
	return map[string]any{
		"job_id":  job.ID,
		"enabled": job.Enabled,
		"job":     toCronJobInfo(job),
	}
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

	return s.sendResponse(sessionID, req.Action, enableDisableResponse(job))
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

	return s.sendResponse(sessionID, req.Action, enableDisableResponse(job))
}

// VoiceModelResponse 语音模型响应结构
type VoiceModelResponse struct {
	Name      string         `json:"name"`
	Provider  string         `json:"provider"`
	Model     string         `json:"model"`
	APIBase   string         `json:"api_base"`
	VoiceID   string         `json:"voice_id"`
	APIKey    string         `json:"api_key"`
	Extra     map[string]any `json:"extra"`
	Enabled   bool           `json:"enabled"`
	IsDefault bool           `json:"is_default"`
}

// VoiceModelListGetResponse 语音模型列表响应
type VoiceModelListGetResponse struct {
	Models  []VoiceModelResponse `json:"models"`
	Default string               `json:"default"`
}

// ASRModelResponse ASR 模型响应结构
type ASRModelResponse struct {
	Name      string         `json:"name"`
	Provider  string         `json:"provider"`
	Model     string         `json:"model"`
	APIBase   string         `json:"api_base"`
	APIKey    string         `json:"api_key"`
	Extra     map[string]any `json:"extra"`
	Enabled   bool           `json:"enabled"`
	IsDefault bool           `json:"is_default"`
}

// ASRModelListGetResponse ASR 模型列表响应
type ASRModelListGetResponse struct {
	Models  []ASRModelResponse `json:"models"`
	Default string             `json:"default"`
}

// ASRModelUpdateRequest ASR 模型更新请求
type ASRModelUpdateRequest struct {
	Name    string         `json:"name"`
	APIKey  string         `json:"api_key,omitempty"`
	APIBase string         `json:"api_base,omitempty"`
	Model   string         `json:"model,omitempty"`
	Enabled *bool          `json:"enabled,omitempty"`
	Extra   map[string]any `json:"extra,omitempty"`
}

// ASRModelSetDefaultRequest ASR 模型设置默认请求
type ASRModelSetDefaultRequest struct {
	Name string `json:"name"`
}

// ASRModelAddRequest 添加 ASR 模型请求
type ASRModelAddRequest struct {
	Name     string         `json:"name"`
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
	APIKey   string         `json:"api_key,omitempty"`
	APIBase  string         `json:"api_base,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
	Enabled  bool           `json:"enabled"`
}

func (s *PetService) handleASRModelListGet(sessionID string, req Request) error {
	if s.asrLoader == nil {
		return s.sendError(sessionID, req.Action, "ASR loader not initialized")
	}

	models := s.configManager.GetASRModelList()
	defaultModel := s.configManager.GetDefaultASRModelName()

	resp := ASRModelListGetResponse{
		Models:  make([]ASRModelResponse, 0, len(models)),
		Default: defaultModel,
	}

	for _, m := range models {
		resp.Models = append(resp.Models, ASRModelResponse{
			Name:      m.Name,
			Provider:  m.Provider,
			Model:     m.Model,
			APIBase:   m.APIBase,
			APIKey:    m.MaskedAPIKey(),
			Extra:     m.MaskedExtra(),
			Enabled:   m.Enabled,
			IsDefault: m.Name == defaultModel,
		})
	}

	return s.sendResponse(sessionID, req.Action, resp)
}

func (s *PetService) handleASRModelAdd(sessionID string, req Request) error {
	if s.asrLoader == nil {
		return s.sendError(sessionID, req.Action, "ASR loader not initialized")
	}

	var data ASRModelAddRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}
	if data.Provider == "" {
		return s.sendError(sessionID, req.Action, "provider is required")
	}

	if s.configManager.GetASRModel(data.Name) != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("ASR model %s already exists", data.Name))
	}

	newModel := &petconfig.ASRModelConfig{
		Name:     data.Name,
		Provider: data.Provider,
		Model:    data.Model,
		APIKey:   data.APIKey,
		APIBase:  data.APIBase,
		Extra:    data.Extra,
		Enabled:  data.Enabled,
	}

	s.configManager.AppendASRModel(newModel)
	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{
		"success": "true",
		"name":    data.Name,
	})
}

func (s *PetService) handleASRModelGet(sessionID string, req Request) error {
	if s.asrLoader == nil {
		return s.sendError(sessionID, req.Action, "ASR loader not initialized")
	}

	var data struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	model := s.configManager.GetASRModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("ASR model %s not found", data.Name))
	}

	return s.sendResponse(sessionID, req.Action, ASRModelResponse{
		Name:      model.Name,
		Provider:  model.Provider,
		Model:     model.Model,
		APIBase:   model.APIBase,
		APIKey:    model.MaskedAPIKey(),
		Extra:     model.MaskedExtra(),
		Enabled:   model.Enabled,
		IsDefault: model.Name == s.configManager.GetDefaultASRModelName(),
	})
}

func (s *PetService) handleASRModelUpdate(sessionID string, req Request) error {
	if s.asrLoader == nil {
		return s.sendError(sessionID, req.Action, "ASR loader not initialized")
	}

	var data ASRModelUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	model := s.configManager.GetASRModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("ASR model %s not found", data.Name))
	}

	if data.APIKey != "" {
		model.APIKey = data.APIKey
	}
	if data.APIBase != "" {
		model.APIBase = data.APIBase
	}
	if data.Model != "" {
		model.Model = data.Model
	}
	if data.Enabled != nil {
		model.Enabled = *data.Enabled
	}
	if data.Extra != nil {
		if model.Extra == nil {
			model.Extra = make(map[string]any)
		}
		for k, v := range data.Extra {
			model.Extra[k] = v
		}
	}

	if err := s.configManager.UpdateASRModel(model); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	needsSwitch := data.APIKey != "" || data.Extra != nil || data.Model != "" || data.APIBase != ""
	if needsSwitch && s.asrLoader.GetCurrentModel() == data.Name && model.Enabled {
		logger.Infof("pet ASR: config changed, reloading provider for %s", data.Name)
		if err := s.asrLoader.SwitchModel(data.Name, s.configManager); err != nil {
			logger.Warnf("pet ASR: failed to reload provider: %v", err)
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleASRModelSetDefault(sessionID string, req Request) error {
	if s.asrLoader == nil {
		return s.sendError(sessionID, req.Action, "ASR loader not initialized")
	}

	var data ASRModelSetDefaultRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	model := s.configManager.GetASRModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("ASR model %s not found", data.Name))
	}

	if !model.Enabled {
		return s.sendError(sessionID, req.Action, "cannot set disabled model as default")
	}

	s.configManager.SelectASRModel(data.Name)
	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if s.asrLoader.GetCurrentModel() != data.Name {
		if err := s.asrLoader.SwitchModel(data.Name, s.configManager); err != nil {
			logger.Warnf("pet ASR: failed to switch to %s: %v", data.Name, err)
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleASRModelDelete(sessionID string, req Request) error {
	if s.asrLoader == nil {
		return s.sendError(sessionID, req.Action, "ASR loader not initialized")
	}

	var data struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	models := s.configManager.GetASRModelList()
	if len(models) <= 1 {
		return s.sendError(sessionID, req.Action, "cannot delete the last model")
	}

	model := s.configManager.GetASRModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("ASR model %s not found", data.Name))
	}

	if err := s.configManager.DeleteASRModel(data.Name); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if s.asrLoader.GetCurrentModel() == data.Name {
		firstEnabled := ""
		for _, m := range models {
			if m.Name != data.Name && m.Enabled {
				firstEnabled = m.Name
				break
			}
		}
		if firstEnabled == "" {
			return s.sendError(sessionID, req.Action, "cannot delete the last enabled model; no fallback available")
		}
		if err := s.asrLoader.SwitchModel(firstEnabled, s.configManager); err != nil {
			return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to switch to fallback model: %v", err))
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleVoiceModelListGet(sessionID string, req Request) error {
	models := s.voiceLoader.ListModels()
	defaultModel := s.voiceLoader.GetCurrentModel()

	resp := VoiceModelListGetResponse{
		Models:  make([]VoiceModelResponse, 0, len(models)),
		Default: defaultModel,
	}

	for _, m := range models {
		resp.Models = append(resp.Models, VoiceModelResponse{
			Name:      m.Name,
			Provider:  m.Provider,
			Model:     m.Model,
			APIBase:   m.APIBase,
			VoiceID:   m.VoiceID,
			APIKey:    m.MaskedAPIKey(),
			Extra:     m.MaskedExtra(),
			Enabled:   m.Enabled,
			IsDefault: m.Name == defaultModel,
		})
	}

	return s.sendResponse(sessionID, req.Action, resp)
}

func (s *PetService) handleVoiceModelGet(sessionID string, req Request) error {
	var data struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	model := s.voiceLoader.GetModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("voice model %s not found", data.Name))
	}

	return s.sendResponse(sessionID, req.Action, VoiceModelResponse{
		Name:      model.Name,
		Provider:  model.Provider,
		Model:     model.Model,
		APIBase:   model.APIBase,
		VoiceID:   model.VoiceID,
		APIKey:    model.MaskedAPIKey(),
		Extra:     model.MaskedExtra(),
		Enabled:   model.Enabled,
		IsDefault: model.Name == s.voiceLoader.GetCurrentModel(),
	})
}

type VoiceModelUpdateRequest struct {
	Name     string         `json:"name"`
	Provider string         `json:"provider,omitempty"`
	APIKey   string         `json:"api_key,omitempty"`
	APIBase  string         `json:"api_base,omitempty"`
	Model    string         `json:"model,omitempty"`
	VoiceID  string         `json:"voice_id,omitempty"`
	Enabled  *bool          `json:"enabled,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
}

// VoiceModelAddRequest 添加语音模型请求
type VoiceModelAddRequest struct {
	Name     string         `json:"name"`
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
	APIKey   string         `json:"api_key,omitempty"`
	APIBase  string         `json:"api_base,omitempty"`
	VoiceID  string         `json:"voice_id,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
	Enabled  bool           `json:"enabled"`
}

func (s *PetService) handleVoiceModelAdd(sessionID string, req Request) error {
	if s.voiceLoader == nil {
		return s.sendError(sessionID, req.Action, "voice loader not initialized")
	}

	var data VoiceModelAddRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}
	if data.Provider == "" {
		return s.sendError(sessionID, req.Action, "provider is required")
	}

	if s.configManager.GetVoiceModel(data.Name) != nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("voice model %s already exists", data.Name))
	}

	newModel := &petconfig.VoiceModelConfig{
		Name:     data.Name,
		Provider: data.Provider,
		Model:    data.Model,
		APIKey:   data.APIKey,
		APIBase:  data.APIBase,
		VoiceID:  data.VoiceID,
		Extra:    data.Extra,
		Enabled:  data.Enabled,
	}

	s.configManager.AppendVoiceModel(newModel)
	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{
		"success": "true",
		"name":    data.Name,
	})
}

func (s *PetService) handleVoiceModelUpdate(sessionID string, req Request) error {
	var data VoiceModelUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	model := s.configManager.GetVoiceModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("voice model %s not found", data.Name))
	}

	if data.Provider != "" {
		model.Provider = data.Provider
	}
	if data.APIKey != "" {
		model.APIKey = data.APIKey
	}
	if data.APIBase != "" {
		model.APIBase = data.APIBase
	}
	if data.Model != "" {
		model.Model = data.Model
	}
	if data.VoiceID != "" {
		model.VoiceID = data.VoiceID
		// 同步更新当前角色的偏好音色
		if char := s.charManager.GetCurrent(); char != nil {
			privateCfg := s.configManager.GetCharacterPrivateConfig()
			if privateCfg != nil {
				privateCfg.VoiceModel = data.Name
				privateCfg.VoiceID = data.VoiceID
				s.configManager.SetCharacterPrivateConfig(privateCfg)
				if err := s.configManager.SavePrivateConfig(char.ID, privateCfg); err != nil {
					logger.Warnf("pet: failed to save character private config: %v", err)
				}
			}
		}
	}
	if data.Enabled != nil {
		model.Enabled = *data.Enabled
	}
	if data.Extra != nil {
		if model.Extra == nil {
			model.Extra = make(map[string]any)
		}
		for k, v := range data.Extra {
			model.Extra[k] = v
		}
	}

	if err := s.configManager.UpdateVoiceModel(model); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	needsSwitch := data.Provider != "" || data.APIKey != "" || data.Extra != nil || data.Model != "" || data.VoiceID != ""
	if needsSwitch && s.voiceLoader.GetCurrentModel() == data.Name {
		logger.Infof("pet voice: config changed, reloading provider for %s", data.Name)
		if err := s.voiceLoader.SwitchModel(data.Name, s.configManager); err != nil {
			logger.Warnf("pet voice: failed to reload provider: %v", err)
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

type VoiceModelDeleteRequest struct {
	Name string `json:"name"`
}

func (s *PetService) handleVoiceModelDelete(sessionID string, req Request) error {
	if s.voiceLoader == nil {
		return s.sendError(sessionID, req.Action, "voice loader not initialized")
	}

	var data VoiceModelDeleteRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	models := s.configManager.GetVoiceModelList()
	if len(models) <= 1 {
		return s.sendError(sessionID, req.Action, "cannot delete the last model")
	}

	model := s.configManager.GetVoiceModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("voice model %s not found", data.Name))
	}

	if err := s.configManager.DeleteVoiceModel(data.Name); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	if s.voiceLoader.GetCurrentModel() == data.Name {
		firstEnabled := ""
		for _, m := range models {
			if m.Name != data.Name && m.Enabled {
				firstEnabled = m.Name
				break
			}
		}
		if firstEnabled == "" {
			return s.sendError(sessionID, req.Action, "cannot delete the last enabled model; no fallback available")
		}
		if err := s.voiceLoader.SwitchModel(firstEnabled, s.configManager); err != nil {
			return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to switch to fallback model: %v", err))
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

type VoiceModelSetDefaultRequest struct {
	Name string `json:"name"`
}

func (s *PetService) handleVoiceModelSetDefault(sessionID string, req Request) error {
	if s.voiceLoader == nil {
		return s.sendError(sessionID, req.Action, "voice loader not initialized")
	}

	var data VoiceModelSetDefaultRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	model := s.configManager.GetVoiceModel(data.Name)
	if model == nil {
		return s.sendError(sessionID, req.Action, fmt.Sprintf("voice model %s not found", data.Name))
	}

	if !model.Enabled {
		return s.sendError(sessionID, req.Action, "cannot set disabled model as default")
	}

	s.configManager.SelectVoiceModel(data.Name)
	if err := s.configManager.SaveVoiceConfig(); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	// 同步更新当前角色的偏好模型
	if char := s.charManager.GetCurrent(); char != nil {
		privateCfg := s.configManager.GetCharacterPrivateConfig()
		if privateCfg != nil {
			privateCfg.VoiceModel = data.Name
			// VoiceID 保持不变（用户可能只想换模型，保留原音色）
			s.configManager.SetCharacterPrivateConfig(privateCfg)
			if err := s.configManager.SavePrivateConfig(char.ID, privateCfg); err != nil {
				logger.Warnf("pet: failed to save character private config: %v", err)
			}
		}
		if s.voiceLoader.GetCurrentModel() != data.Name {
			if err := s.voiceLoader.SwitchModel(data.Name, s.configManager); err != nil {
				logger.Warnf("pet voice: failed to switch to %s: %v", data.Name, err)
			}
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

type VoiceModelGetVoicesRequest struct {
	Provider  string `json:"provider"`
	Model     string `json:"model,omitempty"`
	APIKey    string `json:"api_key,omitempty"`
	SecretKey string `json:"secret_key,omitempty"`
}

func (s *PetService) handleVoiceModelGetVoices(sessionID string, req Request) error {
	var data VoiceModelGetVoicesRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Provider == "" {
		return s.sendError(sessionID, req.Action, "provider is required")
	}

	// 如果用户没提供凭证，从配置中获取
	apiKey := data.APIKey
	secretKey := data.SecretKey
	model := data.Model

	if apiKey == "" || secretKey == "" || model == "" {
		cfgModel := s.voiceLoader.GetModelByProvider(data.Provider)
		if cfgModel != nil {
			if apiKey == "" {
				if data.Provider == "minimax" {
					apiKey = voice.ResolveAPIKey(cfgModel.APIKey, cfgModel.Name)
				} else {
					if ak, ok := cfgModel.Extra["accessKeyId"].(string); ok {
						apiKey = voice.ResolveAPIKey(ak, cfgModel.Name)
					}
				}
			}
			if secretKey == "" {
				if sk, ok := cfgModel.Extra["secretAccessKey"].(string); ok {
					secretKey = voice.ResolveAPIKey(sk, cfgModel.Name)
				}
			}
			if model == "" {
				model = cfgModel.Model
			}
		}
	}

	result, err := voice.GetVoices(data.Provider, apiKey, secretKey, model)
	if err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, result)
}

func (s *PetService) handleSkillList(sessionID string, req Request) error {
	if s.skillsMgr == nil {
		return s.sendError(sessionID, req.Action, "skills manager not initialized")
	}

	skillsList := s.skillsMgr.ListSkills()
	return s.sendResponse(sessionID, req.Action, map[string]interface{}{
		"skills": skillsList,
	})
}

func (s *PetService) handleSkillSearch(sessionID string, req Request) error {
	if s.skillsMgr == nil {
		return s.sendError(sessionID, req.Action, "skills manager not initialized")
	}

	var data struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Query == "" {
		return s.sendError(sessionID, req.Action, "query is required")
	}

	if data.Limit <= 0 {
		data.Limit = 10
	}

	results, err := s.skillsMgr.SearchSkills(s.ctx, data.Query, data.Limit)
	if err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]interface{}{
		"results": results,
	})
}

func (s *PetService) handleSkillInstall(sessionID string, req Request) error {
	if s.skillsMgr == nil {
		return s.sendError(sessionID, req.Action, "skills manager not initialized")
	}

	var data struct {
		Slug     string `json:"slug"`
		Registry string `json:"registry"`
		Version  string `json:"version"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Slug == "" {
		return s.sendError(sessionID, req.Action, "slug is required")
	}
	if data.Registry == "" {
		data.Registry = "clawhub"
	}

	result, err := s.skillsMgr.InstallSkill(s.ctx, data.Slug, data.Registry, data.Version)
	if err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, result)
}

func (s *PetService) handleSkillRemove(sessionID string, req Request) error {
	if s.skillsMgr == nil {
		return s.sendError(sessionID, req.Action, "skills manager not initialized")
	}

	var data struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	if err := s.skillsMgr.RemoveSkill(data.Name); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"name": data.Name})
}

func (s *PetService) handleSkillGet(sessionID string, req Request) error {
	if s.skillsMgr == nil {
		return s.sendError(sessionID, req.Action, "skills manager not initialized")
	}

	var data struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	if data.Name == "" {
		return s.sendError(sessionID, req.Action, "name is required")
	}

	content, ok := s.skillsMgr.GetSkillContent(data.Name)
	if !ok {
		return s.sendError(sessionID, req.Action, "skill not found")
	}

	return s.sendResponse(sessionID, req.Action, map[string]interface{}{
		"name":    data.Name,
		"content": content,
	})
}

func (s *PetService) handleAudioFrame(sessionID string, req Request) error {
	var data AudioFrameRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid audio frame data")
	}

	if data.Audio == "" {
		return s.sendError(sessionID, req.Action, "audio data is empty")
	}

	if data.SessionKey == "" {
		return s.sendError(sessionID, req.Action, "session_key is required for voice input")
	}

	if data.Format != "" && data.Format != "pcm" {
		return s.sendError(sessionID, req.Action, "only pcm format is supported")
	}

	char := s.charManager.GetCurrent()
	if char == nil {
		return s.sendError(sessionID, req.Action, "no active character")
	}

	pcmData, err := base64.StdEncoding.DecodeString(data.Audio)
	if err != nil {
		return s.sendError(sessionID, req.Action, "failed to decode audio data")
	}

	sampleRate := data.SampleRate
	if sampleRate <= 0 {
		sampleRate = 16000
	}
	channels := data.Channels
	if channels <= 0 {
		channels = 1
	}

	chunk := bus.AudioChunk{
		SessionID:  sessionID,
		SessionKey: data.SessionKey,
		CharID:     char.ID,
		SpeakerID:  "pet_user",
		ChatID:     sessionID,
		Channel:    "pet",
		Sequence:   data.Sequence,
		Timestamp:  data.Timestamp,
		SampleRate: sampleRate,
		Channels:   channels,
		Format:     "pcm",
		Data:       pcmData,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	err = s.msgBus.PublishAudioChunk(ctx, chunk)
	cancel()
	if err != nil {
		errMsg := "语音识别失败，请重试"
		if errors.Is(err, context.DeadlineExceeded) {
			errMsg = "语音输入通道繁忙，请稍后重试"
		}
		if errors.Is(err, bus.ErrBusClosed) {
			errMsg = "语音通道未就绪，请重启应用后重试"
		}
		logger.ErrorCF("pet", "Failed to publish audio chunk", map[string]any{
			"error":      err.Error(),
			"session_id": sessionID,
			"sequence":   data.Sequence,
			"chat_id":    chunk.ChatID,
		})
		perr.Add(perr.LevelError, voice.CodeVoiceASR, err.Error(), nil)
		return s.sendError(sessionID, req.Action, errMsg)
	}

	return s.sendResponse(sessionID, req.Action, map[string]bool{"received": true})
}

type VoiceConfigGetResponse struct {
	ModelName         string `json:"model_name"`
	TTSModelName      string `json:"tts_model_name"`
	EchoTranscription bool   `json:"echo_transcription"`
}

type VoiceConfigUpdateRequest struct {
	ModelName         *string `json:"model_name,omitempty"`
	TTSModelName      *string `json:"tts_model_name,omitempty"`
	EchoTranscription *bool   `json:"echo_transcription,omitempty"`
}

func (s *PetService) handleVoiceConfigGet(sessionID string, req Request) error {
	if s.config.Config == nil {
		return s.sendError(sessionID, req.Action, "config not available")
	}

	return s.sendResponse(sessionID, req.Action, VoiceConfigGetResponse{
		ModelName:         s.config.Config.Voice.ModelName,
		TTSModelName:      s.config.Config.Voice.TTSModelName,
		EchoTranscription: s.config.Config.Voice.EchoTranscription,
	})
}

func (s *PetService) handleVoiceConfigUpdate(sessionID string, req Request) error {
	if s.config.Config == nil {
		return s.sendError(sessionID, req.Action, "config not available")
	}

	var data VoiceConfigUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid request data")
	}

	voiceCfg := &s.config.Config.Voice

	if data.ModelName != nil {
		voiceCfg.ModelName = *data.ModelName
	}
	if data.TTSModelName != nil {
		voiceCfg.TTSModelName = *data.TTSModelName
	}
	if data.EchoTranscription != nil {
		voiceCfg.EchoTranscription = *data.EchoTranscription
	}

	if s.config.ConfigPath != "" {
		if err := config.SaveConfig(s.config.ConfigPath, s.config.Config); err != nil {
			return s.sendError(sessionID, req.Action, fmt.Sprintf("failed to save config: %v", err))
		}
	}

	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleDebugWeeklyReport(sessionID string, req Request) error {
	if s.activityStore == nil || s.charManager == nil {
		return s.sendError(sessionID, req.Action, "activity store not initialized")
	}
	s.markSessionInteraction(sessionID)

	charID := s.charManager.GetCurrentID()
	now := time.Now()
	seedEvents := []*activity.Event{
		{
			ID:          activity.NewID(),
			CharacterID: charID,
			SessionID:   sessionID,
			Type:        activity.EventUserMessage,
			Category:    activity.CategoryDoc,
			Status:      activity.StatusDone,
			Title:       "整理主动性周报",
			Summary:     "整理主动性周报",
			CreatedAt:   now.Add(-2 * time.Hour),
		},
		{
			ID:          activity.NewID(),
			CharacterID: charID,
			SessionID:   sessionID,
			Type:        activity.EventTaskResult,
			Category:    activity.CategoryCode,
			Status:      activity.StatusDone,
			Title:       "完成打包修复",
			Summary:     "完成打包修复",
			CreatedAt:   now.Add(-90 * time.Minute),
		},
		{
			ID:          activity.NewID(),
			CharacterID: charID,
			SessionID:   sessionID,
			Type:        activity.EventTaskResult,
			Category:    activity.CategoryDoc,
			Status:      activity.StatusPending,
			Title:       "补充联调文档",
			Summary:     "补充联调文档",
			CreatedAt:   now.Add(-30 * time.Minute),
		},
	}
	for _, ev := range seedEvents {
		if err := s.activityStore.Append(ev); err != nil {
			return s.sendError(sessionID, req.Action, err.Error())
		}
	}

	snapshot := proactive.BuildSnapshot(now, proactive.SnapshotDependencies{
		ActivityStore:      s.activityStore,
		ConfigManager:      s.configManager,
		UserProfileManager: s.userProfileManager,
		CharacterProvider:  s.charManager,
		LastPushAt: func() time.Time {
			if s.proactiveManager == nil {
				return time.Time{}
			}
			return s.proactiveManager.LastPushAt()
		},
	})
	snapshot.EvaluationReason = "user_message"

	provider := proactive.NewWeeklyReportProvider(
		s.activityStore,
		proactive.NewWeeklyReportStateStore(s.WorkspacePath()),
	)
	intent, ok, err := provider.Evaluate(snapshot)
	if err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}
	if !ok || intent == nil {
		return s.sendError(sessionID, req.Action, "weekly report provider did not produce intent")
	}
	if err := s.deliverProactiveIntent(*intent, proactive.DeliveryCard); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}
	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

func (s *PetService) handleDebugProgressNudge(sessionID string, req Request) error {
	if s.activityStore == nil || s.charManager == nil {
		return s.sendError(sessionID, req.Action, "activity store not initialized")
	}
	s.markSessionInteraction(sessionID)

	charID := s.charManager.GetCurrentID()
	now := time.Now()
	ev := &activity.Event{
		ID:          activity.NewID(),
		CharacterID: charID,
		SessionID:   sessionID,
		Type:        activity.EventTaskResult,
		Category:    activity.CategoryCode,
		Status:      activity.StatusPending,
		Title:       "还有一段逻辑没收口",
		Summary:     "还有一段逻辑没收口",
		CreatedAt:   now.Add(-15 * time.Minute),
	}
	if err := s.activityStore.Append(ev); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}

	snapshot := proactive.BuildSnapshot(now, proactive.SnapshotDependencies{
		ActivityStore:      s.activityStore,
		ConfigManager:      s.configManager,
		UserProfileManager: s.userProfileManager,
		CharacterProvider:  s.charManager,
		LastPushAt: func() time.Time {
			if s.proactiveManager == nil {
				return time.Time{}
			}
			return s.proactiveManager.LastPushAt()
		},
	})
	snapshot.EvaluationReason = "user_message"

	provider := proactive.NewProgressNudgeProvider(
		s.activityStore,
		proactive.NewHistoryStore(s.WorkspacePath()),
	)
	intent, ok, err := provider.Evaluate(snapshot)
	if err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}
	if !ok || intent == nil {
		return s.sendError(sessionID, req.Action, "progress nudge provider did not produce intent")
	}
	if err := s.deliverProactiveIntent(*intent, proactive.DeliveryBubble); err != nil {
		return s.sendError(sessionID, req.Action, err.Error())
	}
	return s.sendResponse(sessionID, req.Action, map[string]string{"status": "ok"})
}

// ensureDefaultActions 注册内置默认动作（仅在同名动作不存在时注册）
// 这些动作对应 /pets/ 目录下的 GIF 文件，为 LLM 提供语义化动作选项。
func ensureDefaultActions(mgr *action.ActionManager) {
	defaults := []*action.Action{
		{
			Name:        "standby",
			Description: "平静待机，适合无特定情绪的日常回复",
			Expression:  "standby",
			EmotionTags: []string{"neutral"},
			Weight:      1.0,
		},
		{
			Name:        "happy",
			Description: "开心摇摆，适合夸赞用户、任务完成、收到好消息",
			Expression:  "happy",
			EmotionTags: []string{"joy", "happy"},
			Weight:      0.9,
		},
		{
			Name:        "sad",
			Description: "低落委屈，适合用户倾诉烦恼、任务失败、帮不上忙",
			Expression:  "sad",
			EmotionTags: []string{"sadness", "sad"},
			Weight:      0.8,
		},
		{
			Name:        "celebrate",
			Description: "庆祝跳出，适合重大完成、里程碑、用户取得突破",
			Expression:  "celebrate",
			EmotionTags: []string{"surprise", "joy"},
			Weight:      0.8,
		},
		{
			Name:        "shake-head",
			Description: "轻松摇头晃脑，适合轻快、随意、无压力的闲聊氛围",
			Expression:  "shake-head",
			EmotionTags: []string{"joy", "neutral"},
			Weight:      0.7,
		},
		{
			Name:        "listen",
			Description: "专注倾听，适合用户说了很长一段话、倾诉情绪、桌宠在等待",
			Expression:  "listen",
			EmotionTags: []string{"neutral"},
			Weight:      0.7,
		},
		{
			Name:        "stay-out",
			Description: "静置输出，适合平静陈述、信息传达、无明显情绪波动的回复",
			Expression:  "stay-out",
			EmotionTags: []string{"neutral"},
			Weight:      0.6,
		},
		{
			Name:        "think",
			Description: "思考中，适合处理信息、分析问题、回复前的思考停顿",
			Expression:  "think",
			EmotionTags: []string{"neutral"},
			Weight:      0.7,
		},
		{
			Name:        "search",
			Description: "搜索中，适合查找资料、检索信息、使用工具查询的场景",
			Expression:  "search",
			EmotionTags: []string{"neutral"},
			Weight:      0.7,
		},
	}
	for _, a := range defaults {
		_ = mgr.Register(a) // 同名已存在时 Register 返回 error，直接忽略
	}
}
