import { useCallback, useEffect, useMemo, useRef } from "react"

import { createAudioRecorder } from "@/features/audio/recorder"
import { usePicoChat } from "@/hooks/use-pico-chat"
import i18n from "@/i18n"

export function useAudioInput(canRecord: boolean) {
  const {
    audioRecordingState,
    audioSequence,
    sendAudioFrame,
    getActiveSessionKey,
    setAudioRecordingState,
    setAudioError,
  } = usePicoChat()
  const sequenceRef = useRef(audioSequence)
  const recorderRef = useRef<ReturnType<typeof createAudioRecorder> | null>(null)

  useEffect(() => {
    sequenceRef.current = audioSequence
  }, [audioSequence])

  useEffect(() => {
    recorderRef.current = createAudioRecorder({
      onFrame: (pcm) => {
        const nextSequence = sequenceRef.current + 1
        const ok = sendAudioFrame(pcm, nextSequence, getActiveSessionKey())
        if (!ok) {
          setAudioError(i18n.t("chat.audio.error"))
          recorderRef.current?.stop()
          return
        }
        sequenceRef.current = nextSequence
      },
      onError: (error) => {
        setAudioError(error)
      },
    })

    return () => {
      recorderRef.current?.stop()
      recorderRef.current = null
    }
  }, [getActiveSessionKey, sendAudioFrame, setAudioError])

  const toggleRecording = useCallback(async () => {
    if (!recorderRef.current) {
      setAudioError(i18n.t("chat.audio.recorderNotReady"))
      return
    }

    if (!canRecord) {
      setAudioError(i18n.t("chat.audio.notConnected"))
      return
    }

    if (recorderRef.current.isRecording()) {
      recorderRef.current.stop()
      setAudioRecordingState("recognizing")
      return
    }

    setAudioError(undefined)
    setAudioRecordingState("recording")
    try {
      await recorderRef.current.start()
    } catch {
      setAudioError(i18n.t("chat.audio.error"))
    }
  }, [canRecord, setAudioError, setAudioRecordingState])

  const isRecording = useMemo(
    () => audioRecordingState === "recording",
    [audioRecordingState],
  )

  return {
    isRecording,
    audioRecordingState,
    toggleRecording,
  }
}
