package agent

import (
	"encoding/json"
)

// Tool 定义了 DeepSeek Function Calling 的工具接口
type Tool interface {
	Name() string
	Description() string
	Parameters() json.RawMessage
	Execute(args string) string
}
