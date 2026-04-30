export {}

declare global {
  interface BubblePayload {
    text: string | null
    emotion: string
    level?: string
    animation?: string
    animationHints?: string[]
    audio?: string
    duration_ms?: number
  }

  interface Window {
    electronAPI?: {
      openOnboarding?: () => void
      completeOnboarding?: () => void
      openSettings?: () => void
      setOnboardingMode?: (enabled: boolean) => void
      setPetClickThrough?: (enabled: boolean) => void
      getBackendBaseUrl?: () => string
      getApiBaseUrl?: () => string
      getLauncherToken?: () => string
      minimizeWindow?: () => void
      toggleMaximizeWindow?: () => void
      closeWindow?: () => void
      showBubble?: {
        (payload: BubblePayload): void
        (text: string | null, emotion: string, audio?: string): void
      }
      onSettingsUpdate?: (callback: (settings: unknown) => void) => void
      onBubbleShow?: (callback: (payload: BubblePayload) => void) => void
      onForceStopMedia?: (callback: () => void) => () => void
    }
  }
}
