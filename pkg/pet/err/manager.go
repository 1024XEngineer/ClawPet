package errors

import (
	"context"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
)

type manager struct {
	pushHandler PushHandler
	errorChan   chan PetError
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
}

var globalMgr *manager
var initMgr sync.Once

func getManager() *manager {
	initMgr.Do(func() {
		globalMgr = &manager{
			errorChan: make(chan PetError, 50),
		}
		globalMgr.ctx, globalMgr.cancel = context.WithCancel(context.Background())
		go globalMgr.processErrors()
	})
	return globalMgr
}

func SetPushHandler(h PushHandler) {
	getManager().SetPushHandler(h)
}

func (m *manager) SetPushHandler(h PushHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pushHandler = h
}

func Add(code, level, message string, ctx map[string]any) {
	getManager().add(PetError{
		Level:   level,
		Code:    code,
		Message: message,
		Context: ctx,
		Time:    time.Now().Unix(),
	})
}

func (m *manager) add(e PetError) {
	select {
	case m.errorChan <- e:
	default:
	}
}

func (m *manager) processErrors() {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf("pet-errors: processErrors panic: %v", r)
			go m.processErrors()
		}
	}()
	for {
		select {
		case <-m.ctx.Done():
			return
		case e := <-m.errorChan:
			m.push(e)
		}
	}
}

func (m *manager) push(e PetError) {
	m.mu.Lock()
	handler := m.pushHandler
	m.mu.Unlock()

	if handler == nil {
		return
	}
	handler(ErrorPush{
		Level:     e.Level,
		Code:      e.Code,
		Message:   e.Message,
		Context:   e.Context,
		Timestamp: e.Time,
	})
}
