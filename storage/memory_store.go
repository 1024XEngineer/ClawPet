package storage

import (
	"go-claw/models"
	"sync"
)

type MemoryStore struct {
	mu      sync.RWMutex
	actions map[string]models.Action
	nextID  int
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		actions: make(map[string]models.Action),
		nextID:  1,
	}
}

func (s *MemoryStore) SaveAction(action models.Action) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	action.ID = s.generateID()
	s.actions[action.ID] = action
	return action.ID
}

func (s *MemoryStore) GetAction(id string) (models.Action, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	action, exists := s.actions[id]
	return action, exists
}

func (s *MemoryStore) GetAllActions() []models.Action {
	s.mu.RLock()
	defer s.mu.RUnlock()

	actions := make([]models.Action, 0, len(s.actions))
	for _, action := range s.actions {
		actions = append(actions, action)
	}
	return actions
}

func (s *MemoryStore) generateID() string {
	id := s.nextID
	s.nextID++
	return string(rune('A'+(id-1)%26)) + string(rune('0'+(id-1)/26))
}
