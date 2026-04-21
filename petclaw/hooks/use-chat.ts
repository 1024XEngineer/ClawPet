"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ensureBackendReadyForChat } from "@/lib/api/bootstrap"
import {
  getWebSocketInstance,
  type ChatMessage,
  type WSEvent,
} from "@/lib/api"
import { getSessionHistory } from "@/lib/api/sessions"

const SESSIONS_STORAGE_KEY = "petclaw_sessions"
const ACTIVE_SESSION_KEY = "petclaw_active_session"

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
  loadSessionHistory: (sessionId: string) => Promise<void>
  reconnect: () => void
  clearError: () => void
}

interface AudioPushData {
  chat_id?: number
  type?: string
  text?: string
  is_final?: boolean
}

const EMPTY_SESSION_TITLE = "新对话"
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

function decodeBase64Chunk(value: string): Uint8Array | null {
  const base64 = value
    .replace(/^data:audio\/[^;]+;base64,/, "")
    .replace(/\s+/g, "")

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

function mergeAudioChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return ""
  }

  let binary = ""
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const [isConnected, setIsConnected] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef(getWebSocketInstance())
  const optionsRef = useRef(options)
  const initialSessionIdRef = useRef(wsRef.current.ensureSessionId())

  // 尝试从 localStorage 加载会话
  const storedSessions = loadSessionsFromStorage()
  const [activeSessionId, setActiveSessionId] = useState(
    storedSessions?.activeSessionId || initialSessionIdRef.current,
  )
  const [sessionsState, setSessionsState] = useState<ChatSessionState[]>(
    storedSessions?.sessions || [createSessionState(initialSessionIdRef.current)],
  )
  const activeSessionIdRef = useRef(activeSessionId)
  const audioStreamRef = useRef<{ chatId: number | null; chunks: Uint8Array[] }>(
    { chatId: null, chunks: [] },
  )
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const lastAssistantTextRef = useRef("")
  const lastEmotionRef = useRef("neutral")
  const lastPlayedAudioRef = useRef<{ value: string; at: number }>({
    value: "",
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

  const playAudioBase64 = useCallback(
    (audioBase64: string) => {
      if (!audioBase64) {
        return
      }

      if (
        lastPlayedAudioRef.current.value === audioBase64 &&
        Date.now() - lastPlayedAudioRef.current.at < 4000
      ) {
        return
      }

      lastPlayedAudioRef.current = {
        value: audioBase64,
        at: Date.now(),
      }

      if (window.electronAPI?.showBubble) {
        showBubble(lastAssistantTextRef.current || null, audioBase64)
        return
      }

      const audioUrl = `data:audio/mp3;base64,${audioBase64}`
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
      }
      currentAudioRef.current = new Audio(audioUrl)
      void currentAudioRef.current.play().catch((playbackError) => {
        console.warn("[petclaw] failed to play audio", playbackError)
      })
    },
    [showBubble],
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

          if (data.type === "error") {
            audioStreamRef.current = { chatId: null, chunks: [] }
            break
          }

          const hasExplicitChatId =
            typeof data.chat_id === "number" && Number.isFinite(data.chat_id)
          const incomingChatId = hasExplicitChatId ? data.chat_id ?? null : null

          let currentStream = audioStreamRef.current
          if (hasExplicitChatId) {
            if (
              currentStream.chatId !== null &&
              currentStream.chatId !== incomingChatId
            ) {
              currentStream = { chatId: incomingChatId, chunks: [] }
              audioStreamRef.current = currentStream
            } else if (currentStream.chatId === null) {
              currentStream = {
                chatId: incomingChatId,
                chunks: currentStream.chunks,
              }
              audioStreamRef.current = currentStream
            }
          }

          if (data.text) {
            const chunkBytes = decodeBase64Chunk(data.text)
            if (chunkBytes === null) {
              audioStreamRef.current = { chatId: null, chunks: [] }
              break
            }
            if (chunkBytes.length > 0) {
              currentStream.chunks.push(chunkBytes)
            }
          }

          if (!data.is_final) {
            break
          }

          const merged = mergeAudioChunks(currentStream.chunks)
          audioStreamRef.current = { chatId: null, chunks: [] }
          const audioBase64 = bytesToBase64(merged)
          if (audioBase64) {
            playAudioBase64(audioBase64)
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
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
        currentAudioRef.current = null
      }
      audioStreamRef.current = { chatId: null, chunks: [] }
      lastAssistantTextRef.current = ""
      lastPlayedAudioRef.current = { value: "", at: 0 }
    }
  }, [
    connectWithBootstrap,
    playAudioBase64,
    updateSessionMessages,
  ])

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) {
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

      wsRef.current.send(content.trim())
    },
    [updateSessionMessages],
  )

  const newChat = useCallback(async () => {
    const nextSessionId = wsRef.current.startNewSession()
    const nextSession = createSessionState(nextSessionId)

    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
    }
    lastPlayedAudioRef.current = { value: "", at: 0 }
    lastAssistantTextRef.current = ""
    audioStreamRef.current = { chatId: null, chunks: [] }
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
  }, [connectWithBootstrap])

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId || sessionId === activeSessionIdRef.current) {
        return
      }

      // 保存当前会话状态
      saveSessionsToStorage(sessionsState, sessionId)

      // Load session history from backend
      await loadSessionHistory(sessionId)

      wsRef.current.useSession(sessionId)
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
      }
      lastPlayedAudioRef.current = { value: "", at: 0 }
      audioStreamRef.current = { chatId: null, chunks: [] }
      lastAssistantTextRef.current = ""
      setIsTyping(false)
      setError(null)
      setActiveSessionId(sessionId)

      await connectWithBootstrap()
    },
    [connectWithBootstrap, loadSessionHistory, sessionsState],
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
      wsRef.current.disconnect()
      audioStreamRef.current = { chatId: null, chunks: [] }
      lastAssistantTextRef.current = ""
      lastPlayedAudioRef.current = { value: "", at: 0 }
      setIsTyping(false)
      setError(null)
    })

    return () => {
      unlisten?.()
    }
  }, [])

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
    loadSessionHistory,
    reconnect,
    clearError,
  }
}
