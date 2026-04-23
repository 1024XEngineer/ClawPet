package config

import (
	"os"
	"path/filepath"
	"testing"
)

// TestDefaultPetConfig 测试默认Pet配置
// 验证DefaultPetConfig返回正确默认值的配置
func TestDefaultPetConfig(t *testing.T) {
	cfg := DefaultPetConfig()

	if len(cfg.Characters) != 1 {
		t.Errorf("Characters length=%d, want 1", len(cfg.Characters))
	}
	if cfg.ActiveID != "pet_001" {
		t.Errorf("ActiveID=%q, want %q", cfg.ActiveID, "pet_001")
	}
	if cfg.Voice == nil {
		t.Error("Voice should not be nil")
	}
	if cfg.App == nil {
		t.Error("App should not be nil")
	}
}

// TestDefaultAppConfig 测试默认应用配置
// 验证DefaultAppConfig返回正确的默认值（情绪启用、提醒启用、主动关怀启用等）
func TestDefaultAppConfig(t *testing.T) {
	cfg := DefaultAppConfig()

	if !cfg.EmotionEnabled {
		t.Error("EmotionEnabled should be true")
	}
	if !cfg.ReminderEnabled {
		t.Error("ReminderEnabled should be true")
	}
	if !cfg.ProactiveCare {
		t.Error("ProactiveCare should be true")
	}
	if cfg.ProactiveIntervalMinutes != 30 {
		t.Errorf("ProactiveIntervalMinutes=%d, want 30", cfg.ProactiveIntervalMinutes)
	}
	if cfg.VoiceEnabled {
		t.Error("VoiceEnabled should be false")
	}
	if cfg.Language != "zh-CN" {
		t.Errorf("Language=%q, want %q", cfg.Language, "zh-CN")
	}
}

// TestDefaultCharacterConfig 测试默认角色配置
// 验证DefaultCharacterConfig返回正确的默认值
func TestDefaultCharacterConfig(t *testing.T) {
	cfg := DefaultCharacterConfig()

	if cfg.ID != "pet_001" {
		t.Errorf("ID=%q, want %q", cfg.ID, "pet_001")
	}
	if cfg.Name != "艾莉" {
		t.Errorf("Name=%q, want %q", cfg.Name, "艾莉")
	}
	if cfg.PersonaType != "gentle" {
		t.Errorf("PersonaType=%q, want %q", cfg.PersonaType, "gentle")
	}
}

// TestDefaultEmotionState 测试默认情绪状态
// 验证DefaultEmotionState返回六维情绪都为50（中性）的状态
func TestDefaultEmotionState(t *testing.T) {
	state := DefaultEmotionState()

	if state.Joy != 50 {
		t.Errorf("Joy=%d, want 50", state.Joy)
	}
	if state.Anger != 50 {
		t.Errorf("Anger=%d, want 50", state.Anger)
	}
	if state.Sadness != 50 {
		t.Errorf("Sadness=%d, want 50", state.Sadness)
	}
}

// TestDefaultMBTI 测试默认MBTI配置
// 验证DefaultMBTI返回四维都为50（中性）的配置
func TestDefaultMBTI(t *testing.T) {
	mbti := DefaultMBTI()

	if mbti.IE != 50.0 {
		t.Errorf("IE=%f, want 50.0", mbti.IE)
	}
	if mbti.SN != 50.0 {
		t.Errorf("SN=%f, want 50.0", mbti.SN)
	}
	if mbti.TF != 50.0 {
		t.Errorf("TF=%f, want 50.0", mbti.TF)
	}
	if mbti.JP != 50.0 {
		t.Errorf("JP=%f, want 50.0", mbti.JP)
	}
}

// TestDefaultVoiceConfig 测试默认语音配置
// 验证DefaultVoiceConfig返回正确的默认值
func TestDefaultVoiceConfig(t *testing.T) {
	cfg := DefaultVoiceConfig()

	if len(cfg.ModelList) != 0 {
		t.Errorf("ModelList length=%d, want 0", len(cfg.ModelList))
	}
	if cfg.DefaultModel != "" {
		t.Errorf("DefaultModel=%q, want empty", cfg.DefaultModel)
	}
	if cfg.ASREnabled {
		t.Error("ASREnabled should be false")
	}
}

// TestEmotionState_ToSixEmotions 测试情绪状态转换
// 验证EmotionState能够正确转换为SixEmotions结构
func TestEmotionState_ToSixEmotions(t *testing.T) {
	state := &EmotionState{
		Joy:      80,
		Anger:    20,
		Sadness:  60,
		Disgust:  30,
		Surprise: 70,
		Fear:     40,
	}

	six := state.ToSixEmotions()
	if six.Joy != 80 {
		t.Errorf("Joy=%d, want 80", six.Joy)
	}
	if six.Anger != 20 {
		t.Errorf("Anger=%d, want 20", six.Anger)
	}
}

// TestNewConfigLoader 测试创建配置加载器
// 验证NewConfigLoader返回有效的加载器实例
func TestNewConfigLoader(t *testing.T) {
	loader := NewConfigLoader("/tmp/test")
	if loader == nil {
		t.Fatal("NewConfigLoader returned nil")
	}
	if loader.WorkspacePath() != "/tmp/test" {
		t.Errorf("WorkspacePath=%q, want %q", loader.WorkspacePath(), "/tmp/test")
	}
}

// TestConfigLoader_Load_NotExist 测试加载不存在的配置文件
// 验证配置文件不存在时使用默认配置
func TestConfigLoader_Load_NotExist(t *testing.T) {
	loader := NewConfigLoader("/nonexistent/path")
	err := loader.Load()
	if err != nil {
		t.Errorf("Load failed: %v", err)
	}

	cfg := loader.GetConfig()
	if cfg == nil {
		t.Fatal("GetConfig returned nil after Load")
	}
	if cfg.ActiveID != "pet_001" {
		t.Errorf("ActiveID=%q, want pet_001", cfg.ActiveID)
	}
}

// TestConfigLoader_SaveAndLoad 测试配置保存和加载
// 验证配置能够保存到文件并重新加载
func TestConfigLoader_SaveAndLoad(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	err = loader.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	loader2 := NewConfigLoader(tmpDir)
	err = loader2.Load()
	if err != nil {
		t.Fatalf("Load2 failed: %v", err)
	}

	if loader2.GetActiveID() != "pet_001" {
		t.Errorf("ActiveID=%q, want %q", loader2.GetActiveID(), "pet_001")
	}
}

// TestConfigLoader_GetCharacters 测试获取角色列表
// 验证能够获取配置中的角色列表
func TestConfigLoader_GetCharacters(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	chars := loader.GetCharacters()
	if len(chars) == 0 {
		t.Fatal("GetCharacters returned empty")
	}
	if chars[0].ID != "pet_001" {
		t.Errorf("First character ID=%q, want pet_001", chars[0].ID)
	}
}

// TestConfigLoader_GetVoice 测试获取语音配置
// 验证能够获取语音配置
func TestConfigLoader_GetVoice(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	voice := loader.GetVoice()
	if voice == nil {
		t.Fatal("GetVoice returned nil")
	}
}

// TestConfigLoader_GetApp 测试获取应用配置
// 验证能够获取应用配置
func TestConfigLoader_GetApp(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	app := loader.GetApp()
	if app == nil {
		t.Fatal("GetApp returned nil")
	}
	if !app.EmotionEnabled {
		t.Error("EmotionEnabled should be true")
	}
}

// TestConfigLoader_LoadCharacterPrivateConfig_NotExist 测试加载不存在的私有配置
// 验证不存在时返回默认私有配置
func TestConfigLoader_LoadCharacterPrivateConfig_NotExist(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	cfg, err := loader.LoadCharacterPrivateConfig("nonexistent_id")
	if err != nil {
		t.Fatalf("LoadCharacterPrivateConfig failed: %v", err)
	}
	if cfg == nil {
		t.Fatal("LoadCharacterPrivateConfig returned nil")
	}
	if cfg.ID != "nonexistent_id" {
		t.Errorf("ID=%q, want %q", cfg.ID, "nonexistent_id")
	}
}

// TestConfigLoader_SaveCharacterPrivateConfig 测试保存角色私有配置
// 验证私有配置能够保存到文件并重新加载
func TestConfigLoader_SaveCharacterPrivateConfig(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	cfg := &CharacterPrivateConfig{
		ID: "test_char",
		EmotionState: &EmotionState{
			Joy: 80,
		},
		MBTI: &MBTIConfig{
			IE: 30,
		},
	}

	err = loader.SaveCharacterPrivateConfig(cfg)
	if err != nil {
		t.Fatalf("SaveCharacterPrivateConfig failed: %v", err)
	}

	loaded, err := loader.LoadCharacterPrivateConfig("test_char")
	if err != nil {
		t.Fatalf("LoadCharacterPrivateConfig failed: %v", err)
	}
	if loaded.EmotionState.Joy != 80 {
		t.Errorf("Joy=%d, want 80", loaded.EmotionState.Joy)
	}
}

// TestEnsureDefaultConfig 测试确保默认配置存在
// 验证能够在指定目录下创建默认配置文件
func TestEnsureDefaultConfig(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	err = EnsureDefaultConfig(tmpDir)
	if err != nil {
		t.Fatalf("EnsureDefaultConfig failed: %v", err)
	}

	configPath := filepath.Join(tmpDir, PetConfigFile)
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Error("PetConfigFile was not created")
	}
}

// TestConfigLoader_GetVoiceModelConfig 测试获取语音模型配置
// 验证能够根据名称获取语音模型配置
func TestConfigLoader_GetVoiceModelConfig(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	model := loader.GetVoiceModelConfig("nonexistent")
	if model != nil {
		t.Error("GetVoiceModelConfig should return nil for nonexistent model")
	}
}

// TestConfigLoader_GetDefaultVoiceModel 测试获取默认语音模型
// 验证当没有设置默认模型时返回nil
func TestConfigLoader_GetDefaultVoiceModel(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewConfigLoader(tmpDir)
	loader.Load()

	model := loader.GetDefaultVoiceModel()
	if model != nil {
		t.Error("GetDefaultVoiceModel should return nil when no default model is set")
	}
}
