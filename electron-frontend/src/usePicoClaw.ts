import { useState, useEffect, useRef, useCallback } from 'react'

import { getAuthRequestCredentials, withLauncherAuthHeader } from './lib/api'

interface PicoTokenInfo {
  token?: string
  ws_url: string
  enabled: boolean
  protocol?: string
}

interface PicoTokenResponse {
  token?: string
  ws_url?: string
  enabled?: boolean
  protocol?: string
}

interface HealthStatusResponse {
  status?: string
}

interface GatewayStatusResponse {
  gateway_base_url?: string
}

interface FetchJsonResult<T> {
  ok: boolean
  status?: number
  data?: T
}

type MessageHandler = (data: any) => void
type TransportMode = 'pico' | 'legacy'
const DIRECT_GATEWAY_BASE = 'http://127.0.0.1:18790'

const log = (msg: string, ...args: any[]) => {
  const fullMsg =
    args.length > 0
      ? `${msg} ${args.map((a) => JSON.stringify(a)).join(' ')}`
      : msg
  console.log('[PicoClaw]', fullMsg)
}

interface EmotionChangeData {
  emotion?: string
  score?: number
  level?: string
  animation?: string
  animationHints?: string[]
  prompt?: string
}

interface PicoCallbacks {
  onHeartbeat?: () => void
  onEmotionChange?: (emotion: EmotionChangeData) => void
  onConnectionChange?: (connected: boolean) => void
}

interface PendingRequest {
  action: string
  timeout: ReturnType<typeof setTimeout>
  resolve: (value: any) => void
  reject: (reason?: any) => void
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function withSessionId(wsUrl: string, sessionId: string): string {
  if (!sessionId) {
    return wsUrl
  }

  try {
    const parsed = new URL(wsUrl)
    parsed.searchParams.set('session_id', sessionId)
    return parsed.toString()
  } catch {
    const join = wsUrl.includes('?') ? '&' : '?'
    return `${wsUrl}${join}session_id=${encodeURIComponent(sessionId)}`
  }
}

function normalizeWsUrl(wsUrl: string): string {
  if (wsUrl.startsWith('http://')) {
    return `ws://${wsUrl.slice('http://'.length)}`
  }
  if (wsUrl.startsWith('https://')) {
    return `wss://${wsUrl.slice('https://'.length)}`
  }
  return wsUrl
}

function joinUrl(base: string, path: string): string {
  if (!base) {
    return path
  }
  return `${trimTrailingSlash(base)}${path}`
}

function resolveHttpBase(base: string): string {
  const trimmed = trimTrailingSlash(base || '')
  if (trimmed) {
    return trimmed
  }
  if (typeof window !== 'undefined') {
    return trimTrailingSlash(window.location.origin)
  }
  return ''
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function buildBaseCandidates(configuredBase: string): string[] {
  const candidates: string[] = []
  const trimmedConfigured = trimTrailingSlash(configuredBase || '')

  if (typeof window !== 'undefined') {
    // In Vite dev, same-origin fetch goes through proxy and avoids CORS.
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      candidates.push('')
      candidates.push(trimTrailingSlash(window.location.origin))
    }
  }

  if (trimmedConfigured) {
    if (trimmedConfigured !== DIRECT_GATEWAY_BASE) {
      candidates.push(DIRECT_GATEWAY_BASE)
    }
    candidates.push(trimmedConfigured)
  } else {
    candidates.push(DIRECT_GATEWAY_BASE)
  }

  return unique(candidates)
}

function getLauncherApiBase(): string {
  const fromElectron = window.electronAPI?.getBackendBaseUrl?.()
  if (fromElectron && fromElectron.trim()) {
    return trimTrailingSlash(fromElectron.trim())
  }
  return 'http://127.0.0.1:18800'
}

function isPetTokenInfo(info: { protocol?: string; ws_url?: string }): boolean {
  if (info.protocol === 'pet') {
    return true
  }
  if (!info.ws_url) {
    return false
  }
  return info.ws_url.includes('/pet/ws') || /:8080\/ws(\?|$)/.test(info.ws_url)
}

function isPetWsUrl(wsUrl: string): boolean {
  if (!wsUrl) {
    return false
  }
  return wsUrl.includes('/pet/ws') || /:8080\/ws(\?|$)/.test(wsUrl)
}

function buildDefaultPetWsUrl(base: string): string | null {
  const httpBase = resolveHttpBase(base)
  if (!httpBase) {
    return null
  }
  return normalizeWsUrl(joinUrl(httpBase, '/pet/ws'))
}

function normalizePetTokenInfo(
  info: PicoTokenResponse | undefined,
  base: string,
): PicoTokenInfo | null {
  if (!info || info.enabled === false) {
    return null
  }

  const ws_url = info.ws_url?.trim() || buildDefaultPetWsUrl(base)
  if (!ws_url || !isPetWsUrl(ws_url)) {
    return null
  }

  return {
    token: info.token,
    ws_url,
    enabled: info.enabled ?? true,
    protocol: info.protocol || 'pet',
  }
}

function decodeEscapedUnicode(value: string): string {
  if (!/\\u[0-9a-fA-F]{4}/.test(value)) {
    return value
  }
  try {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
    return JSON.parse(`"${escaped}"`) as string
  } catch {
    return value
  }
}

function normalizeIncomingText(value: string): string {
  let text = typeof value === 'string' ? value : ''
  if (!text) {
    return ''
  }
  text = text.trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1)
  }
  return decodeEscapedUnicode(text)
}

export function usePicoClaw(apiBaseUrl: string, callbacks?: PicoCallbacks) {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Record<string, MessageHandler>>({})
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5
  const apiBaseRef = useRef(apiBaseUrl)

  // 更新apiBaseRef当apiBaseUrl改变时
  useEffect(() => {
    apiBaseRef.current = apiBaseUrl
  }, [apiBaseUrl])
  const sessionIdRef = useRef<string>('')
  const callbacksRef = useRef(callbacks)
  const transportModeRef = useRef<TransportMode>('pico')
  const shouldReconnectRef = useRef(true)
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map())

  callbacksRef.current = callbacks

  useEffect(() => {
    apiBaseRef.current = apiBaseUrl
  }, [apiBaseUrl])

  const fetchTokenInfo = useCallback(async (): Promise<PicoTokenInfo | null> => {
    const launcherApiBase = getLauncherApiBase()
    let discoveredGatewayBase = ''
    const tried: string[] = []

    const tryFetchJSON = async <T,>(
      endpoint: string,
      init?: RequestInit,
    ): Promise<FetchJsonResult<T>> => {
      tried.push(endpoint)
      try {
        const res = await fetch(endpoint, {
          ...init,
          headers: withLauncherAuthHeader(init?.headers),
          credentials: getAuthRequestCredentials(endpoint),
        })
        if (!res.ok) {
          return { ok: false, status: res.status }
        }
        const data = (await res.json()) as T
        return { ok: true, status: res.status, data }
      } catch (error) {
        log('fetch failed', { endpoint, error: String(error) })
        return { ok: false }
      }
    }

    try {
      const gatewayStatus = await tryFetchJSON<GatewayStatusResponse>(
        joinUrl(launcherApiBase, '/api/gateway/status'),
      )
      const candidate = gatewayStatus.data?.gateway_base_url?.trim() || ''
      if (gatewayStatus.ok && candidate) {
        discoveredGatewayBase = trimTrailingSlash(candidate)
      }
    } catch {
      // Ignore launcher discovery failures and continue with static candidates.
    }

    const bases = discoveredGatewayBase
      ? unique([DIRECT_GATEWAY_BASE, discoveredGatewayBase, ...buildBaseCandidates(apiBaseRef.current)])
      : unique([DIRECT_GATEWAY_BASE, ...buildBaseCandidates(apiBaseRef.current)])

    for (const base of bases) {
      const healthEndpoint = joinUrl(base, '/health')
      const petTokenEndpoint = joinUrl(base, '/pet/token')
      log('fetchTokenInfo try base', {
        base,
        healthEndpoint,
        petTokenEndpoint,
      })

      const health = await tryFetchJSON<HealthStatusResponse>(healthEndpoint)
      if (!health.ok) {
        log('fetchTokenInfo health unavailable, skip', {
          endpoint: healthEndpoint,
          status: health.status,
        })
        continue
      }

      const petToken = await tryFetchJSON<PicoTokenResponse>(petTokenEndpoint)
      const tokenInfo = normalizePetTokenInfo(petToken.data, base)
      if (petToken.ok && tokenInfo) {
        log('fetchTokenInfo success (pet)', {
          base,
          healthEndpoint,
          endpoint: petTokenEndpoint,
          ws_url: tokenInfo.ws_url,
        })
        return tokenInfo
      }

      log('fetchTokenInfo pet channel unavailable, skip', {
        endpoint: petTokenEndpoint,
        status: petToken.status,
        enabled: petToken.data?.enabled,
        ws_url: petToken.data?.ws_url,
      })
    }

    console.error('[PicoClaw] Failed to fetch pet token info from /pet/token', { tried })
    return null
  }, [])

  const decodeMaybeJSON = useCallback((raw: any) => {
    if (typeof raw !== 'string') {
      return raw
    }
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }, [])

  const rejectAllPending = useCallback((reason: string) => {
    const pending = pendingRequestsRef.current
    for (const [requestId, req] of pending.entries()) {
      clearTimeout(req.timeout)
      req.reject(new Error(reason))
      pending.delete(requestId)
    }
  }, [])

  const settleLegacyResponse = useCallback(
    (msg: any) => {
      const pending = pendingRequestsRef.current
      const payload = decodeMaybeJSON(msg?.data)

      let requestId = ''
      if (msg?.request_id && pending.has(msg.request_id)) {
        requestId = msg.request_id
      }
      if (!requestId && msg?.action) {
        for (const [id, req] of pending.entries()) {
          if (req.action === msg.action) {
            requestId = id
            break
          }
        }
      }

      if (!requestId) {
        if (msg?.status === 'error') {
          console.error('[PicoClaw] legacy response error (unmatched):', {
            action: msg?.action,
            error: msg?.error,
            data: payload,
          })
        }
        return
      }

      const req = pending.get(requestId)
      if (!req) {
        return
      }
      clearTimeout(req.timeout)
      pending.delete(requestId)

      if (msg?.status === 'error') {
        const payloadError =
          payload && typeof payload === 'object' && 'error' in payload
            ? (payload as { error?: unknown }).error
            : undefined
        const errorText =
          (typeof msg?.error === 'string' && msg.error) ||
          (typeof payloadError === 'string' && payloadError) ||
          `${msg?.action || req.action} failed`
        req.reject(new Error(errorText))
        return
      }

      req.resolve(payload ?? msg)
    },
    [decodeMaybeJSON],
  )

  const handleLegacyMessage = useCallback((msg: any) => {
    if (msg.type === 'session.info') {
      sessionIdRef.current = msg.session_id || ''
      return
    }

    if (msg.type === 'push') {
      if (msg.push_type === 'init_status') {
        handlersRef.current['init_status']?.(msg.data)
        return
      }

      if (msg.push_type === 'audio') {
        let audioData = msg.data
        if (typeof audioData === 'string') {
          try {
            audioData = JSON.parse(audioData)
          } catch {
            // keep raw string
          }
        }
        handlersRef.current['audio']?.(audioData)
        return
      }

      if (msg.push_type === 'ai_chat') {
        const rawData = msg.data
        let text = ''
        let emotion = 'neutral'
        let action = ''
        let isFinal = msg.is_final === true
        let chatId = 0

        if (typeof rawData === 'string') {
          try {
            const parsed = JSON.parse(rawData)
            text = parsed.text || parsed.Text || parsed.content || rawData
            emotion = parsed.emotion || parsed.Emotion || 'neutral'
            action = parsed.action || parsed.Action || ''
            chatId = parsed.chat_id || 0
          } catch {
            text = rawData
          }
        } else if (rawData && typeof rawData === 'object') {
          chatId = rawData.chat_id || rawData.ChatID || rawData.chatId || 0
          const dataType = rawData.type || rawData.ContentType

          text = rawData.Text || rawData.text || rawData.content || ''
          emotion = rawData.Emotion || rawData.emotion || 'neutral'
          action = rawData.Action || rawData.action || ''
          if (dataType === 'final') {
            isFinal = true
          }
        }

        if (typeof text === 'string') {
          text = text.replace(/\{[^}]*\}/g, '').trim()
          text = normalizeIncomingText(text)
        }

        handlersRef.current['ai_chat']?.({
          text,
          emotion,
          action,
          isFinal,
          chat_id: chatId,
          is_final: isFinal,
        })
      }
    }
  }, [])

  const handlePicoMessage = useCallback((msg: any) => {
    if (msg.type === 'session.info') {
      const payloadSession = msg.payload?.session_id
      sessionIdRef.current = msg.session_id || payloadSession || sessionIdRef.current
      return
    }

    if (msg.type === 'typing.start') {
      callbacksRef.current?.onHeartbeat?.()
      return
    }

    if (msg.type === 'message.create' || msg.type === 'message.update') {
      const payload = msg.payload || {}
      const text = normalizeIncomingText(typeof payload.content === 'string' ? payload.content : '')
      if (!text.trim()) {
        return
      }

      handlersRef.current['ai_chat']?.({
        text,
        emotion: 'neutral',
        action: '',
        isFinal: true,
        is_final: true,
        chat_id: payload.message_id || 0,
      })
      return
    }

    if (msg.type === 'error') {
      console.error('[PicoClaw] Pico error:', msg.payload || msg)
    }
  }, [])

  const connect = useCallback(() => {
    console.log('[usePicoClaw] connect called')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[usePicoClaw] already connected, returning')
      return
    }

    shouldReconnectRef.current = true

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setIsConnecting(true)

    const scheduleReconnect = () => {
      if (!shouldReconnectRef.current) {
        return
      }
      if (reconnectAttempts.current >= maxReconnectAttempts) {
        return
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttempts.current),
        30000,
      )
      console.log('[usePicoClaw] scheduling reconnect in', delay, 'ms')
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttempts.current += 1
        connect()
      }, delay)
    }

    fetchTokenInfo().then((tokenInfo) => {
      console.log('[usePicoClaw] fetchTokenInfo result:', tokenInfo)
      if (!tokenInfo) {
        console.log('[usePicoClaw] token info is null, connection failed')
        setIsConnecting(false)
        setIsConnected(false)
        callbacksRef.current?.onConnectionChange?.(false)
        scheduleReconnect()
        return
      }

      try {
        if (!isPetWsUrl(tokenInfo.ws_url)) {
          throw new Error(`pet ws required, got: ${tokenInfo.ws_url}`)
        }

        const mode: TransportMode = 'legacy'
        transportModeRef.current = mode

        const wsUrl = withSessionId(
          normalizeWsUrl(tokenInfo.ws_url),
          sessionIdRef.current,
        )
        console.log('[usePicoClaw] connecting to WebSocket:', wsUrl)
        const ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          console.log('[usePicoClaw] WebSocket connected successfully')
          setIsConnected(true)
          setIsConnecting(false)
          reconnectAttempts.current = 0
          callbacksRef.current?.onConnectionChange?.(true)
          log('connected', { mode, wsUrl })
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)

            if (msg?.action && typeof msg?.status === 'string') {
              settleLegacyResponse(msg)
              if (msg.action === 'chat') {
                const payload = decodeMaybeJSON(msg.data)
                let text = ''
                if (typeof payload === 'string') {
                  text = payload
                } else if (payload && typeof payload === 'object') {
                  const maybe = payload as { text?: string; error?: string; message?: string }
                  text = maybe.text || maybe.error || maybe.message || ''
                }
                text = normalizeIncomingText(text)
                if (text) {
                  handlersRef.current['ai_chat']?.({
                    text,
                    emotion: 'neutral',
                    action: '',
                    isFinal: true,
                    is_final: true,
                    chat_id: 0,
                  })
                }
              }
              return
            }

            if (msg?.type === 'push' || msg?.type === 'session.info') {
              handleLegacyMessage(msg)
              return
            }

            if (msg?.type) {
              handlePicoMessage(msg)
              return
            }
          } catch (error) {
            log('parse message failed', error)
          }
        }

        ws.onerror = (event) => {
          console.log('[usePicoClaw] WebSocket error:', event)
          log('websocket error', event)
          rejectAllPending('WebSocket error')
          setIsConnected(false)
          setIsConnecting(false)
          callbacksRef.current?.onConnectionChange?.(false)
        }

        ws.onclose = () => {
          console.log('[usePicoClaw] WebSocket closed')
          rejectAllPending('WebSocket closed')
          setIsConnected(false)
          setIsConnecting(false)
          callbacksRef.current?.onConnectionChange?.(false)
          wsRef.current = null

          if (!shouldReconnectRef.current) {
            return
          }

          scheduleReconnect()
        }

        wsRef.current = ws
      } catch (error) {
        console.error('[PicoClaw] connect failed:', error)
        setIsConnecting(false)
        setIsConnected(false)
        callbacksRef.current?.onConnectionChange?.(false)
      }
    })
  }, [
    fetchTokenInfo,
    handleLegacyMessage,
    handlePicoMessage,
    rejectAllPending,
    settleLegacyResponse,
  ])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    rejectAllPending('Disconnected')
    setIsConnected(false)
    setIsConnecting(false)
    callbacksRef.current?.onConnectionChange?.(false)
  }, [rejectAllPending])

  const send = useCallback((action: string, data: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
      const sendLegacyWithAck = (
        message: Record<string, any>,
        expectedAction: string,
        timeoutMs = 10000,
      ) => {
        const timeout = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId)
          reject(new Error(`${expectedAction} timeout`))
        }, timeoutMs)

        pendingRequestsRef.current.set(requestId, {
          action: expectedAction,
          timeout,
          resolve,
          reject,
        })

        wsRef.current?.send(JSON.stringify(message))
      }

      if (transportModeRef.current === 'pico') {
        if (action === 'chat') {
          const message = {
            type: 'message.send',
            id: requestId,
            session_id: sessionIdRef.current || undefined,
            payload: {
              content: data?.text || data?.content || '',
            },
          }
          wsRef.current.send(JSON.stringify(message))
          resolve({ status: 'ok' })
          return
        }

        if (action === 'health_check') {
          wsRef.current.send(JSON.stringify({ type: 'ping', id: requestId }))
          resolve({ status: 'ok' })
          return
        }

        if (action === 'emotion_get' || action === 'tool_result') {
          reject(new Error(`${action} is not supported in pico mode`))
          return
        }

        wsRef.current.send(
          JSON.stringify({
            type: 'message.send',
            id: requestId,
            session_id: sessionIdRef.current || undefined,
            payload: {
              content: data?.text || data?.content || JSON.stringify(data || {}),
            },
          }),
        )
        resolve({ status: 'ok' })
        return
      }

      if (action === 'emotion_get') {
        sendLegacyWithAck(
          {
            action: 'emotion_get',
            data: {},
            request_id: requestId,
          },
          'emotion_get',
          10000,
        )
        return
      }

      if (action === 'chat') {
        sendLegacyWithAck(
          {
            action: 'chat',
            data: {
              text: data?.text || data?.content || '',
              session_key: data?.session_key || 'pet:default:go-claw',
            },
            request_id: requestId,
          },
          'chat',
          15000,
        )
        return
      }

      if (action === 'tool_result') {
        sendLegacyWithAck(
          {
            action: 'tool_result',
            data: {
              tool_call_id: data?.tool_call_id,
              result: data?.result,
            },
            request_id: requestId,
          },
          'tool_result',
          10000,
        )
        return
      }

      if (action === 'health_check') {
        sendLegacyWithAck(
          {
            action: 'health_check',
            request_id: requestId,
          },
          'health_check',
          5000,
        )
        return
      }

      sendLegacyWithAck(
        {
          action,
          data,
          request_id: requestId,
        },
        action,
        10000,
      )
    })
  }, [])

  const on = useCallback((pushType: string, handler: MessageHandler) => {
    handlersRef.current[pushType] = handler
  }, [])

  const off = useCallback((pushType: string) => {
    delete handlersRef.current[pushType]
  }, [])

  useEffect(() => {
    console.log('[usePicoClaw] Setting up auto-connection')
    connect()

    handlersRef.current['heartbeat'] = () => {
      callbacksRef.current?.onHeartbeat?.()
    }

    handlersRef.current['emotion_change'] = (data: any) => {
      callbacksRef.current?.onEmotionChange?.(data)
    }

    handlersRef.current['audio'] = (data: any) => {
      if (data && data.text) {
        window.electronAPI?.showBubble({
          text: null,
          emotion: 'joy',
          animation: 'happy',
          animationHints: ['happy', 'standby', 'init.png'],
          audio: data.text,
        })
      }
    }

    const healthCheckInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        void send('health_check', {})
      }
    }, 30000)

    return () => {
      clearInterval(healthCheckInterval)
      delete handlersRef.current['heartbeat']
      delete handlersRef.current['audio']
      disconnect()
    }
  }, [])

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    send,
    on,
    off,
  }
}
