"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  Cat,
  Check,
  ChevronDown,
  Crown,
  FolderUp,
  Gauge,
  Heart,
  Loader2,
  Minus,
  MoonStar,
  PawPrint,
  Sparkles,
  Square,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { API_ENDPOINTS, getApiBaseUrl } from "@/lib/api"
import { fetchWithAuthRetry } from "@/lib/api/auth-bootstrap"
import { saveOnboardingState, SCHEDULE_ICS_NAME_STORAGE_KEY } from "@/lib/onboarding"
import { buildLearningRhythm, buildPressurePlan } from "@/lib/student-insights"

type SetupStatus = "pending" | "running" | "done" | "failed"
type PersonalityTone = "阴阳怪气" | "抽象发疯" | "甜心夹子"

interface SetupTask {
  id: string
  label: string
  detail: string
  status: SetupStatus
}

interface OnboardingWizardProps {
  onFinish: () => void
}

const steps = ["情报录入", "桌宠人格", "契约确认"]
const milestones = ["认识你", "理解你", "陪伴你"]

const setupTemplate: SetupTask[] = [
  { id: "env", label: "环境检查", detail: "检查 Launcher 服务连通性", status: "pending" },
  { id: "gateway", label: "网关状态", detail: "确认网关可用", status: "pending" },
  { id: "pico", label: "配置 Pet Channel", detail: "初始化桌宠通信通道", status: "pending" },
  { id: "token", label: "连接验证", detail: "拉取 Pico Token 并完成连通", status: "pending" },
]

const permissionLabels = {
  screenView: "屏幕学习状态感知",
  appCheck: "应用专注状态感知",
  localDocRead: "本地学习资料索引",
  popupReminder: "强提醒弹窗",
}

const permissionHints = {
  screenView: "仅用于判断你是否在学习场景，便于桌宠切换提醒语气。",
  appCheck: "检测是否切到娱乐应用，触发更有梗的拉回提醒。",
  localDocRead: "建立资料关键词索引，提问时能更快帮你定位文件。",
  popupReminder: "需要时允许桌宠主动打断提醒，避免任务拖延。",
}

const presetMajors = [
  { value: "计算机", label: "计算机 · 代码咏唱" },
  { value: "法学", label: "法学 · 辩论开大" },
  { value: "临床医学", label: "临床医学 · 白衣战士" },
  { value: "汉语言", label: "汉语言 · 文采暴击" },
  { value: "金融", label: "金融 · 数字炼金" },
  { value: "艺术设计", label: "艺术设计 · 灵感喷泉" },
]
const breakerVocabulary = ["高数", "四六级", "早八", "实验报告", "课程设计", "论文", "答辩"]
const nicknameTags = ["义父", "铲屎官", "大冤种", "少侠", "学术巨佬"]
const loadingComfortLines = [
  "正在帮你给小窝通风，马上就好喵。",
  "我在和网关贴贴握手，别急别急~",
  "最后几步啦，桌宠已经在门口摇尾巴。",
]
const showcaseGifs = ["/pets/standby1.gif", "/pets/happy1.gif", "/pets/listening.gif", "/pets/celebrate_out.gif"]
const showcaseLines = [
  "随机掉落今日桌宠皮肤，看看谁先来贴贴。",
  "这只负责卖萌，那只负责催你交作业。",
  "完成初始化后，它会按照你的节奏出没。",
  "把状态调到舒服区，桌宠会更懂你的小情绪。",
]
const MIN_SUMMON_LOADING_MS = 6200

function pickRandomIndex(size: number, current?: number): number {
  if (size <= 1) return 0
  let next = Math.floor(Math.random() * size)
  while (typeof current === "number" && next === current) {
    next = Math.floor(Math.random() * size)
  }
  return next
}

function withStatus(tasks: SetupTask[], id: string, status: SetupStatus): SetupTask[] {
  return tasks.map((task) => (task.id === id ? { ...task, status } : task))
}

function TaskIcon({ status }: { status: SetupStatus }) {
  if (status === "done") return <Check className="h-4 w-4 text-emerald-600" />
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-foreground" />
  if (status === "failed") return <span className="text-sm font-semibold text-red-600">!</span>
  return <span className="h-3 w-3 rounded-full border border-muted-foreground/50" />
}

export function OnboardingWizard({ onFinish }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)

  const [setupTasks, setSetupTasks] = useState<SetupTask[]>(setupTemplate)
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [loadingLineIndex, setLoadingLineIndex] = useState(0)
  const [summonInProgress, setSummonInProgress] = useState(false)

  const [profile, setProfile] = useState({ displayName: "", role: "计算机", language: "中文" })
  const [app, setApp] = useState({
    autoConnectOnLaunch: true,
    enableDesktopBubble: true,
    openConsoleOnPetClick: true,
  })

  const [apiKey, setApiKey] = useState("")
  const [permissions, setPermissions] = useState({
    screenView: true,
    appCheck: true,
    localDocRead: true,
    popupReminder: true,
  })

  const [anxietyLevel, setAnxietyLevel] = useState(58)
  const [sleepHour, setSleepHour] = useState(1)
  const [selectedBreakers, setSelectedBreakers] = useState<string[]>(["早八", "论文"])
  const [icsFileName, setIcsFileName] = useState("")
  const [isDropActive, setIsDropActive] = useState(false)

  const [personalityTone, setPersonalityTone] = useState<PersonalityTone>("阴阳怪气")
  const [activityLevel, setActivityLevel] = useState(65)
  const [nickname, setNickname] = useState("义父")
  const [customNickname, setCustomNickname] = useState("")
  const [showCompletionCard, setShowCompletionCard] = useState(false)
  const [previewReminderText, setPreviewReminderText] = useState("")
  const [showcaseIndex, setShowcaseIndex] = useState(() => pickRandomIndex(showcaseGifs.length))
  const [isMajorMenuOpen, setIsMajorMenuOpen] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(0)
  const [isFinishing, setIsFinishing] = useState(false)
  const displayProgressRef = useRef(0)
  const majorMenuRef = useRef<HTMLDivElement | null>(null)

  const hasElectronApi = typeof window !== "undefined" && Boolean(window.electronAPI)

  useEffect(() => {
    displayProgressRef.current = displayProgress
  }, [displayProgress])

  const learningRhythmInsight = useMemo(() => {
    return buildLearningRhythm({
      major: profile.role,
      sleepHour,
      anxietyLevel,
      deadlineDate: "",
      selectedBreakers,
      hasScheduleFile: Boolean(icsFileName),
    })
  }, [anxietyLevel, icsFileName, profile.role, selectedBreakers, sleepHour])

  const pressurePlanInsight = useMemo(() => {
    return buildPressurePlan({
      major: profile.role,
      sleepHour,
      anxietyLevel,
      deadlineDate: "",
      selectedBreakers,
      hasScheduleFile: Boolean(icsFileName),
    })
  }, [anxietyLevel, icsFileName, profile.role, selectedBreakers, sleepHour])

  const moodTheme = useMemo(() => {
    if (pressurePlanInsight.level === 'critical' || pressurePlanInsight.level === 'high') {
      return {
        shellGradient: pressurePlanInsight.level === 'critical'
          ? "from-[#f1dfd9] via-[#f2e0dc] to-[#f4e4e2]"
          : "from-[#efe0d3] via-[#f1e1d7] to-[#f3e4de]",
        sidePanel: pressurePlanInsight.level === 'critical' ? "bg-[#f1e0dc]" : "bg-[#efe2d7]",
        accent: pressurePlanInsight.level === 'critical' ? "bg-[#ff5b5b] hover:bg-[#e54848]" : "bg-[#ff8a3d] hover:bg-[#f07324]",
        shellTint: pressurePlanInsight.level === 'critical' ? '#f1e1dd' : '#efe2d8',
        sideTint: pressurePlanInsight.level === 'critical' ? '#f0e0dc' : '#efe1d7',
        cardGlow: pressurePlanInsight.level === 'critical'
          ? "shadow-[0_14px_35px_-22px_rgba(245,58,104,0.75)]"
          : "shadow-[0_14px_35px_-22px_rgba(249,115,22,0.68)]",
        chipActive: pressurePlanInsight.level === 'critical'
          ? "border-fuchsia-200 bg-gradient-to-r from-rose-100 via-fuchsia-100 to-violet-100 text-rose-900 shadow-[0_0_20px_rgba(236,72,153,0.35)]"
          : "border-amber-200 bg-gradient-to-r from-orange-100 via-amber-100 to-yellow-100 text-amber-900 shadow-[0_0_20px_rgba(245,158,11,0.35)]",
        chipIdle: pressurePlanInsight.level === 'critical'
          ? "border-rose-200/70 bg-white/75 text-rose-800 hover:border-fuchsia-300 hover:bg-rose-50"
          : "border-orange-200/70 bg-white/80 text-orange-800 hover:border-amber-300 hover:bg-amber-50",
        personalityPanel: pressurePlanInsight.level === 'critical'
          ? "border-fuchsia-200/80 bg-[linear-gradient(120deg,rgba(255,240,246,0.95),rgba(255,228,239,0.92),rgba(240,232,255,0.9))]"
          : "border-orange-200/80 bg-[linear-gradient(120deg,rgba(255,245,233,0.95),rgba(255,232,221,0.92),rgba(238,240,255,0.9))]",
      }
    }
    if (pressurePlanInsight.level === 'medium') {
      return {
        shellGradient: "from-[#ecddcf] via-[#f0ddd8] to-[#f2e1de]",
        sidePanel: "bg-[#f0ddd7]",
        accent: "bg-[#d66a12] hover:bg-[#bf5c0c]",
        shellTint: '#ecdccf',
        sideTint: '#efdbd6',
        cardGlow: "shadow-[0_14px_35px_-22px_rgba(217,119,6,0.6)]",
        chipActive: "border-orange-200 bg-gradient-to-r from-amber-100 via-orange-100 to-rose-100 text-orange-900 shadow-[0_0_20px_rgba(249,115,22,0.3)]",
        chipIdle: "border-amber-200/70 bg-white/80 text-amber-800 hover:border-orange-300 hover:bg-orange-50",
        personalityPanel: "border-amber-200/80 bg-[linear-gradient(120deg,rgba(255,246,232,0.95),rgba(246,236,255,0.9),rgba(232,244,255,0.9))]",
      }
    }
    return {
      shellGradient: "from-[#e9efe5] via-[#ecf0e8] to-[#edf1eb]",
      sidePanel: "bg-[#e8eee6]",
      accent: "bg-[#1f9f6f] hover:bg-[#16875c]",
      shellTint: '#e8efe7',
      sideTint: '#e6ede5',
      cardGlow: "shadow-[0_14px_35px_-22px_rgba(16,185,129,0.62)]",
      chipActive: "border-emerald-200 bg-gradient-to-r from-emerald-100 via-cyan-100 to-sky-100 text-emerald-900 shadow-[0_0_20px_rgba(45,212,191,0.35)]",
      chipIdle: "border-emerald-200/70 bg-white/80 text-emerald-800 hover:border-cyan-300 hover:bg-cyan-50",
      personalityPanel: "border-emerald-200/80 bg-[linear-gradient(120deg,rgba(237,255,246,0.95),rgba(230,250,255,0.92),rgba(236,240,255,0.88))]",
    }
  }, [pressurePlanInsight.level])

  const companionFeedback = useMemo(() => {
    if (setupRunning) {
      return loadingComfortLines[loadingLineIndex]
    }
    if (setupError) {
      return `这次没连上，不是你的问题。${setupError}，我们可以再试一次。`
    }
    if (step === 0) {
      if (icsFileName) {
        return `收到课表 ${icsFileName}，我会尽量避开上课时段提醒你。`
      }
      if (selectedBreakers.length > 3) {
        return "我看到你的压力点比较密集，后续提醒会更聚焦、少废话。"
      }
      return `已记录你的${profile.role}情报，我会按${sleepHour.toString().padStart(2, "0")}:00的作息来安排提醒。`
    }
    if (step === 1) {
      const calling = customNickname.trim() || nickname
      return `收到！以后我会叫你“${calling}”，用${personalityTone}模式陪你稳稳推进任务。`
    }
    return "先把你的喜好悄悄告诉我，召唤时我会把环境一次性收拾好。"
  }, [customNickname, icsFileName, loadingLineIndex, nickname, personalityTone, profile.role, selectedBreakers.length, setupError, setupRunning, sleepHour, step])

  const runSetup = async (): Promise<boolean> => {
    setSetupRunning(true)
    setSetupError(null)
    setSetupTasks(setupTemplate)

    try {
      const baseUrl = getApiBaseUrl()

      setSetupTasks((prev) => withStatus(prev, "env", "running"))
      const authRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.AUTH.STATUS}`, { credentials: "include" }, false)
      if (![200, 401].includes(authRes.status)) throw new Error(`环境检查失败（${authRes.status}）`)

      setSetupTasks((prev) => withStatus(withStatus(prev, "env", "done"), "gateway", "running"))
      const gatewayRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.GATEWAY.STATUS}`, { credentials: "include" })
      if (![200, 401].includes(gatewayRes.status)) throw new Error(`网关检查失败（${gatewayRes.status}）`)

      setSetupTasks((prev) => withStatus(withStatus(prev, "gateway", "done"), "pico", "running"))
      const setupRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.PET.SETUP}`, { method: "POST", credentials: "include" })
      if (!setupRes.ok) throw new Error(`Pet Channel 初始化失败（${setupRes.status}）`)

      setSetupTasks((prev) => withStatus(withStatus(prev, "pico", "done"), "token", "running"))
      const tokenRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.PET.TOKEN}`, { credentials: "include" })
      if (!tokenRes.ok) throw new Error(`连接验证失败（${tokenRes.status}）`)

      setSetupTasks((prev) => withStatus(prev, "token", "done"))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : "初始化失败"
      setSetupError(message)
      setSetupTasks((prev) => prev.map((task) => (task.status === "running" ? { ...task, status: "failed" } : task)))
      return false
    } finally {
      setSetupRunning(false)
    }
  }

  useEffect(() => {
    if (!setupRunning) {
      setLoadingLineIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setLoadingLineIndex((prev) => (prev + 1) % loadingComfortLines.length)
    }, 1800)

    return () => window.clearInterval(timer)
  }, [setupRunning])

  useEffect(() => {
    try {
      const savedName = window.localStorage.getItem(SCHEDULE_ICS_NAME_STORAGE_KEY)
      if (savedName) {
        setIcsFileName(savedName)
      }
    } catch {
    }
  }, [])

  useEffect(() => {
    setShowCompletionCard(false)
  }, [step])

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }
    document.documentElement.setAttribute("data-mood-level", pressurePlanInsight.level)
  }, [pressurePlanInsight.level])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setShowcaseIndex((prev) => pickRandomIndex(showcaseGifs.length, prev))
    }, 4200)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isMajorMenuOpen) return

    const closeMenu = (event: MouseEvent) => {
      const target = event.target as Node
      if (!majorMenuRef.current?.contains(target)) {
        setIsMajorMenuOpen(false)
      }
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMajorMenuOpen(false)
      }
    }

    window.addEventListener("mousedown", closeMenu)
    window.addEventListener("keydown", onEscape)

    return () => {
      window.removeEventListener("mousedown", closeMenu)
      window.removeEventListener("keydown", onEscape)
    }
  }, [isMajorMenuOpen])

  useEffect(() => {
    if (!summonInProgress) {
      setDisplayProgress(0)
      return
    }

    const timer = window.setInterval(() => {
      setDisplayProgress((prev) => {
        const cap = setupRunning ? 94 : 98
        const step = setupRunning ? 1.45 : 0.55
        return Math.min(cap, prev + step)
      })
    }, 120)

    return () => window.clearInterval(timer)
  }, [setupRunning, summonInProgress])

  const toggleBreaker = (value: string) => {
    setSelectedBreakers((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]))
  }

  const pickIcsFile = (file: File | null) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith(".ics")) {
      setSetupError("只支持 .ics 课表文件，请重新选择")
      return
    }
    setSetupError(null)
    setIcsFileName(file.name)
    try {
      window.localStorage.setItem(SCHEDULE_ICS_NAME_STORAGE_KEY, file.name)
    } catch {
    }
  }

  const previewReminder = () => {
    const candidate = pressurePlanInsight.level === 'critical'
      ? pressurePlanInsight.templates.strong
      : pressurePlanInsight.level === 'high'
        ? pressurePlanInsight.templates.normal
        : pressurePlanInsight.templates.soft

    setPreviewReminderText(candidate)
    if (window.electronAPI?.showBubble) {
      window.electronAPI.showBubble(candidate, 'neutral')
    }
  }

  const complete = async () => {
    const trimmedApiKey = apiKey.trim()
    if (trimmedApiKey) {
      try {
        window.localStorage.setItem("petclaw.apiKeyDraft", trimmedApiKey)
      } catch {
      }
    }

    setSummonInProgress(true)
    setDisplayProgress(4)
    const [ready] = await Promise.all([
      runSetup(),
      new Promise((resolve) => window.setTimeout(resolve, MIN_SUMMON_LOADING_MS)),
    ])

    await new Promise<void>((resolve) => {
      const start = performance.now()
      const from = displayProgressRef.current
      const duration = 920
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        setDisplayProgress(from + (100 - from) * eased)
        if (t < 1) {
          window.requestAnimationFrame(tick)
          return
        }
        resolve()
      }
      window.requestAnimationFrame(tick)
    })

    if (!ready) {
      setSetupError("自动配置未完全成功，已先进入控制台；你可以稍后在配置页重试。")
    }

    const finalNickname = customNickname.trim() || nickname
    const voiceStyle = activityLevel >= 65 ? "活泼碎碎念" : "温和陪伴型"

    try {
      window.localStorage.setItem("petclaw.userIdentity", "student")
    } catch {
    }

    try {
      window.localStorage.setItem(
        "petclaw.studentInsights",
        JSON.stringify({
          learningRhythm: learningRhythmInsight,
          pressurePlan: pressurePlanInsight,
        }),
      )
      window.localStorage.setItem("petclaw.moodLevel", pressurePlanInsight.level)
    } catch {
    }

    saveOnboardingState({
      version: 1,
      completed: true,
      completedAt: new Date().toISOString(),
      profile: {
        displayName: finalNickname,
        role: profile.role,
        language: profile.language,
      },
      pet: {
        petName: finalNickname,
        personality: personalityTone,
        voiceStyle,
      },
      app: {
        ...app,
        enableDesktopBubble: permissions.popupReminder,
      },
      studentInsights: {
        learningRhythm: learningRhythmInsight,
        pressurePlan: pressurePlanInsight,
      },
    })
    setIsFinishing(true)
    window.setTimeout(() => {
      onFinish()
    }, 420)
  }

  return (
    <div
      className={`onboarding-flow-bg relative h-full min-h-0 w-full overflow-hidden bg-gradient-to-br transition-[background-color,border-color,box-shadow,opacity,transform] duration-700 ease-out ${hasElectronApi ? "rounded-none border-0 shadow-none" : "rounded-[2rem] border border-[#e8dccd] shadow-[0_30px_90px_-50px_rgba(130,84,23,0.5)]"} ${isFinishing ? "opacity-0 scale-[0.992]" : "opacity-100 scale-100"}`}
      style={{ backgroundColor: moodTheme.shellTint, backgroundBlendMode: 'normal' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.5),transparent_35%),radial-gradient(circle_at_85%_25%,rgba(248,192,255,0.25),transparent_38%),radial-gradient(circle_at_50%_85%,rgba(123,211,255,0.2),transparent_42%)]" />
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1.18fr_0.82fr]">
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="shrink-0 border-b border-[#eadfce] bg-[linear-gradient(180deg,rgba(255,250,243,0.96),rgba(255,245,235,0.88))] px-4 py-4 shadow-[inset_0_-1px_0_rgba(255,255,255,0.56)] backdrop-blur-xl sm:px-6 xl:px-8"
            data-electron-drag-region={hasElectronApi ? "true" : undefined}
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                {steps.map((_, index) => (
                  <span key={index} className={`h-1.5 rounded-full transition-all ${index <= step ? "w-11 bg-[#9c5f22]" : "w-9 bg-[#e2d6c6]"}`} />
                ))}
              </div>
              <div className={`${hasElectronApi ? "window-chrome-actions flex" : "hidden"} items-center gap-1`} data-electron-no-drag="true">
                <button
                  type="button"
                  className="window-chrome-button"
                  onClick={() => window.electronAPI?.minimizeWindow?.()}
                  disabled={!hasElectronApi}
                  title="最小化"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="window-chrome-button"
                  onClick={() => window.electronAPI?.toggleMaximizeWindow?.()}
                  disabled={!hasElectronApi}
                  title="最大化 / 还原"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="window-chrome-button window-chrome-button--danger"
                  onClick={() => {
                    if (hasElectronApi) {
                      window.electronAPI?.closeWindow?.()
                    } else {
                      window.close()
                    }
                  }}
                  title="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <h1 className="animate-float text-xl font-semibold text-gradient-warm text-shadow-warm sm:text-2xl xl:text-3xl">{steps[step]}</h1>
            <p className="mt-1 text-sm text-gradient-milestone font-decorated">阶段：<span className="animate-text-shimmer">{milestones[step]}</span> · 已完成 {step + 1}/3</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 xl:px-8 xl:py-6">
            {step === 2 && (
              <div className="space-y-5">
                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(120deg,rgba(255,255,255,0.9),rgba(255,246,228,0.82),rgba(255,238,251,0.82))] p-5 ${moodTheme.cardGlow}`}>
                  <div className="mb-2 flex items-center gap-2 text-xl font-semibold text-gradient-warm text-shadow-soft">
                    <Sparkles className="h-5 w-5 animate-text-shimmer" />
                    注入灵力源（API Key）
                  </div>
                  <Input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="可选：填写你自己的 API Key，不填也可继续"
                    className="mt-3 rounded-full border-[#e8cfae] bg-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.75)]"
                  />
                  <p className="mt-2 text-xs text-gradient-milestone">用于切换到你的私有模型额度，不会影响默认可用功能。</p>
                </div>

                <div className={`space-y-2 rounded-2xl border border-dashed border-white/70 bg-[linear-gradient(130deg,rgba(255,249,236,0.9),rgba(242,252,255,0.9),rgba(255,239,245,0.86))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="text-sm font-medium text-gradient-primary">为什么要这些权限？为了让桌宠更懂你，不做“瞎催型闹钟”。</p>
                  {(Object.keys(permissions) as Array<keyof typeof permissions>).map((key) => (
                    <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/60 bg-white/60 px-3 py-2 text-sm text-[#4d3929] backdrop-blur">
                      <input
                        type="checkbox"
                        checked={permissions[key]}
                        onChange={(e) => setPermissions((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="mt-1 h-4 w-4 accent-[#d17a2a]"
                      />
                      <span>
                        <span className="block font-medium">{permissionLabels[key]}</span>
                        <span className="block text-xs text-gradient-milestone">{permissionHints[key]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {step === 0 && (
              <div className="space-y-5">
                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(120deg,rgba(255,255,255,0.9),rgba(238,248,255,0.87),rgba(255,245,231,0.86))] p-4 text-sm text-[#6a5644] ${moodTheme.cardGlow}`}>
                  这些信息会变成你的情报档案：桌宠会按你的作息、课程压力和焦虑点来调节提醒节奏与语气。
                </div>
                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.92),rgba(255,244,226,0.86),rgba(238,251,255,0.86))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 flex items-center gap-2 text-2xl font-semibold text-gradient-warm text-shadow-soft"><BookOpen className="h-5 w-5 animate-text-shimmer" />你的主修功法（专业）</p>
                  <div ref={majorMenuRef} className="relative overflow-visible rounded-2xl border border-white/80 bg-gradient-to-r from-white/95 via-[#fff3dd]/90 to-[#eaf7ff]/90 p-1.5">
                    <span className="pointer-events-none absolute left-4 top-1.5 text-[10px] tracking-widest text-gradient-milestone font-semibold uppercase">MAJOR PATH</span>
                    <button
                      type="button"
                      onClick={() => setIsMajorMenuOpen((prev) => !prev)}
                      className="w-full rounded-xl border border-[#eddcc7] bg-white/90 px-4 pb-2.5 pt-6 text-left text-lg text-[#4d3929] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)]"
                    >
                      {presetMajors.find((major) => major.value === profile.role)?.label ?? presetMajors[0].label}
                    </button>
                    <ChevronDown className={`pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gradient-milestone transition-transform ${isMajorMenuOpen ? "rotate-180" : "rotate-0"}`} />
                    {isMajorMenuOpen && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-white/80 bg-[linear-gradient(160deg,rgba(255,251,245,0.98),rgba(255,245,235,0.96),rgba(240,249,255,0.95))] p-2 shadow-[0_20px_40px_-24px_rgba(120,86,45,0.55)] backdrop-blur">
                        {presetMajors.map((major) => {
                          const active = profile.role === major.value
                          return (
                            <button
                              key={major.value}
                              type="button"
                              onClick={() => {
                                setProfile((prev) => ({ ...prev, role: major.value }))
                                setIsMajorMenuOpen(false)
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-base transition ${active ? "bg-gradient-to-r from-[#ffe8cc] via-[#ffeedd] to-[#eef7ff] text-[#613d1e]" : "text-[#5e4530] hover:bg-white/70"}`}
                            >
                              <span>{major.label}</span>
                              {active && <Check className="h-4 w-4 text-[#c8702a]" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.9),rgba(255,250,236,0.86),rgba(241,247,255,0.84))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 flex items-center gap-2 text-2xl font-semibold text-gradient-warm text-shadow-soft"><MoonStar className="h-5 w-5 animate-text-shimmer" />作息时间偏好</p>
                  <p className="mb-2 text-sm text-[#6a5644]">常见入睡时间：{sleepHour.toString().padStart(2, "0")}:00</p>
                  <input
                    type="range"
                    min={0}
                    max={23}
                    value={sleepHour}
                    onChange={(e) => setSleepHour(Number(e.target.value))}
                    className="pet-slider pet-slider--sleep h-2.5 w-full cursor-pointer appearance-none rounded-full"
                  />
                  <div className="mt-2 flex justify-between text-xs text-gradient-milestone">
                    <span>23:00 前（养生）</span>
                    <span>03:00+（修仙）</span>
                  </div>
                </div>

                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.9),rgba(248,252,255,0.88),rgba(255,244,231,0.86))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 text-2xl font-semibold text-gradient-warm text-shadow-soft">破防词汇（多选）</p>
                  <p className="mb-2 text-sm text-gradient-milestone">选你最容易焦虑的关键词，桌宠会在相关任务中提高提醒频次。</p>
                  <div className="flex flex-wrap gap-2">
                    {breakerVocabulary.map((item) => {
                      const active = selectedBreakers.includes(item)
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggleBreaker(item)}
                          className={`rounded-full border px-4 py-1.5 text-sm transition ${active ? moodTheme.chipActive : moodTheme.chipIdle}`}
                        >
                          [{item}]
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.9),rgba(255,246,232,0.9),rgba(237,249,255,0.82))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 text-2xl font-semibold text-gradient-warm text-shadow-soft">课表导入（.ics）</p>
                  <p className="mb-2 text-sm text-gradient-milestone">导入后可自动识别上课时段，避免在上课时高频打扰。</p>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault()
                      setIsDropActive(true)
                    }}
                    onDragLeave={() => setIsDropActive(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setIsDropActive(false)
                      pickIcsFile(e.dataTransfer.files?.[0] ?? null)
                    }}
                    className={`block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${isDropActive ? "border-[#d17a2a] bg-[#fff0dc]" : "border-[#d8c6ae] bg-white"}`}
                  >
                    <FolderUp className="mx-auto mb-3 h-10 w-10 text-[#b8742f]" />
                    <p className="text-xl font-semibold text-[#4d3929]">拖拽 .ics 课表文件到这里</p>
                    <p className="mt-2 text-sm text-gradient-milestone">或点击选择文件</p>
                    <input
                      type="file"
                      accept=".ics"
                      className="hidden"
                      onChange={(e) => pickIcsFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {icsFileName ? <p className="mt-2 text-sm text-emerald-700">已接收：{icsFileName}</p> : <p className="mt-2 text-sm text-gradient-milestone">可选：没有课表也能继续</p>}
                  <button
                    type="button"
                    onClick={() => {
                      setIcsFileName("")
                      try {
                        window.localStorage.removeItem(SCHEDULE_ICS_NAME_STORAGE_KEY)
                      } catch {
                      }
                    }}
                    className="mt-3 rounded-full border border-[#e4d4c0] bg-white px-4 py-1.5 text-sm text-gradient-milestone hover:bg-[#fff3e3]"
                  >
                    暂不导入，直接继续
                  </button>
                </div>

                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.9),rgba(255,238,239,0.86),rgba(232,245,255,0.84))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 text-2xl font-semibold text-gradient-warm text-shadow-soft">学习压力感知</p>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={anxietyLevel}
                    onChange={(e) => setAnxietyLevel(Number(e.target.value))}
                    className="pet-slider pet-slider--anxiety h-2.5 w-full cursor-pointer appearance-none rounded-full"
                    style={{ backgroundPositionX: `${100 - anxietyLevel}%` }}
                  />
                  <div className="mt-2 flex justify-between text-sm text-gradient-milestone">
                    <span>心态平稳</span>
                    <span>快碎了 · {anxietyLevel}%</span>
                  </div>
                </div>

              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.92),rgba(255,245,230,0.86),rgba(236,248,255,0.84))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 flex items-center gap-2 text-2xl font-semibold text-gradient-warm text-shadow-soft"><Cat className="h-5 w-5 animate-text-shimmer" />嘴替流派（Personality）</p>
                  <div className={`rounded-2xl border p-3 shadow-[inset_0_0_40px_rgba(255,255,255,0.08)] ${moodTheme.personalityPanel}`}>
                    <div className="mb-3 flex items-center gap-2 text-sm text-[#5b3f2a]">
                      <Heart className="h-4 w-4 text-[#ffb38a]" />
                      选一个说话人格，桌宠会按这个模式碎碎念
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(["阴阳怪气", "抽象发疯", "甜心夹子"] as PersonalityTone[]).map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => setPersonalityTone(tone)}
                          className={`pet-chip rounded-xl border px-3 py-2 text-sm transition ${personalityTone === tone ? `pet-chip--active ${moodTheme.chipActive}` : moodTheme.chipIdle}`}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.92),rgba(255,237,227,0.86),rgba(236,244,255,0.84))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-3 flex items-center gap-2 text-2xl font-semibold text-gradient-warm text-shadow-soft"><Gauge className="h-5 w-5 animate-text-shimmer" />显眼包指数（Activity Level）</p>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={activityLevel}
                    onChange={(e) => setActivityLevel(Number(e.target.value))}
                    className="pet-slider pet-slider--energy h-2.5 w-full cursor-pointer appearance-none rounded-full"
                  />
                  <div className="mt-2 flex justify-between text-sm text-gradient-milestone">
                    <span>淡定潜水</span>
                    <span>满屏踩奶</span>
                  </div>
                </div>

                <div className={`rounded-2xl border border-white/70 bg-[linear-gradient(130deg,rgba(255,255,255,0.92),rgba(255,245,229,0.88),rgba(238,249,255,0.82))] p-5 ${moodTheme.cardGlow}`}>
                  <p className="mb-1 flex items-center gap-2 text-2xl font-semibold text-gradient-warm text-shadow-soft"><Crown className="h-5 w-5 animate-text-shimmer" />认贼作父（Nickname）</p>
                  <p className="mb-3 text-sm text-gradient-milestone">这是桌宠对你的爱称，不是网名。会直接影响它撒娇和催任务的语气。</p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {nicknameTags.map((tag) => (
                      <button
                          key={tag}
                          type="button"
                          onClick={() => setNickname(tag)}
                          className={`rounded-full border px-3 py-1.5 text-sm transition ${nickname === tag ? moodTheme.chipActive : moodTheme.chipIdle}`}
                        >
                          [{tag}]
                        </button>
                    ))}
                  </div>
                  <Input
                    value={customNickname}
                    onChange={(e) => {
                      setCustomNickname(e.target.value)
                      setProfile((prev) => ({ ...prev, displayName: e.target.value }))
                    }}
                    placeholder="或者你起一个专属爱称"
                    className="border-[#dac7b1] bg-white text-[#4d3929]"
                  />
                </div>

                <label className="flex items-center justify-between rounded-xl border border-[#d8c6ae] bg-[#fffaf4] p-3 text-sm text-gradient-primary">
                  启动后自动连接
                  <input
                    type="checkbox"
                    checked={app.autoConnectOnLaunch}
                    onChange={(e) => setApp((prev) => ({ ...prev, autoConnectOnLaunch: e.target.checked }))}
                    className="h-4 w-4 accent-[#d17a2a]"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-[#d8c6ae] bg-[#fffaf4] p-3 text-sm text-gradient-primary">
                  点击桌宠打开控制台
                  <input
                    type="checkbox"
                    checked={app.openConsoleOnPetClick}
                    onChange={(e) => setApp((prev) => ({ ...prev, openConsoleOnPetClick: e.target.checked }))}
                    className="h-4 w-4 accent-[#d17a2a]"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[#eadfce] bg-[#fff8ef]/95 px-4 py-4 backdrop-blur sm:px-6 xl:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep((prev) => Math.max(0, prev - 1))} disabled={step === 0 || setupRunning} className="text-[#6a5644]">
              上一步
            </Button>
            {step < 2 ? (
              <Button
                onClick={() => setStep((prev) => Math.min(2, prev + 1))}
                disabled={setupRunning || summonInProgress}
                className={`rounded-full px-6 text-white transition-colors duration-500 ${moodTheme.accent}`}
              >
                <span className="animate-text-shimmer">下一步喵~</span>
              </Button>
            ) : (
              <Button onClick={() => setShowCompletionCard(true)} disabled={setupRunning || summonInProgress} className="rounded-full bg-[#ff9100] px-6 text-white hover:bg-[#e67f00]">
                {setupRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}<span className="animate-text-shimmer">大功告成，召唤桌宠</span>
              </Button>
            )}
            </div>
          </div>
        </div>

        <div
          className={`hidden h-full border-l border-[#eadfce] ${moodTheme.sidePanel} p-6 transition-colors duration-700 ease-out lg:block xl:p-8`}
          style={{ backgroundColor: moodTheme.sideTint }}
        >
          <div className="mb-6 flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs text-gradient-primary backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 animate-text-shimmer" />ClawPet <span className="font-semibold">初始化向导</span>
          </div>
          <div className="rounded-2xl border border-[#e8dccd] bg-white/90 px-4 py-3 text-sm leading-relaxed text-gradient-primary shadow-sm">
            {companionFeedback}
          </div>
          <div className="mt-6 rounded-3xl border border-[#e8dccd] bg-white/80 p-6 shadow-sm">
            <div className="mb-3 flex items-center justify-between text-xs text-gradient-milestone">
              <span className="rounded-full bg-[#fff1e0] px-3 py-1">🐾 桌宠候场区</span>
              <span>随机轮播</span>
            </div>
            <div className="relative overflow-hidden rounded-3xl border border-[#eadfce] bg-[radial-gradient(circle_at_25%_20%,#ffeccd_0%,#ffe4bf_35%,#ffd9ab_100%)] p-4">
              <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/30 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-8 -left-8 h-20 w-20 rounded-full bg-[#f8c996]/40 blur-xl" />
              <div className="relative flex h-[18.5rem] items-center justify-center rounded-2xl bg-white/55">
                <img
                  src={showcaseGifs[showcaseIndex]}
                  alt="桌宠预览"
                  className="h-full max-h-[16.5rem] w-auto object-contain drop-shadow-[0_14px_18px_rgba(75,43,13,0.2)]"
                />
              </div>
              <p className="mt-3 text-center text-sm text-[#6a5644]">{showcaseLines[showcaseIndex]}</p>
            </div>
          </div>
        </div>
      </div>

      {showCompletionCard && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/25 p-6">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(140deg,rgba(255,250,242,0.96),rgba(250,242,255,0.92),rgba(241,249,255,0.9))] p-6 shadow-[0_26px_70px_-35px_rgba(94,56,22,0.6)]">
            <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-[#ffccad]/40 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-[#b9d8ff]/35 blur-3xl" />
            {summonInProgress ? (
              <>
                <p className="text-2xl font-semibold text-gradient-warm text-shadow-warm">正在召唤桌宠</p>
                <p className="mt-2 text-sm text-gradient-milestone">自动配置进行中，正在和进度条一起同步推进喵。</p>

                <div className="relative mt-4 flex h-44 items-center justify-center overflow-hidden rounded-2xl border border-[#eadfce] bg-[radial-gradient(circle_at_30%_25%,#ffe9cc_0%,#fff7eb_40%,#fffdf8_100%)]">
                  <div className="absolute h-28 w-28 rounded-full bg-[#f8c589]/55 blur-2xl" />
                  <div className="absolute h-36 w-36 rounded-full border-4 border-[#f5dbbf] border-t-[#d17a2a] animate-spin" />
                  <div className="absolute h-24 w-24 rounded-full border-4 border-[#fde7cf] border-b-[#b8641d] animate-[spin_1400ms_linear_infinite]" />
                  <PawPrint className="relative h-12 w-12 text-[#a85b1c] drop-shadow" />
                </div>

                <div className="mt-4 rounded-2xl border border-[#eadfce] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between text-sm text-gradient-primary">
                    <span className="font-medium">自动配置进度</span>
                    <span>{Math.round(displayProgress)}%</span>
                  </div>
                  <Progress value={displayProgress} className="h-2 [&>div]:bg-[#cd7a2f]" />
                  <p className="mt-2 text-xs text-gradient-milestone">{loadingComfortLines[loadingLineIndex]}</p>
                  <div className="mt-3 grid gap-2">
                    {setupTasks.map((task) => (
                      <div key={task.id} className="flex items-start gap-3 rounded-xl border border-[#eadfce] bg-white px-3 py-2">
                        <div className="mt-0.5 h-4 w-4"><TaskIcon status={task.status} /></div>
                        <div>
                          <p className="text-sm font-medium text-[#3f2d1f]">{task.label}</p>
                          <p className="text-xs text-gradient-milestone">{task.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {setupError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{setupError}</div>}
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold text-gradient-warm text-shadow-warm animate-text-shimmer">你的人设画像已准备好</p>
                <p className="mt-2 text-sm text-gradient-milestone">确认后会先看一段召唤动画，再自动完成环境检查和桌宠通信配置。</p>

                <div className="mt-4 grid gap-3 rounded-2xl border border-white/80 bg-white/78 p-4 text-sm text-gradient-primary backdrop-blur">
                  <p><span className="font-medium text-gradient-warm">学习节奏：</span>{learningRhythmInsight.summary}</p>
                  <p><span className="font-medium text-gradient-warm">高专注窗口：</span>{learningRhythmInsight.focusWindows.join(" / ")}</p>
                  <p><span className="font-medium text-gradient-warm">压力等级：</span>{pressurePlanInsight.level}（{pressurePlanInsight.strategy}）</p>
                  <p><span className="font-medium text-gradient-warm">提醒间隔：</span>{pressurePlanInsight.reminderIntervalsMinutes.join(" / ")} 分钟</p>
                </div>

                <div className="mt-4 rounded-2xl border border-dashed border-[#e4d4c0] bg-[linear-gradient(130deg,rgba(255,245,230,0.85),rgba(255,236,248,0.78),rgba(234,245,255,0.78))] p-4">
                  <p className="text-sm font-medium text-gradient-primary">首条提醒预览</p>
                  <p className="mt-1 text-sm text-[#6a5644]">{previewReminderText || "点击“试试第一条提醒”预览桌宠语气。"}</p>
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCompletionCard(false)} className="border-[#e4d4c0] text-gradient-primary">再看一下</Button>
                  <Button variant="outline" onClick={previewReminder} className="border-[#e4d4c0] text-gradient-primary">试试第一条提醒</Button>
                  <Button onClick={complete} className="bg-[#ff9100] text-white hover:bg-[#e67f00]"><span className="animate-text-shimmer">确认并召唤桌宠</span></Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
