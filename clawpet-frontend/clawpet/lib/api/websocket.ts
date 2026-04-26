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

export interface CharacterProfileData {
  pet_id: string
  pet_name: string
  pet_persona: string
  pet_persona_type: string
  avatar?: string
  created_at?: string
  updated_at?: string
}

export interface PetConfigData {
  emotion_enabled?: boolean
  reminder_enabled?: boolean
  proactive_care?: boolean
  proactive_interval_minutes?: number
  voice_enabled?: boolean
  language?: string
}

export interface EmotionData {
  pet_id: string
  emotion: string
  joy: number
  anger: number
  sadness: number
  disgust: number
  surprise: number
  fear: number
  description: string
}

export interface UserProfileUpdateData {
  display_name?: string
  role?: string
  language?: string
  chronotype?: string
  personality_tone?: string
  anxiety_level?: number
  pressure_level?: string
  extra?: Record<string, unknown>
}

interface PendingActionRequest {
  action: string
  resolve: (resp: PetResponse) => void
  reject: (err: Error) => void
  timeoutId: number
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
  private pendingActionRequests: Map<string, PendingActionRequest[]> = new Map()

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
          chatId < this.activeAssistantLastChatId
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
        this.projectAudioTextChunk(payload)
        if (forcedFinal && payload.is_final === undefined) {
          payload.is_final = true
        }
        this.emit({ type: "audio", data: payload })
        return
      } catch {
        const payload: Record<string, unknown> = { text: data }
        this.projectAudioTextChunk(payload)
        if (forcedFinal) {
          payload.is_final = true
        }
        this.emit({ type: "audio", data: payload })
        return
      }
    }

    const payload = { ...((data || {}) as Record<string, unknown>) }
    this.projectAudioTextChunk(payload)
    if (forcedFinal && payload.is_final === undefined) {
      payload.is_final = true
    }
    this.emit({ type: "audio", data: payload })
  }

  private projectAudioTextChunk(payload: Record<string, unknown>): void {
    const text =
      (typeof payload.text === "string" && payload.text) ||
      (typeof payload.Text === "string" && payload.Text) ||
      ""
    if (!text) {
      return
    }

    const textPayload: Record<string, unknown> = {
      type: "text",
      text,
    }

    const chatId = payload.chat_id ?? payload.chatId
    if (chatId !== undefined) {
      textPayload.chat_id = chatId
    }

    this.handleAIChatPush(textPayload, false)
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
    const actionKey = typeof resp.action === "string" ? resp.action : ""
    if (actionKey) {
      const queue = this.pendingActionRequests.get(actionKey)
      if (queue && queue.length > 0) {
        const pending = queue.shift()
        if (queue.length === 0) {
          this.pendingActionRequests.delete(actionKey)
        }
        if (pending) {
          window.clearTimeout(pending.timeoutId)
          if (resp.status === "error") {
            const message = String(
              resp.error || (resp.data?.error as string) || `Action failed: ${actionKey}`,
            )
            pending.reject(new Error(message))
          } else {
            pending.resolve(resp)
          }
        }
      }
    }

    if (resp.status === "error") {
      const message =
        String(resp.error || (resp.data?.error as string) || "Unknown error")
      this.emit({ type: "error", data: message })
    }
  }

  async requestAction<T extends Record<string, unknown> = Record<string, unknown>>(
    action: string,
    data?: Record<string, unknown>,
    timeoutMs = 12000,
  ): Promise<PetResponse & { data?: T }> {
    if (!action.trim()) {
      throw new Error("Action is required")
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      await this.connect()
    }

    if (this.wsMode !== "pet") {
      throw new Error("PET channel is not available for action request")
    }

    return new Promise<PetResponse & { data?: T }>((resolve, reject) => {
      const requestId = `req-${++this.msgIdCounter}-${Date.now()}`
      const msg: PetRequest = {
        action,
        data,
        request_id: requestId,
      }

      const timeoutId = window.setTimeout(() => {
        const queue = this.pendingActionRequests.get(action)
        if (!queue) {
          return
        }
        const idx = queue.findIndex((item) => item.timeoutId === timeoutId)
        if (idx >= 0) {
          queue.splice(idx, 1)
        }
        if (queue.length === 0) {
          this.pendingActionRequests.delete(action)
        }
        reject(new Error(`Action timeout: ${action}`))
      }, timeoutMs)

      const pending: PendingActionRequest = {
        action,
        resolve: (resp) => resolve(resp as PetResponse & { data?: T }),
        reject,
        timeoutId,
      }

      const queue = this.pendingActionRequests.get(action)
      if (queue) {
        queue.push(pending)
      } else {
        this.pendingActionRequests.set(action, [pending])
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendRaw(msg)
        return
      }

      window.clearTimeout(timeoutId)
      const pendingQueue = this.pendingActionRequests.get(action)
      if (pendingQueue) {
        const idx = pendingQueue.indexOf(pending)
        if (idx >= 0) {
          pendingQueue.splice(idx, 1)
        }
        if (pendingQueue.length === 0) {
          this.pendingActionRequests.delete(action)
        }
      }
      reject(new Error("Connection not ready"))
    })
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

  async getVoiceModelList(): Promise<PetResponse & { data?: VoiceModelListData }> {
    return this.requestAction<VoiceModelListData>("voice_model_list_get")
  }

  async getCharacter(): Promise<PetResponse & { data?: CharacterProfileData }> {
    return this.requestAction<CharacterProfileData>("character_get", {})
  }

  async updateCharacter(data: {
    pet_id?: string
    pet_name?: string
    pet_persona?: string
    pet_persona_type?: string
  }): Promise<PetResponse & { data?: CharacterProfileData }> {
    return this.requestAction<CharacterProfileData>("character_update", data)
  }

  async switchCharacter(characterId: string): Promise<PetResponse> {
    return this.requestAction("character_switch", { character_id: characterId })
  }

  async getPetConfig(): Promise<PetResponse & { data?: PetConfigData }> {
    return this.requestAction<PetConfigData>("config_get", {})
  }

  async updatePetConfig(data: PetConfigData): Promise<PetResponse & { data?: PetConfigData }> {
    return this.requestAction<PetConfigData>("config_update", data)
  }

  async getEmotion(): Promise<PetResponse & { data?: EmotionData }> {
    return this.requestAction<EmotionData>("emotion_get", {})
  }

  async updateUserProfile(data: UserProfileUpdateData): Promise<PetResponse> {
    return this.requestAction("user_profile_update", data)
  }

  async submitOnboardingConfig(data: {
    pet_name: string
    pet_persona: string
    pet_persona_type: string
  }): Promise<PetResponse> {
    return this.requestAction("onboarding_config", data)
  }

  async getVoiceModel(name: string): Promise<PetResponse & { data?: VoiceModelData }> {
    return this.requestAction<VoiceModelData>("voice_model_get", { name })
  }

  async updateVoiceModel(data: {
    name: string
    api_key?: string
    api_base?: string
    model?: string
    voice_id?: string
    enabled?: boolean
    extra?: Record<string, unknown>
  }): Promise<PetResponse> {
    return this.requestAction("voice_model_update", data)
  }

  async setDefaultVoiceModel(name: string): Promise<PetResponse> {
    return this.requestAction("voice_model_set_default", { name })
  }

  async getVoiceModelVoices(data: {
    provider: string
    model?: string
    api_key?: string
    secret_key?: string
  }): Promise<PetResponse & { data?: VoiceModelVoicesData }> {
    return this.requestAction<VoiceModelVoicesData>("voice_model_get_voices", data)
  }

  async getModelList(): Promise<PetResponse & { data?: ModelListData }> {
    return this.requestAction<ModelListData>("model_list_get")
  }

  async addModel(data: AddModelRequest): Promise<PetResponse> {
    return this.requestAction("model_add", data)
  }

  async updateModel(data: UpdateModelRequest): Promise<PetResponse> {
    return this.requestAction("model_update", data)
  }

  async deleteModel(modelName: string): Promise<PetResponse> {
    return this.requestAction("model_delete", { model_name: modelName })
  }

  async setDefaultModel(modelName: string): Promise<PetResponse> {
    return this.requestAction("model_set_default", { model_name: modelName })
  }
}

export interface VoiceModelData {
  name: string
  provider: string
  api_base: string
  model: string
  voice_id: string
  api_key: string
  extra: Record<string, unknown>
  enabled: boolean
  is_default: boolean
}

export interface VoiceModelListData {
  models: VoiceModelData[]
  default: string
}

export interface VoiceModelVoicesData {
  provider: string
  volcengine_voices?: VoiceModelVoice[]
}

export interface VoiceModelVoice {
  VoiceType: string
  Name: string
  Gender: string
  Age: string
  Description: string
  Language: string
  Emotion: string
}

export interface ModelInfo {
  index: number
  model_name: string
  model: string
  api_base?: string
  api_key: string
  proxy?: string
  auth_method?: string
  connect_mode?: string
  workspace?: string
  rpm?: number
  max_tokens_field?: string
  request_timeout?: number
  thinking_level?: string
  extra_body?: Record<string, unknown>
  enabled: boolean
  is_default: boolean
  is_virtual: boolean
}

export interface ModelListData {
  models: ModelInfo[]
  total: number
  default_model: string
}

export interface AddModelRequest {
  model_name: string
  model: string
  api_key?: string
  api_base?: string
  proxy?: string
  auth_method?: string
  connect_mode?: string
  workspace?: string
  rpm?: number
  max_tokens_field?: string
  request_timeout?: number
  thinking_level?: string
  extra_body?: Record<string, unknown>
}

export interface UpdateModelRequest {
  model_name: string
  new_model?: string
  api_key?: string
  api_base?: string | null
  proxy?: string | null
  auth_method?: string
  connect_mode?: string
  workspace?: string
  rpm?: number
  max_tokens_field?: string
  request_timeout?: number
  thinking_level?: string | null
  extra_body?: Record<string, unknown>
}

let wsInstance: PicoClawWebSocket | null = null

export function getWebSocketInstance(): PicoClawWebSocket {
  if (!wsInstance) {
    wsInstance = new PicoClawWebSocket()
  }
  return wsInstance
}
