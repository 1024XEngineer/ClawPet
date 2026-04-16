"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { getWebSocketInstance, type ChatMessage, type WSEvent } from '@/lib/api'

export interface UseChatOptions {
  onMessage?: (message: ChatMessage) => void
  onError?: (error: string) => void
  onConnectionChange?: (connected: boolean) => void
}

export function useChat(options: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef(getWebSocketInstance())
  const optionsRef = useRef(options)

  // 更新 options ref
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // WebSocket 事件处理
  useEffect(() => {
    const ws = wsRef.current

    const handleEvent = (event: WSEvent) => {
      switch (event.type) {
        case 'connected':
          setIsConnected(true)
          setError(null)
          optionsRef.current.onConnectionChange?.(true)
          break

        case 'disconnected':
          setIsConnected(false)
          optionsRef.current.onConnectionChange?.(false)
          break

        case 'message':
          if (typeof event.data === 'object' && event.data) {
            const message = event.data as ChatMessage
            setMessages((prev) => {
              // 检查是否是流式更新（相同 id）
              const existingIndex = prev.findIndex((m) => m.id === message.id)
              if (existingIndex >= 0) {
                const newMessages = [...prev]
                newMessages[existingIndex] = message
                return newMessages
              }
              return [...prev, message]
            })
            setIsTyping(message.streaming ?? false)
            optionsRef.current.onMessage?.(message)
          }
          break

        case 'typing':
          const isTypingValue = typeof event.data === 'string' ? event.data === 'true' : true
          setIsTyping(isTypingValue)
          break

        case 'error':
          const errorMsg = typeof event.data === 'string' ? event.data : 'Unknown error'
          setError(errorMsg)
          optionsRef.current.onError?.(errorMsg)
          break

        case 'reconnecting':
          setError('正在重新连接...')
          break
      }
    }

    const unsubscribe = ws.subscribe(handleEvent)

    // 自动连接
    ws.connect().catch((err) => {
      setError('连接失败')
      console.error('WebSocket connection failed:', err)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // 发送消息
  const sendMessage = useCallback((content: string) => {
    if (!content.trim()) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsTyping(true)
    setError(null)

    wsRef.current.send(content.trim())
  }, [])

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  // 手动重连
  const reconnect = useCallback(() => {
    setError(null)
    wsRef.current.connect().catch((err) => {
      setError('重新连接失败')
      console.error('Reconnection failed:', err)
    })
  }, [])

  return {
    messages,
    isConnected,
    isTyping,
    error,
    sendMessage,
    clearMessages,
    reconnect,
  }
}
