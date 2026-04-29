package asr

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v3/pkg/media/oggwriter"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/logger"
)

type audioWriter interface {
	WriteRTPPacket(seq uint16, ts uint32, data []byte) error
	Close() error
}

type rtpWriter struct {
	w   *oggwriter.OggWriter
	seq uint16
}

func (w *rtpWriter) WriteRTPPacket(seq uint16, ts uint32, data []byte) error {
	pkt := &rtp.Packet{
		Header: rtp.Header{
			SequenceNumber: seq,
			Timestamp:      ts,
			SSRC:           1,
		},
		Payload: data,
	}
	return w.w.WriteRTP(pkt)
}

func (w *rtpWriter) Close() error {
	return w.w.Close()
}

type wavWriter struct {
	file       *os.File
	sampleRate int
	channels   int
}

func newWavWriter(filename string, sampleRate, channels int) (*wavWriter, error) {
	f, err := os.Create(filename)
	if err != nil {
		return nil, err
	}

	w := &wavWriter{
		file:       f,
		sampleRate: sampleRate,
		channels:   channels,
	}

	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:], 0xFFFFFFFF)
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(header[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(header[28:32], uint32(sampleRate)*2*uint32(channels))
	binary.LittleEndian.PutUint16(header[32:34], 2*uint16(channels))
	binary.LittleEndian.PutUint16(header[34:36], 16)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], 0xFFFFFFFF)

	f.Write(header)
	return w, nil
}

func (w *wavWriter) WriteRTPPacket(seq uint16, ts uint32, data []byte) error {
	_, err := w.file.Write(data)
	return err
}

func (w *wavWriter) Close() error {
	if w.file != nil {
		w.file.Sync()
		w.file.Close()
	}
	return nil
}

type speechAccumulator struct {
	writer      audioWriter
	format      string
	file        string
	lastAudioAt time.Time
	mu          sync.Mutex
	closed      bool
	chatID      string
	speakerID   string
	sessionID   string
	sessionKey  string // 会话隔离标识
	charID      string // 当前角色 ID
	channel     string
	sampleRate  int
	channels    int
}

func (a *speechAccumulator) Push(chunk bus.AudioChunk) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.closed {
		return
	}

	a.lastAudioAt = time.Now()

	if err := a.writer.WriteRTPPacket(uint16(chunk.Sequence), chunk.Timestamp, chunk.Data); err != nil {
		logger.ErrorCF("voice-agent", "Failed to write audio", map[string]any{"error": err})
	}
}

func (a *speechAccumulator) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closed {
		a.writer.Close()
		a.closed = true
	}
}

type Agent struct {
	bus         *bus.MessageBus
	transcriber Transcriber

	mu       sync.Mutex
	sessions map[string]*speechAccumulator // keyed by sessionID_speakerID
}

func NewAgent(mb *bus.MessageBus, t Transcriber) *Agent {
	return &Agent{
		bus:         mb,
		transcriber: t,
		sessions:    make(map[string]*speechAccumulator),
	}
}

func (a *Agent) Start(ctx context.Context) {
	logger.InfoCF("voice-agent", "Started Voice Agent orchestrator", nil)
	go a.listenChunks(ctx)
	go a.vadTick(ctx)

	// Cleanup sessions on shutdown
	go func() {
		<-ctx.Done()
		a.mu.Lock()
		for key, acc := range a.sessions {
			acc.Close()
			os.Remove(acc.file)
			delete(a.sessions, key)
		}
		a.mu.Unlock()
		logger.InfoCF("voice-agent", "Cleaned up voice sessions on shutdown", nil)
	}()
}

func (a *Agent) listenChunks(ctx context.Context) {
	chunks := a.bus.AudioChunksChan()
	for {
		select {
		case <-ctx.Done():
			return
		case chunk, ok := <-chunks:
			if !ok {
				return
			}
			a.handleChunk(chunk)
		}
	}
}

func (a *Agent) handleChunk(chunk bus.AudioChunk) {
	// Only accept Opus or PCM encoded audio
	if chunk.Format != "opus" && chunk.Format != "pcm" {
		logger.DebugCF("voice-agent", "Ignoring unsupported audio format", map[string]any{"format": chunk.Format})
		return
	}

	key := fmt.Sprintf("%s_%s", chunk.SessionID, chunk.SpeakerID)

	a.mu.Lock()
	acc, exists := a.sessions[key]
	if !exists {
		var writer audioWriter
		var filename string

		if chunk.Format == "opus" {
			filename = filepath.Join(os.TempDir(), fmt.Sprintf("voice_%s_%d.ogg", key, time.Now().UnixNano()))
			oggWriter, err := oggwriter.New(filename, uint32(chunk.SampleRate), uint16(chunk.Channels))
			if err != nil {
				a.mu.Unlock()
				logger.ErrorCF("voice-agent", "Failed to create OggWriter", map[string]any{"error": err})
				return
			}
			writer = &rtpWriter{w: oggWriter}
		} else {
			filename = filepath.Join(os.TempDir(), fmt.Sprintf("voice_%s_%d.wav", key, time.Now().UnixNano()))
			wavWriter, err := newWavWriter(filename, chunk.SampleRate, chunk.Channels)
			if err != nil {
				a.mu.Unlock()
				logger.ErrorCF("voice-agent", "Failed to create WavWriter", map[string]any{"error": err})
				return
			}
			writer = wavWriter
		}

		acc = &speechAccumulator{
			writer:      writer,
			format:      chunk.Format,
			file:        filename,
			lastAudioAt: time.Now(),
			chatID:      chunk.ChatID,
			speakerID:   chunk.SpeakerID,
			sessionID:   chunk.SessionID,
			sessionKey:  chunk.SessionKey,
			charID:      chunk.CharID,
			channel:     chunk.Channel,
			sampleRate:  chunk.SampleRate,
			channels:    chunk.Channels,
		}
		a.sessions[key] = acc
		logger.DebugCF("voice-agent", "Started accumulating voice", map[string]any{"key": key, "file": filename, "format": chunk.Format})
	}
	a.mu.Unlock()

	acc.Push(chunk)
}

func (a *Agent) vadTick(ctx context.Context) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.checkSilence(ctx)
		}
	}
}

func (a *Agent) checkSilence(ctx context.Context) {
	a.mu.Lock()
	now := time.Now()
	var finished []*speechAccumulator

	for key, acc := range a.sessions {
		acc.mu.Lock()
		last := acc.lastAudioAt
		acc.mu.Unlock()

		if now.Sub(last) > 1500*time.Millisecond {
			acc.Close()
			delete(a.sessions, key)
			finished = append(finished, acc)
		}
	}
	a.mu.Unlock()

	for _, acc := range finished {
		go a.processUtterance(ctx, acc)
	}
}

func (a *Agent) processUtterance(ctx context.Context, acc *speechAccumulator) {
	defer os.Remove(acc.file)

	logger.InfoCF("voice-agent", "User finished speaking, transcribing...", map[string]any{"file": acc.file})

	if a.transcriber == nil {
		logger.ErrorCF("voice-agent", "No STT configured!", nil)
		return
	}

	res, err := a.transcriber.Transcribe(ctx, acc.file)
	if err != nil {
		logger.ErrorCF("voice-agent", "Transcription failed", map[string]any{"error": err})
		return
	}

	if res.Text == "" {
		logger.DebugCF("voice-agent", "Ignored empty transcription", map[string]any{"file": acc.file})
		return
	}

	logger.InfoCF("voice-agent", "Transcription result", map[string]any{"text": res.Text, "duration": res.Duration})

	channelType := acc.channel
	if channelType == "" {
		channelType = "discord" // fallback for legacy chunks
	}

	text := strings.ToLower(strings.TrimSpace(res.Text))
	if strings.Contains(text, "leave the voice channel") || strings.Contains(text, "leave voice") ||
		strings.Contains(text, "disconnect voice") || strings.Contains(text, "leave the channel") ||
		strings.Contains(text, "leave channel") {
		logger.InfoCF("voice-agent", "Voice command triggered: leave", nil)
		if err := a.bus.PublishVoiceControl(ctx, bus.VoiceControl{
			SessionID: acc.sessionID,
			Type:      "command",
			Action:    "leave",
		}); err != nil {
			logger.ErrorCF("voice-agent", "Failed to publish leave control", map[string]any{"error": err})
		}
		if err := a.bus.PublishOutbound(ctx, bus.OutboundMessage{
			Channel: channelType,
			ChatID:  acc.chatID,
			Content: "Goodbye! Leaving the voice channel.",
		}); err != nil {
			logger.ErrorCF("voice-agent", "Failed to publish goodbye message", map[string]any{"error": err})
		}
		return
	}

	oralPrompt := "\n\n[SYSTEM]: The user just spoke this to you over voice chat. Please reply in a highly concise, conversational, oral style suitable for text-to-speech. Do not use markdown, emojis, asterisks, or code blocks. Speak naturally."

	if err := a.bus.PublishInbound(ctx, bus.InboundMessage{
		Channel:    channelType,
		SenderID:   acc.speakerID,
		SessionKey: acc.sessionKey,
		ChatID:     acc.chatID,
		Content:    res.Text + oralPrompt,
		Peer: bus.Peer{
			Kind: acc.charID,
			ID:   acc.sessionKey,
		},
		Metadata: map[string]string{
			"is_voice": "true",
		},
	}); err != nil {
		logger.ErrorCF("voice-agent", "Failed to publish inbound message", map[string]any{"error": err})
	}
}
