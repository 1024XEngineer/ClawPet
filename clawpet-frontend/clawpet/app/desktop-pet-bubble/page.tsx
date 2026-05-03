"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import "./bubble.css"

interface BubbleData {
  text: string | null
  duration_ms?: number
}

const DEFAULT_DURATION_MS = 6000

export default function DesktopPetBubblePage() {
  const [text, setText] = useState("")
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  useEffect(() => {
    const stop = window.electronAPI?.onForceStopMedia?.(() => {
      clearHideTimer()
      setVisible(false)
      setText("")
    })

    return () => {
      stop?.()
    }
  }, [])

  useEffect(() => {
    const target = cardRef.current
    if (!target) {
      return
    }

    const reportSize = () => {
      const rect = target.getBoundingClientRect()
      const width = Math.ceil(rect.width + 18)
      const height = Math.ceil(rect.height + 18)
      window.electronAPI?.reportBubbleWindowSize?.({ width, height })
    }

    reportSize()

    const observer = new ResizeObserver(() => {
      reportSize()
    })
    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [text])

  useEffect(() => {
    const handleBubbleShow = (payload: BubbleData) => {
      const nextText = typeof payload?.text === "string" ? payload.text.trim() : ""
      if (!nextText) {
        clearHideTimer()
        setVisible(false)
        setText("")
        return
      }

      clearHideTimer()
      setText(nextText)
      setVisible(true)

      const duration =
        typeof payload?.duration_ms === "number" && payload.duration_ms > 0
          ? payload.duration_ms
          : DEFAULT_DURATION_MS

      hideTimerRef.current = setTimeout(() => {
        setVisible(false)
      }, duration)
    }

    window.electronAPI?.onBubbleShow?.(handleBubbleShow)

    return () => {
      clearHideTimer()
    }
  }, [])

  const classes = useMemo(
    () => `bubble-root ${visible ? "bubble-root--visible" : ""}`,
    [visible],
  )

  return (
    <div className="bubble-app" aria-hidden={!visible}>
      <div className={classes}>
        <div ref={cardRef} className="bubble-card">{text}</div>
      </div>
    </div>
  )
}
