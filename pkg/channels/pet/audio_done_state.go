package pet

import "sync"

var (
	activeStreamersMu sync.RWMutex
	activeStreamers   = make(map[string]*petStreamer)
)

func setActivePetStreamer(sessionID string, streamer *petStreamer) {
	if sessionID == "" || streamer == nil {
		return
	}
	activeStreamersMu.Lock()
	activeStreamers[sessionID] = streamer
	activeStreamersMu.Unlock()
}

func getActivePetStreamer(sessionID string) *petStreamer {
	if sessionID == "" {
		return nil
	}
	activeStreamersMu.RLock()
	streamer := activeStreamers[sessionID]
	activeStreamersMu.RUnlock()
	return streamer
}

func clearActivePetStreamer(sessionID string, streamer *petStreamer) {
	if sessionID == "" || streamer == nil {
		return
	}
	activeStreamersMu.Lock()
	current := activeStreamers[sessionID]
	if current == streamer {
		delete(activeStreamers, sessionID)
	}
	activeStreamersMu.Unlock()
}
