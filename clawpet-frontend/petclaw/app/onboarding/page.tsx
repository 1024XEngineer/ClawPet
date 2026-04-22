"use client"

import { useEffect, useState } from "react"

import { OnboardingWizard } from "@/components/onboarding-wizard"

export default function OnboardingPage() {
  const [isElectronShell, setIsElectronShell] = useState(false)

  useEffect(() => {
    setIsElectronShell(Boolean(window.electronAPI))
  }, [])

  useEffect(() => {
    window.electronAPI?.setOnboardingMode?.(true)
    return () => {
      window.electronAPI?.setOnboardingMode?.(false)
    }
  }, [])

  useEffect(() => {
    document.title = "初始化向导 - ClawPet AI"
  }, [])

  return (
    <div className={`h-screen bg-transparent ${isElectronShell ? "p-0" : "p-4 md:p-5"}`}>
      <OnboardingWizard
        onFinish={() => {
          if (typeof window !== "undefined" && window.electronAPI?.completeOnboarding) {
            window.electronAPI.completeOnboarding()
            return
          }
          if (typeof window !== "undefined" && window.opener) {
            window.close()
            return
          }
          window.location.href = "/"
        }}
      />
    </div>
  )
}
