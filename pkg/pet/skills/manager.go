package skills

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/skills"
)

type PushHandler func(push Push)

type Push struct {
	Type      string      `json:"type"`
	PushType  string      `json:"push_type"`
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
}

type Manager struct {
	loader      *skills.SkillsLoader
	registryMgr *skills.RegistryManager
	installer   *skills.SkillInstaller
	workspace   string
	cfg         *config.Config
	pushHandler PushHandler
}

func NewManager(cfg *config.Config) (*Manager, error) {
	workspace := cfg.WorkspacePath()
	globalDir := config.GetHome()
	globalSkillsDir := filepath.Join(globalDir, "skills")

	builtinDir := os.Getenv(config.EnvBuiltinSkills)
	if builtinDir == "" {
		wd, _ := os.Getwd()
		builtinDir = filepath.Join(wd, "skills")
	}

	loader := skills.NewSkillsLoader(workspace, globalSkillsDir, builtinDir)

	var registryMgr *skills.RegistryManager
	if cfg != nil {
		clawHubConfig := cfg.Tools.Skills.Registries.ClawHub
		registryMgr = skills.NewRegistryManagerFromConfig(skills.RegistryConfig{
			MaxConcurrentSearches: cfg.Tools.Skills.MaxConcurrentSearches,
			ClawHub: skills.ClawHubConfig{
				Enabled:         clawHubConfig.Enabled,
				BaseURL:         clawHubConfig.BaseURL,
				AuthToken:       clawHubConfig.AuthToken.String(),
				SearchPath:      clawHubConfig.SearchPath,
				SkillsPath:      clawHubConfig.SkillsPath,
				DownloadPath:    clawHubConfig.DownloadPath,
				Timeout:         clawHubConfig.Timeout,
				MaxZipSize:      clawHubConfig.MaxZipSize,
				MaxResponseSize: clawHubConfig.MaxResponseSize,
			},
		})
	}

	githubToken := ""
	proxy := ""
	if cfg != nil {
		githubToken = cfg.Tools.Skills.Github.Token.String()
		proxy = cfg.Tools.Skills.Github.Proxy
	}
	installer, err := skills.NewSkillInstaller(workspace, githubToken, proxy)
	if err != nil {
		logger.WarnCF("pet-skills", "failed to create skill installer", map[string]any{"error": err.Error()})
	}

	return &Manager{
		loader:      loader,
		registryMgr: registryMgr,
		installer:   installer,
		workspace:   workspace,
		cfg:         cfg,
	}, nil
}

func (m *Manager) ListSkills() []skills.SkillInfo {
	return m.loader.ListSkills()
}

func (m *Manager) GetSkillContent(name string) (string, bool) {
	return m.loader.LoadSkill(name)
}

func (m *Manager) SearchSkills(ctx context.Context, query string, limit int) ([]skills.SearchResult, error) {
	if m.registryMgr == nil {
		return nil, fmt.Errorf("registry manager not initialized")
	}
	return m.registryMgr.SearchAll(ctx, query, limit)
}

func (m *Manager) InstallSkill(ctx context.Context, slug, registry, version string) (*InstallResult, error) {
	if m.registryMgr == nil {
		return nil, fmt.Errorf("registry manager not initialized")
	}

	reg := m.registryMgr.GetRegistry(registry)
	if reg == nil {
		return nil, fmt.Errorf("registry %q not found", registry)
	}

	skillsRoot := filepath.Join(m.workspace, "skills")
	targetDir := filepath.Join(skillsRoot, slug)

	if _, err := os.Stat(targetDir); err == nil {
		return nil, fmt.Errorf("skill %q already exists", slug)
	}

	if err := os.MkdirAll(skillsRoot, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create skills directory: %w", err)
	}

	result, err := reg.DownloadAndInstall(ctx, slug, version, targetDir)
	if err != nil {
		return nil, fmt.Errorf("failed to install skill: %w", err)
	}

	return result, nil
}

func (m *Manager) RemoveSkill(name string) error {
	skills := m.loader.ListSkills()
	for _, skill := range skills {
		if skill.Name != name {
			continue
		}
		if skill.Source != "workspace" {
			return fmt.Errorf("only workspace skills can be deleted")
		}
		if err := os.RemoveAll(filepath.Dir(skill.Path)); err != nil {
			return fmt.Errorf("failed to delete skill: %w", err)
		}
		return nil
	}
	return fmt.Errorf("skill %q not found", name)
}

func (m *Manager) GetRegistryManager() *skills.RegistryManager {
	return m.registryMgr
}

func (m *Manager) GetInstaller() *skills.SkillInstaller {
	return m.installer
}

type InstallResult = skills.InstallResult

type SearchResult = skills.SearchResult
type SkillInfo = skills.SkillInfo
