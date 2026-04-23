import {
  DIRECT_PICO_TOKEN_PATH,
  DIRECT_PICO_WS_PATH,
  DIRECT_PET_TOKEN_PATH,
  DIRECT_PET_WS_PATH,
  getDirectGatewayBaseUrl,
  isDirectGatewayEnabled,
} from "./config"

const CHAT_ACTION = "chat"

const PUSH_TYPE_AI_CHAT = "ai_chat"
const PUSH_TYPE_AUDIO = "audio"
const PUSH_TYPE_AUDIO_AND_VOICE = "audio_and_voice"
const PUSH_TYPE_EMOTION_CHANGE = "emotion_change"
const PUSH_TYPE_ACTION_TRIGGER = "action_trigger"

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  streaming?: boolean
  error?: string
}

interface PetRequest {
  action: string
  data?: Record<string, unknown>
  request_id?: string
}

interface PetResponse {
  status: string
  action?: string
  data?: Record<string, unknown>
  error?: string
  request_id?: string
}

interface PetPush {
  type: string
  push_type: string
  data?: Record<string, unknown>
  is_final?: boolean
  timestamp: number
}

interface TokenResponse {
  enabled?: boolean
  token?: string
  ws_url?: string
  protocol?: string
}

interface TokenCandidate {
  baseUrl: string
  tokenPath: string
  wsPath: string
}

type WSEventData = ChatMessage | string | Record<string, unknown>
type WSMode = "pet" | "pico"
type OutboundRequest = PetRequest

interface PicoWireMessage {
  type?: string
  id?: string
  session_id?: string
  timestamp?: number
  payload?: Record<string, unknown>
}

export type WSEventType =
  | "connected"
  | "disconnected"
  | "message"
  | "audio"
  | "typing"
  | "error"
  | "reconnecting"
  | "emotion_change"
  | "action_trigger"

export interface WSEvent {
  type: WSEventType
  data?: WSEventData
}

type WSEventHandler = (event: WSEvent) => void

function normalizeIncomingText(text: string): string {
  return text.replace(/\{[^}]*\}/g, "").trim()
}

export class PicoClawWebSocket {
  private ws: WebSocket | null = null
  private sessionId = ""
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private readonly reconnectDelay = 1000
  private handlers: Set<WSEventHandler> = new Set()
  private wsMode: WSMode = "pet"
  private messageQueue: OutboundRequest[] = []
  private isConnecting = false
  private msgIdCounter = 0
  private lastConnectUrl = ""
  private manualClose = false
  private activeAssistantMessageId: string | null = null
  private activeAssistantContent = ""
  private activeAssistantTimestamp = 0
  private activeAssistantLastChatId: number | null = null
  private openHandlers: {
    settle: () => void
    fail: (err: Error) => void
  } | null = null

  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      if (this.isConnecting) {
        const startedAt = Date.now()
        const timer = window.setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            window.clearInterval(timer)
            resolve()
            return
          }
          if (!this.isConnecting || Date.now() - startedAt > 10000) {
            window.clearInterval(timer)
            reject(new Error("Connection in progress timed out"))
          }
        }, 100)
        return
      }

      this.openHandlers = {
        settle: () => resolve(),
        fail: (err: Error) => reject(err),
      }

      try {
        if (!this.sessionId) {
          this.sessionId = this.generateSessionId()
        }
        const { token, wsPath, wsBaseUrl, mode } =
          await this.resolveTokenAndPath()
        this.wsMode = mode
        const query = `session=${encodeURIComponent(this.sessionId)}&session_id=${encodeURIComponent(this.sessionId)}`
        const url = `${wsBaseUrl}${wsPath}?${query}`
        this.connectWebSocket(url, token)
      } catch (err) {
        this.openHandlers = null
        reject(
          err instanceof Error ? err : new Error("WebSocket bootstrap failed"),
        )
      }
    })
  }

  ensureSessionId(): string {
    if (!this.sessionId) {
      this.sessionId = this.generateSessionId()
    }
    return this.sessionId
  }

  startNewSession(): string {
    this.disconnect()
    this.sessionId = this.generateSessionId()
    this.messageQueue = []
    this.resetAssistantState()
    return this.sessionId
  }

  useSession(sessionId: string): string {
    this.disconnect()
    this.sessionId = sessionId || this.generateSessionId()
    this.messageQueue = []
    this.resetAssistantState()
    return this.sessionId
  }

  private resetAssistantState(): void {
    this.activeAssistantMessageId = null
    this.activeAssistantContent = ""
    this.activeAssistantTimestamp = 0
    this.activeAssistantLastChatId = null
  }

  private async resolveTokenAndPath(): Promise<{
    token: string
    wsPath: string
    wsBaseUrl: string
    mode: WSMode
  }> {
    const candidates: TokenCandidate[] = []
    const directGatewayBase = getDirectGatewayBaseUrl()
    if (isDirectGatewayEnabled() && directGatewayBase) {
      candidates.push(
        {
          baseUrl: directGatewayBase,
          tokenPath: DIRECT_PET_TOKEN_PATH,
          wsPath: DIRECT_PET_WS_PATH,
        },
        {
          baseUrl: directGatewayBase,
          tokenPath: DIRECT_PICO_TOKEN_PATH,
          wsPath: DIRECT_PICO_WS_PATH,
        },
      )
    }

    let lastError = "PET channel not available"

    for (const candidate of candidates) {
      const res = await fetch(`${candidate.baseUrl}${candidate.tokenPath}`, {
        method: "GET",
        credentials: "omit",
      }).catch(() => null)

      if (!res) {
        lastError = `Token endpoint failed (${candidate.tokenPath}): network error`
        continue
      }

      if (res.status === 404) {
        lastError = "PET channel not available"
        continue
      }

      if (!res.ok) {
        lastError = `Token endpoint failed (${candidate.tokenPath}): HTTP ${res.status}`
        continue
      }

      const data = (await res.json()) as TokenResponse
      if (!data.enabled) {
        lastError = `Channel not enabled (${candidate.tokenPath})`
        continue
      }

      const wsPathFromToken = this.normalizeWsPath(data.ws_url)
      const wsBaseUrl = this.normalizeWsBaseUrl(data.ws_url, candidate.baseUrl)
      const hasExplicitPicoSignal =
        data.protocol === "pico" || wsPathFromToken === DIRECT_PICO_WS_PATH
      const resolvedPath = wsPathFromToken || candidate.wsPath
      const mode: WSMode =
        hasExplicitPicoSignal || resolvedPath === DIRECT_PICO_WS_PATH
          ? "pico"
          : "pet"
      return {
        token: data.token || "",
        wsPath: resolvedPath,
        wsBaseUrl,
        mode,
      }
    }

    throw new Error(lastError)
  }

  private normalizeWsPath(raw?: string): string {
    if (!raw || !raw.trim()) {
      return ""
    }

    const value = raw.trim()

    try {
      if (
        value.startsWith("ws://") ||
        value.startsWith("wss://") ||
        value.startsWith("http://") ||
        value.startsWith("https://")
      ) {
        const parsed = new URL(value)
        return parsed.pathname || ""
      }
    } catch {
      return ""
    }

    return value.startsWith("/") ? value : `/${value}`
  }

  private normalizeWsBaseUrl(
    raw: string | undefined,
    fallbackBaseUrl: string,
  ): string {
    if (raw && raw.trim()) {
      try {
        const parsed = new URL(raw)
        return `${parsed.protocol}//${parsed.host}`
      } catch {
        // ignore and use fallback
      }
    }

    return fallbackBaseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
  }

  private connectWebSocket(url: string, token: string): void {
    this.isConnecting = true
    this.lastConnectUrl = url
    this.manualClose = false

    try {
      const protocols = token ? [`token.${token}`] : undefined
      this.ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url)

      this.ws.onopen = () => {
        this.isConnecting = false
        this.reconnectAttempts = 0
        this.emit({ type: "connected" })

        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()
          if (msg) {
            this.sendRaw(msg)
          }
        }

        this.openHandlers?.settle()
        this.openHandlers = null
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (this.wsMode === "pico") {
            this.handlePicoMessage(data as PicoWireMessage)
            return
          }

          if (data.type === "push") {
            this.handlePush(data as PetPush)
            return
          }

          this.handleResponse(data as PetResponse)
        } catch {
          this.emit({ type: "error", data: "Invalid message format" })
        }
      }

      this.ws.onerror = () => {
        this.isConnecting = false
        const msg = `WebSocket error (${this.lastConnectUrl})`
        this.emit({ type: "error", data: msg })
        this.openHandlers?.fail(new Error(msg))
        this.openHandlers = null
      }

      this.ws.onclose = (event) => {
        this.isConnecting = false
        this.emit({ type: "disconnected" })

        if (this.manualClose) {
          this.manualClose = false
          return
        }

        if (event.code !== 1000) {
          this.emit({
            type: "error",
            data: `WebSocket closed: code=${event.code} reason=${event.reason || "none"}`,
          })
        }

        this.attemptReconnect()
      }
    } catch (error) {
      this.isConnecting = false
      const err =
        error instanceof Error
          ? error
          : new Error("WebSocket connection failed")
      this.openHandlers?.fail(err)
      this.openHandlers = null
    }
  }

  private handlePush(push: PetPush): void {
    const data = push.data ?? {}

    switch (push.push_type) {
      case PUSH_TYPE_AI_CHAT:
        this.handleAIChatPush(data, Boolean(push.is_final))
        break
      case PUSH_TYPE_AUDIO:
      case PUSH_TYPE_AUDIO_AND_VOICE:
        this.handleAudioPush(data, Boolean(push.is_final))
        break
      case PUSH_TYPE_EMOTION_CHANGE:
        this.handleEmotionChangePush(data)
        break
      case PUSH_TYPE_ACTION_TRIGGER:
        this.handleActionTriggerPush(data)
        break
      default:
        break
    }
  }

  private mergeAssistantFinalContent(
    streamContent: string,
    finalChunk: string,
  ): string {
    if (!finalChunk) {
      return streamContent
    }
    if (!streamContent) {
      return finalChunk
    }
    if (finalChunk === streamContent) {
      return streamContent
    }
    if (streamContent.endsWith(finalChunk)) {
      return streamContent
    }
    if (finalChunk.startsWith(streamContent)) {
      return finalChunk
    }
    if (streamContent.startsWith(finalChunk)) {
      return streamContent
    }
    return `${streamContent}${finalChunk}`
  }

  private handleAIChatPush(data: unknown, forcedFinal = false): void {
    const timestamp = Date.now()
    let contentType = "text"
    let text = ""
    let chatId: number | null = null

    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        contentType = (parsed.type as string) || "text"
        const parsedChatId = Number(parsed.chat_id ?? parsed.chatId)
        if (Number.isFinite(parsedChatId)) {
          chatId = parsedChatId
        }
        text =
          (parsed.text as string) ||
          (parsed.Text as string) ||
          (parsed.content as string) ||
          data
      } catch {
        text = data
      }
    } else if (data && typeof data === "object") {
      const payload = data as Record<string, unknown>
      contentType =
        (payload.type as string) ||
        (payload.ContentType as string) ||
        "text"
      const parsedChatId = Number(payload.chat_id ?? payload.chatId)
      if (Number.isFinite(parsedChatId)) {
        chatId = parsedChatId
      }
      text =
        (payload.text as string) ||
        (payload.Text as string) ||
        (payload.content as string) ||
        ""
    }

    text = normalizeIncomingText(text)

    if (contentType === "tool") {
      if (!text) {
        return
      }
      this.emit({
        type: "message",
        data: {
          id: `tool-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          content: text,
          timestamp,
          streaming: false,
        } satisfies ChatMessage,
      })
      return
    }

    const isFinal = forcedFinal || contentType === "final"

    if ((contentType === "text" || contentType === "") && !isFinal) {
      if (!text) {
        return
      }
      if (!this.activeAssistantMessageId) {
        this.activeAssistantMessageId = `assistant-${timestamp}`
        this.activeAssistantContent = ""
        this.activeAssistantTimestamp = timestamp
      }

      if (chatId !== null) {
        if (
          this.activeAssistantLastChatId !== null &&
          chatId <= this.activeAssistantLastChatId
        ) {
          return
        }
        this.activeAssistantLastChatId = chatId
      }

      this.activeAssistantContent += text
      this.emit({
        type: "message",
        data: {
          id: this.activeAssistantMessageId,
          role: "assistant",
          content: this.activeAssistantContent,
          timestamp: this.activeAssistantTimestamp || timestamp,
          streaming: true,
        } satisfies ChatMessage,
      })
      return
    }

    if (isFinal) {
      if (chatId !== null) {
        if (
          this.activeAssistantLastChatId !== null &&
          chatId < this.activeAssistantLastChatId
        ) {
          return
        }
        this.activeAssistantLastChatId = chatId
      }

      const finalContent = normalizeIncomingText(
        this.mergeAssistantFinalContent(this.activeAssistantContent, text),
      )
      if (!finalContent) {
        this.emit({ type: "typing", data: "false" })
        this.resetAssistantState()
        return
      }
      if (!this.activeAssistantMessageId) {
        this.activeAssistantMessageId = `assistant-${timestamp}`
        this.activeAssistantTimestamp = timestamp
      }

      this.emit({
        type: "message",
        data: {
          id: this.activeAssistantMessageId,
          role: "assistant",
          content: finalContent,
          timestamp: this.activeAssistantTimestamp || timestamp,
          streaming: false,
        } satisfies ChatMessage,
      })
      this.emit({ type: "typing", data: "false" })
      this.resetAssistantState()
    }
  }

  private handleAudioPush(data: unknown, forcedFinal = false): void {
    if (typeof data === "string") {
      try {
        const payload = JSON.parse(data) as Record<string, unknown>
        if (forcedFinal && payload.is_final === undefined) {
          payload.is_final = true
        }
        this.emit({ type: "audio", data: payload })
        return
      } catch {
        const payload: Record<string, unknown> = { text: data }
        if (forcedFinal) {
          payload.is_final = true
        }
        this.emit({ type: "audio", data: payload })
        return
      }
    }

    const payload = { ...((data || {}) as Record<string, unknown>) }
    if (forcedFinal && payload.is_final === undefined) {
      payload.is_final = true
    }
    this.emit({ type: "audio", data: payload })
  }

  private handleEmotionChangePush(data: Record<string, unknown>): void {
    this.emit({
      type: "emotion_change",
      data: (data.emotion as string) || "",
    })
  }

  private handleActionTriggerPush(data: Record<string, unknown>): void {
    this.emit({
      type: "action_trigger",
      data: (data.action as string) || "",
    })
  }

  private handlePicoMessage(msg: PicoWireMessage): void {
    const msgType = (msg.type || "").trim()
    const payload = msg.payload || {}
    const timestamp = msg.timestamp || Date.now()

    switch (msgType) {
      case "message.create":
      case "message.update": {
        const content = String(payload.content || payload.text || "").trim()
        if (!content) {
          return
        }
        const messageId =
          String(payload.message_id || msg.id || `assistant-${timestamp}`)
        this.emit({
          type: "message",
          data: {
            id: messageId,
            role: "assistant",
            content,
            timestamp,
            streaming: false,
          } satisfies ChatMessage,
        })
        return
      }
      case "typing.start":
        this.emit({ type: "typing", data: "true" })
        return
      case "typing.stop":
        this.emit({ type: "typing", data: "false" })
        return
      case "error": {
        const message = String(payload.message || payload.error || "Pico channel error")
        this.emit({ type: "error", data: message })
        return
      }
      case "session.info":
      case "pong":
        return
      default:
        return
    }
  }

  private handleResponse(resp: PetResponse): void {
    if (resp.status === "error") {
      const message =
        String(resp.error || (resp.data?.error as string) || "Unknown error")
      this.emit({ type: "error", data: message })
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.manualClose = true
      this.ws.close()
      this.ws = null
    }
    this.reconnectAttempts = 0
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0
  }

  send(content: string): void {
    this.resetAssistantState()
    if (this.wsMode === "pico") {
      const requestId = `req-${++this.msgIdCounter}-${Date.now()}`
      const msg: PicoWireMessage = {
        type: "message.send",
        id: requestId,
        session_id: this.ensureSessionId(),
        timestamp: Date.now(),
        payload: {
          content,
        },
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendRaw(msg)
        return
      }
      this.messageQueue.push(msg as OutboundRequest)
      this.connect().catch(() => {
        this.emit({ type: "error", data: "Connection failed" })
      })
      return
    }

    this.sendAction(CHAT_ACTION, {
      text: content,
      session_key: this.ensureSessionId(),
    })
  }

  private sendAction(action: string, data?: Record<string, unknown>): void {
    const requestId = `req-${++this.msgIdCounter}-${Date.now()}`
    const msg: PetRequest = {
      action,
      data,
      request_id: requestId,
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw(msg)
      return
    }

    this.messageQueue.push(msg)
    this.connect().catch(() => {
      this.emit({ type: "error", data: "Connection failed" })
    })
  }

  private sendRaw(msg: OutboundRequest): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  subscribe(handler: WSEventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private emit(event: WSEvent): void {
    this.handlers.forEach((handler) => handler(event))
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit({
        type: "error",
        data: `Max reconnection attempts reached (${this.lastConnectUrl || "unknown url"})`,
      })
      return
    }

    this.reconnectAttempts += 1
    this.emit({ type: "reconnecting" })

    window.setTimeout(() => {
      this.connect().catch(() => {})
    }, this.reconnectDelay * this.reconnectAttempts)
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

let wsInstance: PicoClawWebSocket | null = null

export function getWebSocketInstance(): PicoClawWebSocket {
  if (!wsInstance) {
    wsInstance = new PicoClawWebSocket()
  }
  return wsInstance
}
