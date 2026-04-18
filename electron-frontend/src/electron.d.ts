interface BubblePayload {
  text: string | null
  emotion?: string
  level?: string
  animation?: string
  animationHints?: string[]
  audio?: string
}

declare global {
  interface Window {
    electronAPI?: {
      openSettings: () => void
      minimizeSettings: () => void
      maximizeSettings: () => void
      closeSettings: () => void
      sendSettingsChange: (settings: any) => void
      sendChatHistory: (history: any[]) => void
      showBubble: {
        (payload: BubblePayload): void
        (text: string | null, emotion: string, audio?: string): void
      }
      sendConnectionAlive: () => void
      onSettingsUpdate: (callback: (settings: any) => void) => void
      onChatHistoryUpdate: (callback: (history: any[]) => void) => void
      onBubbleShow: (callback: (data: BubblePayload) => void) => void
      onConnectionAlive: (callback: () => void) => void
    }
  }
}

export {}