package compression

import (
	"os"
	"testing"
)

func TestNewConversationStore(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	callback := func(characterID string, entries []*ConversationEntry) {}

	store, err := NewConversationStore(tmpDir, 10, callback)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	if store == nil {
		t.Fatal("NewConversationStore returned nil")
	}
	if store.Threshold() != 10 {
		t.Errorf("Threshold()=%d, want 10", store.Threshold())
	}
}

func TestConversationStore_Add(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	callback := func(characterID string, entries []*ConversationEntry) {
	}

	store, err := NewConversationStore(tmpDir, 100, callback)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	err = store.Add("pet_001", "session-001", "user", "你好")
	if err != nil {
		t.Fatalf("Add failed: %v", err)
	}

	count, _ := store.Count("pet_001", "session-001")
	if count != 1 {
		t.Errorf("Count=%d, want 1", count)
	}
}

func TestConversationStore_GetUncompressed(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	store, err := NewConversationStore(tmpDir, 100, nil)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	store.Add("pet_001", "session-001", "user", "用户消息")
	store.Add("pet_001", "session-001", "assistant", "宠物回复")

	entries, err := store.GetUncompressed("pet_001", "session-001")
	if err != nil {
		t.Fatalf("GetUncompressed failed: %v", err)
	}

	if len(entries) != 2 {
		t.Errorf("len(entries)=%d, want 2", len(entries))
	}
}

func TestConversationStore_MarkCompressed(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	store, err := NewConversationStore(tmpDir, 100, nil)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	store.Add("pet_001", "session-001", "user", "消息1")
	store.Add("pet_001", "session-001", "user", "消息2")

	entries, _ := store.GetUncompressed("pet_001", "session-001")
	var ids []int64
	for _, e := range entries {
		ids = append(ids, e.ID)
	}

	err = store.MarkCompressed(ids)
	if err != nil {
		t.Fatalf("MarkCompressed failed: %v", err)
	}

	count, _ := store.Count("pet_001", "session-001")
	if count != 0 {
		t.Errorf("Count after MarkCompressed=%d, want 0", count)
	}
}

func TestConversationStore_GetAll(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	store, err := NewConversationStore(tmpDir, 100, nil)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	store.Add("pet_001", "session-001", "user", "消息1")
	store.Add("pet_001", "session-001", "user", "消息2")

	entries, _ := store.GetUncompressed("pet_001", "session-001")
	store.MarkCompressed([]int64{entries[0].ID})

	allEntries, err := store.GetAll("pet_001", "session-001", 10)
	if err != nil {
		t.Fatalf("GetAll failed: %v", err)
	}

	if len(allEntries) != 2 {
		t.Errorf("len(allEntries)=%d, want 2 (including compressed)", len(allEntries))
	}
}

func TestConversationStore_Count(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	store, err := NewConversationStore(tmpDir, 100, nil)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	count, err := store.Count("pet_001", "session-001")
	if err != nil {
		t.Fatalf("Count failed: %v", err)
	}
	if count != 0 {
		t.Errorf("initial Count=%d, want 0", count)
	}

	store.Add("pet_001", "session-001", "user", "消息1")
	store.Add("pet_001", "session-001", "assistant", "消息2")

	count, _ = store.Count("pet_001", "session-001")
	if count != 2 {
		t.Errorf("Count=%d, want 2", count)
	}
}

func TestConversationStore_SoftDeleteOld(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	store, err := NewConversationStore(tmpDir, 100, nil)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	store.Add("pet_001", "session-001", "user", "消息1")
	entries, _ := store.GetUncompressed("pet_001", "session-001")
	store.MarkCompressed([]int64{entries[0].ID})

	err = store.SoftDeleteOld(0)
	if err != nil {
		t.Fatalf("SoftDeleteOld failed: %v", err)
	}

	err = store.SoftDeleteOld(30)
	if err != nil {
		t.Fatalf("SoftDeleteOld failed: %v", err)
	}
}

func TestConversationStore_SetCallback(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "conversation-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	store, err := NewConversationStore(tmpDir, 100, nil)
	if err != nil {
		t.Fatalf("NewConversationStore failed: %v", err)
	}
	defer store.Close()

	var called bool
	callback := func(characterID string, entries []*ConversationEntry) {
		called = true
	}

	store.SetCallback(callback)
	if called {
		t.Error("callback should not be called immediately")
	}
}
