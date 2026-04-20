package memory

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/sipeed/picoclaw/pkg/logger"
)

// Store 记忆存储
// 使用SQLite数据库持久化存储角色的记忆信息
type Store struct {
	db *sql.DB
}

// Memory 记忆条目
// 代表角色的一条记忆
type Memory struct {
	ID          int64     // 记忆唯一ID
	CharacterID string    // 所属角色ID
	Content     string    // 记忆内容
	MemoryType  string    // 记忆类型
	Weight      int       // 权重 0-100
	CreatedAt   time.Time // 创建时间
	UpdatedAt   time.Time // 更新时间
}

// 记忆类型常量（实际存储时可使用任意字符串，类型由配置决定）
const (
	MemoryTypeConversation   = "conversation"    // 对话记忆
	MemoryTypePreference     = "preference"      // 宠物偏好
	MemoryTypeFact           = "fact"            // 事实知识
	MemoryTypeUserProfile    = "user_profile"    // 用户基础信息
	MemoryTypeUserPreference = "user_preference" // 用户偏好
)

// NewStore 创建记忆存储实例
// workspacePath: 工作区路径，数据库文件将创建在此目录下
func NewStore(workspacePath string) (*Store, error) {
	if err := os.MkdirAll(workspacePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	dbPath := filepath.Join(workspacePath, "pet_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	s := &Store{db: db}
	if err := s.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to init schema: %w", err)
	}

	logger.Infof("memory: store initialized at %s", dbPath)
	return s, nil
}

// initSchema 初始化数据库表结构
func (s *Store) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS memories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		character_id TEXT NOT NULL,
		content TEXT NOT NULL,
		memory_type TEXT NOT NULL,
		weight INTEGER DEFAULT 50,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_character_memories ON memories(character_id);
	CREATE INDEX IF NOT EXISTS idx_character_type ON memories(character_id, memory_type);
	CREATE INDEX IF NOT EXISTS idx_character_weight ON memories(character_id, weight);
	`
	_, err := s.db.Exec(schema)

	// 迁移：如果 weight 列不存在（已有旧数据库），添加该列
	_, _ = s.db.Exec("ALTER TABLE memories ADD COLUMN weight INTEGER DEFAULT 50")

	return err
}

// Add 添加新记忆
// characterID: 角色ID
// content: 记忆内容
// memoryType: 记忆类型（conversation/preference/fact）
// weight: 权重 0-100
func (s *Store) Add(characterID, content, memoryType string, weight int) (*Memory, error) {
	now := time.Now().Unix()

	result, err := s.db.Exec(
		"INSERT INTO memories (character_id, content, memory_type, weight, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		characterID, content, memoryType, weight, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert memory: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert id: %w", err)
	}

	return &Memory{
		ID:         id,
		Content:    content,
		MemoryType: memoryType,
		Weight:     weight,
		CreatedAt:  time.Unix(now, 0),
		UpdatedAt:  time.Unix(now, 0),
	}, nil
}

// List 获取角色的所有记忆
// 按更新时间倒序排列
func (s *Store) List(characterID string) ([]*Memory, error) {
	rows, err := s.db.Query(
		"SELECT id, character_id, content, memory_type, weight, created_at, updated_at FROM memories WHERE character_id = ? ORDER BY updated_at DESC",
		characterID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var m Memory
		var createdAt, updatedAt int64
		if err := rows.Scan(&m.ID, &m.CharacterID, &m.Content, &m.MemoryType, &m.Weight, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		m.CreatedAt = time.Unix(createdAt, 0)
		m.UpdatedAt = time.Unix(updatedAt, 0)
		memories = append(memories, &m)
	}

	return memories, nil
}

// ListByType 获取角色指定类型的所有记忆
// 按更新时间倒序排列
func (s *Store) ListByType(characterID, memoryType string) ([]*Memory, error) {
	rows, err := s.db.Query(
		"SELECT id, character_id, content, memory_type, weight, created_at, updated_at FROM memories WHERE character_id = ? AND memory_type = ? ORDER BY updated_at DESC",
		characterID, memoryType,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var m Memory
		var createdAt, updatedAt int64
		if err := rows.Scan(&m.ID, &m.CharacterID, &m.Content, &m.MemoryType, &m.Weight, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		m.CreatedAt = time.Unix(createdAt, 0)
		m.UpdatedAt = time.Unix(updatedAt, 0)
		memories = append(memories, &m)
	}

	return memories, nil
}

// Delete 删除指定记忆
func (s *Store) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM memories WHERE id = ?", id)
	return err
}

// DeleteCharacter 删除角色的所有记忆
func (s *Store) DeleteCharacter(characterID string) error {
	_, err := s.db.Exec("DELETE FROM memories WHERE character_id = ?", characterID)
	return err
}

// ListByWeight 获取角色记忆，按权重从高到低排序
func (s *Store) ListByWeight(characterID string, limit int) ([]*Memory, error) {
	rows, err := s.db.Query(
		"SELECT id, character_id, content, memory_type, weight, created_at, updated_at FROM memories WHERE character_id = ? ORDER BY weight DESC LIMIT ?",
		characterID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var m Memory
		var createdAt, updatedAt int64
		if err := rows.Scan(&m.ID, &m.CharacterID, &m.Content, &m.MemoryType, &m.Weight, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		m.CreatedAt = time.Unix(createdAt, 0)
		m.UpdatedAt = time.Unix(updatedAt, 0)
		memories = append(memories, &m)
	}

	return memories, nil
}

// ListBelowWeight 获取权重低于指定阈值的记忆
func (s *Store) ListBelowWeight(characterID string, threshold float64) ([]*Memory, error) {
	rows, err := s.db.Query(
		"SELECT id, character_id, content, memory_type, weight, created_at, updated_at FROM memories WHERE character_id = ? AND weight < ? ORDER BY weight ASC",
		characterID, threshold,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var m Memory
		var createdAt, updatedAt int64
		if err := rows.Scan(&m.ID, &m.CharacterID, &m.Content, &m.MemoryType, &m.Weight, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		m.CreatedAt = time.Unix(createdAt, 0)
		m.UpdatedAt = time.Unix(updatedAt, 0)
		memories = append(memories, &m)
	}

	return memories, nil
}

// DeleteByIDs 根据ID列表批量删除记忆
func (s *Store) DeleteByIDs(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	query := "DELETE FROM memories WHERE id IN ("
	args := make([]any, len(ids))
	for i, id := range ids {
		if i > 0 {
			query += ","
		}
		query += "?"
		args[i] = id
	}
	query += ")"
	_, err := s.db.Exec(query, args...)
	return err
}

// UpdateWeight 更新记忆权重
func (s *Store) UpdateWeight(id int64, weight int) error {
	_, err := s.db.Exec("UPDATE memories SET weight = ?, updated_at = ? WHERE id = ?", weight, time.Now().Unix(), id)
	return err
}

// Close 关闭数据库连接
func (s *Store) Close() error {
	return s.db.Close()
}
