"use client"

import { useCallback, useEffect, useRef, useState } from "react"

interface UseVoiceInputOptions {
  onResult?: (text: string) => void
  onError?: (error: string) => void
  lang?: string
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const { onResult, onError, lang = "zh-CN" } = options
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const recognitionRef = useRef<any>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

    setIsSupported(Boolean(SpeechRecognition))

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {}
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {}
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsListening(false)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      onError?.("当前环境不支持语音输入")
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = lang
      recognition.maxAlternatives = 1

      recognition.onresult = (event: any) => {
        let finalTranscript = ""

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const transcript = event.results[i][0]?.transcript || ""
          if (event.results[i].isFinal) {
            finalTranscript += transcript
          }
        }

        if (finalTranscript.trim()) {
          onResult?.(finalTranscript.trim())
        }
      }

      recognition.onerror = (event: any) => {
        if (event.error !== "no-speech" && event.error !== "aborted") {
          onError?.(event.error || "语音输入失败")
        }
        setIsListening(false)
      }

      recognition.onend = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        setIsListening(false)
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)

      timeoutRef.current = setTimeout(() => {
        stopListening()
      }, 60_000)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "语音输入启动失败"
      onError?.(message)
      setIsListening(false)
    }
  }, [lang, onError, onResult, stopListening])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
      return
    }
    startListening()
  }, [isListening, startListening, stopListening])

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  }
}
