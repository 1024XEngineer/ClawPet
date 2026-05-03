package userprofile

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/sipeed/picoclaw/pkg/pet/config"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/characters"
	"github.com/sipeed/picoclaw/pkg/pet/memory"
	"github.com/sipeed/picoclaw/pkg/providers"
)

const (
	ProfileFileName = "user_profile.json"
	StateFileName   = "user_state.json"
	UserDataDir     = ".picoclaw"
)

type Manager struct {
	profile   *UserProfile
	state     map[string]*UserState
	dataDir   string
	memStore  *memory.Store
	charMgr   *characters.Manager
	provider  providers.LLMProvider
	modelName string
}

func NewManager(dataDir string, memStore *memory.Store, charMgr *characters.Manager, provider providers.LLMProvider, modelName string) *Manager {
	return &Manager{
		profile:   nil,
		state:     make(map[string]*UserState),
		dataDir:   dataDir,
		memStore:  memStore,
		charMgr:   charMgr,
		provider:  provider,
		modelName: modelName,
	}
}

func (m *Manager) getUserDataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, UserDataDir)
}

func (m *Manager) profilePath() string {
	return filepath.Join(m.getUserDataDir(), ProfileFileName)
}

func (m *Manager) statePath(charID string) string {
	return filepath.Join(m.dataDir, config.WorkspacePath, charID, StateFileName)
}

func (m *Manager) ensureUserDataDir() error {
	dir := m.getUserDataDir()
	return os.MkdirAll(dir, 0755)
}

func (m *Manager) LoadProfile() *UserProfile {
	if m.profile != nil {
		return m.profile
	}

	m.profile = NewUserProfile()

	path := m.profilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return m.profile
		}
		logger.Errorf("userprofile: failed to read profile: %v", err)
		return m.profile
	}

	if err := json.Unmarshal(data, m.profile); err != nil {
		logger.Errorf("userprofile: failed to unmarshal profile: %v", err)
		return m.profile
	}

	if m.profile.Extra == nil {
		m.profile.Extra = make(map[string]any)
	}

	return m.profile
}

func (m *Manager) SaveProfile() error {
	if m.profile == nil {
		return fmt.Errorf("profile is nil")
	}

	m.profile.UpdatedAt = time.Now().Unix()

	if err := m.ensureUserDataDir(); err != nil {
		return fmt.Errorf("failed to ensure user data dir: %w", err)
	}

	data, err := json.MarshalIndent(m.profile, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal profile: %w", err)
	}

	if err := os.WriteFile(m.profilePath(), data, 0644); err != nil {
		return fmt.Errorf("failed to write profile: %w", err)
	}

	return nil
}

func (m *Manager) LoadState(charID string) *UserState {
	if state, ok := m.state[charID]; ok {
		return state
	}

	state := NewUserState()

	path := m.statePath(charID)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return state
		}
		logger.Errorf("userprofile: failed to read state for %s: %v", charID, err)
		return state
	}

	if err := json.Unmarshal(data, state); err != nil {
		logger.Errorf("userprofile: failed to unmarshal state for %s: %v", charID, err)
		return state
	}

	m.state[charID] = state
	return state
}

func (m *Manager) SaveState(charID string) error {
	state, ok := m.state[charID]
	if !ok {
		return fmt.Errorf("state not found for %s", charID)
	}

	state.LastAnalyzedAt = time.Now().Unix()

	charDir := filepath.Join(m.dataDir, charID)
	if err := os.MkdirAll(charDir, 0755); err != nil {
		return fmt.Errorf("failed to ensure char dir: %w", err)
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}

	if err := os.WriteFile(m.statePath(charID), data, 0644); err != nil {
		return fmt.Errorf("failed to write state: %w", err)
	}

	return nil
}

func (m *Manager) UpdateProfile(req *UserProfileUpdateRequest) {
	profile := m.LoadProfile()

	if req.DisplayName != "" {
		profile.DisplayName = req.DisplayName
	}
	if req.Role != "" {
		profile.Role = req.Role
	}
	if req.Language != "" {
		profile.Language = req.Language
	}
	if req.Chronotype != "" {
		profile.Chronotype = req.Chronotype
	}
	if req.PersonalityTone != "" {
		profile.PersonalityTone = req.PersonalityTone
	}
	if req.AnxietyLevel > 0 {
		profile.AnxietyLevel = req.AnxietyLevel
	}
	if req.PressureLevel != "" {
		profile.PressureLevel = req.PressureLevel
	}

	for k, v := range req.Extra {
		profile.Extra[k] = v
	}

	if err := m.SaveProfile(); err != nil {
		logger.Errorf("userprofile: failed to save profile: %v", err)
	}
}

func (m *Manager) formatChronotype(c string) string {
	switch c {
	case "morning":
		return "晨型（早起型）"
	case "balanced":
		return "均衡型"
	case "night":
		return "夜型（晚睡型）"
	default:
		return c
	}
}

func (m *Manager) formatAnxietyLevel(level int) string {
	if level >= 75 {
		return "高"
	}
	if level >= 45 {
		return "中"
	}
	return "低"
}

func (m *Manager) UpdateState(charID string, mood string, energy, engagement int, trend string) {
	state := m.LoadState(charID)

	if mood != "" {
		state.CurrentMood = mood
	}
	if energy > 0 {
		state.EnergyLevel = energy
	}
	if engagement > 0 {
		state.EngagementLevel = engagement
	}
	if trend != "" {
		state.StressTrend = trend
	}

	m.state[charID] = state

	if err := m.SaveState(charID); err != nil {
		logger.Errorf("userprofile: failed to save state: %v", err)
	}
}

func (m *Manager) IsProfileEmpty() bool {
	profile := m.LoadProfile()
	return profile.DisplayName == "" && profile.Role == ""
}

func (m *Manager) GetContextPrompt(charID string) string {
	profile := m.LoadProfile()
	state := m.LoadState(charID)

	var sb strings.Builder

	sb.WriteString("\n【用户档案】\n")

	hasProfile := false
	if profile.DisplayName != "" {
		sb.WriteString(fmt.Sprintf("  用户昵称：%s\n", profile.DisplayName))
		hasProfile = true
	}
	if profile.Role != "" {
		sb.WriteString(fmt.Sprintf("  身份/角色：%s\n", profile.Role))
		hasProfile = true
	}
	if profile.Language != "" {
		sb.WriteString(fmt.Sprintf("  语言偏好：%s\n", profile.Language))
		hasProfile = true
	}
	if profile.Chronotype != "" {
		sb.WriteString(fmt.Sprintf("  作息类型：%s\n", m.formatChronotype(profile.Chronotype)))
		hasProfile = true
	}
	if profile.PersonalityTone != "" {
		sb.WriteString(fmt.Sprintf("  期望对话风格：%s\n", profile.PersonalityTone))
		hasProfile = true
	}
	if profile.PressureLevel != "" {
		sb.WriteString(fmt.Sprintf("  当前压力等级：%s", profile.PressureLevel))
		if profile.AnxietyLevel > 0 {
			sb.WriteString(fmt.Sprintf("（焦虑指数 %d%%）", profile.AnxietyLevel))
		}
		sb.WriteString("\n")
		hasProfile = true
	}

	for k, v := range profile.Extra {
		sb.WriteString(fmt.Sprintf("  [%s]: %v\n", k, v))
		hasProfile = true
	}

	if !hasProfile {
		sb.WriteString("  （用户尚未完成画像设置）\n")
	}

	char := m.charMgr.GetCurrent()
	charName := ""
	if char != nil {
		charName = "（来自" + char.ID + "的感知）"
	}

	sb.WriteString("\n当前状态" + charName + "：\n")
	sb.WriteString(fmt.Sprintf("  情绪状态：%s\n", state.CurrentMood))
	sb.WriteString(fmt.Sprintf("  精力水平：%d%%\n", state.EnergyLevel))
	sb.WriteString(fmt.Sprintf("  互动意愿：%d%%\n", state.EngagementLevel))

	trendLabel := "稳定"
	switch state.StressTrend {
	case "rising":
		trendLabel = "上升中"
	case "falling":
		trendLabel = "下降中"
	case "stable":
		trendLabel = "稳定"
	}
	sb.WriteString(fmt.Sprintf("  压力趋势：%s\n", trendLabel))

	return sb.String()
}

func (m *Manager) AnalyzeAfterChat(charID, userMsg, petResp string) {
	if m.provider == nil || m.memStore == nil {
		return
	}

	prompt := fmt.Sprintf(`【用户情绪分析】
根据以下对话记录，分析用户的情绪事件（注意是记录过去发生的事件，而非当前状态）：

用户：%s
桌宠：%s

请返回JSON格式（不要有其他内容）：
{
  "event": "描述用户表现出的关键情绪事件，如'用户在讨论考试时表达了焦虑'或'用户在得到夸奖后情绪好转'",
  "current_mood": "stressed/relaxed/frustrated/engaged/bored/pleased/anxious/calm",
  "energy_level": 0-100,
  "engagement_level": 0-100,
  "stress_trend": "rising/falling/stable"
}`, userMsg, petResp)

	model := m.modelName
	if model == "" {
		model = m.provider.GetDefaultModel()
	}

	resp, err := m.provider.Chat(context.Background(), []providers.Message{
		{Role: "user", Content: prompt},
	}, nil, model, nil)
	if err != nil {
		logger.Warnf("userprofile: analysis failed: %v", err)
		return
	}

	m.parseAnalysisResult(charID, resp.Content)
}

func (m *Manager) parseAnalysisResult(charID, resp string) {
	mood := extractJSONField(resp, "current_mood")
	energy := extractJSONIntField(resp, "energy_level")
	engagement := extractJSONIntField(resp, "engagement_level")
	trend := extractJSONField(resp, "stress_trend")
	event := extractJSONField(resp, "event")

	if mood != "" || energy > 0 || engagement > 0 || trend != "" {
		m.UpdateState(charID, mood, energy, engagement, trend)
	}

	if event != "" && m.memStore != nil {
		char := m.charMgr.GetCurrent()
		if char != nil {
			m.memStore.Add(char.ID, event, memory.MemoryTypeUserPreference, 75)
			logger.Infof("userprofile: saved memory event for %s: %s", char.ID, event)
		}
	}
}

func extractJSONField(s, key string) string {
	prefix := fmt.Sprintf(`"%s":`, key)
	idx := strings.Index(s, prefix)
	if idx == -1 {
		prefix = fmt.Sprintf(`"%s": `, key)
		idx = strings.Index(s, prefix)
	}
	if idx == -1 {
		return ""
	}

	start := idx + len(prefix)
	for start < len(s) && (s[start] == ' ' || s[start] == '"') {
		start++
	}

	end := start
	for end < len(s) && s[end] != '"' && s[end] != ',' && s[end] != '\n' && s[end] != '}' {
		end++
	}

	if end > start {
		return s[start:end]
	}
	return ""
}

func extractJSONIntField(s, key string) int {
	field := extractJSONField(s, key)
	if field == "" {
		return 0
	}

	var val int
	fmt.Sscanf(field, "%d", &val)
	return val
}
