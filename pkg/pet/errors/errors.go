package errors

const (
	LevelError = "error"
	LevelWarn  = "warn"
	LevelInfo  = "info"
)

type ErrorPush struct {
	Level     string         `json:"level"`
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Timestamp int64          `json:"timestamp"`
	Context   map[string]any `json:"context,omitempty"`
}

type PetError struct {
	Level   string
	Code    string
	Message string
	Context map[string]any
	Time    int64
}

type PushHandler func(ErrorPush)
