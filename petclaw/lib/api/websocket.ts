import { API_BASE_URL, API_ENDPOINTS } from './config'

function getWebSocketURL(): string {
  // 直接连接到 Gateway (18790) 的 /pico/ws 端点
  return `ws://127.0.0.1:18790/pico/ws`
}

// Pico Protocol 消息类型
const PICO_TYPE_MESSAGE_SEND = "message.send"
const PICO_TYPE_MESSAGE_CREATE = "message.create"
const PICO_TYPE_MESSAGE_UPDATE = "message.update"
const PICO_TYPE_TYPING_START = "typing.start"
const PICO_TYPE_TYPING_STOP = "typing.stop"
const PICO_TYPE_PING = "ping"
const PICO_TYPE_PONG = "pong"
const PICO_TYPE_ERROR = "error"

// 从 API 获取 Pico token
async function fetchPicoToken(): Promise<string> {
  // 直接使用配置中的 token
  return "pico-test-token-123"
}

// 聊天消息类型
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  streaming?: boolean
  error?: string
}

// WebSocket 事件类型
export type WSEventType = 
  | 'connected'
  | 'disconnected'
  | 'message'
  | 'typing'
  | 'error'
  | 'reconnecting'

export interface WSEvent {
  type: WSEventType
  data?: ChatMessage | string
}

type WSEventHandler = (event: WSEvent) => void

export class PicoClawWebSocket {
  private ws: WebSocket | null = null
  private token: string = ''
  private sessionId: string = ''
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private handlers: Set<WSEventHandler> = new Set()
  private messageQueue: any[] = []
  private isConnecting = false

  constructor() {}

  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      if (this.isConnecting) {
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection)
            resolve()
          }
        }, 100)
        return
      }

      try {
        this.token = await fetchPicoToken()
        this.sessionId = this.generateSessionId()
      } catch (err) {
        reject(err)
        return
      }

      this.isConnecting = true
      const url = `${getWebSocketURL()}?session_id=${this.sessionId}&token=${this.token}`
      
      try {
        this.ws = new WebSocket(url)

        this.ws.onopen = () => {
          this.isConnecting = false
          this.reconnectAttempts = 0
          this.emit({ type: 'connected' })

          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()
            if (msg) this.sendRaw(msg)
          }

          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const picoMsg = JSON.parse(event.data)
            this.handlePicoMessage(picoMsg)
          } catch {
            this.emit({ type: 'error', data: 'Invalid message format' })
          }
        }

        this.ws.onerror = () => {
          this.isConnecting = false
          this.emit({ type: 'error', data: 'WebSocket error' })
          reject(new Error('WebSocket error'))
        }

        this.ws.onclose = () => {
          this.isConnecting = false
          this.emit({ type: 'disconnected' })
          this.attemptReconnect()
        }
      } catch (error) {
        this.isConnecting = false
        reject(error)
      }
    })
  }

  private handlePicoMessage(msg: any): void {
    switch (msg.type) {
      case PICO_TYPE_MESSAGE_CREATE:
        if (msg.payload) {
          const content = msg.payload['content'] as string
          const isThought = msg.payload['thought'] as boolean
          const chatMsg: ChatMessage = {
            id: msg.id || `msg-${Date.now()}`,
            role: isThought ? 'system' : 'assistant',
            content: typeof content === 'string' ? content : '',
            timestamp: msg.timestamp || Date.now(),
            streaming: false,
          }
          this.emit({ type: 'message', data: chatMsg })
        }
        break

      case PICO_TYPE_MESSAGE_UPDATE:
        if (msg.payload) {
          const content = msg.payload['content'] as string
          const chatMsg: ChatMessage = {
            id: (msg.payload['message_id'] as string) || '',
            role: 'assistant',
            content: typeof content === 'string' ? content : '',
            timestamp: msg.timestamp || Date.now(),
            streaming: true,
          }
          this.emit({ type: 'message', data: chatMsg })
        }
        break

      case PICO_TYPE_TYPING_START:
        this.emit({ type: 'typing', data: 'true' })
        break

      case PICO_TYPE_TYPING_STOP:
        this.emit({ type: 'typing', data: 'false' })
        break

      case PICO_TYPE_PONG:
        break

      case PICO_TYPE_PING:
        this.sendRaw({
          type: PICO_TYPE_PONG,
          id: msg.id,
          session_id: this.sessionId,
          timestamp: Date.now(),
        })
        break

      case PICO_TYPE_ERROR:
        if (msg.payload) {
          const code = msg.payload['code'] as string
          const errorMsg = msg.payload['message'] as string
          this.emit({ type: 'error', data: `${code}: ${errorMsg}` })
        }
        break
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts
  }

  send(content: string): void {
    const msg: any = {
      type: PICO_TYPE_MESSAGE_SEND,
      id: `msg-${Date.now()}`,
      session_id: this.sessionId,
      timestamp: Date.now(),
      payload: {
        content: content,
      },
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw(msg)
    } else {
      this.messageQueue.push(msg)
      this.connect().catch(() => {
        this.emit({ type: 'error', data: 'Connection failed' })
      })
    }
  }

  private sendRaw(msg: any): void {
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
      this.emit({ type: 'error', data: 'Max reconnection attempts reached' })
      return
    }

    this.reconnectAttempts++
    this.emit({ type: 'reconnecting' })

    setTimeout(() => {
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