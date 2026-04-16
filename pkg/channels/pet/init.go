package pet

import (
	"path/filepath"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/channels"
	"github.com/sipeed/picoclaw/pkg/config"
)

// init 注册 pet channel 工厂函数到 ChannelManager
// 在 package 初始化时自动调用，将 "pet" 字符串与工厂函数关联
func init() {
	// 注册工厂函数到 ChannelManager
	// 工厂函数会在 ChannelManager 创建 pet channel 时调用
	channels.RegisterFactory("pet", func(cfg *config.Config, b *bus.MessageBus) (channels.Channel, error) {
		// 检查是否启用 pet channel
		if !cfg.Channels.Pet.Enabled {
			return nil, nil // 不启用则返回 nil
		}

		// 获取 workspace 路径
		// 优先使用 PetConfig 中的配置，否则使用全局配置
		workspacePath := cfg.Channels.Pet.WorkspacePath
		if workspacePath == "" {
			workspacePath = cfg.WorkspacePath()
		}

		// 获取 picoclaw 配置路径
		configPath := filepath.Join(config.GetHome(), "config.json")

		// 创建并返回 pet channel 实例
		return NewPetChannel(cfg.Channels.Pet, b, workspacePath, cfg, configPath)
	})
}
