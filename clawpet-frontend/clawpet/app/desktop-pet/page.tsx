"use client"

import { MessageCircle, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"

import "./desktop-pet.css"

type PetState =
  | "idle"
  | "sad"
  | "happy"
  | "listen"
  | "standby"
  | "celebrate"
  | "shakeHead"
  | "stayOut"

interface BubbleData {
  text: string | null
  emotion?: string
  level?: string
  animation?: string
  animationHints?: string[]
  audio?: string
}

function decodeBase64Audio(value: string): Uint8Array | null {
  const base64 = value.replace(/^data:audio\/[^;]+;base64,/, "").replace(/\s+/g, "")
  if (!base64) {
    return null
  }
  try {
    const binary = window.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

const happyImages = ["/pets/happy1.gif", "/pets/happy2.gif"]
const standbyImages = ["/pets/standby1.gif", "/pets/standby2.gif", "/pets/standby3.gif"]

const getPetImage = (state: PetState, prevImage?: string): string => {
  switch (state) {
    case "idle":
      return "/pets/init.png"
    case "sad":
      return "/pets/sad.gif"
    case "happy":
      return happyImages[Math.floor(Math.random() * happyImages.length)]
    case "listen":
      return "/pets/listening.gif"
    case "celebrate":
      return "/pets/celebrate_out.gif"
    case "shakeHead":
      return "/pets/shake-head_out.gif"
    case "stayOut":
      return "/pets/stay_out.gif"
    case "standby": {
      let img = standbyImages[Math.floor(Math.random() * standbyImages.length)]
      if (prevImage && standbyImages.includes(prevImage) && standbyImages.length > 1) {
        while (img === prevImage) {
          img = standbyImages[Math.floor(Math.random() * standbyImages.length)]
        }
      }
      return img
    }
    default:
      return "/pets/init.png"
  }
}

const emotionToPetState: Record<string, PetState> = {
  joy: "happy",
  happy: "happy",
  sadness: "sad",
  sad: "sad",
  anger: "shakeHead",
  disgust: "shakeHead",
  surprise: "celebrate",
  fear: "stayOut",
  neutral: "standby",
}

const levelToPetState: Record<string, PetState> = {
  critical: "stayOut",
  elevated: "standby",
  normal: "standby",
}

const animationToPetState: Record<string, PetState> = {
  happy: "happy",
  sad: "sad",
  listen: "listen",
  standby: "standby",
  celebrate: "celebrate",
  "shake-head": "shakeHead",
  "stay-out": "stayOut",
  "init.png": "idle",
}

const resolvePetState = (data: BubbleData): PetState => {
  const candidates = [
    data.animation,
    ...(data.animationHints ?? []),
    data.emotion ? emotionToPetState[data.emotion] : undefined,
    data.level ? levelToPetState[data.level] : undefined,
    "idle" as PetState,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate in animationToPetState) {
      return animationToPetState[candidate]
    }
    if (
      candidate === "idle" ||
      candidate === "sad" ||
      candidate === "happy" ||
      candidate === "listen" ||
      candidate === "standby" ||
      candidate === "celebrate" ||
      candidate === "shakeHead" ||
      candidate === "stayOut"
    ) {
      return candidate
    }
  }

  return "idle"
}

export default function DesktopPetPage() {
  const [petState, setPetState] = useState<PetState>("standby")
  const [currentImage, setCurrentImage] = useState("/pets/standby1.gif")
  const [bubble, setBubble] = useState("")
  const [showControls, setShowControls] = useState(false)

  const stackRef = useRef<HTMLDivElement | null>(null)
  const controlsVisibleRef = useRef(false)
  const currentImageRef = useRef(currentImage)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioObjectUrlRef = useRef<string | null>(null)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  currentImageRef.current = currentImage

  const transitionTo = useCallback((newState: PetState, delay?: number) => {
    const prevImage = currentImageRef.current
    setPetState(newState)
    setCurrentImage(getPetImage(newState, prevImage))
    if (delay) {
      setTimeout(() => {
        setPetState("standby")
        setCurrentImage(getPetImage("standby", currentImageRef.current))
      }, delay)
    }
  }, [])

  useEffect(() => {
    const handleBubbleShow = (data: BubbleData) => {
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current)
        bubbleTimerRef.current = null
      }

      if (data.text !== null) {
        setBubble(data.text || "")
      }

      transitionTo(resolvePetState(data))

      if (data.audio) {
        const rawAudio = data.audio.trim()
        const bytes = decodeBase64Audio(rawAudio)
        let audioUrl = rawAudio

        console.info("[petclaw] desktop bubble audio received", {
          textLength: data.text?.length ?? 0,
          rawLength: rawAudio.length,
          decodedBytes: bytes?.length ?? 0,
          emotion: data.emotion ?? "",
        })

        if (audioObjectUrlRef.current) {
          URL.revokeObjectURL(audioObjectUrlRef.current)
          audioObjectUrlRef.current = null
        }

        if (bytes && bytes.length > 0) {
          const blob = new Blob([bytes], { type: "audio/mpeg" })
          audioUrl = URL.createObjectURL(blob)
          audioObjectUrlRef.current = audioUrl
        } else if (!audioUrl.startsWith("data:") && !audioUrl.startsWith("http")) {
          audioUrl = `data:audio/mp3;base64,${audioUrl}`
        }

        if (audioRef.current) {
          audioRef.current.pause()
        }
        audioRef.current = new Audio(audioUrl)
        audioRef.current.onerror = (errorEvent) => {
          console.warn("[petclaw] desktop audio element error", errorEvent)
        }
        audioRef.current.onended = () => {
          setBubble("")
          transitionTo("standby")
        }
        audioRef.current.play().catch((playbackError) => {
          console.warn("[petclaw] desktop failed to play audio", playbackError)
          setBubble("")
        })
      } else {
        bubbleTimerRef.current = setTimeout(() => {
          setBubble("")
          transitionTo("standby")
        }, 10000)
      }
    }

    window.electronAPI?.onBubbleShow?.(handleBubbleShow)
    window.electronAPI?.onSettingsUpdate?.(() => {})
    document.title = "PetClaw"

    return () => {
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current)
      }
      if (audioRef.current) {
        audioRef.current.pause()
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current)
        audioObjectUrlRef.current = null
      }
    }
  }, [transitionTo])

  useEffect(() => {
    const handlePointerMove = (event: globalThis.MouseEvent) => {
      const stack = stackRef.current
      if (!stack) {
        return
      }
      const rect = stack.getBoundingClientRect()
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      if (inside !== controlsVisibleRef.current) {
        controlsVisibleRef.current = inside
        setShowControls(inside)
      }
    }

    const handleWindowLeave = () => {
      controlsVisibleRef.current = false
      setShowControls(false)
    }

    window.addEventListener("mousemove", handlePointerMove)
    window.addEventListener("blur", handleWindowLeave)
    window.addEventListener("mouseleave", handleWindowLeave as EventListener)

    return () => {
      window.removeEventListener("mousemove", handlePointerMove)
      window.removeEventListener("blur", handleWindowLeave)
      window.removeEventListener("mouseleave", handleWindowLeave as EventListener)
    }
  }, [])

  const openChatPanel = () => {
    try {
      if (window.electronAPI?.openSettings) {
        window.electronAPI.openSettings()
        return
      }
    } catch {
      // fall through to web fallback
    }
    window.location.href = "/"
  }

  const closeWindow = () => {
    if (window.electronAPI?.closeWindow) {
      window.electronAPI.closeWindow()
      return
    }
    window.close()
  }

  const handleOpenSettingsMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openChatPanel()
  }

  const handleCloseWindowMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    closeWindow()
  }

  return (
    <div className="desktop-pet-app">
      <div className="desktop-pet-container">
        <div ref={stackRef} className="desktop-pet-stack">
          <div
            className={`desktop-pet-controls ${showControls ? "desktop-pet-controls--visible" : ""}`}
            data-electron-no-drag="true"
          >
            <button
              type="button"
              className="desktop-pet-btn"
              onMouseDown={handleOpenSettingsMouseDown}
              title="Open chat panel"
              aria-label="Open chat panel"
            >
              <MessageCircle className="desktop-pet-btn-icon" />
            </button>
            <button
              type="button"
              className="desktop-pet-btn desktop-pet-btn-close"
              onMouseDown={handleCloseWindowMouseDown}
              title="Exit desktop pet"
              aria-label="Exit desktop pet"
            >
              <X className="desktop-pet-btn-icon" />
            </button>
          </div>
          <div
            className="desktop-pet-area"
            data-electron-drag-region="true"
          >
            <img className="desktop-pet-image" src={currentImage} alt="Pet" />
            <span className="desktop-pet-state">{petState}</span>
          </div>
        </div>

        {bubble ? <div className="desktop-pet-bubble">{bubble}</div> : null}
      </div>
    </div>
  )
}
