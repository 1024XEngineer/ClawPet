// Package pet 提供桌宠通道，通过WebSocket连接桌面客户端，处理API请求
package pet

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/channels"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet"
	"github.com/sipeed/picoclaw/pkg/pet/voice"
)

// 队列和超时配置默认值（当配置缺失时使用）
const (
	defaultAudioQueueSize   = 100             // 默认队列容量
	defaultAudioWaitTimeout = 3 * time.Second // 默认等待超时（兜底）
)

// 语音分段符
const voiceSegmentSeps = ".。；;?？！!"

// parsePureText 从 [text:xxx] 格式中提取纯文本
func parsePureText(raw string) string {
	// 匹配 [text:xxx] 格式，提取 xxx 部分
	re := regexp.MustCompile(`\[text:([^\]]*)\]`)
	matches := re.FindAllStringSubmatch(raw, -1)
	if len(matches) == 0 {
		return raw
	}
	var sb strings.Builder
	for _, match := range matches {
		if len(match) > 1 {
			sb.WriteString(match[1])
		}
	}
	return sb.String()
}

func isLocalhostOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// Request 定义了客户端请求的类型
type Request = pet.Request

// Response 定义了服务端响应的类型
type Response = pet.Response

// Push 定义了服务端推送的类型
type Push = pet.Push

const (
	pingInterval = 30 * time.Second // 心跳间隔
	readTimeout  = 60 * time.Second // 读取超时时间
)

// PetChannel 桌面宠通道
// 通过WebSocket连接桌面客户端，处理API请求
type PetChannel struct {
	*channels.BaseChannel                     // 基础通道
	config                config.PetConfig    // 通道配置
	msgBus                *bus.MessageBus     // 消息总线
	upgrader              websocket.Upgrader  // WebSocket升级器
	connections           map[string]*petConn // 连接映射表：connID -> connection
	connsMu               sync.RWMutex        // 连接映射表的读写锁
	ctx                   context.Context     // 上下文
	cancel                context.CancelFunc  // 取消函数
	service               *pet.PetService     // 桌宠服务
	voiceSynthesizer      *voice.Synthesizer  // 语音合成器
}

// petConn 表示一个WebSocket连接
type petConn struct {
	id        string          // 连接ID
	conn      *websocket.Conn // WebSocket连接
	sessionID string          // 会话ID
	writeMu   sync.Mutex      // 写操作锁
	closed    bool            // 连接是否关闭
}

// NewPetChannel 创建Pet Channel
// cfg: pet channel 配置
// msgBus: 消息总线
// workspacePath: 工作区路径，用于存储角色配置等文件
// systemConfig: 系统配置，用于创建压缩所需的 LLM Provider
// configPath: picoclaw 主配置路径，用于模型配置管理
func NewPetChannel(cfg config.PetConfig, msgBus *bus.MessageBus, workspacePath string, systemConfig *config.Config, configPath string) (*PetChannel, error) {
	ctx, cancel := context.WithCancel(context.Background())

	base := channels.NewBaseChannel("pet", cfg, msgBus, cfg.AllowFrom)

	// Origin 检查函数，用于 WebSocket 升级时的安全验证
	checkOrigin := func(r *http.Request) bool {
		if len(cfg.AllowOrigins) == 0 {
			return true
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		// Desktop renderer loaded from file:// may send Origin: null (or empty in
		// non-browser clients). Treat these local desktop cases as trusted and rely
		// on token auth for access control.
		if origin == "" || origin == "null" || strings.HasPrefix(strings.ToLower(origin), "file://") {
			return true
		}
		for _, allowed := range cfg.AllowOrigins {
			if allowed == "*" || allowed == origin {
				return true
			}
		}
		if isLocalhostOrigin(origin) {
			return true
		}
		return false
	}

	pc := &PetChannel{
		BaseChannel: base,
		config:      cfg,
		msgBus:      msgBus,
		upgrader: websocket.Upgrader{
			CheckOrigin:     checkOrigin,
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
		},
		connections: make(map[string]*petConn),
		ctx:         ctx,
		cancel:      cancel,
	}

	// 创建 PetService，传递工作区路径用于存储角色配置
	var err error
	pc.service, err = pet.NewPetService(msgBus, pet.PetServiceConfig{
		WorkspacePath: workspacePath,
		Config:        systemConfig,
		ConfigPath:    configPath,
	})
	if err != nil {
		logger.Errorf("pet: failed to create PetService: %v", err)
		return nil, err
	}
	pc.service.SetPushHandler(pc.handleServicePush)
	pc.service.Start()

	// 初始化语音合成器
	voiceLoader := pc.service.VoiceLoader()
	if voiceLoader != nil {
		voiceSender := voice.NewSender(pc.sendVoicePush)
		pc.voiceSynthesizer = voice.NewSynthesizer(voiceLoader, voiceSender)
	}

	return pc, nil
}

// handleServicePush 处理 PetService 的推送
func (c *PetChannel) handleServicePush(push any) {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()

	for _, pc := range c.connections {
		if err := pc.writeJSON(push); err != nil {
			logger.Warnf("pet: failed to push to conn_id=%s: %v", pc.id, err)
		}
	}
}

// Name 通道名称
func (c *PetChannel) Name() string {
	return "pet"
}

// Service 返回 PetService 实例，供 LLMTagHook 等组件访问情绪引擎和动作管理器
func (c *PetChannel) Service() *pet.PetService {
	return c.service
}

// WebhookPath 实现 WebhookHandler 接口，返回 HTTP 端点路径
// PetChannel 使用 /pet/ 前缀（带斜杠表示子树匹配），包括 /pet/ws, /pet/token, /pet/init_status
func (c *PetChannel) WebhookPath() string {
	return "/pet/"
}

// Start 启动通道
// 注意：当 PetChannel 实现了 WebhookHandler 接口后，
// HTTP handler 会由 Manager 统一注册到主 Gateway 服务器，
// 这里不再启动独立的 HTTP 服务器
func (c *PetChannel) Start(ctx context.Context) error {
	logger.Infof("pet: Start called, channel registered to main gateway HTTP server")

	// PetChannel 通过 WebhookHandler 接口注册到主 Gateway，
	// 不需要启动独立的 HTTP 服务器
	// 如果需要独立的 HTTP 服务器，可以通过配置禁用 WebhookHandler

	go c.runHeartbeat()

	logger.InfoCF("pet", "Pet channel started", nil)
	return nil
}

// Stop 停止通道
func (c *PetChannel) Stop(ctx context.Context) error {
	c.cancel()
	c.connsMu.Lock()
	for _, pc := range c.connections {
		pc.conn.Close()
	}
	c.connections = make(map[string]*petConn)
	c.connsMu.Unlock()

	if c.service != nil {
		c.service.Stop()
	}

	logger.InfoCF("pet", "Pet channel stopped", nil)
	return nil
}

// Send 发送消息（实现Channel接口）
func (c *PetChannel) Send(ctx context.Context, msg bus.OutboundMessage) ([]string, error) {
	if !c.IsRunning() {
		return nil, channels.ErrNotRunning
	}
	logger.Infof("pet: Send, msg=%v", msg)
	c.sendToClient(msg.ChatID, msg.Content)

	if c.voiceSynthesizer != nil {
		appConfig := c.service.AppConfig()
		if appConfig != nil && appConfig.VoiceEnabled {
			emotion := ""
			if char := c.service.CharManager().GetCurrent(); char != nil {
				emotion, _ = char.GetEmotionEngine().GetDominantEmotion()
			}
			pureText := parsePureText(msg.Content)
			if pureText != "" {
				go c.voiceSynthesizer.ParseAndSynthesize(msg.ChatID, 0, pureText, emotion)
			}
		}
	}

	return nil, nil
}

// IsRunning 是否运行
func (c *PetChannel) IsRunning() bool {
	return c.ctx.Err() == nil
}

// IsAllowed 是否允许
func (c *PetChannel) IsAllowed(senderID string) bool {
	return true
}

// IsAllowedSender 是否允许发送者
func (c *PetChannel) IsAllowedSender(sender bus.SenderInfo) bool {
	return true
}

// ReasoningChannelID 推理通道ID
func (c *PetChannel) ReasoningChannelID() string {
	return ""
}

// runHeartbeat 定期发送心跳
func (c *PetChannel) runHeartbeat() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			c.broadcastPush(pet.Push{
				Type:      "push",
				PushType:  pet.PushTypeHeartbeat,
				Data:      mustMarshal(map[string]interface{}{"timestamp": time.Now().Unix()}),
				Timestamp: time.Now().Unix(),
			})
		}
	}
}

// sendToClient 发送消息到指定session的客户端
func (c *PetChannel) sendToClient(sessionID, content string) {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()

	logger.Infof("pet: sendToClient, sessionID=%s, content=%s, connections_count=%d", sessionID, content, len(c.connections))

	for connID, pc := range c.connections {
		logger.Infof("pet: checking connection conn_id=%s, sessionID=%s", connID, pc.sessionID)
		if pc.sessionID == sessionID || sessionID == "broadcast" {
			logger.Infof("pet: matched! sending to conn_id=%s", connID)
			data, _ := json.Marshal(content)
			pc.writeJSON(Response{
				Status: pet.StatusOK,
				Action: pet.ActionChat,
				Data:   data,
			})
		}
	}
}

// broadcastPush 广播推送消息
func (c *PetChannel) broadcastPush(push pet.Push) {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()

	for _, pc := range c.connections {
		if err := pc.writeJSON(push); err != nil {
			logger.Warnf("pet: failed to broadcast push to conn_id=%s: %v", pc.id, err)
		}
	}
}

// ServeHTTP 处理HTTP请求（WebSocket升级 + API端点）
// 支持从主 Gateway 转发的 /pet/* 路径
func (c *PetChannel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// 处理 /pet/ 前缀（从主 Gateway 转发来的请求）
	if strings.HasPrefix(path, "/pet/") {
		path = strings.TrimPrefix(path, "/pet")
	} else if path == "/pet" {
		path = "/"
	}

	logger.Debugf("pet: ServeHTTP called, path=%s, normalized=%s, method=%s", r.URL.Path, path, r.Method)

	switch path {
	case "/ws", "/ws/", "/":
		c.handleWebSocket(w, r)
	case "/token", "/token/":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		c.handleGetToken(w, r)
	case "/init_status", "/init_status/":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		c.handleGetInitStatus(w, r)
	default:
		http.NotFound(w, r)
	}
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if xfProto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))); xfProto == "https" || xfProto == "wss" {
		return true
	}
	return false
}

func wsSchemeForRequest(r *http.Request) string {
	if isSecureRequest(r) {
		return "wss"
	}
	return "ws"
}

func (c *PetChannel) handleGetToken(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	wsPath := "/ws"
	if strings.HasPrefix(r.URL.Path, "/pet/") || r.URL.Path == "/pet" {
		wsPath = "/pet/ws"
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"enabled":  true,
		"token":    "",
		"ws_url":   fmt.Sprintf("%s://%s%s", wsSchemeForRequest(r), r.Host, wsPath),
		"protocol": "pet",
	})
}

func (c *PetChannel) handleGetInitStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if c.service == nil {
		http.Error(w, "pet service unavailable", http.StatusServiceUnavailable)
		return
	}
	// 返回基本的初始化状态
	_ = json.NewEncoder(w).Encode(map[string]any{
		"initialized": true,
		"service":     "pet",
	})
}

// handleWebSocket 处理WebSocket连接
func (c *PetChannel) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if !c.IsRunning() {
		http.Error(w, "channel not running", http.StatusServiceUnavailable)
		return
	}

	conn, err := c.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Warnf("pet: failed to upgrade: %v", err)
		return
	}

	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		sessionID = "default"
	}

	pc := &petConn{
		id:        generateConnID(),
		conn:      conn,
		sessionID: sessionID,
	}

	c.connsMu.Lock()
	c.connections[pc.id] = pc
	c.connsMu.Unlock()

	c.service.RegisterSession(pc.id, sessionID)
	c.service.PushInitStatus(sessionID)

	logger.Infof("pet: client connected, conn_id=%s, session=%s", pc.id, sessionID)

	go c.readLoop(pc)
}

// readLoop 读取客户端消息
func (c *PetChannel) readLoop(pc *petConn) {
	pingDone := make(chan struct{})

	defer func() {
		close(pingDone)
		c.service.UnregisterSession(pc.id)

		pc.writeMu.Lock()
		pc.closed = true
		pc.writeMu.Unlock()

		pc.conn.Close()
		c.connsMu.Lock()
		delete(c.connections, pc.id)
		c.connsMu.Unlock()
		logger.Infof("pet: client disconnected, conn_id=%s", pc.id)
	}()

	pc.conn.SetReadDeadline(time.Now().Add(readTimeout))
	pc.conn.SetPongHandler(func(appData string) error {
		pc.conn.SetReadDeadline(time.Now().Add(readTimeout))
		return nil
	})

	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-c.ctx.Done():
				return
			case <-pingDone:
				return
			case <-ticker.C:
				if err := pc.writePing(); err != nil {
					logger.Debugf("pet: ping failed, conn_id=%s, err=%v", pc.id, err)
					return
				}
			}
		}
	}()

	for {
		_, rawMsg, err := pc.conn.ReadMessage()
		if err != nil {
			logger.Debugf("pet: readLoop exit, conn_id=%s, err=%v", pc.id, err)
			return
		}

		var req Request
		if err := json.Unmarshal(rawMsg, &req); err != nil {
			pc.writeJSON(Response{Status: pet.StatusError, Error: "invalid request"})
			continue
		}

		c.handleRequest(pc, req)
	}
}

// handleRequest 处理客户端请求
func (c *PetChannel) handleRequest(pc *petConn, req Request) {
	logger.Infof("pet: handleRequest called, action=%s, conn_id=%s", req.Action, pc.id)
	c.service.HandleRequest(pc.id, req)
}

// writeJSON 发送JSON到客户端
func (pc *petConn) writeJSON(v any) error {
	pc.writeMu.Lock()
	defer pc.writeMu.Unlock()
	if pc.closed {
		return fmt.Errorf("connection closed")
	}
	_ = pc.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := pc.conn.WriteJSON(v)
	if err != nil {
		logger.Warnf("pet: writeJSON failed conn_id=%s, err=%v", pc.id, err)
	}
	return err
}

func (pc *petConn) writePing() error {
	pc.writeMu.Lock()
	defer pc.writeMu.Unlock()
	if pc.closed {
		return fmt.Errorf("connection closed")
	}
	return pc.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
}

// generateConnID 生成连接ID
func generateConnID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

// mustMarshal 将任意数据转换为适合嵌入推送信封的原始JSON
func mustMarshal(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{"error": "marshal error"}`)
	}
	return data
}

// petStreamer 实现流式输出，通过WebSocket发送增量内容
type petStreamer struct {
	channel          *PetChannel
	sessionID        string
	lastLen          int
	buffer           string
	chatID           int64
	voiceSynthesizer *voice.Synthesizer // 语音合成器

	// 状态机相关
	textBuffer  strings.Builder // 收集 [text:] 中的文本
	tagBuffer   strings.Builder // 收集其他标签内容
	inTextTag   bool            // 是否在 [text:...] 标签内
	inOtherTag  bool            // 是否在其他标签内（如 [emotion:...]）
	pendingText string          // 已收集待发送的文本（遇到标签前的）

	textVoiceBuffer strings.Builder // 收集 [text:] 中的文本
	voiceBuffer     strings.Builder // 收集 [voice:] 中的语音数据
	inVoiceTag      bool            // 是否在 [voice:...] 标签内

	// 语音队列和播放控制
	audioQueue         *voice.AudioQueue // 语音优先队列
	seqCounter         int64             // 序号计数器
	waitTimer          *time.Timer       // 等待前端回应的超时计时器
	waitTimeout        time.Duration     // 等待超时时长
	waitMu             sync.Mutex        // 保护 waitTimer 的互斥锁
	stopped            bool              // 是否已停止（用于阻止新操作）
	streamingEnded     bool              // 流式是否已结束
	hasSentFirst       bool              // 是否已发送第一个音频
	hasReadyAudioCount int               // 等待发送的音频数量
	audioPlayDone      chan struct{}     // audioPlayLoop 结束信号
	voiceEnabled       bool              // 当前语音开关状态
	audioDone          chan int64        // audio_done 通知 channel
	audioReady         chan int64        // TTS 合成完毕通知 channel
}

// BeginStream 实现StreamingCapable接口
func (c *PetChannel) BeginStream(ctx context.Context, sessionID string) (channels.Streamer, error) {
	logger.Infof("pet: BeginStream called, sessionID=%s", sessionID)

	streamer := &petStreamer{
		channel:          c,
		sessionID:        sessionID,
		chatID:           0,
		voiceSynthesizer: c.voiceSynthesizer,
		// 语音优先队列初始化
		audioQueue:    voice.NewAudioQueue(defaultAudioQueueSize),
		seqCounter:    0,
		waitTimer:     time.NewTimer(defaultAudioWaitTimeout),
		waitTimeout:   defaultAudioWaitTimeout,
		voiceEnabled:  true,
		audioDone:     make(chan int64, 1),
		audioReady:    make(chan int64, 1),
		audioPlayDone: make(chan struct{}),
	}

	// 启动音频播放控制 goroutine
	go streamer.audioPlayLoop()

	return streamer, nil
}

// Update 发送增量内容到客户端，使用状态机解析标签
func (s *petStreamer) Update(ctx context.Context, content string) error {
	if s == nil || s.channel == nil {
		return nil
	}

	s.lastLen = len(content)
	s.buffer += content
	s.textVoiceBuffer.WriteString(content)

	// 检查语音开关状态
	appConfig := s.channel.service.AppConfig()
	voiceEnabled := appConfig != nil && appConfig.VoiceEnabled

	if voiceEnabled && s.audioQueue != nil {
		// 语音开启：处理语音分段
		s.voiceEnabled = true
		s.processVoiceSegmentsLocked(content)
		return nil
	}

	// 语音关闭：使用原来的流式文本逻辑
	s.voiceEnabled = false

	sendVoice := func() {
		if s.voiceSynthesizer != nil {
			emotion := ""
			if char := s.channel.service.CharManager().GetCurrent(); char != nil {
				emotion, _ = char.GetEmotionEngine().GetDominantEmotion()
			}
			rawText := s.textVoiceBuffer.String()
			parsedText := parsePureText(rawText)
			go s.voiceSynthesizer.ParseAndSynthesize(s.sessionID, s.chatID, parsedText, emotion)
		}
		s.textVoiceBuffer.Reset()
	}

	sendPending := func() {
		if len(s.buffer) > 0 {
			textToSend := s.buffer
			s.chatID++
			s.channel.sendStreamChunk(s.sessionID, s.chatID, "text", textToSend, false)
			s.buffer = ""
		}
	}

	if len(s.buffer) > 0 {
		if s.inTextTag {
			if strings.Contains(s.buffer, "]") {
				s.inTextTag = false
				i := strings.Index(s.buffer, "]")
				s.buffer = s.buffer[:i]
				sendVoice()
			}
			sendPending()
		} else if strings.Contains(s.buffer, "[text:") {
			s.inTextTag = true
			i := strings.Index(s.buffer, "[text:")
			s.buffer = s.buffer[i+6:]
			sendPending()
		}
	}

	return nil
}

// Finalize 发送最终完成标记
// 注意：不再发送重复文本，只发送情绪状态汇总
// 流式结束后等待剩余音频发送完毕
func (s *petStreamer) Finalize(ctx context.Context, content string) error {

	logger.DebugCF("pet", "Finalize called", map[string]any{
		"content": content,
	})

	if s == nil || s.channel == nil {
		return nil
	}

	s.waitMu.Lock()
	// 标记流式结束，但不立即停止。audioPlayLoop 会继续处理剩余音频
	s.streamingEnded = true
	s.waitMu.Unlock()

	// 等待 audioPlayLoop 处理完剩余音频
	// 某些前端不会发送 audio_done，避免在 Finalize 阶段长时间阻塞导致“无回复”体感。
	if s.voiceEnabled && s.audioQueue != nil && !s.audioQueue.IsEmpty() {
		select {
		case <-s.audioPlayDone:
			logger.DebugCF("pet", "Finalize: audioPlayLoop finished", nil)
		case <-time.After(30 * time.Second):
			logger.WarnCF("pet", "Finalize: audioPlayLoop timeout (fallback continue)", nil)
		}
	}

	s.waitMu.Lock()
	if s.waitTimer != nil {
		s.waitTimer.Stop()
	}
	s.waitMu.Unlock()

	// 清空状态，不发送任何文本
	s.buffer = ""
	s.textVoiceBuffer.Reset()
	s.voiceBuffer.Reset()
	s.textBuffer.Reset()
	s.tagBuffer.Reset()
	s.inTextTag = false
	s.inOtherTag = false

	// 重置语音播放状态
	s.hasSentFirst = false
	s.hasReadyAudioCount = 0

	// 发送最终状态块（带情绪状态）
	// 语音模式下 Update 不会持续推文本，这里补发纯文本，避免前端出现“无回复”。
	finalText := parsePureText(content)
	s.chatID++
	s.channel.sendStreamChunk(s.sessionID, s.chatID, "final", finalText, true)

	return nil
}

// Cancel 取消流式输出
func (s *petStreamer) Cancel(ctx context.Context) {
	s.waitMu.Lock()
	defer s.waitMu.Unlock()
	s.stopped = true
	s.hasSentFirst = false
	s.hasReadyAudioCount = 0
	if s.waitTimer != nil {
		s.waitTimer.Stop()
	}
	if s.audioQueue != nil {
		s.audioQueue.Clear()
	}
}

// findSegment 查找第一个完整的段落（以换行或句号结尾）
// 返回: 段落内容, 剩余内容, 是否找到
func (s *petStreamer) findSegment(buffer string) (string, string, bool) {
	runes := []rune(buffer)
	for i := len(runes) - 1; i >= 0; i-- {
		c := runes[i]
		if c == '\n' || c == '.' {
			segment := string(runes[:i+1])
			remaining := string(runes[i+1:])
			return segment, remaining, true
		}
	}
	return "", buffer, false
}

// cleanSegment 清理段落，去除纯空白、无用符号和标签
func (s *petStreamer) cleanSegment(segment string) string {
	// 先移除所有标签
	segment = cleanStreamTags(segment)

	runes := []rune(segment)
	cleaned := make([]rune, 0, len(runes))

	for i, r := range runes {
		if r == '\n' {
			hasTextBefore := false
			for j := 0; j < i; j++ {
				if !isWhitespace(runes[j]) {
					hasTextBefore = true
					break
				}
			}
			if !hasTextBefore {
				continue
			}
		}
		cleaned = append(cleaned, r)
	}

	result := string(cleaned)
	result = removeTrailingDots(result)
	return strings.TrimRight(result, " \t")
}

// cleanStreamTags 清理流式输出中的所有标签
func cleanStreamTags(content string) string {
	// 匹配所有 [xxx:yyy] 或 [xxx] 格式的标签
	tagPattern := regexp.MustCompile(`\[[^\]]+\]`)
	content = tagPattern.ReplaceAllString(content, "")

	// 清理多余的空行
	emptyLinePattern := regexp.MustCompile(`\n{3,}`)
	content = emptyLinePattern.ReplaceAllString(content, "\n\n")

	return strings.TrimSpace(content)
}

// isWhitespace 检查是否为空白字符
func isWhitespace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r'
}

// removeTrailingDots 去除末尾连续的句号（后面无文字时）
func removeTrailingDots(s string) string {
	runes := []rune(s)
	for len(runes) > 1 && runes[len(runes)-1] == '.' {
		runes = runes[:len(runes)-1]
	}
	return string(runes)
}

// detectContentType 根据内容前缀判断类型
func detectContentType(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```go") || strings.HasPrefix(text, "```golang") {
		return "go"
	}
	if strings.HasPrefix(text, "```json") {
		return "json"
	}
	if strings.HasPrefix(text, "```python") || strings.HasPrefix(text, "```py") {
		return "python"
	}
	if strings.HasPrefix(text, "```javascript") || strings.HasPrefix(text, "```js") {
		return "javascript"
	}
	if strings.HasPrefix(text, "```typescript") || strings.HasPrefix(text, "```ts") {
		return "typescript"
	}
	if strings.HasPrefix(text, "```html") {
		return "html"
	}
	if strings.HasPrefix(text, "```css") {
		return "css"
	}
	if strings.HasPrefix(text, "```sql") {
		return "sql"
	}
	if strings.HasPrefix(text, "```bash") || strings.HasPrefix(text, "```sh") {
		return "bash"
	}
	if strings.HasPrefix(text, "```xml") {
		return "xml"
	}
	if strings.HasPrefix(text, "```yaml") || strings.HasPrefix(text, "```yml") {
		return "yaml"
	}
	if strings.HasPrefix(text, "```markdown") || strings.HasPrefix(text, "```md") {
		return "markdown"
	}
	if strings.HasPrefix(text, "```") {
		return "code"
	}
	return "text"
}

// sendStreamChunk 发送流式数据块
func (c *PetChannel) sendStreamChunk(sessionID string, chatID int64, contentType, text string, isFinal bool) {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()

	var emotion, act string
	if c.service != nil {
		if char := c.service.CharManager().GetCurrent(); char != nil {
			emotion, _ = char.GetEmotionEngine().GetDominantEmotion()
		}
	}

	streamData := StreamData{
		ChatID:      chatID,
		ContentType: contentType,
		Text:        text,
		Emotion:     emotion,
		Action:      act,
	}

	dataBytes, _ := json.Marshal(streamData)

	for connID, pc := range c.connections {
		if pc.sessionID == sessionID || sessionID == "broadcast" {
			pc.writeJSON(PetStreamResponse{
				Type:      "push",
				PushType:  "ai_chat",
				Data:      dataBytes,
				IsFinal:   isFinal,
				Timestamp: time.Now().Unix(),
			})
			_ = connID
		}
	}
}

// sendResponse 发送普通响应
func (c *PetChannel) sendResponse(sessionID string, action string, data map[string]interface{}) {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()

	for connID, pc := range c.connections {
		if pc.sessionID == sessionID || sessionID == "broadcast" {
			pc.writeJSON(Response{
				Status: pet.StatusOK,
				Action: action,
				Data:   mustMarshal(data),
			})
			_ = connID
		}
	}
}

// sendVoicePush 发送语音推送（供 voice.Sender 调用）
func (c *PetChannel) sendVoicePush(sessionID string, pushType string, data any) error {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()

	dataBytes, err := json.Marshal(data)
	if err != nil {
		return err
	}

	for _, pc := range c.connections {
		if pc.sessionID == sessionID || sessionID == "broadcast" {
			if err := pc.writeJSON(PetStreamResponse{
				Type:      "push",
				PushType:  pushType,
				Data:      dataBytes,
				IsFinal:   false,
				Timestamp: time.Now().Unix(),
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

// StreamData 流式数据内容
type StreamData struct {
	ChatID      int64  `json:"chat_id"`
	ContentType string `json:"type"`
	Text        string `json:"text"`
	Emotion     string `json:"emotion,omitempty"`
	Action      string `json:"action,omitempty"`
}

// PetStreamResponse 流式响应结构
type PetStreamResponse struct {
	Type      string          `json:"type"`
	PushType  string          `json:"push_type"`
	Data      json.RawMessage `json:"data"`
	IsFinal   bool            `json:"is_final"`
	Timestamp int64           `json:"timestamp"`
}

// processVoiceSegmentsLocked 处理语音分段（不获取锁版本）
// 调用方需持有 waitMu 锁
//
// 分段逻辑：
//  1. 找 [text: 开始
//  2. 在 [text: 和 ] 之间，按分段符（，。！？,.!?) 分割成多句
//  3. 每积累一段文本，加入 audioQueue 队列
//  4. 异步调用 TTS 合成音频
//  5. 遇到 "]" 立即将剩余 buffer 内容入队
func (s *petStreamer) processVoiceSegmentsLocked(content string) {
	if s.stopped {
		logger.DebugCF("pet", "processVoiceSegmentsLocked: stopped=true, skip", nil)
		return
	}
	if s.voiceSynthesizer == nil {
		logger.DebugCF("pet", "processVoiceSegmentsLocked: voiceSynthesizer=nil, skip", nil)
		return
	}
	if s.audioQueue == nil {
		logger.DebugCF("pet", "processVoiceSegmentsLocked: audioQueue=nil, skip", nil)
		return
	}

	s.voiceBuffer.WriteString(content)
	buffer := s.voiceBuffer.String()

	for len(buffer) > 0 {
		if s.inTextTag {
			runes := []rune(buffer)
			text := ""
			segIdx := -1
			sepRune := rune(0)
			for i, r := range runes {
				if r == ']' {
					segIdx = i
					sepRune = r
					break
				}
				if strings.ContainsRune(voiceSegmentSeps, r) {
					segIdx = i
					sepRune = r
					break
				}
			}
			if segIdx == -1 {
				break
			}
			if sepRune == ']' {
				s.inTextTag = false
				text = string(runes[:segIdx])
				s.voiceBuffer.Reset()
			} else {
				text = string(runes[:segIdx]) + string(sepRune)
				s.voiceBuffer.Reset()
				s.voiceBuffer.WriteString(string(runes[segIdx+1:]))
			}
			buffer = s.voiceBuffer.String()
			if text != "" {
				s.seqCounter++
				err := s.voiceSynthesizer.SynthesizeToQueue(
					s.sessionID,
					s.chatID,
					text,
					s.seqCounter,
					s.audioQueue,
					s.audioReady,
				)
				if err != nil {
					logger.WarnCF("pet", "failed to enqueue audio segment", map[string]any{
						"seq":   s.seqCounter,
						"error": err.Error(),
					})
				}
			}
		} else {
			startIdx := strings.Index(buffer, "[text:")
			if startIdx == -1 {
				break
			}
			s.inTextTag = true
			buffer = buffer[startIdx+6:]
			s.voiceBuffer.Reset()
			s.voiceBuffer.WriteString(buffer)
			buffer = s.voiceBuffer.String()
		}
	}
}

// audioPlayLoop 音频播放控制循环
// 专门处理 audio_done 和 timer，不与主逻辑竞争锁
func (s *petStreamer) audioPlayLoop() {
	logger.DebugCF("pet", "audioPlayLoop: started", nil)
	for {
		// 检查退出条件
		s.waitMu.Lock()
		if s.stopped {
			s.waitMu.Unlock()
			logger.DebugCF("pet", "audioPlayLoop: stopped, exiting", nil)
			return
		}
		if s.streamingEnded && (s.audioQueue == nil || s.audioQueue.IsEmpty()) {
			s.waitMu.Unlock()
			close(s.audioPlayDone)
			logger.DebugCF("pet", "audioPlayLoop: streaming ended and queue empty, exiting", nil)
			return
		}
		s.waitMu.Unlock()

		select {
		case seq := <-s.audioReady:
			// TTS 合成完毕通知
			s.waitMu.Lock()
			logger.DebugCF("pet", "audioPlayLoop: audio ready", map[string]any{"seq": seq})
			if seq == 1 {
				// 发送成功 → 这是第一个
				s.hasSentFirst = true
				s.trySendNextLocked()
			} else {
				// 没发送 → 不是第一个，增加计数
				s.hasReadyAudioCount++
			}
			s.waitMu.Unlock()

		case <-s.audioDone:
			// 收到 audio_done 通知
			s.waitMu.Lock()
			logger.DebugCF("pet", "audioPlayLoop: received audio_done", map[string]any{
				"hasReadyAudioCount": s.hasReadyAudioCount,
				"queue_size":         s.audioQueue.Size(),
			})
			// 弹出已发送的片段
			//front, _ := s.audioQueue.PeekNextReady()
			//if front != nil {
			//	_, _ = s.audioQueue.MarkSent()
			//	logger.DebugCF("pet", "audioPlayLoop: marked sent", map[string]any{"seq": front.Seq})
			//}
			// 有待发送音频则发送
			if s.hasReadyAudioCount > 0 && s.hasSentFirst {
				if s.trySendNextLocked() {
					s.hasReadyAudioCount--
				}
			}
			s.waitMu.Unlock()

		case <-s.waitTimer.C:
			// timer 超时
			s.waitMu.Lock()
			logger.DebugCF("pet", "audioPlayLoop: timer fired", map[string]any{
				"hasReadyAudioCount": s.hasReadyAudioCount,
				"queue_size":         s.audioQueue.Size(),
			})
			// 有待发送音频则发送
			if s.hasReadyAudioCount > 0 && s.hasSentFirst {
				if s.trySendNextLocked() {
					s.hasReadyAudioCount--
				} else {
					s.waitTimer.Reset(defaultAudioWaitTimeout)
				}
				// 如果发送失败（音频未就绪），不减计数，等下次 timer 重试
			}
			s.waitMu.Unlock()
		}
	}
}

// trySendNextLocked 尝试发送下一个已就绪的音频
// 返回 true 表示发送成功，false 表示没有发送
func (s *petStreamer) trySendNextLocked() bool {
	if s.audioQueue == nil || s.audioQueue.IsEmpty() {
		logger.DebugCF("pet", "trySendNextLocked: queue is nil or empty", nil)
		return false
	}

	front, err := s.audioQueue.PeekNextReady()
	if err != nil || front == nil {
		logger.DebugCF("pet", "trySendNextLocked: PeekNextReady failed", map[string]any{
			"err":   err,
			"front": front,
		})
		return false
	}

	logger.DebugCF("pet", "trySendNextLocked: checking", map[string]any{
		"queue_size":         s.audioQueue.Size(),
		"front_seq":          front.Seq,
		"front_ready":        front.Ready,
		"front_sent":         front.Sent,
		"hasSentFirst":       s.hasSentFirst,
		"hasReadyAudioCount": s.hasReadyAudioCount,
	})

	// 检查是否就绪且未发送
	if !front.Ready {
		logger.DebugCF("pet", "trySendNextLocked: audio not ready", map[string]any{"seq": front.Seq})
		return false
	}
	if front.Sent {
		logger.DebugCF("pet", "trySendNextLocked: audio already sent", map[string]any{"seq": front.Seq})
		return false
	}

	// 判断是否是最后一个
	isFinal := s.audioQueue.Size() == 1

	// 复制数据
	segCopy := &voice.AudioSegment{
		Seq:       front.Seq,
		Text:      front.Text,
		AudioData: front.AudioData,
		Duration:  front.Duration,
	}

	// 标记为已发送并弹出
	_, _ = s.audioQueue.MarkSent()

	// 锁外异步发送
	go s.sendAudioSegmentAsync(segCopy, isFinal)

	return true
}

// sendAudioSegmentAsync 异步发送音频片段到前端（不持有锁）
func (s *petStreamer) sendAudioSegmentAsync(seg *voice.AudioSegment, isFinal bool) {
	if seg == nil {
		logger.WarnCF("pet", "sendAudioSegmentAsync: seg is nil!", nil)
		return
	}

	// 检查是否有错误
	if seg.Error != "" {
		logger.WarnCF("pet", "sendAudioSegmentAsync: TTS error", map[string]any{
			"seq":   seg.Seq,
			"error": seg.Error,
		})
		data := map[string]any{
			"seq":      seg.Seq,
			"text":     seg.Text,
			"audio":    "",
			"duration": 0,
			"is_final": isFinal,
			"error":    seg.Error,
		}
		_ = s.channel.sendVoicePush(s.sessionID, "audio_and_voice", data)
		return
	}

	// Base64编码音频
	encoded := base64.StdEncoding.EncodeToString(seg.AudioData)

	data := map[string]any{
		"seq":      seg.Seq,
		"text":     seg.Text,
		"audio":    encoded,
		"duration": seg.Duration,
		"is_final": isFinal,
	}

	logger.DebugCF("pet", "sendAudioSegmentAsync", map[string]any{
		"seq":       seg.Seq,
		"text":      seg.Text,
		"audio_len": len(encoded),
		"duration":  seg.Duration,
	})

	_ = s.channel.sendVoicePush(s.sessionID, "audio_and_voice", data)

	logger.DebugCF("pet", "sent audio segment async", map[string]any{
		"seq":      seg.Seq,
		"duration": seg.Duration,
	})

	// 重置等待计时器（使用音频实际时长）
	s.waitMu.Lock()
	if seg.Duration > 0 {
		s.waitTimer.Reset(time.Duration(seg.Duration) * time.Millisecond)
	} else {
		s.waitTimer.Reset(defaultAudioWaitTimeout)
	}
	s.waitMu.Unlock()
}

// HandleAudioDone 处理前端音频播放完毕的通知
func (s *petStreamer) HandleAudioDone(seq int64) {
	select {
	case s.audioDone <- seq:
	default:
	}
}
