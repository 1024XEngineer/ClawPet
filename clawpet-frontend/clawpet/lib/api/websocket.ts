import {
  API_ENDPOINTS,
  DIRECT_PET_TOKEN_PATH,
  DIRECT_PET_WS_PATH,
  getApiBaseUrl,
  getDirectGatewayBaseUrl,
  isDirectGatewayEnabled,
  withLauncherAuthRequest,
} from "./config"

const CHAT_ACTION = "chat"
const AUDIO_FRAME_ACTION = "audio_frame"
const DEBUG_WS = process.env.NODE_ENV !== "production"

const PUSH_TYPE_AI_CHAT = "ai_chat"
const PUSH_TYPE_AUDIO = "audio"
const PUSH_TYPE_AUDIO_AND_VOICE = "audio_and_voice"
const PUSH_TYPE_TEXT_AND_AUDIO = "text_and_audio"
const PUSH_TYPE_ASR = "asr"
const PUSH_TYPE_EMOTION_CHANGE = "emotion_change"
const PUSH_TYPE_ACTION_TRIGGER = "action_trigger"
const PUSH_TYPE_ERROR = "error"
const PUSH_TYPE_PROGRESS_NUDGE = "progress_nudge"

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
  asr_enabled?: boolean
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
  authMode: "launcher" | "direct"
}

type WSEventData = ChatMessage | string | Record<string, unknown>
type WSMode = "pet" | "pico"
type OutboundRequest = PetRequest | PicoWireMessage

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
  | "asr"
  | "voice_progress"
  | "tool_status"
  | "typing"
  | "error"
  | "reconnecting"
  | "emotion_change"
  | "action_trigger"
  | "push_error"
  | "progress_nudge"

export interface WSEvent {
  type: WSEventType
  data?: WSEventData
}

type WSEventHandler = (event: WSEvent) => void

function normalizeIncomingText(text: string): string {
  return text.replace(/\{[^}]*\}/g, "").trim()
}

function normalizePushPayload(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      return parsed
    } catch {
      return {}
    }
  }
  if (data && typeof data === "object") {
    return data as Record<string, unknown>
  }
  return {}
}

export class PicoClawWebSocket {
  private ws: WebSocket | null = null
  private routeSessionId = ""
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
  private voiceInputBlockedReason = ""

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
        if (!this.routeSessionId) {
          this.routeSessionId = this.generateSessionId()
        }
        const { token, wsPath, wsBaseUrl, mode } =
          await this.resolveTokenAndPath()
        this.wsMode = mode
        this.voiceInputBlockedReason = ""
        const encodedSession = encodeURIComponent(this.routeSessionId)
        const query = `sessionId=${encodedSession}&session=${encodedSession}&session_id=${encodedSession}`
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

  ensureRouteSessionId(): string {
    if (!this.routeSessionId) {
      this.routeSessionId = this.generateSessionId()
    }
    return this.routeSessionId
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

    // Priority 1: Direct Gateway (18790) - always try first
    const directGatewayBase = getDirectGatewayBaseUrl()
    if (isDirectGatewayEnabled() && directGatewayBase) {
      candidates.push({
        baseUrl: directGatewayBase,
        tokenPath: DIRECT_PET_TOKEN_PATH,
        wsPath: DIRECT_PET_WS_PATH,
        authMode: "direct",
      })
    }

    // Priority 2: Launcher (18800) - fallback only
    const launcherBase = getApiBaseUrl().trim()
    if (launcherBase && launcherBase !== directGatewayBase) {
      candidates.push({
        baseUrl: launcherBase,
        tokenPath: API_ENDPOINTS.PET.TOKEN,
        wsPath: DIRECT_PET_WS_PATH,
        authMode: "launcher",
      })
    }

    let lastError = "PET channel not available"

    for (const candidate of candidates) {
      const endpoint = `${candidate.baseUrl}${candidate.tokenPath}`
      const requestInit: RequestInit =
        candidate.authMode === "launcher"
          ? withLauncherAuthRequest(endpoint, { method: "GET" })
          : { method: "GET", credentials: "omit" }
      const res = await fetch(endpoint, requestInit).catch(() => null)

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
      if (data.protocol === "pico" || wsPathFromToken === "/pico/ws") {
        lastError = "PET channel unavailable: server returned pico channel"
        continue
      }

      const resolvedPath = wsPathFromToken || candidate.wsPath
      if (resolvedPath !== DIRECT_PET_WS_PATH) {
        lastError = `PET channel unavailable: unexpected ws path ${resolvedPath}`
        continue
      }

      return {
        token: data.token || "",
        wsPath: resolvedPath,
        wsBaseUrl,
        mode: "pet",
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
          if (DEBUG_WS) {
            console.info("[petclaw][ws][inbound]", data)
          }

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
          if (DEBUG_WS) {
            console.warn("[petclaw][ws][inbound-invalid]", event.data)
          }
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
      case PUSH_TYPE_TEXT_AND_AUDIO:
        this.handleAudioPush(data, Boolean(push.is_final))
        break
      case PUSH_TYPE_ASR:
        this.handleASRPush(data)
        break
      case PUSH_TYPE_EMOTION_CHANGE:
        this.handleEmotionChangePush(data)
        break
      case PUSH_TYPE_ACTION_TRIGGER:
        this.handleActionTriggerPush(data)
        break
      case PUSH_TYPE_ERROR: {
        const errData = data as Record<string, unknown>
        this.emit({ type: "push_error", data: errData })
        if (typeof window !== "undefined" && window.electronAPI?.showErrorNotification) {
          window.electronAPI.showErrorNotification({
            level: String(errData.level ?? "error"),
            code: String(errData.code ?? ""),
            message: String(errData.message ?? ""),
          })
        }
        break
      }
      case PUSH_TYPE_PROGRESS_NUDGE:
        this.handleProgressNudgePush(data)
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
        type: "tool_status",
        data: {
          status: /执行完成|completed|done/i.test(text)
            ? "done"
            : /失败|error|failed/i.test(text)
              ? "error"
              : "busy",
          text,
          timestamp,
        },
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

    if (payload.type === "error" && typeof payload.text === "string") {
      this.emit({
        type: "push_error",
        data: { level: "error", code: "voice_tts", message: payload.text },
      })
      return
    }

    if (typeof payload.error === "string" && payload.error !== "") {
      this.emit({
        type: "push_error",
        data: {
          level: "error",
          code: typeof payload.code === "string" ? payload.code : "voice_tts",
          message: payload.error,
        },
      })
    }

    this.projectAudioTextChunk(payload)
    if (forcedFinal && payload.is_final === undefined) {
      payload.is_final = true
    }
    this.emit({ type: "audio", data: payload })
  }

  private handleASRPush(data: unknown): void {
    if (typeof data !== "object" || data === null) {
      return
    }
    const payload = data as Record<string, unknown>
    const text =
      (typeof payload.text === "string" && payload.text) ||
      (typeof payload.Text === "string" && payload.Text) ||
      ""
    if (!text) {
      return
    }
    const chatId = payload.chat_id ?? payload.chatId
    this.emit({
      type: "asr",
      data: { text, chat_id: chatId },
    })
  }

  private projectAudioTextChunk(payload: Record<string, unknown>): void {
    const text =
      (typeof payload.text === "string" && payload.text) ||
      (typeof payload.Text === "string" && payload.Text) ||
      ""
    if (!text) {
      return
    }

    if (payload.role === "user") {
      const chatId = payload.chat_id ?? payload.chatId
      this.emit({
        type: "asr",
        data: { text, chat_id: chatId },
      })
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
      data: (data.expression as string) || (data.action as string) || "",
    })
  }

  private handleProgressNudgePush(data: Record<string, unknown>): void {
    this.emit({
      type: "progress_nudge",
      data: normalizePushPayload(data),
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
      const baseMessage =
        String(resp.error || (resp.data?.error as string) || "Unknown error")
      const isAudioFrameGenericAsrFailure =
        resp.action === AUDIO_FRAME_ACTION && /语音识别失败\s*，?\s*请重试/.test(baseMessage)
      const audioFrameDetails =
        resp.action === AUDIO_FRAME_ACTION
          ? ` [audio_frame] ${baseMessage}; data=${JSON.stringify(resp.data || {})}`
          : ""
      const message = audioFrameDetails || baseMessage
      if (/unknown action\s*:\s*audio_frame/i.test(message)) {
        this.voiceInputBlockedReason = "当前服务不支持 audio_frame，请切换到 PET 语音通道。"
      }
      if (DEBUG_WS && resp.action === AUDIO_FRAME_ACTION) {
        console.warn("[petclaw][ws][audio_frame][error]", {
          error: baseMessage,
          data: resp.data || {},
          requestId: resp.request_id || "",
          suppressed: isAudioFrameGenericAsrFailure,
        })
      }
      if (isAudioFrameGenericAsrFailure) {
        return
      }
      this.emit({ type: "error", data: message })
      return
    }

    if (resp.action === AUDIO_FRAME_ACTION && resp.status === "ok") {
      this.emit({
        type: "voice_progress",
        data: {
          action: AUDIO_FRAME_ACTION,
          received: Boolean(resp.data?.received),
        },
      })
      return
    }

    if (resp.action === CHAT_ACTION && resp.status === "ok") {
      const text = this.extractTextFromResponseData(resp.data)
      if (!text) {
        return
      }
      const timestamp = Date.now()
      const messageId = `assistant-${timestamp}`
      this.emit({
        type: "message",
        data: {
          id: messageId,
          role: "assistant",
          content: text,
          timestamp,
          streaming: false,
        } satisfies ChatMessage,
      })
      this.emit({ type: "typing", data: "false" })
    }
  }

  private extractTextFromResponseData(data?: Record<string, unknown>): string {
    if (!data) {
      return ""
    }

    const direct =
      (typeof data.text === "string" && data.text) ||
      (typeof data.content === "string" && data.content) ||
      (typeof data.message === "string" && data.message) ||
      (typeof data.answer === "string" && data.answer) ||
      (typeof data.response === "string" && data.response) ||
      ""
    if (direct) {
      return normalizeIncomingText(direct)
    }

    const nested = data.data
    if (nested && typeof nested === "object") {
      const nestedObj = nested as Record<string, unknown>
      const nestedText =
        (typeof nestedObj.text === "string" && nestedObj.text) ||
        (typeof nestedObj.content === "string" && nestedObj.content) ||
        (typeof nestedObj.message === "string" && nestedObj.message) ||
        ""
      return normalizeIncomingText(nestedText)
    }

    return ""
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

  send(content: string, sessionKey?: string): void {
    this.resetAssistantState()
    const resolvedSessionKey = sessionKey?.trim() || this.generateSessionId()
    if (this.wsMode === "pico") {
      const requestId = `req-${++this.msgIdCounter}-${Date.now()}`
      const msg: PicoWireMessage = {
        type: "message.send",
        id: requestId,
        session_id: resolvedSessionKey,
        timestamp: Date.now(),
        payload: {
          content,
        },
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendRaw(msg)
        return
      }
      this.messageQueue.push(msg)
      this.connect().catch(() => {
        this.emit({ type: "error", data: "Connection failed" })
      })
      return
    }

    this.sendAction(CHAT_ACTION, {
      text: content,
      session_key: resolvedSessionKey,
    })
  }

  sendAudioFrame(audioBase64: string, sequence: number, sessionKey: string): boolean {
    const normalizedAudio = audioBase64.trim()
    const normalizedSessionKey = sessionKey.trim()
    if (!normalizedAudio || !normalizedSessionKey) {
      return false
    }

    if (this.wsMode === "pico") {
      this.emit({ type: "error", data: "当前通道不支持语音输入" })
      return false
    }

    if (this.voiceInputBlockedReason) {
      this.emit({ type: "error", data: this.voiceInputBlockedReason })
      return false
    }

    const timestampUint32 = Math.floor(Date.now() % 4294967296)

    this.sendAction(
      AUDIO_FRAME_ACTION,
      {
      audio: normalizedAudio,
      format: "pcm",
      sample_rate: 16000,
      channels: 1,
      sequence,
      timestamp: timestampUint32,
      session_key: normalizedSessionKey,
      },
      { queueIfDisconnected: false },
    )
    return true
  }

  private sendAction(
    action: string,
    data?: Record<string, unknown>,
    options: { queueIfDisconnected?: boolean } = {},
  ): void {
    const queueIfDisconnected = options.queueIfDisconnected ?? true
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

    if (!queueIfDisconnected) {
      this.emit({ type: "error", data: "Connection not ready" })
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

  getVoiceInputAvailability(sessionKey?: string): {
    available: boolean
    reason: string
  } {
    if (this.voiceInputBlockedReason) {
      return { available: false, reason: this.voiceInputBlockedReason }
    }
    if (this.wsMode !== "pet") {
      return { available: false, reason: "当前不是 PET 通道，无法使用语音输入。" }
    }
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return { available: false, reason: "连接未建立，无法开始录音。" }
    }
    if (!sessionKey?.trim()) {
      return { available: false, reason: "会话未就绪，无法开始录音。" }
    }
    return { available: true, reason: "" }
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

  async addVoiceModel(data: {
    name: string
    provider: string
    model?: string
    api_key?: string
    api_base?: string
    voice_id?: string
    extra?: Record<string, unknown>
    enabled?: boolean
  }): Promise<PetResponse> {
    return this.requestAction("voice_model_add", data)
  }

  async updateVoiceModel(data: {
    name: string
    provider?: string
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

  async deleteVoiceModel(name: string): Promise<PetResponse> {
    return this.requestAction("voice_model_delete", { name })
  }

  async getASRModelList(): Promise<PetResponse & { data?: ASRModelListData }> {
    return this.requestAction<ASRModelListData>("asr_model_list_get")
  }

  async getASRModel(name: string): Promise<PetResponse & { data?: ASRModelData }> {
    return this.requestAction<ASRModelData>("asr_model_get", { name })
  }

  async addASRModel(data: {
    name: string
    provider: string
    model?: string
    api_key?: string
    api_base?: string
    extra?: Record<string, unknown>
    enabled?: boolean
  }): Promise<PetResponse> {
    return this.requestAction("asr_model_add", data)
  }

  async updateASRModel(data: {
    name: string
    provider?: string
    api_key?: string
    api_base?: string
    model?: string
    enabled?: boolean
    extra?: Record<string, unknown>
  }): Promise<PetResponse> {
    return this.requestAction("asr_model_update", data)
  }

  async setDefaultASRModel(name: string): Promise<PetResponse> {
    return this.requestAction("asr_model_set_default", { name })
  }

  async deleteASRModel(name: string): Promise<PetResponse> {
    return this.requestAction("asr_model_delete", { name })
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

  // ---- Cron Jobs ----
  async listCronJobs(includeDisabled = false): Promise<PetResponse & { data?: CronListResponse }> {
    return this.requestAction<CronListResponse>("cron_list", { include_disabled: includeDisabled })
  }

  async addCronJob(data: CronAddRequest): Promise<PetResponse & { data?: CronAddResponse }> {
    return this.requestAction<CronAddResponse>("cron_add", data)
  }

  async removeCronJob(jobId: string): Promise<PetResponse> {
    return this.requestAction("cron_remove", { job_id: jobId })
  }

  async enableCronJob(jobId: string): Promise<PetResponse> {
    return this.requestAction("cron_enable", { job_id: jobId })
  }

  async disableCronJob(jobId: string): Promise<PetResponse> {
    return this.requestAction("cron_disable", { job_id: jobId })
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

export interface ASRModelData {
  name: string
  provider: string
  api_base: string
  model: string
  api_key: string
  extra: Record<string, unknown>
  enabled: boolean
  is_default: boolean
}

export interface ASRModelListData {
  models: ASRModelData[]
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

// ---- Cron Job Types ----
export interface CronJobInfo {
  id: string
  name: string
  enabled: boolean
  schedule_kind: "at" | "every" | "cron"
  every_ms: number | null
  cron_expr: string | null
  at_ms: number | null
  message: string
  channel: string
  to: string
  next_run_at_ms: number | null
  last_run_at_ms: number | null
  last_status: string
  created_at_ms: number
}

export interface CronListResponse {
  jobs: CronJobInfo[]
}

export interface CronAddResponse {
  job_id: string
  name: string
}

export interface CronAddRequest {
  name: string
  message: string
  at_seconds?: number
  every_seconds?: number
  cron_expr?: string
}

let wsInstance: PicoClawWebSocket | null = null

export function getWebSocketInstance(): PicoClawWebSocket {
  if (!wsInstance) {
    wsInstance = new PicoClawWebSocket()
  }
  return wsInstance
}
