import type { LearningRhythmInsight, PressurePlanInsight } from './student-insights'

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
    learningRhythm: LearningRhythmInsight
    pressurePlan: PressurePlanInsight
  }
}

export function loadOnboardingState(): OnboardingState | null {
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
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state))
  } catch {
  }
}
