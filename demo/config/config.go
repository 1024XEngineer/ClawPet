package config

type Config struct {
	Server struct {
		Port string `json:"port"`
	} `json:"server"`

	DeepSeek struct {
		APIKey  string `json:"api_key"`
		BaseURL string `json:"base_url"`
		Model   string `json:"model"`
	} `json:"deepseek"`

	State struct {
		MaxContextSize int `json:"max_context_size"`
	} `json:"state"`
}

func NewDefaultConfig() *Config {
	cfg := &Config{}
	cfg.Server.Port = "8080"
	cfg.DeepSeek.BaseURL = "https://api.deepseek.com"
	cfg.DeepSeek.Model = "deepseek-chat"
	cfg.State.MaxContextSize = 10
	return cfg
}
