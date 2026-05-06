"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getWebSocketInstance, type WSEvent } from "@/lib/api"

interface UseVoiceInputOptions {
  onResult?: (text: string) => void
  onError?: (error: string) => void
  canRecord?: boolean
  sessionKey?: string
}

type VoicePhase = "idle" | "recording" | "recognizing" | "error"

const TARGET_SAMPLE_RATE = 16000
const FRAME_SIZE = 2048
const SCRIPT_FRAME_SIZE = 1024
const DEBUG_VOICE = process.env.NODE_ENV !== "production"
const MOCK_FRAME_MS = 80
const WORKLET_FALLBACK_DELAY_MS = 250
const STOP_LISTENING_GRACE_MS = 450
const MIN_RECORDING_MS = 1200
const ANALYZER_POLL_MS = 64
const SCRIPT_CALLBACK_STALL_MS = 320
const RAF_STALL_MS = 420
const WATCHDOG_INTERVAL_MS = 500
const WATCHDOG_STALL_MS = 1200
const CAPTURE_HEALTH_CHECK_MS = 1200
const MIN_FRAMES_BEFORE_STOP = 8
const STOP_LISTENING_EXTRA_WAIT_MS = 900
const POLL_TICK_LOG_INTERVAL = 12
const SCRIPT_BACKEND_BOOT_MS = 700
const RECOGNIZING_NO_PROGRESS_MS = 15000
const VOICE_BUILD_TAG = "voice-v2026-05-04-worklet-first"

function resolveScriptProcessorForce(): { forced: boolean; reason: string } {
  if (typeof window === "undefined") {
    return { forced: false, reason: "" }
  }
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get("force_script_processor") === "1") {
      return { forced: true, reason: "query" }
    }
    if (window.localStorage.getItem("petclaw.force_script_processor") === "1") {
      return { forced: true, reason: "localStorage" }
    }
    const ua = window.navigator.userAgent || ""
    if (/\bElectron\b/i.test(ua)) {
      return { forced: false, reason: "electron-worklet-first" }
    }
    return { forced: false, reason: "" }
  } catch {
    return { forced: false, reason: "" }
  }
}

function resolveWorkletModuleUrl(): string {
  if (typeof window === "undefined") {
    return "/audio-worklet-processor.js"
  }
  return new URL("audio-worklet-processor.js", `${window.location.origin}/`).toString()
}

function encodePcm16Base64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  const bytes = new Uint8Array(pcm.buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function downsampleTo16k(input: Float32Array, sourceSampleRate: number): Float32Array {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) {
    return input
  }

  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE
  const targetLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(targetLength)

  let outputIndex = 0
  let inputIndex = 0
  while (outputIndex < targetLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio))
    let total = 0
    let count = 0
    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      total += input[i]
      count += 1
    }
    output[outputIndex] = count > 0 ? total / count : 0
    outputIndex += 1
    inputIndex = nextInputIndex
  }

  return output
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const { onResult, onError, canRecord = true, sessionKey = "" } = options
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [phase, setPhase] = useState<VoicePhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [unavailableReason, setUnavailableReason] = useState<string>("")

  const wsRef = useRef(getWebSocketInstance())
  const phaseRef = useRef<VoicePhase>("idle")
  const sequenceRef = useRef(0)
  const sentFrameCountRef = useRef(0)
  const sampleBufferRef = useRef<number[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const analyserNodeRef = useRef<AnalyserNode | null>(null)
  const sinkGainRef = useRef<GainNode | null>(null)
  const recognizingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognizingNoProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureBootstrapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mockCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafPollRef = useRef<number | null>(null)
  const samplingWatchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const captureHealthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scriptBackendBootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaRecorderProbeRef = useRef<MediaRecorder | null>(null)
  const listeningStartedAtRef = useRef(0)
  const lastScriptCallbackAtRef = useRef(0)
  const analyserStallLoggedRef = useRef(false)
  const analyserPollTicksRef = useRef(0)
  const rafPollTicksRef = useRef(0)
  const lastRafTickAtRef = useRef(0)
  const lastPollTickAtRef = useRef(0)
  const watchdogRestartCountRef = useRef(0)
  const mediaRecorderProbeChunkCountRef = useRef(0)
  const mediaRecorderProbeBytesRef = useRef(0)
  const mediaRecorderProbeErrorCountRef = useRef(0)
  const captureHealthFailedRef = useRef(false)
  const hasReceivedSamplesRef = useRef(false)
  const recognizingHasResultRef = useRef(false)
  const hasReceivedAnyResponseRef = useRef(false)
  const workletTickCountRef = useRef(0)
  const scriptProcessCallbacksRef = useRef(0)
  const scriptProcessSampleCountRef = useRef(0)
  const stopListeningRef = useRef<(() => Promise<void>) | null>(null)
  const stopCaptureOnUnmountRef = useRef<(() => void) | null>(null)
  const lastWsErrorRef = useRef<{ message: string; at: number }>({ message: "", at: 0 })
  const visibilityHandlerRef = useRef<(() => void) | null>(null)
  const blurHandlerRef = useRef<(() => void) | null>(null)
  const activeStartTokenRef = useRef(0)
  const initializingRef = useRef(false)
  const startingRef = useRef(false)
  const stoppingRef = useRef(false)

  const debugLog = useCallback((message: string, data?: Record<string, unknown>) => {
    if (!DEBUG_VOICE) {
      return
    }
    if (data) {
      console.info("[voice-input]", message, data)
      return
    }
    console.info("[voice-input]", message)
  }, [])

  const emitFrame = useCallback((
    wsClient: { sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean },
    samples: Float32Array,
    sourceSampleRate: number,
    session: string,
  ) => {
    const downsampled = downsampleTo16k(samples, sourceSampleRate)
    const base64Pcm = encodePcm16Base64(downsampled)
    const nextSequence = sequenceRef.current + 1
    if (typeof wsClient.sendAudioFrame !== "function") {
      throw new Error("语音通道未就绪，请重启应用")
    }
    const ok = wsClient.sendAudioFrame(base64Pcm, nextSequence, session)
    if (!ok) {
      throw new Error("语音输入失败，请重试。")
    }
    sequenceRef.current = nextSequence
    sentFrameCountRef.current += 1
    debugLog("audio_frame sent", {
      sequence: nextSequence,
      samples: downsampled.length,
      sentFrames: sentFrameCountRef.current,
    })
  }, [debugLog])

  const setPhaseState = useCallback((next: VoicePhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const clearRecognizingTimeout = useCallback(() => {
    if (recognizingTimeoutRef.current) {
      clearTimeout(recognizingTimeoutRef.current)
      recognizingTimeoutRef.current = null
    }
  }, [])

  const clearNoProgressTimeout = useCallback(() => {
    if (recognizingNoProgressTimeoutRef.current) {
      clearTimeout(recognizingNoProgressTimeoutRef.current)
      recognizingNoProgressTimeoutRef.current = null
    }
  }, [])

  const clearCaptureBootstrapTimeout = useCallback(() => {
    if (captureBootstrapTimeoutRef.current) {
      clearTimeout(captureBootstrapTimeoutRef.current)
      captureBootstrapTimeoutRef.current = null
    }
  }, [])

  const clearMockCaptureTimer = useCallback(() => {
    if (mockCaptureTimerRef.current) {
      clearInterval(mockCaptureTimerRef.current)
      mockCaptureTimerRef.current = null
    }
  }, [])

  const clearAnalyserPollTimer = useCallback(() => {
    if (analyserPollTimerRef.current) {
      clearTimeout(analyserPollTimerRef.current)
      analyserPollTimerRef.current = null
    }
  }, [])

  const clearRafPoll = useCallback(() => {
    if (rafPollRef.current !== null) {
      window.cancelAnimationFrame(rafPollRef.current)
      rafPollRef.current = null
    }
  }, [])

  const clearSamplingWatchdog = useCallback(() => {
    if (samplingWatchdogTimerRef.current) {
      clearInterval(samplingWatchdogTimerRef.current)
      samplingWatchdogTimerRef.current = null
    }
  }, [])

  const clearCaptureHealthTimer = useCallback(() => {
    if (captureHealthTimerRef.current) {
      clearTimeout(captureHealthTimerRef.current)
      captureHealthTimerRef.current = null
    }
  }, [])

  const clearScriptBackendBootTimer = useCallback(() => {
    if (scriptBackendBootTimerRef.current) {
      clearTimeout(scriptBackendBootTimerRef.current)
      scriptBackendBootTimerRef.current = null
    }
  }, [])

  const clearFocusGuards = useCallback(() => {
    if (visibilityHandlerRef.current) {
      window.removeEventListener("visibilitychange", visibilityHandlerRef.current)
      visibilityHandlerRef.current = null
    }
    if (blurHandlerRef.current) {
      window.removeEventListener("blur", blurHandlerRef.current)
      blurHandlerRef.current = null
    }
  }, [])

  const stopMediaRecorderProbe = useCallback(() => {
    const recorder = mediaRecorderProbeRef.current
    if (!recorder) {
      return
    }
    try {
      if (recorder.state !== "inactive") {
        recorder.stop()
      }
    } catch {
      // ignore
    }
    mediaRecorderProbeRef.current = null
  }, [])

  const startMediaRecorderProbe = useCallback((stream: MediaStream) => {
    stopMediaRecorderProbe()
    mediaRecorderProbeChunkCountRef.current = 0
    mediaRecorderProbeBytesRef.current = 0
    mediaRecorderProbeErrorCountRef.current = 0

    if (typeof MediaRecorder === "undefined") {
      debugLog("media recorder probe unsupported")
      return
    }

    try {
      const recorder = new MediaRecorder(stream)
      recorder.onstart = () => {
        debugLog("media recorder probe started")
      }
      recorder.ondataavailable = (event: BlobEvent) => {
        const size = event.data?.size ?? 0
        if (size <= 0) {
          return
        }
        mediaRecorderProbeChunkCountRef.current += 1
        mediaRecorderProbeBytesRef.current += size
      }
      recorder.onerror = () => {
        mediaRecorderProbeErrorCountRef.current += 1
        debugLog("media recorder probe error", {
          errors: mediaRecorderProbeErrorCountRef.current,
        })
      }
      recorder.onstop = () => {
        debugLog("media recorder probe stopped", {
          chunks: mediaRecorderProbeChunkCountRef.current,
          bytes: mediaRecorderProbeBytesRef.current,
          errors: mediaRecorderProbeErrorCountRef.current,
        })
      }

      recorder.start(300)
      mediaRecorderProbeRef.current = recorder
    } catch (err) {
      debugLog("media recorder probe unavailable", {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [debugLog, stopMediaRecorderProbe])

  const handleIncomingSamples = useCallback((
    wsClient: { sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean },
    input: Float32Array,
    sourceSampleRate: number,
    fromRealtimeCallback = false,
  ) => {
    if (phaseRef.current !== "recording") {
      return
    }
    if (!input || input.length === 0) {
      return
    }
    if (fromRealtimeCallback && !hasReceivedSamplesRef.current) {
      hasReceivedSamplesRef.current = true
      clearCaptureBootstrapTimeout()
      debugLog("received first audio samples", { sampleCount: input.length })
    }

    const buffer = sampleBufferRef.current
    for (let i = 0; i < input.length; i += 1) {
      buffer.push(input[i])
    }

    const frameSize = scriptProcessorRef.current ? SCRIPT_FRAME_SIZE : FRAME_SIZE
    while (buffer.length >= frameSize) {
      const frameSamples = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i += 1) {
        frameSamples[i] = buffer[i]
      }
      buffer.splice(0, frameSize)
      emitFrame(wsClient, frameSamples, sourceSampleRate, sessionKey)
    }
  }, [clearCaptureBootstrapTimeout, debugLog, emitFrame, sessionKey])

  const startAnalyserPolling = useCallback((
    wsClient: { sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean },
    sourceSampleRate: number,
  ) => {
    clearAnalyserPollTimer()
    const analyser = analyserNodeRef.current
    if (!analyser) {
      return
    }
    const buffer = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(buffer)
    const firstCopy = new Float32Array(buffer.length)
    firstCopy.set(buffer)
    scriptProcessSampleCountRef.current += firstCopy.length
    handleIncomingSamples(wsClient, firstCopy, sourceSampleRate)

    const pollOnce = () => {
      if (phaseRef.current !== "recording") {
        analyserPollTimerRef.current = null
        return
      }
      const now = Date.now()
      const scriptRecentlyActive =
        scriptProcessCallbacksRef.current > 0 &&
        lastScriptCallbackAtRef.current > 0 &&
        now - lastScriptCallbackAtRef.current < SCRIPT_CALLBACK_STALL_MS
      const rafRecentlyActive =
        rafPollTicksRef.current > 0 &&
        lastRafTickAtRef.current > 0 &&
        now - lastRafTickAtRef.current < RAF_STALL_MS

      if (scriptRecentlyActive) {
        analyserStallLoggedRef.current = false
        analyserPollTimerRef.current = setTimeout(pollOnce, ANALYZER_POLL_MS)
        return
      }

      if (rafRecentlyActive) {
        analyserPollTimerRef.current = setTimeout(pollOnce, ANALYZER_POLL_MS)
        return
      }

      if (
        scriptProcessCallbacksRef.current > 0 &&
        lastScriptCallbackAtRef.current > 0 &&
        !analyserStallLoggedRef.current
      ) {
        analyserStallLoggedRef.current = true
        debugLog("script processor stalled, analyser fallback keeps streaming", {
          callbacks: scriptProcessCallbacksRef.current,
          stalledMs: now - lastScriptCallbackAtRef.current,
        })
      }

      try {
        const ctx = audioContextRef.current
        if (ctx && ctx.state === "suspended") {
          void ctx.resume().catch(() => {
          })
        }
        analyser.getFloatTimeDomainData(buffer)
        const copy = new Float32Array(buffer.length)
        copy.set(buffer)
        scriptProcessSampleCountRef.current += copy.length
        analyserPollTicksRef.current += 1
        lastPollTickAtRef.current = Date.now()
        handleIncomingSamples(wsClient, copy, sourceSampleRate)
      } catch (err) {
        debugLog("analyser polling error", {
          message: err instanceof Error ? err.message : String(err),
        })
      }
      analyserPollTimerRef.current = setTimeout(pollOnce, ANALYZER_POLL_MS)
    }

    analyserPollTimerRef.current = setTimeout(pollOnce, ANALYZER_POLL_MS)
    debugLog("analyser polling fallback started", { pollMs: ANALYZER_POLL_MS })
  }, [clearAnalyserPollTimer, debugLog, handleIncomingSamples])

  const startRafSamplingLoop = useCallback((
    wsClient: { sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean },
    sourceSampleRate: number,
  ) => {
    clearRafPoll()
    const analyser = analyserNodeRef.current
    if (!analyser) {
      return
    }
    const buffer = new Float32Array(analyser.fftSize)
    const rafLoop = () => {
      if (phaseRef.current !== "recording") {
        rafPollRef.current = null
        return
      }
      try {
        const ctx = audioContextRef.current
        if (ctx && ctx.state === "suspended") {
          void ctx.resume().catch(() => {
          })
        }
        analyser.getFloatTimeDomainData(buffer)
        const copy = new Float32Array(buffer.length)
        copy.set(buffer)
        scriptProcessSampleCountRef.current += copy.length
        rafPollTicksRef.current += 1
        lastRafTickAtRef.current = Date.now()
        handleIncomingSamples(wsClient, copy, sourceSampleRate)
      } catch (err) {
        debugLog("raf main loop error", {
          message: err instanceof Error ? err.message : String(err),
        })
      }
      rafPollRef.current = window.requestAnimationFrame(rafLoop)
    }
    rafPollRef.current = window.requestAnimationFrame(rafLoop)
    debugLog("raf main loop started")
  }, [clearRafPoll, debugLog, handleIncomingSamples])

  const startSamplingWatchdog = useCallback((
    wsClient: { sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean },
    sourceSampleRate: number,
  ) => {
    clearSamplingWatchdog()
    samplingWatchdogTimerRef.current = setInterval(() => {
      if (phaseRef.current !== "recording") {
        return
      }
      const now = Date.now()
      const rafAlive = lastRafTickAtRef.current > 0 && now - lastRafTickAtRef.current < WATCHDOG_STALL_MS
      const pollAlive = lastPollTickAtRef.current > 0 && now - lastPollTickAtRef.current < WATCHDOG_STALL_MS
      if (rafAlive || pollAlive) {
        return
      }
      watchdogRestartCountRef.current += 1
      const ctx = audioContextRef.current
      if (ctx && ctx.state === "suspended") {
        void ctx.resume().catch(() => {
        })
      }
      startRafSamplingLoop(wsClient, sourceSampleRate)
      startAnalyserPolling(wsClient, sourceSampleRate)
    }, WATCHDOG_INTERVAL_MS)
    debugLog("sampling watchdog started", {
      intervalMs: WATCHDOG_INTERVAL_MS,
      stallMs: WATCHDOG_STALL_MS,
    })
  }, [clearSamplingWatchdog, debugLog, startAnalyserPolling, startRafSamplingLoop])

  const shouldUseMockVoiceInput = useCallback((): boolean => {
    return false
  }, [])

  const stopCapture = useCallback(() => {
    initializingRef.current = false
    startingRef.current = false
    stoppingRef.current = false
    clearCaptureBootstrapTimeout()
    clearCaptureHealthTimer()
    clearMockCaptureTimer()
    clearAnalyserPollTimer()
    clearRafPoll()
    clearSamplingWatchdog()
    clearFocusGuards()
    stopMediaRecorderProbe()
    clearScriptBackendBootTimer()
    hasReceivedSamplesRef.current = false
    workletTickCountRef.current = 0
    scriptProcessCallbacksRef.current = 0
    scriptProcessSampleCountRef.current = 0
    lastScriptCallbackAtRef.current = 0
    analyserStallLoggedRef.current = false
    analyserPollTicksRef.current = 0
    rafPollTicksRef.current = 0
    lastRafTickAtRef.current = 0
    lastPollTickAtRef.current = 0
    watchdogRestartCountRef.current = 0
    mediaRecorderProbeChunkCountRef.current = 0
    mediaRecorderProbeBytesRef.current = 0
    mediaRecorderProbeErrorCountRef.current = 0
    captureHealthFailedRef.current = false
    try {
      workletNodeRef.current?.disconnect()
      scriptProcessorRef.current?.disconnect()
      sinkGainRef.current?.disconnect()
      analyserNodeRef.current?.disconnect()
      sourceNodeRef.current?.disconnect()
    } catch {
      // ignore
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop()
      }
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close()
    }
    workletNodeRef.current = null
    scriptProcessorRef.current = null
    sinkGainRef.current = null
    analyserNodeRef.current = null
    sourceNodeRef.current = null
    mediaStreamRef.current = null
    audioContextRef.current = null
    sampleBufferRef.current = []
  }, [clearAnalyserPollTimer, clearCaptureBootstrapTimeout, clearCaptureHealthTimer, clearFocusGuards, clearMockCaptureTimer, clearRafPoll, clearSamplingWatchdog, clearScriptBackendBootTimer, stopMediaRecorderProbe])

  useEffect(() => {
    stopCaptureOnUnmountRef.current = stopCapture
  }, [stopCapture])

  useEffect(() => {
    return () => {
      stopCaptureOnUnmountRef.current?.()
    }
  }, [])

  const startCaptureHealthCheck = useCallback(() => {
    clearCaptureHealthTimer()
    captureHealthTimerRef.current = setTimeout(() => {
      if (phaseRef.current !== "recording") {
        return
      }

      const scriptCallbacks = scriptProcessCallbacksRef.current
      const rafTicks = rafPollTicksRef.current
      const analyserTicks = analyserPollTicksRef.current
      const workletTicks = workletTickCountRef.current
      const sentFrames = sentFrameCountRef.current
      const probeChunks = mediaRecorderProbeChunkCountRef.current
      const probeBytes = mediaRecorderProbeBytesRef.current
      const probeErrors = mediaRecorderProbeErrorCountRef.current
      const callbackActive = scriptCallbacks > 0 || rafTicks > 0 || analyserTicks > 0 || workletTicks > 0

      debugLog("capture health check", {
        sentFrames,
        scriptCallbacks,
        rafTicks,
        analyserTicks,
        workletTicks,
        probeChunks,
        probeBytes,
        probeErrors,
      })

      if (callbackActive) {
        return
      }

      captureHealthFailedRef.current = true
      const probeHasData = probeChunks > 0 || probeBytes > 0
      const message = probeHasData
        ? "麦克风流有数据，但当前窗口音频回调未触发，请将主设置窗口保持前台后重试。"
        : "当前窗口未触发音频采样回调，请切换到主设置窗口并重试。"

      debugLog("capture health check failed", {
        probeHasData,
        sentFrames,
        scriptCallbacks,
        rafTicks,
        analyserTicks,
        workletTicks,
        probeChunks,
        probeBytes,
        probeErrors,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      })

      setPhaseState("error")
      setError(message)
      onError?.(message)
      stopCapture()
      setIsListening(false)
    }, CAPTURE_HEALTH_CHECK_MS)
  }, [clearCaptureHealthTimer, debugLog, onError, setPhaseState, stopCapture])

  const startMockCapture = useCallback((
    wsClient: { sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean },
  ) => {
    clearMockCaptureTimer()
    hasReceivedSamplesRef.current = true
    sequenceRef.current = 0
    sentFrameCountRef.current = 0
    let phase = 0
    const frequency = 440
    const twoPi = Math.PI * 2

    mockCaptureTimerRef.current = setInterval(() => {
      if (phaseRef.current !== "recording") {
        return
      }
      const samples = new Float32Array(FRAME_SIZE)
      for (let i = 0; i < FRAME_SIZE; i += 1) {
        samples[i] = Math.sin(phase) * 0.2
        phase += (twoPi * frequency) / TARGET_SAMPLE_RATE
        if (phase >= twoPi) {
          phase -= twoPi
        }
      }
      try {
        emitFrame(wsClient, samples, TARGET_SAMPLE_RATE, sessionKey)
      } catch (err) {
        const message = err instanceof Error ? err.message : "语音输入失败，请重试。"
        setPhaseState("error")
        setError(message)
        onError?.(message)
        stopCapture()
        setIsListening(false)
      }
    }, MOCK_FRAME_MS)

    
  }, [clearMockCaptureTimer, debugLog, emitFrame, onError, sessionKey, setPhaseState, stopCapture])

  const startRecognizingTimeout = useCallback(() => {
    clearRecognizingTimeout()
    recognizingTimeoutRef.current = setTimeout(() => {
      setPhaseState("error")
      setError("语音识别超时，请重试。")
      onError?.("语音识别超时，请重试。")
    }, 15_000)
  }, [clearRecognizingTimeout, onError, setPhaseState])

  const startNoProgressTimeout = useCallback(() => {
    clearNoProgressTimeout()
    recognizingNoProgressTimeoutRef.current = setTimeout(() => {
      setPhaseState("error")
      setError("未收到识别结果，请重试。")
      onError?.("未收到识别结果，请重试。")
    }, RECOGNIZING_NO_PROGRESS_MS)
  }, [clearNoProgressTimeout, onError, setPhaseState])

  useEffect(() => {
    setIsSupported(Boolean(navigator?.mediaDevices?.getUserMedia))

    const unsubscribe = wsRef.current.subscribe((event: WSEvent) => {
      if (event.type === "error") {
        const message = typeof event.data === "string" ? event.data : "语音输入失败"
        const now = Date.now()
        if (message === lastWsErrorRef.current.message && now - lastWsErrorRef.current.at < 1500) {
          debugLog("skip duplicated ws error", { message })
          return
        }
        lastWsErrorRef.current = { message, at: now }
        if (phaseRef.current === "recording") {
          stopCapture()
          setIsListening(false)
        }
        clearRecognizingTimeout()
        clearNoProgressTimeout()
        setPhaseState("error")
        setError(message)
        onError?.(message)
        return
      }

      if (phaseRef.current !== "recognizing") {
        return
      }
      if (event.type === "typing") {
        if (event.data === "true" || event.data === true) {
          startNoProgressTimeout()
          recognizingHasResultRef.current = true
          hasReceivedAnyResponseRef.current = true
        }
      }
      if (event.type === "message" && typeof event.data === "object" && event.data) {
        const message = event.data as { role?: string; content?: string; streaming?: boolean }
        if (message.role === "assistant" && typeof message.content === "string" && message.content.trim()) {
          recognizingHasResultRef.current = true
          hasReceivedAnyResponseRef.current = true
        }
      }
      if (event.type === "audio" && typeof event.data === "object" && event.data) {
        const audioPayload = event.data as { text?: string; is_final?: boolean }
        if (typeof audioPayload.text === "string" && audioPayload.text.trim()) {
          recognizingHasResultRef.current = true
          hasReceivedAnyResponseRef.current = true
        }
        if (audioPayload.is_final) {
          clearRecognizingTimeout()
          clearNoProgressTimeout()
          setError(null)
          setPhaseState("idle")
        }
      }
      if (event.type === "asr" && typeof event.data === "object" && event.data) {
        const asrPayload = event.data as { text?: string }
        if (typeof asrPayload.text === "string" && asrPayload.text.trim()) {
          recognizingHasResultRef.current = true
          hasReceivedAnyResponseRef.current = true
          onResult?.(asrPayload.text)
        }
      }
      if (event.type === "typing" && event.data === "false") {
        clearRecognizingTimeout()
        clearNoProgressTimeout()
        if (recognizingHasResultRef.current) {
          setError(null)
          setPhaseState("idle")
        } else if (!hasReceivedAnyResponseRef.current) {
          const message = "未识别到语音内容，请重试。"
          setPhaseState("error")
          setError(message)
          onError?.(message)
        }
        recognizingHasResultRef.current = false
        hasReceivedAnyResponseRef.current = false
      }
      if (event.type === "message" && typeof event.data === "object" && event.data) {
        const message = event.data as { role?: string; streaming?: boolean }
        if (message.role === "assistant" && message.streaming === false) {
          clearRecognizingTimeout()
          clearNoProgressTimeout()
          setError(null)
          setPhaseState("idle")
        }
      }
    })

    return () => {
      unsubscribe()
      clearRecognizingTimeout()
      clearNoProgressTimeout()
    }
  }, [clearNoProgressTimeout, clearRecognizingTimeout, debugLog, onError, onResult, setPhaseState, startNoProgressTimeout])

  useEffect(() => {
    if (!isSupported) {
      setUnavailableReason("当前环境不支持语音输入")
      return
    }
    const wsClient = wsRef.current as {
      getVoiceInputAvailability?: (sessionKey?: string) => { available: boolean; reason: string }
    }
    if (typeof wsClient.getVoiceInputAvailability === "function") {
      const availability = wsClient.getVoiceInputAvailability(sessionKey)
      setUnavailableReason(availability.available ? "" : availability.reason)
      return
    }
    if (!canRecord) {
      setUnavailableReason("连接未建立，无法开始录音。")
      return
    }
    if (!sessionKey.trim()) {
      setUnavailableReason("会话未就绪，无法开始录音。")
      return
    }
    setUnavailableReason("")
  }, [canRecord, isSupported, sessionKey])

  const startListening = useCallback(async () => {
    if (initializingRef.current || startingRef.current) {
      debugLog("start rejected (already starting)")
      return
    }
    if (stoppingRef.current) {
      debugLog("start rejected (stop in progress)")
      return
    }
    initializingRef.current = true
    startingRef.current = true
    const startToken = activeStartTokenRef.current + 1
    activeStartTokenRef.current = startToken
    const isStaleSession = () => activeStartTokenRef.current !== startToken
    const failStart = (message: string) => {
      setPhaseState("error")
      setError(message)
      onError?.(message)
      startingRef.current = false
      initializingRef.current = false
    }
    debugLog("start token", { startToken })

    const wsClient = wsRef.current as {
      sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean
    }
    if (typeof wsClient.sendAudioFrame !== "function") {
      failStart("语音通道未就绪，请重启应用")
      return
    }

    const availability = (wsClient as {
      getVoiceInputAvailability?: (sessionKey?: string) => { available: boolean; reason: string }
    }).getVoiceInputAvailability?.(sessionKey)
    if (availability && !availability.available) {
      failStart(availability.reason || "语音通道未就绪，请稍后重试。")
      return
    }
    if (!canRecord) {
      failStart("连接未建立，无法开始录音。")
      return
    }
    if (!sessionKey.trim()) {
      failStart("会话未就绪，无法开始录音。")
      return
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      failStart("当前环境不支持语音输入")
      return
    }

    if (window.electronAPI?.ensureSettingsForeground) {
      const focused = await window.electronAPI.ensureSettingsForeground()
      if (!focused?.ok) {
        failStart("无法激活主设置窗口，请切回主窗口后重试。")
        return
      }
    }

    if (document.visibilityState !== "visible") {
      failStart("当前窗口不可见，无法开始语音输入，请切回主设置窗口。")
      return
    }

    try {
      setError(null)
      clearRecognizingTimeout()
      clearNoProgressTimeout()
      clearCaptureBootstrapTimeout()
      clearCaptureHealthTimer()
      sequenceRef.current = 0
      sentFrameCountRef.current = 0
      sampleBufferRef.current = []
      hasReceivedSamplesRef.current = false
      workletTickCountRef.current = 0
      scriptProcessCallbacksRef.current = 0
      scriptProcessSampleCountRef.current = 0
      lastScriptCallbackAtRef.current = 0
      analyserStallLoggedRef.current = false
      analyserPollTicksRef.current = 0
      rafPollTicksRef.current = 0
      lastRafTickAtRef.current = 0
      lastPollTickAtRef.current = 0
      watchdogRestartCountRef.current = 0
      mediaRecorderProbeChunkCountRef.current = 0
      mediaRecorderProbeBytesRef.current = 0
      mediaRecorderProbeErrorCountRef.current = 0
      captureHealthFailedRef.current = false
      debugLog("start listening", {
        canRecord,
        sessionKey: Boolean(sessionKey.trim()),
        voiceBuildTag: VOICE_BUILD_TAG,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      })
      if (shouldUseMockVoiceInput()) {
        startMockCapture(wsClient)
        setPhaseState("recording")
        setIsListening(true)
        return
      }
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (isStaleSession()) {
        debugLog("start stale exit", { startToken, stage: "after-getUserMedia" })
        stopCapture()
        return
      }
      startMediaRecorderProbe(mediaStreamRef.current)
      const context = new AudioContext()
      audioContextRef.current = context
      if (context.state !== "running") {
        await context.resume()
      }
      if (isStaleSession()) {
        debugLog("start stale exit", { startToken, stage: "after-context-resume" })
        stopCapture()
        return
      }
      if (!context.audioWorklet) {
        throw new Error("当前环境不支持语音输入")
      }
      sourceNodeRef.current = context.createMediaStreamSource(mediaStreamRef.current)
      const sourceSampleRate = context.sampleRate
      analyserNodeRef.current = context.createAnalyser()
      analyserNodeRef.current.fftSize = 2048
      sourceNodeRef.current.connect(analyserNodeRef.current)
      sinkGainRef.current = context.createGain()
      sinkGainRef.current.gain.value = 0
      listeningStartedAtRef.current = Date.now()

      clearFocusGuards()
      const focusLostMessage = "录音期间窗口失焦，已停止语音输入，请保持主设置窗口前台后重试。"
      const handleFocusLost = () => {
        if (phaseRef.current !== "recording") {
          return
        }
        setPhaseState("error")
        setError(focusLostMessage)
        onError?.(focusLostMessage)
        const stop = stopListeningRef.current
        if (stop) {
          void stop()
          return
        }
        stopCapture()
        setIsListening(false)
      }
      const onVisibilityChange = () => {
        debugLog("visibility changed during recording", {
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        })
        if (document.visibilityState !== "visible") {
          handleFocusLost()
        }
      }

      const attachFocusGuards = () => {
        visibilityHandlerRef.current = onVisibilityChange
        blurHandlerRef.current = handleFocusLost
        window.addEventListener("visibilitychange", onVisibilityChange)
        window.addEventListener("blur", handleFocusLost)
        debugLog("focus guards attached", {
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        })
      }

      const startScriptProcessorBackend = () => {
        if (isStaleSession() || audioContextRef.current !== context) {
          throw new Error("语音输入会话已中断，请重试。")
        }
        const sourceNode = sourceNodeRef.current
        const sinkGain = sinkGainRef.current
        if (!sourceNode || !sinkGain) {
          throw new Error("语音输入初始化失败")
        }

        const scriptNode = context.createScriptProcessor(4096, 1, 1)
        scriptProcessorRef.current = scriptNode
        scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
          try {
            scriptProcessCallbacksRef.current += 1
            lastScriptCallbackAtRef.current = Date.now()
            const channel = event.inputBuffer.getChannelData(0)
            const copy = new Float32Array(channel.length)
            copy.set(channel)
            scriptProcessSampleCountRef.current += copy.length
            handleIncomingSamples(wsClient, copy, sourceSampleRate, true)
          } catch (processErr) {
            const processMessage = processErr instanceof Error ? processErr.message : "语音输入失败，请重试。"
            setPhaseState("error")
            setError(processMessage)
            onError?.(processMessage)
            stopCapture()
            setIsListening(false)
          }
        }
        sourceNode.connect(scriptNode)
        scriptNode.connect(sinkGain)
        clearScriptBackendBootTimer()
        scriptBackendBootTimerRef.current = setTimeout(() => {
          if (phaseRef.current !== "recording") {
            return
          }
          if (scriptProcessCallbacksRef.current > 0) {
            return
          }
          const message = "脚本采样回调未启动，请检查默认输入设备或麦克风占用后重试。"
          debugLog("script backend boot timeout", { timeoutMs: SCRIPT_BACKEND_BOOT_MS })
          setPhaseState("error")
          setError(message)
          onError?.(message)
          stopCapture()
          setIsListening(false)
        }, SCRIPT_BACKEND_BOOT_MS)
        startRafSamplingLoop(wsClient, sourceSampleRate)
        startAnalyserPolling(wsClient, sourceSampleRate)
        startSamplingWatchdog(wsClient, sourceSampleRate)
        debugLog("audio capture backend", { backend: "script-processor" })
      }

      const forceScriptProcessor = resolveScriptProcessorForce()
      try {
        if (forceScriptProcessor.forced) {
          throw new Error("script processor forced by query flag")
        }
        const workletModuleUrl = resolveWorkletModuleUrl()
        debugLog("loading audio worklet module", { url: workletModuleUrl })
        await context.audioWorklet.addModule(workletModuleUrl)
        if (isStaleSession() || audioContextRef.current !== context) {
          debugLog("init cancelled", {
            startToken,
            contextStillActive: audioContextRef.current === context,
          })
          stopCapture()
          return
        }
        workletNodeRef.current = new AudioWorkletNode(context, "petclaw-audio-processor")
        workletNodeRef.current.onprocessorerror = () => {
          debugLog("audio worklet processor error")
        }
        workletNodeRef.current.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; kind?: string; tick?: number }>) => {
          if (event.data?.kind === "tick") {
            workletTickCountRef.current += 1
            return
          }
          try {
            const input = event.data?.samples
            if (!input) {
              return
            }
            handleIncomingSamples(wsClient, input, sourceSampleRate, true)
          } catch (err) {
            const message = err instanceof Error ? err.message : "语音输入失败，请重试。"
            setPhaseState("error")
            setError(message)
            onError?.(message)
            stopCapture()
            setIsListening(false)
          }
        }
        sourceNodeRef.current.connect(workletNodeRef.current)
        workletNodeRef.current.connect(sinkGainRef.current)
        debugLog("audio capture backend", { backend: "worklet" })
      } catch (err) {
        if (isStaleSession()) {
          debugLog("start stale exit", { startToken, stage: "worklet-catch" })
          stopCapture()
          return
        }
        const message = err instanceof Error ? err.message : "audio worklet init failed"
        const cspBlocked = /content-security-policy|refused/i.test(message)
        debugLog("audio worklet unavailable, fallback", {
          message,
          cspBlocked,
          forced: forceScriptProcessor.forced,
          forceReason: forceScriptProcessor.reason,
        })
        startScriptProcessorBackend()
      }

      if (!workletNodeRef.current && !scriptProcessorRef.current) {
        throw new Error("语音输入初始化失败")
      }

      sinkGainRef.current.connect(context.destination)
      if (context.state !== "running") {
        await context.resume()
      }
      debugLog("audio context after connect", {
        state: context.state,
      })
      if (isStaleSession()) {
        debugLog("start stale exit", { startToken, stage: "before-ready" })
        stopCapture()
        return
      }
      setPhaseState("recording")
      setIsListening(true)
      attachFocusGuards()
      debugLog("backend ready", {
        startToken,
        backend: workletNodeRef.current ? "worklet" : scriptProcessorRef.current ? "script-processor" : "none",
      })
      startCaptureHealthCheck()

      captureBootstrapTimeoutRef.current = setTimeout(() => {
        if (isStaleSession()) {
          return
        }
        if (phaseRef.current !== "recording") {
          return
        }
        if (hasReceivedSamplesRef.current) {
          return
        }
        debugLog("capture bootstrap without samples", {
          backend: workletNodeRef.current ? "worklet" : scriptProcessorRef.current ? "script-processor" : "none",
          workletTicks: workletTickCountRef.current,
        })
        if (workletNodeRef.current && !scriptProcessorRef.current && sourceNodeRef.current && sinkGainRef.current && audioContextRef.current === context) {
          debugLog("switching fallback -> script-processor", {
            reason: "no worklet samples",
            workletTicks: workletTickCountRef.current,
          })
          try {
            workletNodeRef.current.disconnect()
          } catch {
          }
          workletNodeRef.current = null
          try {
            startScriptProcessorBackend()
          } catch (fallbackErr) {
            const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : "语音输入初始化失败"
            setPhaseState("error")
            setError(fallbackMessage)
            onError?.(fallbackMessage)
            stopCapture()
            setIsListening(false)
            return
          }
          captureBootstrapTimeoutRef.current = setTimeout(() => {
            if (phaseRef.current !== "recording" || hasReceivedSamplesRef.current) {
              return
            }
            const message = "麦克风有权限但未产出音频数据，请检查默认输入设备或独占占用。"
            debugLog("capture bootstrap timeout")
            setPhaseState("error")
            setError(message)
            onError?.(message)
            stopCapture()
            setIsListening(false)
          }, WORKLET_FALLBACK_DELAY_MS)
          return
        }
        const message = "麦克风有权限但未产出音频数据，请检查默认输入设备或独占占用。"
        debugLog("capture bootstrap timeout")
        setPhaseState("error")
        setError(message)
        onError?.(message)
        stopCapture()
        setIsListening(false)
      }, WORKLET_FALLBACK_DELAY_MS)

    } catch (err) {
      if (isStaleSession()) {
        debugLog("start stale exit", { startToken, stage: "catch" })
        stopCapture()
        return
      }
      const message = err instanceof Error ? err.message : "语音输入启动失败"
      setPhaseState("error")
      setError(message)
      onError?.(message)
      stopCapture()
      setIsListening(false)
    } finally {
      startingRef.current = false
      initializingRef.current = false
    }
  }, [canRecord, clearCaptureBootstrapTimeout, clearCaptureHealthTimer, clearFocusGuards, clearNoProgressTimeout, clearRecognizingTimeout, debugLog, emitFrame, onError, sessionKey, setPhaseState, shouldUseMockVoiceInput, startAnalyserPolling, startCaptureHealthCheck, startMediaRecorderProbe, startMockCapture, startRafSamplingLoop, startSamplingWatchdog, stopCapture])

  const stopListening = useCallback(async () => {
    if (stoppingRef.current) {
      debugLog("stop rejected (already stopping)")
      return
    }
    if (initializingRef.current || startingRef.current) {
      debugLog("stop requested during init; cancel init")
      activeStartTokenRef.current += 1
      stopCapture()
      setIsListening(false)
      setPhaseState("idle")
      return
    }
    if (phaseRef.current !== "recording") {
      debugLog("stop ignored (not recording)")
      return
    }
    stoppingRef.current = true

    const wsClient = wsRef.current as {
      sendAudioFrame?: (audioBase64: string, sequence: number, sessionKey: string) => boolean
    }
    if (phaseRef.current === "recording" && listeningStartedAtRef.current > 0) {
      const elapsed = Date.now() - listeningStartedAtRef.current
      if (elapsed < MIN_RECORDING_MS) {
        const waitMs = MIN_RECORDING_MS - elapsed
        debugLog("stop listening delayed for minimum recording window", { elapsedMs: elapsed, waitMs })
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), waitMs)
        })
      }
    }

    const captureStatsSnapshot = {
      listenDurationMs: listeningStartedAtRef.current ? Date.now() - listeningStartedAtRef.current : 0,
      sentFrames: sentFrameCountRef.current,
      scriptCallbacks: scriptProcessCallbacksRef.current,
      scriptSamples: scriptProcessSampleCountRef.current,
      analyserTicks: analyserPollTicksRef.current,
      rafTicks: rafPollTicksRef.current,
      workletTicks: workletTickCountRef.current,
      bufferedSamples: sampleBufferRef.current.length,
      watchdogRestarts: watchdogRestartCountRef.current,
      mediaRecorderProbeChunks: mediaRecorderProbeChunkCountRef.current,
      mediaRecorderProbeBytes: mediaRecorderProbeBytesRef.current,
      mediaRecorderProbeErrors: mediaRecorderProbeErrorCountRef.current,
      captureHealthFailed: captureHealthFailedRef.current,
    }

    if (phaseRef.current === "recording" && sentFrameCountRef.current === 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), STOP_LISTENING_GRACE_MS)
      })
    }

    if (phaseRef.current === "recording" && sentFrameCountRef.current > 0 && sentFrameCountRef.current < MIN_FRAMES_BEFORE_STOP) {
      const waitMs = STOP_LISTENING_EXTRA_WAIT_MS
      debugLog("stop listening delayed for low frame count", {
        sentFrames: sentFrameCountRef.current,
        minFrames: MIN_FRAMES_BEFORE_STOP,
        waitMs,
      })
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), waitMs)
      })
    }

    if (phaseRef.current === "recording" && sampleBufferRef.current.length > 0) {
      try {
        const contextRate = audioContextRef.current?.sampleRate || TARGET_SAMPLE_RATE
        const remainder = new Float32Array(sampleBufferRef.current.length)
        for (let i = 0; i < sampleBufferRef.current.length; i += 1) {
          remainder[i] = sampleBufferRef.current[i]
        }
        sampleBufferRef.current = []
        emitFrame(wsClient, remainder, contextRate, sessionKey)
      } catch (err) {
        const message = err instanceof Error ? err.message : "语音输入失败，请重试。"
        setPhaseState("error")
        setError(message)
        onError?.(message)
        stopCapture()
        setIsListening(false)
        return
      }
    }

    const finalStats = {
      listenDurationMs: listeningStartedAtRef.current ? Date.now() - listeningStartedAtRef.current : captureStatsSnapshot.listenDurationMs,
      sentFrames: sentFrameCountRef.current,
      scriptCallbacks: scriptProcessCallbacksRef.current,
      scriptSamples: scriptProcessSampleCountRef.current,
      analyserTicks: analyserPollTicksRef.current,
      rafTicks: rafPollTicksRef.current,
      workletTicks: workletTickCountRef.current,
      bufferedSamples: sampleBufferRef.current.length,
      watchdogRestarts: watchdogRestartCountRef.current,
      mediaRecorderProbeChunks: mediaRecorderProbeChunkCountRef.current,
      mediaRecorderProbeBytes: mediaRecorderProbeBytesRef.current,
      mediaRecorderProbeErrors: mediaRecorderProbeErrorCountRef.current,
      captureHealthFailed: captureHealthFailedRef.current,
    }

    stopCapture()
    setIsListening(false)

    const captureCallbacksDead =
      finalStats.scriptCallbacks === 0 &&
      finalStats.rafTicks === 0 &&
      finalStats.analyserTicks === 0 &&
      finalStats.workletTicks === 0

    if (captureCallbacksDead && finalStats.sentFrames < MIN_FRAMES_BEFORE_STOP) {
      const probeHasData = finalStats.mediaRecorderProbeChunks > 0 || finalStats.mediaRecorderProbeBytes > 0
      const message = probeHasData
        ? "麦克风流有数据，但当前窗口音频回调未触发，请将主设置窗口保持前台后重试。"
        : "当前窗口未触发音频采样回调，请切换到主设置窗口并重试。"
      debugLog("stop listening with stalled capture callbacks", {
        ...finalStats,
        probeHasData,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      })
      setPhaseState("error")
      setError(message)
      onError?.(message)
      return
    }

    if (finalStats.sentFrames === 0) {
      const message = "未采集到可发送音频，请重试。"
      debugLog("stop listening with zero frames", {
        listenDurationMs: finalStats.listenDurationMs,
        workletTicks: finalStats.workletTicks,
        scriptCallbacks: finalStats.scriptCallbacks,
        scriptSamples: finalStats.scriptSamples,
        analyserTicks: finalStats.analyserTicks,
        rafTicks: finalStats.rafTicks,
        bufferedSamples: finalStats.bufferedSamples,
        watchdogRestarts: finalStats.watchdogRestarts,
        mediaRecorderProbeChunks: finalStats.mediaRecorderProbeChunks,
        mediaRecorderProbeBytes: finalStats.mediaRecorderProbeBytes,
        mediaRecorderProbeErrors: finalStats.mediaRecorderProbeErrors,
        captureHealthFailed: finalStats.captureHealthFailed,
      })
      setPhaseState("error")
      setError(message)
      onError?.(message)
      return
    }

    debugLog("stop listening", { sentFrames: finalStats.sentFrames })
    debugLog("capture stats", {
      listenDurationMs: finalStats.listenDurationMs,
      sentFrames: finalStats.sentFrames,
      scriptCallbacks: finalStats.scriptCallbacks,
      scriptSamples: finalStats.scriptSamples,
      analyserTicks: finalStats.analyserTicks,
      rafTicks: finalStats.rafTicks,
      workletTicks: finalStats.workletTicks,
      bufferedSamples: finalStats.bufferedSamples,
      watchdogRestarts: finalStats.watchdogRestarts,
      mediaRecorderProbeChunks: finalStats.mediaRecorderProbeChunks,
      mediaRecorderProbeBytes: finalStats.mediaRecorderProbeBytes,
      mediaRecorderProbeErrors: finalStats.mediaRecorderProbeErrors,
      captureHealthFailed: finalStats.captureHealthFailed,
    })
    setPhaseState("recognizing")
    startRecognizingTimeout()
    startNoProgressTimeout()
    recognizingHasResultRef.current = false
    hasReceivedAnyResponseRef.current = false
    stoppingRef.current = false
  }, [debugLog, emitFrame, onError, sessionKey, setPhaseState, startNoProgressTimeout, startRecognizingTimeout, stopCapture])

  useEffect(() => {
    stopListeningRef.current = stopListening
    return () => {
      stopListeningRef.current = null
    }
  }, [stopListening])

  const toggleListening = useCallback(() => {
    try {
      if (isListening) {
        void stopListening()
        return
      }
      if (initializingRef.current) {
        void stopListening()
        return
      }
      void startListening()
    } catch (err) {
      const message = err instanceof Error ? err.message : "语音输入失败，请重试。"
      setPhaseState("error")
      setError(message)
      onError?.(message)
      stopCapture()
      setIsListening(false)
    }
  }, [isListening, onError, setPhaseState, startListening, stopCapture, stopListening])

  return {
    isListening,
    isSupported,
    phase,
    error,
    unavailableReason,
    startListening,
    stopListening,
    toggleListening,
  }
}
