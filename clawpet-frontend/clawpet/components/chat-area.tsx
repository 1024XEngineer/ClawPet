"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import {
  ChevronDown,
  FileText,
  Lightbulb,
  Mic,
  PenTool,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { type UseChatResult } from "@/hooks/use-chat"
import { useVoiceInput } from "@/hooks/use-voice-input"
import { cn } from "@/lib/utils"

const suggestions = [
  {
    icon: Lightbulb,
    accent:
      "from-amber-100 via-yellow-50 to-white text-amber-700 border-amber-200/80",
    title: "拆解难题",
    description: "把复杂目标拆成今天就能推进的三步。",
    prompt: "帮我把当前任务拆成三个今天就能推进的步骤。",
  },
  {
    icon: PenTool,
    accent:
      "from-orange-100 via-rose-50 to-white text-orange-700 border-orange-200/80",
    title: "起草内容",
    description: "快速生成开场白、说明文或 PR 简介。",
    prompt: "帮我起草一段清晰、简洁的说明文字。",
  },
  {
    icon: Search,
    accent:
      "from-sky-100 via-cyan-50 to-white text-sky-700 border-sky-200/80",
    title: "查找资料",
    description: "整理关键词、搜索方向和排查思路。",
    prompt: "帮我整理这个问题应该查什么关键词、按什么顺序查。",
  },
  {
    icon: FileText,
    accent:
      "from-violet-100 via-purple-50 to-white text-violet-700 border-violet-200/80",
    title: "输出提纲",
    description: "把想法整理成结构化提纲或行动清单。",
    prompt: "帮我把这个主题整理成清晰的结构化提纲。",
  },
]

const workbenchCards = [
  {
    title: "今日推进",
    description: "",
  },
  {
    title: "桌宠提醒",
    description: "",
  },
  {
    title: "灵感草稿",
    description: "",
  },
]

interface ChatAreaProps {
  chat: UseChatResult
  layoutMode?: "full" | "compact" | "ultra"
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}`
}

export function ChatArea({ chat, layoutMode = "full" }: ChatAreaProps) {
  const [activeTab, setActiveTab] = useState("聊天")
  const [message, setMessage] = useState("")
  const isCompact = layoutMode !== "full"
  const isUltra = layoutMode === "ultra"
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const {
    isListening,
    isSupported: isVoiceInputSupported,
    toggleListening,
  } = useVoiceInput({
    onResult: (text) => {
      setMessage((prev) => `${prev}${prev ? " " : ""}${text}`.trim())
    },
    onError: (voiceError) => {
      console.warn("[petclaw] voice input error", voiceError)
    },
  })

  const {
    messages,
    isConnected,
    isTyping,
    error,
    sendMessage,
    reconnect,
    clearError,
    sessions,
  } = chat

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = () => {
    if (!message.trim()) {
      return
    }
    sendMessage(message)
    setMessage("")
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleSuggestionClick = (prompt: string) => {
    sendMessage(prompt)
  }

  const hasMessages = messages.length > 0
  const heroTitle =
    activeTab === "工作" ? "今天准备推进哪项任务？" : "今天想让桌宠帮你什么？"
  const heroSubtitle =
    activeTab === "工作"
      ? "把计划、代码、写作或提醒交给桌宠，它会帮你压成能立刻执行的动作。"
      : "这里不是后台，而是桌宠的指挥台。你可以发问、交办任务，或者直接开始一轮陪伴式会话。"

  const userMessageCount = messages.filter((item) => item.role === "user").length
  const assistantMessageCount = messages.filter(
    (item) => item.role === "assistant" && !item.streaming,
  ).length

  const stageStats = useMemo(
    () => [
      {
        label: "连接状态",
        value: isConnected ? "已连接" : "待连接",
        tone: isConnected ? "text-emerald-700" : "text-rose-700",
        shell: isConnected
          ? "from-emerald-100 via-emerald-50 to-white border-emerald-200/80"
          : "from-rose-100 via-rose-50 to-white border-rose-200/80",
      },
      {
        label: "会话记忆",
        value: formatCount(sessions.length, "段"),
        tone: "text-[#704a2a]",
        shell: "from-amber-100 via-orange-50 to-white border-amber-200/80",
      },
      {
        label: "已处理消息",
        value: formatCount(userMessageCount + assistantMessageCount, "条"),
        tone: "text-[#5f4b86]",
        shell: "from-violet-100 via-purple-50 to-white border-violet-200/80",
      },
    ],
    [assistantMessageCount, isConnected, sessions.length, userMessageCount],
  )

  const visibleSuggestions = isUltra ? suggestions.slice(0, 2) : suggestions

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,246,237,0.78),rgba(255,249,245,0.94),rgba(255,252,249,0.98))]"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.8),transparent_26%),radial-gradient(circle_at_86%_10%,rgba(255,215,170,0.32),transparent_24%),radial-gradient(circle_at_70%_72%,rgba(254,205,211,0.18),transparent_30%),radial-gradient(circle_at_18%_82%,rgba(191,219,254,0.18),transparent_26%)]" />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "dashboard-enter",
            isUltra ? "px-2.5 pb-1.5 pt-2" : isCompact ? "px-3 pb-2 pt-3" : "px-6 pb-3 pt-5",
          )}
        >
          <div className={cn("dashboard-card border border-white/70 bg-[linear-gradient(145deg,rgba(255,251,246,0.92),rgba(255,245,237,0.86),rgba(255,249,244,0.84))] shadow-[0_20px_45px_-30px_rgba(120,83,42,0.45)] backdrop-blur-xl", isUltra ? "rounded-[1rem] px-2.5 py-2" : isCompact ? "rounded-[1.2rem] px-3 py-2.5" : "rounded-[1.8rem] px-5 py-4")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                 <span
                   className={cn(
                     "inline-flex items-center gap-2 rounded-full border font-medium",
                     isUltra ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
                     isConnected
                       ? "border-emerald-200/90 bg-emerald-50/90 text-emerald-700"
                       : "border-rose-200/90 bg-rose-50/90 text-rose-700",
                  )}
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      isConnected
                        ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
                        : "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.32)]",
                    )}
                  />
                  {isConnected ? "桌宠在线" : "等待连接"}
                </span>

                 <span className={cn("dashboard-pulse-glow inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/82 text-[#70563f]", isUltra ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm")}>
                   <Sparkles className="h-4 w-4 text-amber-600" />
                   驾驶舱模式
                 </span>

              </div>

               <div className={cn("flex items-center gap-2 rounded-full border border-white/75 bg-white/82", isUltra ? "p-0.5" : "p-1")}>
                {(["聊天", "工作"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                       "rounded-full font-medium transition",
                       isUltra ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
                      activeTab === tab
                        ? "bg-gradient-to-r from-white via-amber-50 to-white text-[#4d3420] shadow-[0_12px_20px_-18px_rgba(115,75,34,0.55)]"
                        : "text-[#8a6b50] hover:text-[#4d3420]",
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {!isConnected && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={reconnect}
                    className="rounded-full border-white/80 bg-white/82 text-[#6f5033] hover:bg-white"
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    重新连接
                  </Button>
                )}
                {!isCompact && <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.24em] text-[#b07b4d]">
                    陪伴牌组
                  </p>
                  <p className="mt-1 text-base font-semibold text-[#51341f]">
                    ClawPet AI
                  </p>
                </div>}
                {!isCompact && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full border-amber-300 bg-amber-50/90 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                  >
                    体验增强版
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={cn("min-h-0 flex-1 overflow-y-scroll", isCompact ? "px-3 pb-2 pt-1" : "px-6 pb-4 pt-1")}>
          {hasMessages ? (
            <div className={cn("grid min-h-full gap-4", !isCompact && "lg:grid-cols-[minmax(0,1fr)_18rem]")}>
              <div className="dashboard-enter dashboard-card min-h-0 overflow-y-scroll rounded-[2rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,249,0.94),rgba(255,247,242,0.9))] p-5 shadow-[0_24px_50px_-34px_rgba(116,80,42,0.4)]">
                <div className="dashboard-card rounded-[1.4rem] border border-white/70 bg-white/82 px-4 py-3 shadow-sm">
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    进行中
                  </p>
                  <p className="mt-1 text-xl font-semibold text-[#4f3725]">
                    当前会话正在进行中
                  </p>
                </div>

                {error && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-[1.2rem] border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-700">
                    <span>{error}</span>
                    <button
                      onClick={clearError}
                      className="rounded-full border border-rose-200 bg-white/80 px-3 py-1 text-rose-700 hover:bg-white"
                    >
                      关闭
                    </button>
                  </div>
                )}

                <div className="mt-4 space-y-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex",
                        msg.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[82%] rounded-[1.6rem] px-4 py-3 shadow-sm",
                          msg.role === "user"
                            ? "bg-[linear-gradient(135deg,#8e5327_0%,#b66a2d_45%,#cb8642_100%)] text-amber-50 shadow-[0_18px_28px_-22px_rgba(146,83,39,0.65)]"
                            : "border border-white/75 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(255,248,241,0.88))] text-[#4b3422] shadow-[0_18px_28px_-24px_rgba(116,81,43,0.28)]",
                        )}
                      >
                        <p className="whitespace-pre-wrap leading-7">
                          {msg.content}
                        </p>
                        {msg.streaming && (
                          <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-current align-middle" />
                        )}
                      </div>
                    </div>
                  ))}

                  {isTyping && !messages.some((msg) => msg.streaming) && (
                    <div className="flex justify-start">
                      <div className="rounded-[1.4rem] border border-white/75 bg-white/82 px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full bg-[#d08a3a] animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="h-2 w-2 rounded-full bg-[#d08a3a] animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="h-2 w-2 rounded-full bg-[#d08a3a] animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {!isCompact && <aside className="hidden space-y-4 lg:block">
                <div className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,245,239,0.88))] p-4 shadow-[0_20px_40px_-32px_rgba(116,80,42,0.36)]">
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    会话脉冲
                  </p>
                  <div className="mt-3 space-y-3">
                    {stageStats.map((item) => (
                      <div
                        key={item.label}
                        className={cn(
                          "dashboard-card rounded-[1.2rem] border bg-gradient-to-r px-3 py-3",
                          item.shell,
                        )}
                      >
                        <p className="text-xs text-[#8a6b50]">{item.label}</p>
                        <p className={cn("mt-1 text-sm font-semibold", item.tone)}>
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-4 shadow-[0_20px_40px_-32px_rgba(116,80,42,0.36)]">
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    快速投喂
                  </p>
                  <div className="mt-3 space-y-2">
                    {suggestions.slice(0, 3).map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.title}
                          onClick={() => handleSuggestionClick(item.prompt)}
                          className="dashboard-card flex w-full items-start gap-3 rounded-[1.2rem] border border-white/70 bg-white/82 px-3 py-3 text-left transition hover:border-amber-100 hover:bg-white"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                  <p className="text-base font-semibold text-[#4f3725]">
                    {item.title}
                  </p>
                            <p className="mt-1 text-sm leading-5 text-[#8a6b50]">
                              {item.description}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </aside>}
            </div>
          ) : (
            <div className={cn("grid min-h-full gap-4", !isCompact && "lg:grid-cols-[minmax(0,1fr)_18rem]")}>
              <div className="dashboard-enter dashboard-card rounded-[2.2rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,251,246,0.96),rgba(255,244,236,0.9),rgba(255,250,245,0.92))] px-7 py-8 shadow-[0_24px_58px_-34px_rgba(118,83,43,0.44)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/82 px-3 py-1.5 text-sm font-medium text-[#7f5a38]">
                    <Sparkles className="h-4 w-4 text-amber-600" />
                    陪伴中枢
                  </span>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/82 px-3 py-1.5 text-sm text-[#7f5a38]">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        isConnected ? "bg-emerald-500" : "bg-rose-500",
                      )}
                    />
                    {isConnected ? "已连接，可以直接开始" : "等待连接后发起任务"}
                  </div>
                </div>

                <div className="mt-8 flex flex-col items-center text-center">
                  <div className="dashboard-float-slow relative flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/75 bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.98),rgba(255,236,214,0.9),rgba(255,245,234,0.84))] shadow-[0_24px_40px_-30px_rgba(214,135,46,0.65)]">
                    <svg viewBox="0 0 40 40" className="h-12 w-12 text-[#4a3425]" fill="none">
                      <circle cx="12" cy="12" r="4" fill="currentColor" />
                      <circle cx="28" cy="12" r="4" fill="currentColor" />
                      <circle cx="12" cy="28" r="4" fill="currentColor" />
                      <circle cx="28" cy="28" r="4" fill="currentColor" />
                      <circle cx="20" cy="20" r="5" fill="currentColor" />
                    </svg>
                    <Sparkles className="absolute -right-1 -top-1 h-5 w-5 text-amber-500" />
                  </div>

                  <h1 className={cn("mt-7 font-semibold tracking-tight text-[#3d2718]", isCompact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl")}>
                    {heroTitle}
                  </h1>
                  <p className={cn("mx-auto mt-4 max-w-3xl text-[#816451]", isCompact ? "text-sm leading-6" : "text-base leading-8")}>
                    {heroSubtitle}
                  </p>
                </div>

                <div className={cn("mt-6 grid gap-3", isCompact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-3")}>
                  {stageStats.map((item) => (
                    <div
                      key={item.label}
                      className={cn(
                        "dashboard-card rounded-[1.4rem] border bg-gradient-to-r px-4 py-4 text-left shadow-sm",
                        item.shell,
                      )}
                    >
                      <p className="text-xs uppercase tracking-[0.18em] text-[#9b7555]">
                        {item.label}
                      </p>
                      <p className={cn("mt-2 text-lg font-semibold", item.tone)}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="mt-5 rounded-[1.3rem] border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <div className={cn("mt-6 grid gap-3", isCompact ? "grid-cols-1" : "md:grid-cols-2")}>
                  {visibleSuggestions.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.title}
                        onClick={() => handleSuggestionClick(item.prompt)}
                        className={cn(
                          "dashboard-card group rounded-[1.7rem] border bg-gradient-to-br p-5 text-left shadow-[0_18px_34px_-28px_rgba(121,85,44,0.36)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_38px_-28px_rgba(121,85,44,0.44)]",
                          item.accent,
                        )}
                      >
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/78 shadow-sm">
                          <Icon className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-xl font-semibold text-[#3f2b1d]">
                          {item.title}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#7f5f48]">
                          {item.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

               {!isCompact && <aside className="space-y-4">
                <div className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,246,241,0.88))] p-4 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.36)]">
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    工作台
                  </p>
                  <div className="mt-3 space-y-3">
                    {workbenchCards.map((item, index) => (
                      <div
                        key={item.title}
                        className={cn(
                          "dashboard-card rounded-[1.25rem] border border-white/75 bg-white/82 px-3 py-3 shadow-sm",
                          index === 0 &&
                            "bg-[linear-gradient(140deg,rgba(255,248,234,0.96),rgba(255,255,255,0.88))]",
                        )}
                      >
                        <p className="text-sm font-semibold text-[#4f3725]">
                          {item.title}
                        </p>
                        {item.description ? (
                          <p className="mt-1 text-xs leading-5 text-[#8a6b50]">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,246,241,0.88))] p-4 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.36)]">
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    第一投喂
                  </p>
                  <p className="mt-2 text-base leading-7 text-[#816451]">
                    直接发一句自然语言，例如“帮我安排今天的复习节奏”或“给我起草一段说明”。
                  </p>
                  <button
                    onClick={() =>
                      handleSuggestionClick("帮我安排今天的复习节奏，并给出一份可执行清单。")
                    }
                    className="dashboard-card mt-4 w-full rounded-[1.25rem] border border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,246,228,0.96),rgba(255,253,247,0.9))] px-4 py-3 text-left text-sm font-medium text-[#7b4d28] transition hover:border-amber-300 hover:bg-white"
                  >
                    生成今天的推进清单
                  </button>
                </div>
               </aside>}
            </div>
          )}
        </div>

        <div className={cn("dashboard-enter relative", isUltra ? "px-2.5 pb-2 pt-1.5" : isCompact ? "px-3 pb-3 pt-2" : "px-6 pb-6 pt-3")}>
          <div className={cn("dashboard-card mx-auto border border-white/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.92),rgba(255,248,241,0.88))] shadow-[0_26px_52px_-34px_rgba(118,80,42,0.46)] backdrop-blur-xl", isUltra ? "max-w-none rounded-[1rem] p-2.5" : isCompact ? "max-w-none rounded-[1.2rem] p-3" : "max-w-5xl rounded-[2rem] p-4")}>
            <div className={cn("flex flex-wrap items-center justify-between border-b border-white/80 px-1", isUltra ? "gap-2 pb-2" : "gap-3 pb-3")}>
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                  召唤台
                </p>
                {!isUltra && <p className={cn("mt-1 text-[#7f5f48]", isCompact ? "text-sm" : "text-base")}>
                  一句话召唤桌宠，马上开始。
                </p>}
              </div>
              {!isUltra && <div className="flex flex-wrap items-center gap-2">
                <button className="rounded-full border border-white/75 bg-white/82 px-3 py-1.5 text-sm text-[#70563f] transition hover:bg-white">
                  <span className="inline-flex items-center gap-1">
                    <Plus className="h-4 w-4" />
                    附加
                  </span>
                </button>
                <button className="rounded-full border border-white/75 bg-white/82 px-3 py-1.5 text-sm text-[#70563f] transition hover:bg-white">
                  <span className="inline-flex items-center gap-1">
                    快速
                    <ChevronDown className="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>}
            </div>

            <div className={cn("px-1", isUltra ? "pt-2" : "pt-4")}>
                <input
                type="text"
                placeholder="输入消息、任务，或你现在最想推进的一件事..."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleKeyDown}
                className={cn(
                  "w-full bg-transparent leading-tight text-[#3f2b1d] outline-none placeholder:text-[#b19278]",
                  isUltra ? "text-[1rem]" : isCompact ? "text-[1.08rem]" : "text-[1.55rem]",
                )}
              />
            </div>

            <div className={cn("flex flex-wrap items-center justify-between px-1", isUltra ? "mt-2 gap-2" : "mt-4 gap-3")}>
              <div className={cn("flex flex-wrap items-center gap-2 text-[#8a6b50]", isUltra ? "text-xs" : "text-sm")}>
                <span className="rounded-full border border-white/75 bg-white/78 px-3 py-1.5">
                  {activeTab === "工作" ? "工作模式" : "聊天模式"}
                </span>
                {!isUltra && <span className="rounded-full border border-white/75 bg-white/78 px-3 py-1.5">
                  {isVoiceInputSupported ? "支持语音输入" : "当前无语音输入"}
                </span>}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleListening}
                  disabled={!isVoiceInputSupported}
                  className={cn(
                    "flex items-center justify-center border border-white/80 bg-white/82 text-[#70563f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40",
                    isUltra ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-2xl",
                    isListening &&
                      "border-amber-300 bg-amber-50 text-amber-700 shadow-[0_14px_20px_-18px_rgba(245,158,11,0.7)]",
                  )}
                  title={
                    isVoiceInputSupported
                      ? isListening
                        ? "停止语音输入"
                        : "开始语音输入"
                      : "当前环境不支持语音输入"
                  }
                >
                  <Mic className="h-4.5 w-4.5" />
                </button>

                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!message.trim() || !isConnected}
                  className={cn(
                    "bg-[linear-gradient(135deg,#9a5929_0%,#c87734_48%,#e1a05b_100%)] text-amber-50 shadow-[0_18px_26px_-18px_rgba(154,89,41,0.75)] hover:brightness-105 disabled:opacity-50",
                    isUltra ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-2xl",
                  )}
                >
                  {isTyping ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
