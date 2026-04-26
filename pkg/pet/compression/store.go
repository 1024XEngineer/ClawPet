package compression

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/sipeed/picoclaw/pkg/logger"
)

// ConversationStore 对话存储
// 持久化存储对话记录，支持软删除
// 数据库文件：pet_conversation.db
type ConversationStore struct {
	db        *sql.DB             // SQLite 数据库连接
	threshold int                 // 触发压缩的消息数阈值
	callback  OnThresholdCallback // 达到阈值时的回调
	mu        sync.RWMutex        // 读写锁
	migrated  bool                // 是否已完成数据库迁移
}

// NewConversationStore 创建对话存储实例
// workspacePath: 工作区路径，数据库文件将创建在此目录下
// threshold: 触发压缩的消息数阈值
// callback: 达到阈值时的回调函数
func NewConversationStore(workspacePath string, threshold int, callback OnThresholdCallback) (*ConversationStore, error) {
	if threshold <= 0 {
		threshold = DefaultThreshold
	}

	// 确保目录存在
	if err := os.MkdirAll(workspacePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	// 打开数据库
	dbPath := filepath.Join(workspacePath, "pet_conversation.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	s := &ConversationStore{
		db:        db,
		threshold: threshold,
		callback:  callback,
	}

	if err := s.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to init schema: %w", err)
	}

	logger.Infof("compression: conversation store initialized at %s", dbPath)
	return s, nil
}

// initSchema 初始化数据库表结构
// conversations 表字段说明：
//   - id: 自增主键
//   - character_id: 角色ID
//   - session_id: 会话ID
//   - role: 对话角色 (user/pet)
//   - content: 对话内容
//   - compressed: 是否已压缩 (0/1)
//   - created_at: 创建时间戳
//   - deleted_at: 软删除时间戳 (NULL表示未删除)
func (s *ConversationStore) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS conversations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		character_id TEXT NOT NULL,
		session_id TEXT NOT NULL DEFAULT '',
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		compressed INTEGER DEFAULT 0,
		created_at INTEGER NOT NULL,
		deleted_at INTEGER DEFAULT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_character_conversations ON conversations(character_id);
	CREATE INDEX IF NOT EXISTS idx_compressed ON conversations(character_id, compressed);
	CREATE INDEX IF NOT EXISTS idx_character_session ON conversations(character_id, session_id);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}

	return nil
}

// migrateAddSessionIDIfNeeded 添加 session_id 列到已存在的表（如果需要）
// 应该在持有锁的情况下调用
func (s *ConversationStore) migrateAddSessionIDIfNeeded() error {
	// 检查 session_id 列是否存在
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='session_id'").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check session_id column: %w", err)
	}

	// 如果列不存在，添加它
	if count == 0 {
		logger.Info("compression: migrating database to add session_id column")
		if _, err := s.db.Exec("ALTER TABLE conversations ADD COLUMN session_id TEXT NOT NULL DEFAULT ''"); err != nil {
			return fmt.Errorf("failed to add session_id column: %w", err)
		}
		logger.Info("compression: session_id column added successfully")
	}

	return nil
}

// Add 添加新对话
// characterID: 角色ID
// sessionID: 会话ID
// role: 对话角色 (user/pet)
// content: 对话内容
// 添加成功后异步检查是否达到压缩阈值
func (s *ConversationStore) Add(characterID, sessionID, role, content string) error {
	// 首次写入前检查并迁移数据库结构（在锁外执行，只执行一次）
	if !s.migrated {
		if err := s.migrateAddSessionIDIfNeeded(); err != nil {
			logger.Warnf("compression: failed to migrate session_id column: %v", err)
		}
		s.migrated = true
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().Unix()
	_, err := s.db.Exec(
		"INSERT INTO conversations (character_id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
		characterID, sessionID, role, content, now,
	)
	if err != nil {
		return fmt.Errorf("failed to insert conversation: %w", err)
	}

	// 异步检查是否达到压缩阈值
	go s.checkThreshold(characterID, sessionID)
	return nil
}

// checkThreshold 检查是否达到压缩阈值
// 如果未压缩对话数达到阈值，触发回调
func (s *ConversationStore) checkThreshold(characterID, sessionID string) {
	s.mu.RLock()
	count, err := s.getUncompressedCountLocked(characterID, sessionID)
	s.mu.RUnlock()
	if err != nil {
		logger.Warnf("compression: failed to get uncompressed count: %v", err)
		return
	}

	// 达到阈值时触发回调
	if s.callback != nil && count >= s.threshold {
		entries, err := s.GetUncompressed(characterID, sessionID)
		if err != nil {
			logger.Warnf("compression: failed to get uncompressed entries: %v", err)
			return
		}
		s.callback(characterID, entries)
	}
}

// getUncompressedCountLocked 获取未压缩对话数量（内部锁定版本）
// caller must hold at least a read lock
func (s *ConversationStore) getUncompressedCountLocked(characterID, sessionID string) (int, error) {
	var count int
	var err error
	if sessionID == "" {
		err = s.db.QueryRow(
			"SELECT COUNT(*) FROM conversations WHERE character_id = ? AND compressed = 0 AND deleted_at IS NULL",
			characterID,
		).Scan(&count)
	} else {
		err = s.db.QueryRow(
			"SELECT COUNT(*) FROM conversations WHERE character_id = ? AND session_id = ? AND compressed = 0 AND deleted_at IS NULL",
			characterID, sessionID,
		).Scan(&count)
	}
	return count, err
}

// GetUncompressed 获取未压缩的对话列表
// characterID: 角色ID
// sessionID: 会话ID（可选，为空则获取该角色的所有会话）
// 返回按时间正序排列的未压缩对话
func (s *ConversationStore) GetUncompressed(characterID, sessionID string) ([]*ConversationEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error
	if sessionID == "" {
		rows, err = s.db.Query(
			"SELECT id, role, content, created_at FROM conversations WHERE character_id = ? AND compressed = 0 AND deleted_at IS NULL ORDER BY created_at ASC",
			characterID,
		)
	} else {
		rows, err = s.db.Query(
			"SELECT id, role, content, created_at FROM conversations WHERE character_id = ? AND session_id = ? AND compressed = 0 AND deleted_at IS NULL ORDER BY created_at ASC",
			characterID, sessionID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []*ConversationEntry
	for rows.Next() {
		var e ConversationEntry
		var createdAt int64
		if err := rows.Scan(&e.ID, &e.Role, &e.Content, &createdAt); err != nil {
			return nil, err
		}
		e.Timestamp = time.Unix(createdAt, 0)
		entries = append(entries, &e)
	}
	return entries, nil
}

// GetAll 获取所有对话（包括已压缩的）
// characterID: 角色ID
// sessionID: 会话ID（可选，为空则获取该角色的所有会话）
// limit: 返回条数限制
// 返回按时间倒序排列的对话
func (s *ConversationStore) GetAll(characterID, sessionID string, limit int) ([]*ConversationEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error
	if sessionID == "" {
		rows, err = s.db.Query(
			"SELECT id, role, content, created_at FROM conversations WHERE character_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?",
			characterID, limit,
		)
	} else {
		rows, err = s.db.Query(
			"SELECT id, role, content, created_at FROM conversations WHERE character_id = ? AND session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?",
			characterID, sessionID, limit,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []*ConversationEntry
	for rows.Next() {
		var e ConversationEntry
		var createdAt int64
		if err := rows.Scan(&e.ID, &e.Role, &e.Content, &createdAt); err != nil {
			return nil, err
		}
		e.Timestamp = time.Unix(createdAt, 0)
		entries = append(entries, &e)
	}
	return entries, nil
}

// MarkCompressed 标记对话为已压缩
// ids: 要标记的对话ID列表
func (s *ConversationStore) MarkCompressed(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 构建批量更新语句
	query := "UPDATE conversations SET compressed = 1 WHERE id IN ("
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

// SoftDeleteOld 软删除旧的已压缩对话
// days: 保留天数，超过此天数的已压缩对话将被软删除
func (s *ConversationStore) SoftDeleteOld(days int) error {
	if days <= 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().AddDate(0, 0, -days).Unix()
	_, err := s.db.Exec(
		"UPDATE conversations SET deleted_at = ? WHERE compressed = 1 AND deleted_at IS NULL AND created_at < ?",
		time.Now().Unix(), cutoff,
	)
	return err
}

// SetCallback 设置达到阈值时的回调函数
func (s *ConversationStore) SetCallback(callback OnThresholdCallback) {
	s.callback = callback
}

// Count 获取未压缩对话数量
// characterID: 角色ID
// sessionID: 会话ID（可选，为空则获取该角色的所有会话数量）
func (s *ConversationStore) Count(characterID, sessionID string) (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.getUncompressedCountLocked(characterID, sessionID)
}

// Threshold 获取当前阈值
func (s *ConversationStore) Threshold() int {
	return s.threshold
}

// Close 关闭数据库连接
func (s *ConversationStore) Close() error {
	return s.db.Close()
}
