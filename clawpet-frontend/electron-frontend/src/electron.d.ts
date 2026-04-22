interface BubblePayload {
  text: string | null
  emotion?: string
  level?: string
  animation?: string
  animationHints?: string[]
  audio?: string
}

interface StartupProgressStep {
  key: string
  label: string
  status: 'pending' | 'running' | 'done' | 'warn' | 'error'
  detail: string
}

interface StartupProgressPayload {
  done: boolean
  percent: number
  title: string
  subtitle: string
  steps: StartupProgressStep[]
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
      getBackendBaseUrl: () => string
      getLauncherToken: () => string
      setOnboardingMode: (enabled: boolean) => void
      minimizeWindow: () => void
      toggleMaximizeWindow: () => void
      closeWindow: () => void
      sendConnectionAlive: () => void
      onSettingsUpdate: (callback: (settings: any) => void) => void
      onChatHistoryUpdate: (callback: (history: any[]) => void) => void
      onBubbleShow: (callback: (data: BubblePayload) => void) => void
      onConnectionAlive: (callback: () => void) => void
      onStartupProgress: (callback: (payload: StartupProgressPayload) => void) => void
      getStartupState: () => Promise<StartupProgressPayload>
    }
  }
}

export {}
