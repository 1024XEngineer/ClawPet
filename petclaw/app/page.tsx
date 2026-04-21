"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

import { ChatArea } from "@/components/chat-area"
import { Sidebar } from "@/components/sidebar"
import { WindowControls } from "@/components/window-controls"
import { useChat } from "@/hooks/use-chat"
import { loadOnboardingState } from "@/lib/onboarding"

const pageLoadingFallback = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    加载中...
  </div>
)

const OnboardingWizard = dynamic(
  () =>
    import("@/components/onboarding-wizard").then(
      (mod) => mod.OnboardingWizard,
    ),
  { loading: () => pageLoadingFallback },
)
const SkillsPage = dynamic(
  () => import("@/components/skills-page").then((mod) => mod.SkillsPage),
  { loading: () => pageLoadingFallback },
)
const SchedulePage = dynamic(
  () => import("@/components/schedule-page").then((mod) => mod.SchedulePage),
  { loading: () => pageLoadingFallback },
)
const ConfigPage = dynamic(
  () => import("@/components/config-page").then((mod) => mod.ConfigPage),
  { loading: () => pageLoadingFallback },
)

type LayoutMode = "full" | "compact" | "ultra"

export default function Home() {
  const [activeNav, setActiveNav] = useState("聊天")
  const [bootState, setBootState] = useState<"checking" | "onboarding" | "ready">(
    "ready",
  )
  const [uiMood, setUiMood] = useState<
    "low" | "medium" | "high" | "critical"
  >("medium")
  const [readyVisible, setReadyVisible] = useState(false)
  const [isElectronShell, setIsElectronShell] = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("full")
  const chat = useChat()

  const applyMoodFromOnboardingState = () => {
    const state = loadOnboardingState()
    const level = state?.studentInsights?.pressurePlan?.level
    if (
      level === "low" ||
      level === "medium" ||
      level === "high" ||
      level === "critical"
    ) {
      setUiMood(level)
      return
    }
    setUiMood("medium")
  }

  useEffect(() => {
    setIsElectronShell(Boolean(window.electronAPI))
  }, [])

  useEffect(() => {
    try {
      const hasForcedOnboarding =
        new URLSearchParams(window.location.search).get("onboarding") === "1"
      if (hasForcedOnboarding) {
        setBootState("onboarding")
        return
      }

      const onboardingState = loadOnboardingState()
      if (onboardingState?.completed) {
        applyMoodFromOnboardingState()
        setBootState("ready")
        return
      }
      setBootState("onboarding")
    } catch {
      setBootState("ready")
    }
  }, [])

  useEffect(() => {
    if (bootState === "onboarding") {
      document.title = "初始化向导 - ClawPet AI"
      return
    }

    if (bootState === "ready") {
      document.title = `${activeNav} - ClawPet AI`
    }
  }, [activeNav, bootState])

  useEffect(() => {
    if (!window.electronAPI?.setOnboardingMode) {
      return
    }

    const onboardingActive = bootState === "onboarding"
    window.electronAPI.setOnboardingMode(onboardingActive)

    return () => {
      window.electronAPI?.setOnboardingMode?.(false)
    }
  }, [bootState])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const root = document.documentElement
    const onboardingState = loadOnboardingState()
    const levelFromState = onboardingState?.studentInsights?.pressurePlan?.level
    const levelFromStorage = window.localStorage.getItem(
      "petclaw.moodLevel",
    ) as "low" | "medium" | "high" | "critical" | null
    const nextLevel = levelFromState || levelFromStorage

    if (nextLevel) {
      root.setAttribute("data-mood-level", nextLevel)
    } else {
      root.removeAttribute("data-mood-level")
    }
  }, [bootState])

  useEffect(() => {
    if (bootState !== "ready") {
      setReadyVisible(false)
      return
    }

    const timer = window.setTimeout(() => {
      setReadyVisible(true)
    }, 30)

    return () => window.clearTimeout(timer)
  }, [bootState])

  useEffect(() => {
    if (!isElectronShell || bootState !== "ready") {
      setLayoutMode("full")
      return
    }

    const updateLayoutMode = () => {
      const width = window.innerWidth
      const height = window.innerHeight

      if (width < 1120 || height < 720) {
        setLayoutMode("ultra")
        return
      }

      if (width < 1520 || height < 920) {
        setLayoutMode("compact")
        return
      }

      setLayoutMode("full")
    }

    updateLayoutMode()
    window.addEventListener("resize", updateLayoutMode)
    return () => window.removeEventListener("resize", updateLayoutMode)
  }, [bootState, isElectronShell])

  const renderContent = () => {
    switch (activeNav) {
      case "聊天":
        return <ChatArea chat={chat} layoutMode={layoutMode} />
      case "技能":
        return <SkillsPage />
      case "定时任务":
        return <SchedulePage />
      case "配置":
        return <ConfigPage />
      default:
        return <ChatArea chat={chat} layoutMode={layoutMode} />
    }
  }

  const shellByMood = {
    low: "border-emerald-200/75 bg-[linear-gradient(145deg,rgba(239,252,246,0.94),rgba(247,255,251,0.92),rgba(255,255,255,0.98))] shadow-[0_28px_80px_-48px_rgba(16,185,129,0.45)]",
    medium:
      "border-amber-200/80 bg-[linear-gradient(145deg,rgba(255,248,239,0.96),rgba(255,251,247,0.94),rgba(255,255,255,0.98))] shadow-[0_28px_80px_-48px_rgba(217,119,6,0.42)]",
    high: "border-orange-300/80 bg-[linear-gradient(145deg,rgba(255,243,236,0.96),rgba(255,248,243,0.94),rgba(255,255,255,0.98))] shadow-[0_28px_84px_-48px_rgba(249,115,22,0.44)]",
    critical:
      "border-rose-300/80 bg-[linear-gradient(145deg,rgba(255,241,243,0.96),rgba(255,247,244,0.94),rgba(255,255,255,0.98))] shadow-[0_28px_88px_-46px_rgba(244,63,94,0.42)]",
  } as const

  const shell = (
    <div
      className={`onboarding-flow-bg relative flex h-full flex-col overflow-hidden transition-[background-color,border-color,box-shadow,border-radius] duration-700 ease-out ${isElectronShell ? "rounded-none border-0 shadow-none" : "rounded-[2rem] border"} ${shellByMood[uiMood]}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(255,255,255,0.84),transparent_24%),radial-gradient(circle_at_86%_8%,rgba(255,218,185,0.34),transparent_20%),radial-gradient(circle_at_82%_76%,rgba(254,205,211,0.2),transparent_26%),radial-gradient(circle_at_14%_84%,rgba(191,219,254,0.18),transparent_24%)]" />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <WindowControls title={`ClawPet AI · ${activeNav}`} />
        <div
          className={cn(
            "flex min-h-0 flex-1 overflow-hidden",
            layoutMode === "ultra" ? "flex-row" : "flex-col lg:flex-row",
          )}
          data-electron-no-drag="true"
        >
          <Sidebar
            activeNav={activeNav}
            setActiveNav={setActiveNav}
            chat={chat}
            layoutMode={layoutMode}
          />
          {renderContent()}
        </div>
      </div>
    </div>
  )

  if (bootState === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-transparent text-sm text-muted-foreground">
        正在初始化...
      </div>
    )
  }

  if (bootState === "onboarding") {
    return (
      <div
        className={`h-screen bg-transparent ${isElectronShell ? "p-0" : "p-4 md:p-5"}`}
      >
        <OnboardingWizard
          onFinish={() => {
            window.electronAPI?.completeOnboarding?.()
            const url = new URL(window.location.href)
            url.searchParams.delete("onboarding")
            window.history.replaceState({}, "", url.toString())
            applyMoodFromOnboardingState()
            setBootState("ready")
          }}
        />
      </div>
    )
  }

  if (isElectronShell) {
    return (
      <div className="h-screen overflow-hidden bg-transparent">
        <div
          className={`h-full w-full transition-opacity duration-300 ${readyVisible ? "opacity-100" : "opacity-0"}`}
        >
          {shell}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`h-screen bg-transparent transition-all duration-500 ease-out p-4 md:p-5 ${readyVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      {shell}
    </div>
  )
}
