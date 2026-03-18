package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// resolveAndValidatePath (严格模式) 确保路径在指定的工作目录下，防止任何形式的路径逃逸
func resolveAndValidatePath(workspace string, inputPath string) (string, error) {
	// 1. 获取 workspace 的绝对路径
	absWorkspace, err := filepath.Abs(workspace)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute workspace path: %v", err)
	}

	// 2. 确保以分隔符结尾，防止 "C:\workspace" 和 "C:\workspace_hacked" 的前缀匹配漏洞
	sep := string(filepath.Separator)
	if !strings.HasSuffix(absWorkspace, sep) {
		absWorkspace += sep
	}

	// 3. 清理输入的路径 (解决包含 ./ 和 ../ 的情况)
	cleanInput := filepath.Clean(inputPath)

	var targetPath string
	// 4. 核心逻辑：区分绝对路径和相对路径的处理方式
	if filepath.IsAbs(cleanInput) {
		// 如果 AI 显式提供了一个绝对路径，我们直接采用它，不做任何拼装！
		// 这样在第 5 步时，如果它不是以 workspace 开头，就会被无情拦截。
		targetPath = cleanInput
	} else {
		// 如果是相对路径，安全地拼接到 workspace 后面
		targetPath = filepath.Join(absWorkspace, cleanInput)
	}

	// 统一获取最终的绝对路径
	absPath, err := filepath.Abs(targetPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve absolute path: %v", err)
	}

	// 5. 最终死亡校验：最终的绝对路径，必须老老实实在 absWorkspace 的管辖范围内！
	if !strings.HasPrefix(absPath, absWorkspace) {
		return "", fmt.Errorf("security error: path traversal detected: %s", inputPath)
	}

	return absPath, nil
}

// ReadFileTool 读取文件工具
type ReadFileTool struct {
	Workspace string
}

func (t *ReadFileTool) Name() string {
	return "read_file"
}

func (t *ReadFileTool) Description() string {
	return "Read the content of a file from the local workspace"
}

func (t *ReadFileTool) Parameters() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"path": {
				"type": "string",
				"description": "The relative path to the file within the workspace"
			}
		},
		"required": ["path"]
	}`)
}

func (t *ReadFileTool) Execute(args string) string {
	var input struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return fmt.Sprintf("Error parsing arguments: %v", err)
	}

	workspace := t.Workspace
	if workspace == "" {
		workspace = "./workspace"
	}

	safePath, err := resolveAndValidatePath(workspace, input.Path)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}

	content, err := os.ReadFile(safePath)
	if err != nil {
		return fmt.Sprintf("Error reading file: %v", err)
	}

	return string(content)
}

// WriteFileTool 写入文件工具
type WriteFileTool struct {
	Workspace string
}

func (t *WriteFileTool) Name() string {
	return "write_file"
}

func (t *WriteFileTool) Description() string {
	return "Write content to a file in the local workspace. Creates directories if they do not exist."
}

func (t *WriteFileTool) Parameters() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"path": {
				"type": "string",
				"description": "The relative path to the file within the workspace"
			},
			"content": {
				"type": "string",
				"description": "The content to write to the file"
			}
		},
		"required": ["path", "content"]
	}`)
}

func (t *WriteFileTool) Execute(args string) string {
	var input struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return fmt.Sprintf("Error parsing arguments: %v", err)
	}

	workspace := t.Workspace
	if workspace == "" {
		workspace = "./workspace"
	}

	safePath, err := resolveAndValidatePath(workspace, input.Path)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}

	// 自动创建父级目录
	dir := filepath.Dir(safePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Sprintf("Error creating directories: %v", err)
	}

	if err := os.WriteFile(safePath, []byte(input.Content), 0644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}

	return fmt.Sprintf("Successfully wrote to file: %s", input.Path)
}
