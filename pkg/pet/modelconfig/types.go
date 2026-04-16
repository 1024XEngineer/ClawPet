package modelconfig

type ModelInfo struct {
	Index          int            `json:"index"`
	ModelName      string         `json:"model_name"`
	Model          string         `json:"model"`
	APIBase        string         `json:"api_base,omitempty"`
	APIKey         string         `json:"api_key"`
	Proxy          string         `json:"proxy,omitempty"`
	AuthMethod     string         `json:"auth_method,omitempty"`
	ConnectMode    string         `json:"connect_mode,omitempty"`
	Workspace      string         `json:"workspace,omitempty"`
	RPM            int            `json:"rpm,omitempty"`
	MaxTokensField string         `json:"max_tokens_field,omitempty"`
	RequestTimeout int            `json:"request_timeout,omitempty"`
	ThinkingLevel  string         `json:"thinking_level,omitempty"`
	ExtraBody      map[string]any `json:"extra_body,omitempty"`
	Enabled        bool           `json:"enabled"`
	IsDefault      bool           `json:"is_default"`
	IsVirtual      bool           `json:"is_virtual"`
}

type ModelListResponse struct {
	Models       []ModelInfo `json:"models"`
	Total        int         `json:"total"`
	DefaultModel string      `json:"default_model"`
}

type AddModelRequest struct {
	ModelName      string         `json:"model_name"`
	Model          string         `json:"model"`
	APIKey         string         `json:"api_key,omitempty"`
	APIBase        string         `json:"api_base,omitempty"`
	Proxy          string         `json:"proxy,omitempty"`
	AuthMethod     string         `json:"auth_method,omitempty"`
	ConnectMode    string         `json:"connect_mode,omitempty"`
	Workspace      string         `json:"workspace,omitempty"`
	RPM            int            `json:"rpm,omitempty"`
	MaxTokensField string         `json:"max_tokens_field,omitempty"`
	RequestTimeout int            `json:"request_timeout,omitempty"`
	ThinkingLevel  string         `json:"thinking_level,omitempty"`
	ExtraBody      map[string]any `json:"extra_body,omitempty"`
}

type UpdateModelRequest struct {
	ModelName      string         `json:"model_name"`
	NewModel       string         `json:"new_model,omitempty"`
	APIKey         string         `json:"api_key,omitempty"`
	APIBase        string         `json:"api_base,omitempty"`
	Proxy          string         `json:"proxy,omitempty"`
	AuthMethod     string         `json:"auth_method,omitempty"`
	ConnectMode    string         `json:"connect_mode,omitempty"`
	Workspace      string         `json:"workspace,omitempty"`
	RPM            int            `json:"rpm,omitempty"`
	MaxTokensField string         `json:"max_tokens_field,omitempty"`
	RequestTimeout int            `json:"request_timeout,omitempty"`
	ThinkingLevel  string         `json:"thinking_level,omitempty"`
	ExtraBody      map[string]any `json:"extra_body,omitempty"`
}

type DeleteModelRequest struct {
	ModelName string `json:"model_name"`
}

type SetDefaultRequest struct {
	ModelName string `json:"model_name"`
}

type StatusResponse struct {
	Status string `json:"status"`
}
