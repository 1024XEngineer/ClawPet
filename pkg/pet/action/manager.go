package action

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// 数据结构定义
// =============================================================================

// Action 动作定义
// 表示一个可触发的动作，包含动作名称、描述和对应的表情
type Action struct {
	// ID: 唯一标识符，UUID格式
	ID string `json:"id"`

	// Name: 动作名称，用于LLM调用和客户端识别
	// 格式示例："wave"、"happy_dance"、"thinking"
	Name string `json:"name"`

	// Description: 动作描述，供LLM理解何时选用该动作
	Description string `json:"description"`

	// Expression: 对应的表情/动画标识
	// 前端根据此字段播放对应的Live2D表情或动画
	Expression string `json:"expression"`

	// EmotionTags: 该动作适用的情绪标签，辅助LLM选择
	EmotionTags []string `json:"emotion_tags,omitempty"`

	// Weight: 动作优先权重 0.0-1.0，越高越容易被选中
	Weight float64 `json:"weight,omitempty"`

	// CreatedAt: 创建时间戳（Unix时间）
	CreatedAt int64 `json:"created_at"`
}

// =============================================================================
// 持久化常量
// =============================================================================

const (
	// ActionsFile 动作库文件名
	// 存储位置: {workspacePath}/pet/actions.json
	ActionsFile = "actions.json"

	// Version 持久化版本号
	Version = 1
)

// ActionsSnapshot 动作库快照
// 用于将动作库持久化到JSON文件
type ActionsSnapshot struct {
	Version int       `json:"version"` // 格式版本号
	Actions []*Action `json:"actions"` // 动作列表
}

// =============================================================================
// 动作管理器
// =============================================================================

// ActionManager 动作管理器
// 负责管理桌宠的所有可用动作
type ActionManager struct {
	// actions: 动作映射表，key为动作名称
	actions map[string]*Action

	// persistPath: 持久化存储路径
	persistPath string

	// mu: 读写锁，保证并发安全
	mu sync.RWMutex
}

// =============================================================================
// 构造函数
// =============================================================================

// NewActionManager 创建动作管理器实例
// 参数：
//   - persistPath: 持久化存储路径，如 "/home/user/picoclaw"
//     如果为空，则不进行持久化存储
func NewActionManager(persistPath string) *ActionManager {
	return &ActionManager{
		actions:     make(map[string]*Action),
		persistPath: persistPath,
	}
}

// =============================================================================
// 注册与注销
// =============================================================================

// Register 注册新动作
// 参数：
//   - action: 要注册的动作指针
//
// 行为：
//   - 如果action.ID为空，自动生成UUID
//   - 如果action.CreatedAt为0，自动设置为当前时间
//   - 如果同名动作已存在，返回错误
//   - 注册成功后自动保存到文件
//
// 注意：
//   - 动作名称(Name)必须唯一
//   - 线程安全
func (m *ActionManager) Register(action *Action) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 自动生成ID
	if action.ID == "" {
		action.ID = uuid.New().String()
	}
	// 自动设置创建时间
	if action.CreatedAt == 0 {
		action.CreatedAt = time.Now().Unix()
	}

	// 检查是否已存在
	if _, exists := m.actions[action.Name]; exists {
		return fmt.Errorf("action %s already exists", action.Name)
	}

	// 注册并保存
	m.actions[action.Name] = action
	return m.saveToFile()
}

// Unregister 注销动作
// 参数：
//   - name: 要注销的动作名称
//
// 行为：
//   - 如果动作不存在，返回错误
//   - 注销成功后自动保存
//
// 注意：
//   - 线程安全
func (m *ActionManager) Unregister(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 检查是否存在
	if _, exists := m.actions[name]; !exists {
		return fmt.Errorf("action %s not found", name)
	}

	// 删除并保存
	delete(m.actions, name)
	return m.saveToFile()
}

// =============================================================================
// 查询方法
// =============================================================================

// Get 根据名称获取动作
// 参数：
//   - name: 动作名称
//
// 返回：
//   - *Action: 动作指针，如果不存在则nil
//   - bool: 是否存在
//
// 注意：
//   - 线程安全（读操作）
func (m *ActionManager) Get(name string) (*Action, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	action, ok := m.actions[name]
	return action, ok
}

// List 获取所有动作
// 返回：
//   - []*Action: 所有动作的切片
//
// 注意：
//   - 返回的是拷贝，不影响内部状态
//   - 线程安全（读操作）
func (m *ActionManager) List() []*Action {
	m.mu.RLock()
	defer m.mu.RUnlock()

	actions := make([]*Action, 0, len(m.actions))
	for _, action := range m.actions {
		actions = append(actions, action)
	}
	return actions
}

// Update 更新动作信息
// 参数：
//   - name: 要更新的动作名称
//   - description: 新的描述（如果为空则不更新）
//   - expression: 新的表情标识（如果为空则不更新）
//
// 返回：
//   - error: 更新失败时返回错误
//
// 注意：
//   - 只更新非空字段
//   - 线程安全
func (m *ActionManager) Update(name string, description, expression string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	action, exists := m.actions[name]
	if !exists {
		return fmt.Errorf("action %s not found", name)
	}

	// 只更新非空字段
	if description != "" {
		action.Description = description
	}
	if expression != "" {
		action.Expression = expression
	}

	return m.saveToFile()
}

// GetByNames 批量获取动作
// 参数：
//   - names: 动作名称数组
//
// 返回：
//   - []*Action: 存在的动作切片（不存在的会被忽略）
//
// 注意：
//   - 线程安全（读操作）
func (m *ActionManager) GetByNames(names []string) []*Action {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var actions []*Action
	for _, name := range names {
		if action, ok := m.actions[name]; ok {
			actions = append(actions, action)
		}
	}
	return actions
}

// =============================================================================
// 标签解析
// =============================================================================

// ParseActionTags 从文本中解析动作标签
// 参数：
//   - text: 包含动作标签的文本
//
// 返回：
//   - []string: 解析出的动作名称数组
//
// LLM标签格式：
//
//	[action:wave]
//	[action:happy_dance]
//
// 查找范围：
//
//	扫描文本中所有匹配 [action:xxx] 模式的标签
//
// 示例输入：
//
//	"你好呀[action:wave]，今天天气真好[action:happy_dance]"
//
// 示例输出：
//
//	["wave", "happy_dance"]
func (m *ActionManager) ParseActionTags(text string) []string {
	var actions []string
	lines := splitLines(text)

	for _, line := range lines {
		// 查找 [action: 位置
		idx := indexOf(line, "[action:")
		for idx != -1 {
			// 查找对应的 ]
			endIdx := indexOf(line[idx:], "]")
			if endIdx != -1 {
				// 提取标签并解析动作名
				tagStr := line[idx : idx+endIdx+1]
				actionName := extractActionName(tagStr)
				if actionName != "" {
					actions = append(actions, actionName)
				}
				// 查找下一个 [action:
				nextIdx := indexOf(line[idx+endIdx+1:], "[action:")
				if nextIdx != -1 {
					idx = idx + endIdx + 1 + nextIdx
				} else {
					break
				}
			} else {
				break
			}
		}
	}

	return actions
}

// =============================================================================
// 持久化方法
// =============================================================================

// Load 从文件加载动作库
// 加载路径: {persistPath}/pet/actions.json
//
// 调用时机：
//   - ActionManager初始化时
//
// 行为：
//   - 如果文件不存在，使用空动作库
//   - 合并加载的动作到现有列表（同名覆盖）
//
// 注意：
//   - 线程安全
func (m *ActionManager) Load() error {
	if m.persistPath == "" {
		return nil
	}

	filePath := filepath.Join(m.persistPath, "pet", ActionsFile)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read actions file: %w", err)
	}

	var snapshot ActionsSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return fmt.Errorf("unmarshal actions: %w", err)
	}

	// 合并到现有列表
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, act := range snapshot.Actions {
		m.actions[act.Name] = act
	}

	return nil
}

// saveToFile 保存动作库到文件
// 保存路径: {persistPath}/pet/actions.json
//
// 注意：
//   - 假设调用者已持有写锁
//   - 如果persistPath为空，不进行保存
func (m *ActionManager) saveToFile() error {
	if m.persistPath == "" {
		return nil
	}

	// 创建目录
	dir := filepath.Join(m.persistPath, "pet")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create actions dir: %w", err)
	}

	// 收集所有动作
	actions := make([]*Action, 0, len(m.actions))
	for _, action := range m.actions {
		actions = append(actions, action)
	}

	// 构建快照
	snapshot := ActionsSnapshot{
		Version: Version,
		Actions: actions,
	}

	// 写入文件
	filePath := filepath.Join(dir, ActionsFile)
	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal actions: %w", err)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("write actions file: %w", err)
	}

	return nil
}

// =============================================================================
// 辅助函数
// =============================================================================

// splitLines 按行分割字符串
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// indexOf 字符串查找
func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// extractActionName 从标签中提取动作名称
// 参数：
//   - tag: 标签字符串，如 "[action:wave]"
//
// 返回：
//   - 动作名称，如 "wave"
//
// 格式检查：
//   - 必须以 "[action:" 开头
//   - 必须以 "]" 结尾
//   - 最小长度 10 ([action:x])
func extractActionName(tag string) string {
	if len(tag) < 10 {
		return ""
	}
	if tag[:8] != "[action:" || tag[len(tag)-1] != ']' {
		return ""
	}
	return tag[8 : len(tag)-1]
}
