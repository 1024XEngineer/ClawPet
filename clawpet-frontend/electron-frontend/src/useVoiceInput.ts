import { useState, useEffect, useCallback, useRef } from 'react'

interface UseVoiceInputOptions {
  onResult?: (text: string) => void
  onError?: (error: string) => void
  lang?: string
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const { onResult, onError, lang = 'zh-CN' } = options
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [status, setStatus] = useState('idle') // idle, starting, listening, recognized, error
  const recognitionRef = useRef<any>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    
    if (SpeechRecognition) {
      setStatus('idle')
      setIsSupported(true)
    } else {
      setStatus('not-supported')
      setIsSupported(false)
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch (e) {}
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    
    if (!SpeechRecognition) {
      setStatus('error')
      onError?.('浏览器不支持语音识别')
      return
    }

    try {
      setStatus('starting')
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = lang
      recognition.maxAlternatives = 1

      recognition.onresult = (event: any) => {
        let finalTranscript = ''
        let interimTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript += transcript
          }
        }

        if (finalTranscript) {
          setStatus('recognized')
          onResult?.(finalTranscript)
          setTimeout(() => setStatus('idle'), 1000)
        } else {
          setStatus('listening')
        }
      }

      recognition.onerror = (event: any) => {
        setStatus('error')
        setIsListening(false)
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          onError?.(event.error)
        }
        setTimeout(() => setStatus('idle'), 2000)
      }

      recognition.onend = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        setIsListening(false)
        if (status === 'listening') {
          setStatus('idle')
        }
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
      setStatus('listening')
      
      timeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop()
        }
      }, 60000)
      
    } catch (e: any) {
      setStatus('error')
      setIsListening(false)
      onError?.(e.message || '启动失败')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }, [lang, onResult, onError, status])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
        setIsListening(false)
        setStatus('idle')
      } catch (e) {}
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  return {
    isListening,
    isSupported,
    status, // idle, starting, listening, recognized, error, not-supported
    startListening,
    stopListening,
    toggleListening
  }
}
