package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// resolveAndValidatePath 确保路径在指定的工作目录下，防止路径逃逸
func resolveAndValidatePath(workspace string, inputPath string) (string, error) {
	// 1. 获取 workspace 的绝对路径
	absWorkspace, err := filepath.Abs(workspace)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute workspace path: %v", err)
	}

	// 2. 规范化 absWorkspace，确保以分隔符结尾，防止前缀匹配绕过
	sep := string(filepath.Separator)
	if !strings.HasSuffix(absWorkspace, sep) {
		absWorkspace += sep
	}

	// 3. 处理输入路径，剥离可能的卷名或根路径标识，强制视为相对路径
	cleanInput := filepath.Clean(inputPath)
	if filepath.IsAbs(cleanInput) {
		vol := filepath.VolumeName(cleanInput)
		cleanInput = cleanInput[len(vol):]
		cleanInput = strings.TrimPrefix(cleanInput, string(filepath.Separator))
		cleanInput = strings.TrimPrefix(cleanInput, "/")
	}

	// 4. 拼接并获取绝对路径
	joinedPath := filepath.Join(absWorkspace, cleanInput)
	absPath, err := filepath.Abs(joinedPath)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %v", err)
	}

	// 5. 最终校验：必须以 absWorkspace 为前缀
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
