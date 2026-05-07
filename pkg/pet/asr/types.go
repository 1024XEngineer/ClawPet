package asr

import (
	"sync"

	"github.com/sipeed/picoclaw/pkg/audio/asr"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/config"
)

// Loader ASR服务加载器
// 根据配置初始化ASR提供者
type Loader struct {
	cfg          *config.VoiceConfig
	transcriber  asr.Transcriber
	currentModel string
	mu           sync.RWMutex
	activeReqs   sync.WaitGroup
	closeOnce    sync.Once
	closed       bool
}

// ASRFactory ASR提供者工厂函数类型
type ASRFactory func(modelCfg *config.ASRModelConfig) asr.Transcriber

// providerRegistry 供应商注册表
var providerRegistry = make(map[string]ASRFactory)

// ConfigManager 配置管理器接口（用于持久化）
type ConfigManager interface {
	SelectASRModel(name string)
	SaveVoiceConfig() error
}

// RegisterProvider 注册 ASR 供应商
func RegisterProvider(name string, factory ASRFactory) {
	providerRegistry[name] = factory
	logger.DebugCF("pet-asr", "Registered provider", map[string]any{
		"provider": name,
	})
}

// GetCurrentTranscriber 返回当前ASR提供者
func (l *Loader) GetCurrentTranscriber() asr.Transcriber {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.transcriber
}

// GetCurrentModel 返回当前模型名称
func (l *Loader) GetCurrentModel() string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.currentModel
}

// IsEnabled 返回ASR是否启用
func (l *Loader) IsEnabled() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.cfg != nil && l.cfg.ASREnabled && l.transcriber != nil
}

// AcquireRequest 增加活跃请求计数
func (l *Loader) AcquireRequest() func() {
	l.activeReqs.Add(1)
	return func() {
		l.activeReqs.Done()
	}
}

// Close 关闭加载器
func (l *Loader) Close() error {
	l.closeOnce.Do(func() {
		l.mu.Lock()
		l.closed = true
		if l.transcriber != nil {
			// 等待活跃请求结束
			l.activeReqs.Wait()
			// 关闭transcriber（如果有Close方法）
			if c, ok := l.transcriber.(interface{ Close() error }); ok {
				_ = c.Close()
			}
			l.transcriber = nil
		}
		l.mu.Unlock()
	})
	return nil
}