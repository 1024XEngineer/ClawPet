package pet

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/pet/action"
	"github.com/sipeed/picoclaw/pkg/pet/emotion"
)

type PushHandler func(push any)

type VoiceToggleHandler func(enabled bool)

type PetService struct {
	msgBus      *bus.MessageBus
	config      PetServiceConfig
	pushHandler PushHandler

	voiceToggleHandler VoiceToggleHandler

	characterStore *CharacterStore
	emotionEngine  *emotion.EmotionEngine
	actionManager  *action.ActionManager

	appConfig    AppConfig
	connSessions map[string]string

	mu sync.RWMutex

	ctx         context.Context
	cancel      context.CancelFunc
	decayTicker *time.Ticker
}

type PetServiceConfig struct {
	WorkspacePath string
}

func NewPetService(msgBus *bus.MessageBus, cfg PetServiceConfig) *PetService {
	ctx, cancel := context.WithCancel(context.Background())
	s := &PetService{
		msgBus:        msgBus,
		config:        cfg,
		emotionEngine: emotion.NewEmotionEngine(cfg.WorkspacePath),
		actionManager: action.NewActionManager(cfg.WorkspacePath),
		appConfig:     AppConfig{EmotionEnabled: true, ReminderEnabled: true, ProactiveCare: true, Language: "zh-CN"},
		connSessions:  make(map[string]string),
		ctx:           ctx,
		cancel:        cancel,
	}

	if cfg.WorkspacePath != "" {
		s.characterStore = GetCharacterStoreWithPath(cfg.WorkspacePath)
		if err := s.characterStore.Load(); err != nil {
			fmt.Printf("pet: failed to load character: %v\n", err)
		}

		if err := s.emotionEngine.Load(); err != nil {
			fmt.Printf("pet: failed to load emotion state: %v\n", err)
		}

		if err := s.actionManager.Load(); err != nil {
			fmt.Printf("pet: failed to load actions: %v\n", err)
		}
	}

	return s
}

// Start 启动 PetService，定时执行情绪衰减
func (s *PetService) Start() {
	s.decayTicker = time.NewTicker(5 * time.Second)
	go s.runEmotionDecay()
	fmt.Println("pet: PetService started, emotion decay ticker running")
}

// runEmotionDecay 定时执行情绪衰减
func (s *PetService) runEmotionDecay() {
	for {
		select {
		case <-s.ctx.Done():
			fmt.Println("pet: emotion decay ticker stopped")
			return
		case <-s.decayTicker.C:
			s.emotionEngine.ApplyDecay(5 * time.Second)
			if shouldPush, push := s.emotionEngine.ShouldPush(); shouldPush {
				s.Push(push)
			}
		}
	}
}

// Stop 停止 PetService
func (s *PetService) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	if s.decayTicker != nil {
		s.decayTicker.Stop()
	}
	fmt.Println("pet: PetService stopped")
}

func (s *PetService) CharacterStore() *CharacterStore {
	return s.characterStore
}

func (s *PetService) EmotionEngine() *emotion.EmotionEngine {
	return s.emotionEngine
}

func (s *PetService) ActionManager() *action.ActionManager {
	return s.actionManager
}

func (s *PetService) SetPushHandler(handler PushHandler) {
	s.pushHandler = handler
}

func (s *PetService) SetVoiceToggleHandler(handler VoiceToggleHandler) {
	s.voiceToggleHandler = handler
}

func (s *PetService) IsVoiceToggleEnabled() bool {
	return s.voiceToggleHandler != nil
}

func (s *PetService) Push(push any) {
	if s.pushHandler != nil {
		s.pushHandler(push)
	}
}

// PushToolStart 推送工具开始执行
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

// PushToolEnd 推送工具执行完成
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

// PushInitStatus 推送初始化状态
func (s *PetService) PushInitStatus(sessionID string) {
	needConfig := s.characterStore == nil || !s.characterStore.IsOnboardingComplete()

	var character *CharacterConfig
	var mbti MBTIConfig
	var emotionState EmotionState

	if !needConfig && s.characterStore != nil {
		char := s.characterStore.Get()
		character = &CharacterConfig{
			PetID:          char.PetID,
			PetName:        char.Name,
			PetPersona:     char.Persona,
			PetPersonaType: char.PersonaType,
			Avatar:         char.Avatar,
		}
		personality := s.emotionEngine.GetPersonality()
		mbti = MBTIConfig{
			IE: personality.IE,
			SN: personality.SN,
			TF: personality.TF,
			JP: personality.JP,
		}
		emotions := s.emotionEngine.GetEmotions()
		dominantEmotion, emotionScore := s.emotionEngine.GetDominantEmotion()
		emotionState = EmotionState{
			PetID:       char.PetID,
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
		NeedConfig:   needConfig,
		HasCharacter: !needConfig,
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
	case ActionCharacterGet:
		return s.handleCharacterGet(sessionID, req)
	case ActionCharacterUpdate:
		return s.handleCharacterUpdate(sessionID, req)
	case ActionConfigGet:
		return s.handleConfigGet(sessionID, req)
	case ActionConfigUpdate:
		return s.handleConfigUpdate(sessionID, req)
	case ActionEmotionGet:
		return s.handleEmotionGet(sessionID, req)
	case ActionHealthCheck:
		return s.handleHealthCheck(sessionID, req)
	case ActionVoiceToggle:
		return s.handleVoiceToggle(sessionID, req)
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

	if s.characterStore != nil {
		char := &Character{
			Name:        data.PetName,
			Persona:     data.PetPersona,
			PersonaType: data.PetPersonaType,
			Avatar:      "default",
		}
		if err := s.characterStore.Update(char); err != nil {
			return s.sendError(sessionID, req.Action, err.Error())
		}
	}

	return s.sendResponse(sessionID, req.Action, OnboardingConfigResponse{PetID: "pet_001"})
}

func (s *PetService) handleCharacterGet(sessionID string, req Request) error {
	if s.characterStore == nil {
		return s.sendError(sessionID, req.Action, "character store not available")
	}

	char := s.characterStore.Get()
	charConfig := CharacterConfig{
		PetID:          char.PetID,
		PetName:        char.Name,
		PetPersona:     char.Persona,
		PetPersonaType: char.PersonaType,
		Avatar:         char.Avatar,
		CreatedAt:      char.CreatedAt.Format(time.RFC3339),
		UpdatedAt:      char.UpdatedAt.Format(time.RFC3339),
	}
	return s.sendResponse(sessionID, req.Action, charConfig)
}

func (s *PetService) handleCharacterUpdate(sessionID string, req Request) error {
	var data CharacterUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid character data")
	}

	if s.characterStore != nil {
		char := &Character{
			Name:        data.PetName,
			Persona:     data.PetPersona,
			PersonaType: data.PetPersonaType,
		}
		if err := s.characterStore.Update(char); err != nil {
			return s.sendError(sessionID, req.Action, err.Error())
		}
		char = s.characterStore.Get()
		data.PetID = char.PetID
	}

	return s.sendResponse(sessionID, req.Action, data)
}

func (s *PetService) handleConfigGet(sessionID string, req Request) error {
	s.mu.RLock()
	cfg := AppConfig{
		EmotionEnabled:           s.appConfig.EmotionEnabled,
		ReminderEnabled:          s.appConfig.ReminderEnabled,
		ProactiveCare:            s.appConfig.ProactiveCare,
		ProactiveIntervalMinutes: s.appConfig.ProactiveIntervalMinutes,
		VoiceEnabled:             s.appConfig.VoiceEnabled,
		Language:                 s.appConfig.Language,
	}
	s.mu.RUnlock()

	return s.sendResponse(sessionID, req.Action, cfg)
}

func (s *PetService) handleConfigUpdate(sessionID string, req Request) error {
	var data ConfigUpdateRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		return s.sendError(sessionID, req.Action, "invalid config data")
	}

	s.mu.Lock()
	if data.EmotionEnabled != nil {
		s.appConfig.EmotionEnabled = *data.EmotionEnabled
	}
	if data.ReminderEnabled != nil {
		s.appConfig.ReminderEnabled = *data.ReminderEnabled
	}
	if data.ProactiveCare != nil {
		s.appConfig.ProactiveCare = *data.ProactiveCare
	}
	if data.ProactiveIntervalMinutes != nil {
		s.appConfig.ProactiveIntervalMinutes = *data.ProactiveIntervalMinutes
	}
	if data.VoiceEnabled != nil {
		s.appConfig.VoiceEnabled = *data.VoiceEnabled
	}
	if data.Language != nil {
		s.appConfig.Language = *data.Language
	}
	cfg := AppConfig{
		EmotionEnabled:           s.appConfig.EmotionEnabled,
		ReminderEnabled:          s.appConfig.ReminderEnabled,
		ProactiveCare:            s.appConfig.ProactiveCare,
		ProactiveIntervalMinutes: s.appConfig.ProactiveIntervalMinutes,
		VoiceEnabled:             s.appConfig.VoiceEnabled,
		Language:                 s.appConfig.Language,
	}
	s.mu.Unlock()

	return s.sendResponse(sessionID, req.Action, cfg)
}

func (s *PetService) handleEmotionGet(sessionID string, req Request) error {
	emotions := s.emotionEngine.GetEmotions()
	dominantEmotion, emotionScore := s.emotionEngine.GetDominantEmotion()

	var petID string
	if s.characterStore != nil {
		petID = s.characterStore.Get().PetID
	}
	if petID == "" {
		petID = "pet_001"
	}

	emo := EmotionState{
		PetID:       petID,
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

// EmotionDescriptions 情绪描述映射表
// 索引：0=<20, 1=20-50, 2=50-80, 3=>80
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

// GetEmotionDescription 根据情绪名称和分数返回描述
func GetEmotionDescription(emotion string, score int) string {
	// 中性情绪直接返回平静
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

func mustMarshal(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{"error": "marshal error"}`)
	}
	return data
}

func (s *PetService) handleVoiceToggle(sessionID string, req Request) error {
	if s.voiceToggleHandler == nil {
		return s.sendError(sessionID, req.Action, "voice toggle not available")
	}

	var toggleReq VoiceToggleRequest
	if err := json.Unmarshal(req.Data, &toggleReq); err != nil {
		return s.sendError(sessionID, req.Action, "invalid voice toggle data")
	}

	s.voiceToggleHandler(toggleReq.Enabled)

	return s.sendResponse(sessionID, req.Action, VoiceToggleResponse{VoiceEnabled: toggleReq.Enabled})
}
