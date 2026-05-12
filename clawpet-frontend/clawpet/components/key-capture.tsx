"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface KeyCaptureProps {
  value: string
  onChange: (accel: string) => void
}

function normalizeKey(key: string): string {
  const map: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  }
  return map[key] ?? key.toUpperCase()
}

function formatDisplay(ctrl: boolean, shift: boolean, alt: boolean, meta: boolean, key: string): string {
  const parts: string[] = []
  if (ctrl) parts.push("Ctrl")
  if (shift) parts.push("Shift")
  if (alt) parts.push("Alt")
  if (meta) parts.push("Cmd")
  if (key) parts.push(key)
  return parts.join("+")
}

function formatAccel(ctrl: boolean, shift: boolean, alt: boolean, meta: boolean, key: string): string {
  const parts: string[] = []
  if (ctrl || meta) parts.push("CommandOrControl")
  if (shift) parts.push("Shift")
  if (alt) parts.push("Alt")
  if (key) parts.push(key)
  return parts.join("+")
}

export function KeyCapture({ value, onChange }: KeyCaptureProps) {
  const [recording, setRecording] = useState(false)
  const [curCtrl, setCurCtrl] = useState(false)
  const [curShift, setCurShift] = useState(false)
  const [curAlt, setCurAlt] = useState(false)
  const [curMeta, setCurMeta] = useState(false)
  const [curKey, setCurKey] = useState("")
  const [warning, setWarning] = useState("")
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboRef = useRef({ ctrl: false, shift: false, alt: false, meta: false, key: "" })

  useEffect(() => {
    comboRef.current = { ctrl: curCtrl, shift: curShift, alt: curAlt, meta: curMeta, key: curKey }
  }, [curCtrl, curShift, curAlt, curMeta, curKey])

  const confirmCombo = useCallback(() => {
    const c = comboRef.current
    if (!c.key) return
    setRecording(false)
    onChange(formatAccel(c.ctrl, c.shift, c.alt, c.meta, c.key))
    setWarning("")
  }, [onChange])

  const handleKey = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const isMod = (k: string) => ["Control", "Shift", "Alt", "Meta"].includes(k)

    if (e.key === "Escape") {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setRecording(false)
      setWarning("")
      return
    }

    if (e.key === "Enter") {
      const c = comboRef.current
      if (!c.key) return
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setRecording(false)
      onChange(formatAccel(c.ctrl, c.shift, c.alt, c.meta, c.key))
      setWarning("")
      return
    }

    const ctrl = e.ctrlKey
    const shift = e.shiftKey
    const alt = e.altKey
    const meta = e.metaKey
    const mainKey = isMod(e.key) ? comboRef.current.key : normalizeKey(e.key)

    setCurCtrl(ctrl)
    setCurShift(shift)
    setCurAlt(alt)
    setCurMeta(meta)

    if (mainKey) {
      setCurKey(mainKey)
      if (!ctrl && !shift && !alt && !meta) {
        setWarning("建议配合 Ctrl/Alt/Shift 使用，否则可能影响正常输入")
      } else {
        setWarning("")
      }
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(confirmCombo, 800)
    }
  }, [confirmCombo])

  useEffect(() => {
    if (!recording) return
    window.addEventListener("keydown", handleKey, true)
    return () => window.removeEventListener("keydown", handleKey, true)
  }, [recording, handleKey])

  useEffect(() => {
    if (!recording) {
      setCurCtrl(false)
      setCurShift(false)
      setCurAlt(false)
      setCurMeta(false)
      setCurKey("")
      setWarning("")
    }
  }, [recording])

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setRecording(true)}
        className={cn(
          "w-full rounded-lg border px-3 py-2 text-xs text-[#4f3725] transition",
          recording
            ? "animate-pulse border-amber-400 bg-amber-100 text-amber-700"
            : "border-amber-200 bg-amber-50/50 hover:border-amber-300",
        )}
      >
        {recording ? (
          curKey
            ? formatDisplay(curCtrl, curShift, curAlt, curMeta, curKey)
            : "按下按键...  [Esc取消]"
        ) : value ? (
          <span className="flex items-center justify-between">
            <span>{value}</span>
            <span className="text-[#9b7b62]">✎</span>
          </span>
        ) : (
          <span className="text-[#9b7b62]">点击录制快捷键</span>
        )}
      </button>
      {warning && (
        <p className="text-xs text-amber-600">{warning}</p>
      )}
    </div>
  )
}
