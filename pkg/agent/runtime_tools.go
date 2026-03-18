package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

// BashExecTool 运行时执行工具
type BashExecTool struct{}

func (t *BashExecTool) Name() string {
	return "bash_exec"
}

func (t *BashExecTool) Description() string {
	return "Execute a bash command on the local system. Returns combined stdout and stderr. Execution is capped at 30 seconds."
}

func (t *BashExecTool) Parameters() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"command": {
				"type": "string",
				"description": "The bash command to execute, e.g. 'ls -la' or 'go version'"
			}
		},
		"required": ["command"]
	}`)
}

func (t *BashExecTool) Execute(args string) string {
	var input struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return fmt.Sprintf("Error parsing arguments: %v", err)
	}

	// 1. 设置 30 秒超时 Context
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 2. 准备执行命令
	// 在 Windows 上，通常需要使用 'cmd /c' 或 'powershell -Command'
	// 但根据需求，我们统一使用 'bash -c'。请确保环境中有 bash (如 Git Bash 或 WSL)
	cmd := exec.CommandContext(ctx, "bash", "-c", input.Command)

	// 3. 捕获合并的输出 (stdout + stderr)
	output, err := cmd.CombinedOutput()

	// 4. 处理结果
	if err != nil {
		// 如果超时，ctx.Err() 会有值
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Sprintf("Error: Command timed out after 30 seconds.\nOutput so far: %s", string(output))
		}
		// 返回错误详情供 AI 纠错
		return fmt.Sprintf("Command failed: %v\nOutput: %s", err, string(output))
	}

	return string(output)
}
