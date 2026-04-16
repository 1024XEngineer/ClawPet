package modelconfig

import (
	"errors"

	"github.com/sipeed/picoclaw/pkg/config"
)

type Manager struct {
	configPath string
}

func NewManager(configPath string) *Manager {
	return &Manager{configPath: configPath}
}

func (m *Manager) List() (*ModelListResponse, error) {
	cfg, err := config.LoadConfig(m.configPath)
	if err != nil {
		return nil, err
	}

	defaultModel := cfg.Agents.Defaults.GetModelName()
	models := make([]ModelInfo, 0, len(cfg.ModelList))

	for i, mc := range cfg.ModelList {
		models = append(models, ModelInfo{
			Index:          i,
			ModelName:      mc.ModelName,
			Model:          mc.Model,
			APIBase:        mc.APIBase,
			APIKey:         MaskAPIKey(mc.APIKey()),
			Proxy:          mc.Proxy,
			AuthMethod:     mc.AuthMethod,
			ConnectMode:    mc.ConnectMode,
			Workspace:      mc.Workspace,
			RPM:            mc.RPM,
			MaxTokensField: mc.MaxTokensField,
			RequestTimeout: mc.RequestTimeout,
			ThinkingLevel:  mc.ThinkingLevel,
			ExtraBody:      mc.ExtraBody,
			Enabled:        mc.Enabled,
			IsDefault:      mc.ModelName == defaultModel,
			IsVirtual:      mc.IsVirtual(),
		})
	}

	return &ModelListResponse{
		Models:       models,
		Total:        len(models),
		DefaultModel: defaultModel,
	}, nil
}

func (m *Manager) Add(req *AddModelRequest) error {
	if req.ModelName == "" {
		return errors.New("model_name is required")
	}
	if req.Model == "" {
		return errors.New("model is required")
	}

	cfg, err := config.LoadConfig(m.configPath)
	if err != nil {
		return err
	}

	mc := &config.ModelConfig{
		ModelName:      req.ModelName,
		Model:          req.Model,
		APIBase:        req.APIBase,
		Proxy:          req.Proxy,
		AuthMethod:     req.AuthMethod,
		ConnectMode:    req.ConnectMode,
		Workspace:      req.Workspace,
		RPM:            req.RPM,
		MaxTokensField: req.MaxTokensField,
		RequestTimeout: req.RequestTimeout,
		ThinkingLevel:  req.ThinkingLevel,
		ExtraBody:      req.ExtraBody,
		Enabled:        true,
	}

	if req.APIKey != "" {
		mc.SetAPIKey(req.APIKey)
	}

	cfg.ModelList = append(cfg.ModelList, mc)

	return config.SaveConfig(m.configPath, cfg)
}

func (m *Manager) Update(req *UpdateModelRequest) error {
	if req.ModelName == "" {
		return errors.New("model_name is required")
	}

	cfg, err := config.LoadConfig(m.configPath)
	if err != nil {
		return err
	}

	idx := -1
	for i, mc := range cfg.ModelList {
		if mc.ModelName == req.ModelName {
			idx = i
			break
		}
	}
	if idx == -1 {
		return errors.New("model not found")
	}

	mc := cfg.ModelList[idx]

	if req.NewModel != "" {
		mc.Model = req.NewModel
	}
	if req.APIBase != "" {
		mc.APIBase = req.APIBase
	}
	if req.Proxy != "" {
		mc.Proxy = req.Proxy
	}
	if req.AuthMethod != "" {
		mc.AuthMethod = req.AuthMethod
	}
	if req.ConnectMode != "" {
		mc.ConnectMode = req.ConnectMode
	}
	if req.Workspace != "" {
		mc.Workspace = req.Workspace
	}
	if req.RPM > 0 {
		mc.RPM = req.RPM
	}
	if req.MaxTokensField != "" {
		mc.MaxTokensField = req.MaxTokensField
	}
	if req.RequestTimeout > 0 {
		mc.RequestTimeout = req.RequestTimeout
	}
	if req.ThinkingLevel != "" {
		mc.ThinkingLevel = req.ThinkingLevel
	}
	if req.APIKey != "" {
		mc.SetAPIKey(req.APIKey)
	}
	if req.ExtraBody != nil {
		mc.ExtraBody = req.ExtraBody
	}

	return config.SaveConfig(m.configPath, cfg)
}

func (m *Manager) Delete(req *DeleteModelRequest) error {
	if req.ModelName == "" {
		return errors.New("model_name is required")
	}

	cfg, err := config.LoadConfig(m.configPath)
	if err != nil {
		return err
	}

	newList := make([]*config.ModelConfig, 0, len(cfg.ModelList))
	found := false
	for _, mc := range cfg.ModelList {
		if mc.ModelName == req.ModelName {
			found = true
			if cfg.Agents.Defaults.ModelName == req.ModelName {
				cfg.Agents.Defaults.ModelName = ""
			}
			continue
		}
		newList = append(newList, mc)
	}

	if !found {
		return errors.New("model not found")
	}

	cfg.ModelList = newList
	return config.SaveConfig(m.configPath, cfg)
}

func (m *Manager) SetDefault(req *SetDefaultRequest) error {
	if req.ModelName == "" {
		return errors.New("model_name is required")
	}

	cfg, err := config.LoadConfig(m.configPath)
	if err != nil {
		return err
	}

	found := false
	isVirtual := false
	for _, mc := range cfg.ModelList {
		if mc.ModelName == req.ModelName {
			found = true
			isVirtual = mc.IsVirtual()
			break
		}
	}
	if !found {
		return errors.New("model not found")
	}
	if isVirtual {
		return errors.New("cannot set virtual model as default")
	}

	cfg.Agents.Defaults.ModelName = req.ModelName
	return config.SaveConfig(m.configPath, cfg)
}
