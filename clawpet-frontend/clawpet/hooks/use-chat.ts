"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ensureBackendReadyForChat } from "@/lib/api/bootstrap"
import {
  getWebSocketInstance,
  type ChatMessage,
  type WSEvent,
} from "@/lib/api"
import {
  deleteSession as deleteSessionOnServer,
  getSessionHistory,
} from "@/lib/api/sessions"

const SESSIONS_STORAGE_KEY = "petclaw_sessions"
const ACTIVE_SESSION_KEY = "petclaw_active_session"
const PPT_SKILL_NAME = "student-ppt-pet"
const PPT_TRIGGER_RE = /(\bppt\b|PPT|幻灯片|答辩|汇报|开题|课件)/i

export interface UseChatOptions {
  onMessage?: (message: ChatMessage) => void
  onError?: (error: string) => void
  onConnectionChange?: (connected: boolean) => void
}

export interface ChatSessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
}

interface ChatSessionState extends ChatSessionSummary {
  messages: ChatMessage[]
}

export interface UseChatResult {
  messages: ChatMessage[]
  sessions: ChatSessionSummary[]
  activeSessionId: string
  isConnected: boolean
  isTyping: boolean
  error: string | null
  sendMessage: (content: string) => void
  newChat: () => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  loadSessionHistory: (sessionId: string) => Promise<void>
  reconnect: () => void
  clearError: () => void
}

interface AudioPushData {
  chat_id?: number
  type?: string
  text?: string
  audio?: string
  audio_mime?: string
  duration?: number
  seq?: number
  error?: string
  is_final?: boolean
}

interface AudioSegmentItem {
  chatId: number | null
  seq: number
  text: string
  audioBase64: string
  audioMime?: string
  durationMs: number
}

interface ResolvedAudioChunkPayload {
  audioBase64: string
  audioMime?: string
}

const EMPTY_SESSION_TITLE = "新对话"

function generateChatSessionKey(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

function normalizeTimestamp(value: number | string): number {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : Date.now()
}

function createSessionState(id: string): ChatSessionState {
  const now = Date.now()
  return {
    id,
    title: EMPTY_SESSION_TITLE,
    preview: "",
    updatedAt: now,
    messageCount: 0,
    messages: [],
  }
}

// localStorage 持久化函数
function saveSessionsToStorage(sessions: ChatSessionState[], activeSessionId: string) {
  if (typeof window === "undefined" || !window.localStorage) {
    return
  }

  try {
    const data = {
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        preview: session.preview,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        messages: session.messages,
      })),
      activeSessionId,
      savedAt: Date.now(),
    }
    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(data))
    window.localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId)
    console.log("[petclaw] 会话已保存到 localStorage", {
      sessionCount: sessions.length,
      activeSessionId,
    })
  } catch (error) {
    console.error("[petclaw] 保存会话到 localStorage 失败:", error)
  }
}

// 从 localStorage 恢复会话
function loadSessionsFromStorage(): {
  sessions: ChatSessionState[]
  activeSessionId: string
} | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null
  }

  try {
    const dataStr = window.localStorage.getItem(SESSIONS_STORAGE_KEY)
    if (!dataStr) {
      return null
    }

    const data = JSON.parse(dataStr)
    if (!data.sessions || !Array.isArray(data.sessions)) {
      return null
    }

    console.log("[petclaw] 从 localStorage 恢复会话", {
      sessionCount: data.sessions.length,
      activeSessionId: data.activeSessionId,
    })

    return {
      sessions: data.sessions,
      activeSessionId: data.activeSessionId || data.sessions[0]?.id || "",
    }
  } catch (error) {
    console.error("[petclaw] 从 localStorage 恢复会话失败:", error)
    return null
  }
}

function buildSessionSummary(session: ChatSessionState): ChatSessionSummary {
  const firstUserMessage = session.messages.find(
    (message) => message.role === "user" && message.content.trim(),
  )

  return {
    id: session.id,
    title:
      (firstUserMessage?.content || EMPTY_SESSION_TITLE).trim().slice(0, 18) ||
      EMPTY_SESSION_TITLE,
    preview: "",
    updatedAt: normalizeTimestamp(
      firstUserMessage?.timestamp ?? session.updatedAt,
    ),
    messageCount: session.messages.length,
  }
}

function mergeMessage(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id)
  if (existingIndex >= 0) {
    const next = [...messages]
    next[existingIndex] = message
    return next
  }
  return [...messages, message]
}

function buildOutgoingMessage(raw: string): string {
  const text = raw.trim()
  if (text.startsWith("/")) {
    return text
  }
  if (!PPT_TRIGGER_RE.test(text)) {
    return text
  }
  return `/use ${PPT_SKILL_NAME} ${text}`
}

function decodeBase64Chunk(value: string): Uint8Array | null {
  let base64 = value
    .replace(/^data:audio\/[^;]+;base64,/, "")
    .replace(/\s+/g, "")

  // Accept URL-safe base64 payloads.
  base64 = base64.replace(/-/g, "+").replace(/_/g, "/")
  const mod = base64.length % 4
  if (mod === 2) {
    base64 += "=="
  } else if (mod === 3) {
    base64 += "="
  }

  if (!base64) {
    return new Uint8Array()
  }

  try {
    const binary = window.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch (error) {
    console.warn("[petclaw] dropped malformed audio chunk", error)
    return null
  }
}

function inferAudioMimeType(bytes: Uint8Array | null): string {
  if (!bytes || bytes.length < 4) {
    return "audio/mpeg"
  }

  // ID3 tag (MP3)
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mpeg"
  }
  // MP3 frame sync
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg"
  }
  // WAV
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return "audio/wav"
  }
  // OGG
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return "audio/ogg"
  }
  // FLAC
  if (
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  ) {
    return "audio/flac"
  }

  return "audio/mpeg"
}

function normalizeAudioMimeType(mime?: string): string | undefined {
  if (!mime) {
    return undefined
  }
  const normalized = mime.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }
  switch (normalized) {
    case "audio/mp3":
    case "audio/mpeg3":
      return "audio/mpeg"
    case "audio/mpeg":
    case "audio/wav":
    case "audio/x-wav":
    case "audio/ogg":
    case "audio/flac":
      return normalized === "audio/x-wav" ? "audio/wav" : normalized
    default:
      return undefined
  }
}

function parseDataAudioURL(value: string): { format: string; data: string } | null {
  if (!value.startsWith("data:audio/")) {
    return null
  }
  const payload = value.slice("data:audio/".length)
  const commaIndex = payload.indexOf(",")
  if (commaIndex < 0) {
    return null
  }
  const meta = payload.slice(0, commaIndex).trim()
  const data = payload.slice(commaIndex + 1).trim()
  const semicolonIndex = meta.indexOf(";")
  const format = (semicolonIndex >= 0 ? meta.slice(0, semicolonIndex) : meta).trim()
  if (!format || !data) {
    return null
  }
  return { format, data }
}

function isLikelyBase64Audio(value: string): boolean {
  const normalized = value.replace(/^data:audio\/[^;]+;base64,/, "").replace(/\s+/g, "")
  if (normalized.length < 64) {
    return false
  }
  if (normalized.length % 4 !== 0) {
    return false
  }
  return /^[A-Za-z0-9+/=]+$/.test(normalized)
}

function resolveAudioChunkPayload(data: AudioPushData): ResolvedAudioChunkPayload | null {
  const explicitMime = normalizeAudioMimeType(data.audio_mime)

  if (typeof data.audio === "string" && data.audio.trim()) {
    const audioValue = data.audio.trim()
    const parsed = parseDataAudioURL(audioValue)
    if (parsed) {
      return {
        audioBase64: parsed.data,
        audioMime: explicitMime || normalizeAudioMimeType(`audio/${parsed.format}`),
      }
    }
    return {
      audioBase64: audioValue,
      audioMime: explicitMime,
    }
  }

  if (data.type === "audio" && typeof data.text === "string" && data.text.trim()) {
    const textValue = data.text.trim()
    const parsed = parseDataAudioURL(textValue)
    if (parsed) {
      return {
        audioBase64: parsed.data,
        audioMime: explicitMime || normalizeAudioMimeType(`audio/${parsed.format}`),
      }
    }
    return {
      audioBase64: textValue,
      audioMime: explicitMime,
    }
  }

  if (typeof data.text === "string" && isLikelyBase64Audio(data.text)) {
    return {
      audioBase64: data.text,
      audioMime: explicitMime,
    }
  }

  return null
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const [isConnected, setIsConnected] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef(getWebSocketInstance())
  const optionsRef = useRef(options)
  const initialSessionIdRef = useRef(generateChatSessionKey())

  // 尝试从 localStorage 加载会话
  const storedSessions = loadSessionsFromStorage()
  const [activeSessionId, setActiveSessionId] = useState(
    storedSessions?.activeSessionId || initialSessionIdRef.current,
  )
  const [sessionsState, setSessionsState] = useState<ChatSessionState[]>(
    storedSessions?.sessions || [createSessionState(initialSessionIdRef.current)],
  )
  const activeSessionIdRef = useRef(activeSessionId)
  const audioQueueRef = useRef<AudioSegmentItem[]>([])
  const audioExpectedSeqRef = useRef<number | null>(null)
  const audioArrivalSeqRef = useRef(0)
  const audioActiveChatIdRef = useRef<number | null>(null)
  const audioIsPlayingRef = useRef(false)
  const audioSeenSeqRef = useRef<Set<string>>(new Set())
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentAudioUrlRef = useRef<string | null>(null)
  const audioAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastQueuedSegmentRef = useRef<{ chatId: number | null; seq: number | null }>({
    chatId: null,
    seq: null,
  })
  const lastAssistantTextRef = useRef("")
  const lastEmotionRef = useRef("neutral")
  const lastPlayedAudioRef = useRef<{ value: string; at: number }>({
    value: "",
    at: 0,
  })
  const lastBubbleTextRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  })

  const updateSessionMessages = useCallback(
    (sessionId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
      setSessionsState((prev) => {
        const next = prev.map((session) => {
          if (session.id !== sessionId) {
            return session
          }

          const nextMessages = updater(session.messages)
          return {
            ...session,
            ...buildSessionSummary({
              ...session,
              messages: nextMessages,
            }),
            messages: nextMessages,
          }
        })

        // 保存到 localStorage
        saveSessionsToStorage(next, activeSessionIdRef.current)

        return next
      })
    },
    [],
  )

  // 监听 activeSessionId 或 sessionsState 变化并保存到 localStorage
  useEffect(() => {
    saveSessionsToStorage(sessionsState, activeSessionId)
  }, [activeSessionId, sessionsState])

  // 页面卸载或组件卸载时保存会话
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveSessionsToStorage(sessionsState, activeSessionId)
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      // 组件卸载时也保存
      saveSessionsToStorage(sessionsState, activeSessionId)
    }
  }, [sessionsState, activeSessionId])

  const loadSessionHistory = useCallback(async (sessionId: string) => {
    try {
      const history = await getSessionHistory(sessionId)
      if (!history) {
        return
      }

      const messages: ChatMessage[] = history.messages.map((msg, index) => ({
        id: `${sessionId}-${index}`,
        role: msg.role,
        content: msg.content,
        timestamp: Date.now(),
      }))

      setSessionsState((prev) => {
        const existingIndex = prev.findIndex((s) => s.id === sessionId)
        if (existingIndex >= 0) {
          const updated = [...prev]
          updated[existingIndex] = {
            ...updated[existingIndex],
            messages,
            messageCount: messages.length,
          }
          return updated
        }

        const now = Date.now()
        const firstUserMessage = messages.find(
          (m) => m.role === "user" && m.content.trim(),
        )
        const newSession: ChatSessionState = {
          id: sessionId,
          title:
            (firstUserMessage?.content || EMPTY_SESSION_TITLE)
              .trim()
              .slice(0, 18) || EMPTY_SESSION_TITLE,
          preview: "",
          updatedAt: now,
          messageCount: messages.length,
          messages,
        }
        return [newSession, ...prev]
      })
    } catch (err) {
      console.warn("[petclaw] Failed to load session history:", err)
    }
  }, [])

  const showBubble = useCallback((text: string | null, audio?: string) => {
    window.electronAPI?.showBubble?.({
      text,
      emotion: lastEmotionRef.current,
      audio,
    })
  }, [])

  const clearAudioAdvanceTimer = useCallback(() => {
    if (audioAdvanceTimerRef.current) {
      clearTimeout(audioAdvanceTimerRef.current)
      audioAdvanceTimerRef.current = null
    }
  }, [])

  const playAudioBase64 = useCallback(
    (
      audioBase64: string,
      bubbleText?: string | null,
      audioMimeHint?: string,
      seq?: number,
      durationMs?: number,
      onSettled?: () => void,
    ) => {
      if (!audioBase64) {
        onSettled?.()
        return
      }

      if (
        lastPlayedAudioRef.current.value === audioBase64 &&
        Date.now() - lastPlayedAudioRef.current.at < 4000
      ) {
        onSettled?.()
        return
      }

      lastPlayedAudioRef.current = {
        value: audioBase64,
        at: Date.now(),
      }

      if (window.electronAPI?.showBubble) {
        // Keep bubble text sync, but always play audio via HTMLAudio to ensure
        // deterministic ordered playback in chat runtime.
        showBubble(bubbleText ?? (lastAssistantTextRef.current || null))
      }

      const decoded = decodeBase64Chunk(audioBase64)
      const mimeType = normalizeAudioMimeType(audioMimeHint) || inferAudioMimeType(decoded)
      if (!decoded || decoded.length === 0) {
        console.error("[petclaw] audio decode failed", {
          seq,
          mimeType,
          base64Length: audioBase64.length,
          audioPrefix: audioBase64.slice(0, 64),
        })
        onSettled?.()
        return
      }
      const byteHead = Array.from(decoded.slice(0, 12)).map((v) =>
        v.toString(16).padStart(2, "0"),
      )
      const rawCandidates = Array.from(
        new Set(
          [
            normalizeAudioMimeType(audioMimeHint),
            mimeType,
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
          ].filter((v): v is string => Boolean(v)),
        ),
      )
      const probeAudio = document.createElement("audio")
      const supportedCandidates = rawCandidates.filter(
        (candidate) => probeAudio.canPlayType(candidate) !== "",
      )
      const mimeCandidates =
        supportedCandidates.length > 0 ? supportedCandidates : rawCandidates

      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current)
        currentAudioUrlRef.current = null
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
      }

      let settled = false
      const settleOnce = () => {
        if (!settled) {
          settled = true
          onSettled?.()
        }
      }

      const tryPlayWithMime = (index: number) => {
        if (index >= mimeCandidates.length) {
          console.error("[petclaw] exhausted audio mime candidates", {
            seq,
            mimeHint: audioMimeHint,
            inferredMime: mimeType,
            mimeCandidates,
            base64Length: audioBase64.length,
            byteHead,
          })
          settleOnce()
          return
        }

        const attemptMime = mimeCandidates[index]
        const blob = new Blob([decoded], { type: attemptMime })
        const audioUrl = URL.createObjectURL(blob)
        currentAudioUrlRef.current = audioUrl
        const audio = new Audio(audioUrl)
        currentAudioRef.current = audio

        audio.onended = () => {
          if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current)
            currentAudioUrlRef.current = null
          }
          settleOnce()
        }

        audio.onerror = (errorEvent) => {
          const mediaError = audio.error
          console.warn("[petclaw] audio element error", {
            errorEvent,
            seq,
            attemptMime,
            base64Length: audioBase64.length,
            mediaErrorCode: mediaError?.code,
            mediaErrorMessage: mediaError?.message,
            byteHead,
          })
          if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current)
            currentAudioUrlRef.current = null
          }
          tryPlayWithMime(index + 1)
        }

        void audio.play().catch((playbackError) => {
          console.warn("[petclaw] failed to play audio", {
            playbackError,
            seq,
            attemptMime,
            base64Length: audioBase64.length,
            byteHead,
          })
          if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current)
            currentAudioUrlRef.current = null
          }
          tryPlayWithMime(index + 1)
        })
      }

      tryPlayWithMime(0)
    },
    [clearAudioAdvanceTimer, showBubble],
  )

  const resetAudioQueue = useCallback(() => {
    clearAudioAdvanceTimer()
    audioQueueRef.current = []
    audioExpectedSeqRef.current = null
    audioArrivalSeqRef.current = 0
    audioActiveChatIdRef.current = null
    audioSeenSeqRef.current = new Set()
    audioIsPlayingRef.current = false
    lastQueuedSegmentRef.current = { chatId: null, seq: null }
  }, [clearAudioAdvanceTimer])

  const drainAudioQueue = useCallback(() => {
    if (audioIsPlayingRef.current) {
      return
    }

    const queue = audioQueueRef.current
    if (queue.length === 0) {
      return
    }

    if (audioExpectedSeqRef.current === null) {
      audioExpectedSeqRef.current = queue[0]?.seq ?? null
    }

    let nextIndex = queue.findIndex((item) => item.seq === audioExpectedSeqRef.current)
    if (nextIndex < 0) {
      nextIndex = 0
      audioExpectedSeqRef.current = queue[0]?.seq ?? null
    }

    if (nextIndex < 0 || audioExpectedSeqRef.current === null) {
      return
    }

    const [nextSegment] = queue.splice(nextIndex, 1)
    audioIsPlayingRef.current = true

    playAudioBase64(
      nextSegment.audioBase64,
      nextSegment.text || null,
      nextSegment.audioMime,
      nextSegment.seq,
      nextSegment.durationMs,
      () => {
        audioIsPlayingRef.current = false
        audioExpectedSeqRef.current = nextSegment.seq + 1
        drainAudioQueue()
      },
    )
  }, [playAudioBase64])

  const enqueueAudioSegment = useCallback(
    (segment: AudioSegmentItem) => {
      const audioFingerprint = segment.audioBase64.slice(0, 24)
      const seqKey = `${segment.chatId ?? "na"}:${segment.seq}:${audioFingerprint}`
      if (audioSeenSeqRef.current.has(seqKey)) {
        return
      }
      audioSeenSeqRef.current.add(seqKey)

      audioQueueRef.current.push(segment)
      audioQueueRef.current.sort((left, right) => left.seq - right.seq)
      if (audioExpectedSeqRef.current === null) {
        audioExpectedSeqRef.current = audioQueueRef.current[0]?.seq ?? segment.seq
      }
      lastQueuedSegmentRef.current = { chatId: segment.chatId, seq: segment.seq }

      drainAudioQueue()
    },
    [drainAudioQueue],
  )

  const connectWithBootstrap = useCallback(async () => {
    setError(null)
    setIsTyping(false)

    const bootstrap = await ensureBackendReadyForChat()
    if (!bootstrap.ok) {
      const reason = bootstrap.reason || "Backend not ready for chat"
      setIsConnected(false)
      setError(reason)
      optionsRef.current.onConnectionChange?.(false)
      optionsRef.current.onError?.(reason)
      return
    }

    wsRef.current.resetReconnectAttempts()

    try {
      await wsRef.current.connect()
    } catch (err) {
      setError("连接失败")
      console.error("WebSocket connection failed:", err)
    }
  }, [])

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    const ws = wsRef.current

    const handleEvent = (event: WSEvent) => {
      switch (event.type) {
        case "connected":
          setIsConnected(true)
          setError(null)
          optionsRef.current.onConnectionChange?.(true)
          break

        case "disconnected":
          setIsConnected(false)
          setIsTyping(false)
          optionsRef.current.onConnectionChange?.(false)
          break

        case "message":
          if (typeof event.data === "object" && event.data) {
            const message = event.data as ChatMessage
            updateSessionMessages(activeSessionIdRef.current, (prev) =>
              mergeMessage(prev, message),
            )
            setIsTyping(message.streaming ?? false)
            if (message.role === "assistant" && !message.streaming) {
              lastAssistantTextRef.current = message.content
            }
            optionsRef.current.onMessage?.(message)
          }
          break

        case "audio": {
          const data = event.data as AudioPushData | undefined
          if (!data) {
            break
          }

          if (data.type === "error" || data.error) {
            resetAudioQueue()
            break
          }

          const parsedChatId = Number(data.chat_id)
          const incomingChatId = Number.isFinite(parsedChatId) ? parsedChatId : null

          if (
            incomingChatId !== null &&
            audioActiveChatIdRef.current !== null &&
            incomingChatId !== audioActiveChatIdRef.current
          ) {
            resetAudioQueue()
          }
          if (incomingChatId !== null) {
            audioActiveChatIdRef.current = incomingChatId
          }

          const audioChunkPayload = resolveAudioChunkPayload(data)
          const parsedSeq = Number(data.seq)
          const seq = Number.isFinite(parsedSeq)
            ? parsedSeq
            : ++audioArrivalSeqRef.current
          const parsedDuration = Number(data.duration)
          const durationMs = Number.isFinite(parsedDuration) ? parsedDuration : 0

          if (audioChunkPayload) {
            enqueueAudioSegment({
              chatId: incomingChatId,
              seq,
              text: typeof data.text === "string" ? data.text : "",
              audioBase64: audioChunkPayload.audioBase64,
              audioMime: audioChunkPayload.audioMime,
              durationMs,
            })
          } else {
            console.warn("[petclaw] audio payload unresolved", {
              seq,
              type: data.type,
              hasAudio: Boolean(typeof data.audio === "string" && data.audio.trim()),
              hasText: Boolean(typeof data.text === "string" && data.text.trim()),
              audioMime: data.audio_mime,
            })
          }

          break
        }

        case "typing":
          setIsTyping(
            typeof event.data === "string" ? event.data === "true" : true,
          )
          break

        case "error": {
          const errorMsg =
            typeof event.data === "string" ? event.data : "Unknown error"
          setError(errorMsg)
          setIsTyping(false)
          optionsRef.current.onError?.(errorMsg)
          break
        }

        case "reconnecting":
          setError("正在重新连接...")
          setIsTyping(false)
          break

        case "emotion_change":
          if (typeof event.data === "string" && event.data.trim()) {
            lastEmotionRef.current = event.data.trim()
          }
          break

        case "action_trigger":
          break
      }
    }

    const unsubscribe = ws.subscribe(handleEvent)

    void connectWithBootstrap().catch((err) => {
      const message =
        err instanceof Error ? err.message : "Backend bootstrap failed"
      setError(message)
      console.error("Chat bootstrap failed:", err)
    })

    return () => {
      unsubscribe()
      ws.disconnect()
      resetAudioQueue()
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
        currentAudioRef.current = null
      }
      clearAudioAdvanceTimer()
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current)
        currentAudioUrlRef.current = null
      }
      lastAssistantTextRef.current = ""
      lastPlayedAudioRef.current = { value: "", at: 0 }
      lastBubbleTextRef.current = { text: "", at: 0 }
    }
  }, [
    connectWithBootstrap,
    drainAudioQueue,
    enqueueAudioSegment,
    playAudioBase64,
    resetAudioQueue,
    showBubble,
    updateSessionMessages,
    clearAudioAdvanceTimer,
  ])

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) {
        return
      }

      const outbound = buildOutgoingMessage(content)
      if (!outbound) {
        return
      }

      if (!wsRef.current.isConnected) {
        setError("当前连接不可用，请先重连后再发送")
        return
      }

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      }

      updateSessionMessages(activeSessionIdRef.current, (prev) => [
        ...prev,
        userMessage,
      ])
      setIsTyping(true)
      setError(null)

      wsRef.current.send(outbound, activeSessionIdRef.current)
    },
    [updateSessionMessages],
  )

  const newChat = useCallback(async () => {
    const nextSessionId = generateChatSessionKey()
    const nextSession = createSessionState(nextSessionId)
    wsRef.current.disconnect()

    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
    }
    resetAudioQueue()
    lastPlayedAudioRef.current = { value: "", at: 0 }
    lastAssistantTextRef.current = ""
    lastBubbleTextRef.current = { text: "", at: 0 }
    setIsTyping(false)
    setError(null)

    setSessionsState((prev) => {
      const currentSession = prev.find(
        (session) => session.id === activeSessionIdRef.current,
      )
      const hasCurrentMessages = Boolean(currentSession?.messages.length)
      const preservedSessions = hasCurrentMessages
        ? prev
        : prev.filter((session) => session.id !== activeSessionIdRef.current)

      const nextSessions = [nextSession, ...preservedSessions]
      // 保存到 localStorage
      saveSessionsToStorage(nextSessions, nextSessionId)

      return nextSessions
    })
    setActiveSessionId(nextSessionId)

    await connectWithBootstrap()
  }, [connectWithBootstrap, resetAudioQueue])

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId || sessionId === activeSessionIdRef.current) {
        return
      }

      // 保存当前会话状态
      saveSessionsToStorage(sessionsState, sessionId)

      // Load session history from backend
      await loadSessionHistory(sessionId)

      wsRef.current.disconnect()
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
      }
      resetAudioQueue()
      lastPlayedAudioRef.current = { value: "", at: 0 }
      lastAssistantTextRef.current = ""
      lastBubbleTextRef.current = { text: "", at: 0 }
      setIsTyping(false)
      setError(null)
      setActiveSessionId(sessionId)

      await connectWithBootstrap()
    },
    [connectWithBootstrap, loadSessionHistory, resetAudioQueue, sessionsState],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        return
      }

      const remaining = sessionsState.filter((session) => session.id !== sessionId)

      if (remaining.length === sessionsState.length) {
        return
      }

      const deleted = await deleteSessionOnServer(sessionId)
      if (!deleted) {
        setError("删除会话失败，请稍后重试")
        return
      }

      let nextActiveId = activeSessionIdRef.current
      if (sessionId === activeSessionIdRef.current) {
        nextActiveId = remaining[0]?.id ?? generateChatSessionKey()
      }

      const nextSessions =
        remaining.length > 0
          ? remaining
          : [createSessionState(nextActiveId)]

      setSessionsState(nextSessions)
      setActiveSessionId(nextActiveId)
      saveSessionsToStorage(nextSessions, nextActiveId)

      if (sessionId === activeSessionIdRef.current) {
        wsRef.current.disconnect()
        if (currentAudioRef.current) {
          currentAudioRef.current.pause()
        }
        resetAudioQueue()
        lastPlayedAudioRef.current = { value: "", at: 0 }
        lastAssistantTextRef.current = ""
        lastBubbleTextRef.current = { text: "", at: 0 }
        setIsTyping(false)
        setError(null)
        await connectWithBootstrap()
      }
    },
    [connectWithBootstrap, resetAudioQueue, sessionsState],
  )

  const reconnect = useCallback(() => {
    setError(null)
    setIsTyping(false)
    wsRef.current.disconnect()

    void connectWithBootstrap().catch((err) => {
      setError("重新连接失败")
      console.error("Reconnection failed:", err)
    })
  }, [connectWithBootstrap])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  useEffect(() => {
    const unlisten = window.electronAPI?.onForceStopMedia?.(() => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
        currentAudioRef.current = null
      }
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current)
        currentAudioUrlRef.current = null
      }
      resetAudioQueue()
      wsRef.current.disconnect()
      lastAssistantTextRef.current = ""
      lastPlayedAudioRef.current = { value: "", at: 0 }
      lastBubbleTextRef.current = { text: "", at: 0 }
      setIsTyping(false)
      setError(null)
    })

    return () => {
      unlisten?.()
    }
  }, [resetAudioQueue])

  const activeSession =
    sessionsState.find((session) => session.id === activeSessionId) ??
    createSessionState(activeSessionId)

  const sessions = [...sessionsState]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((session) => buildSessionSummary(session))

  return {
    messages: activeSession.messages,
    sessions,
    activeSessionId,
    isConnected,
    isTyping,
    error,
    sendMessage,
    newChat,
    switchSession,
    deleteSession,
    loadSessionHistory,
    reconnect,
    clearError,
  }
}
