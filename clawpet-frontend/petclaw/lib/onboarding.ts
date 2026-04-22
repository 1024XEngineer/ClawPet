export const ONBOARDING_STORAGE_KEY = 'petclaw.onboarding.v1'
export const SCHEDULE_ICS_NAME_STORAGE_KEY = 'petclaw.scheduleIcsFileName'

export interface OnboardingProfile {
  displayName: string
  role: string
  language: string
}

export interface OnboardingPet {
  petName: string
  personality: string
  voiceStyle: string
}

export interface OnboardingAppSettings {
  autoConnectOnLaunch: boolean
  enableDesktopBubble: boolean
  openConsoleOnPetClick: boolean
}

export interface OnboardingState {
  version: 1
  completed: boolean
  completedAt: string
  profile: OnboardingProfile
  pet: OnboardingPet
  app: OnboardingAppSettings
  studentInsights?: {
    learningRhythm: {
      chronotype: 'morning' | 'balanced' | 'night'
      focusWindows: string[]
      quietWindows: string[]
      reminderCadence: 'light' | 'standard' | 'intensive'
      summary: string
    }
    pressurePlan: {
      level: 'low' | 'medium' | 'high' | 'critical'
      strategy: string
      reminderIntervalsMinutes: number[]
      toneGuide: string
      templates: {
        soft: string
        normal: string
        strong: string
      }
    }
  }
}

export function loadOnboardingState(): OnboardingState | null {
  if (typeof window === 'undefined') {
    return null
  }

  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY)
  } catch {
    return null
  }

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as OnboardingState
  } catch {
    return null
  }
}

export function saveOnboardingState(state: OnboardingState): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state))
  } catch {
  }
}

export function openOnboardingPopup(): void {
  if (typeof window === 'undefined') {
    return
  }

  if (window.electronAPI?.openOnboarding) {
    window.electronAPI.openOnboarding()
    return
  }

  const popup = window.open(
    '/onboarding?mode=rerun',
    'petclaw-onboarding',
    'width=1280,height=860,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes',
  )

  if (popup) {
    popup.focus()
  }
}
