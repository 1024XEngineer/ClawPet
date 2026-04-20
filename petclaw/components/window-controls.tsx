"use client"

import { Minus, Square, X } from "lucide-react"
import { useEffect, useState, type CSSProperties } from "react"

interface WindowControlsProps {
  title: string
}

export function WindowControls({ title }: WindowControlsProps) {
  const [hasElectronApi, setHasElectronApi] = useState(false)

  useEffect(() => {
    setHasElectronApi(Boolean(window.electronAPI))
  }, [])

  return (
    <div
      className="window-chrome z-20 select-none px-3 sm:px-4"
      style={{ userSelect: "none" } as CSSProperties}
    >
      <div className="window-chrome-title" data-electron-drag-region="true">
        {title}
      </div>
      <div className="window-chrome-actions ml-2" data-electron-no-drag="true">
        <button
          type="button"
          onClick={() => window.electronAPI?.minimizeWindow?.()}
          disabled={!hasElectronApi}
          className="window-chrome-button"
          title="最小化"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => window.electronAPI?.toggleMaximizeWindow?.()}
          disabled={!hasElectronApi}
          className="window-chrome-button"
          title="最大化 / 还原"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (hasElectronApi) {
              window.electronAPI?.closeWindow?.()
              return
            }
            if (typeof window !== "undefined") {
              window.close()
            }
          }}
          className="window-chrome-button window-chrome-button--danger"
          title="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
