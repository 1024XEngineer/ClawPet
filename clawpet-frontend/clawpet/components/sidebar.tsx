"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle,
  Clock,
  Cpu,
  FolderUp,
  Home,
  Layers,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { type UseChatResult } from "@/hooks/use-chat"
import { useGatewayStatus } from "@/hooks/use-picoclaw"
import {
  openOnboardingPopup,
  SCHEDULE_ICS_NAME_STORAGE_KEY,
} from "@/lib/onboarding"
import { cn } from "@/lib/utils"

interface SidebarProps {
  activeNav: string
  setActiveNav: (nav: string) => void
  layoutMode?: "full" | "compact" | "ultra"
  chat: Pick<
    UseChatResult,
    "sessions" | "activeSessionId" | "newChat" | "switchSession" | "deleteSession"
  >
}

const navItems = [
  {
    icon: MessageSquare,
    label: "聊天",
    detail: "即时提问",
    accent:
      "from-amber-100 via-orange-50 to-white text-[#7b4d28] border-amber-200/90",
  },
  {
    icon: Layers,
    label: "技能",
    detail: "能力卡组",
    accent:
      "from-orange-100 via-rose-50 to-white text-[#924d2f] border-orange-200/90",
  },
  {
    icon: Clock,
    label: "定时任务",
    detail: "自动执行",
    accent:
      "from-sky-100 via-cyan-50 to-white text-[#365f87] border-sky-200/90",
  },
  {
    icon: Settings,
    label: "配置",
    detail: "环境设定",
    accent:
      "from-violet-100 via-purple-50 to-white text-[#5d4b8a] border-violet-200/90",
  },
]

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)

  if (diff < 60_000) {
    return "刚刚"
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`
  }
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function resolveGatewayAppearance(state?: string) {
  switch (state) {
    case "running":
      return {
        dot: "bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.45)]",
        shell:
          "from-emerald-100 via-emerald-50 to-white border-emerald-200/80",
        title: "运行中",
        detail: "桌宠已上线。",
      }
    case "starting":
    case "restarting":
      return {
        dot: "bg-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.4)] animate-pulse",
        shell:
          "from-amber-100 via-amber-50 to-white border-amber-200/80",
        title: "准备中",
        detail: "正在同步连接。",
      }
    case "stopping":
      return {
        dot: "bg-orange-500 shadow-[0_0_14px_rgba(249,115,22,0.35)]",
        shell:
          "from-orange-100 via-orange-50 to-white border-orange-200/80",
        title: "停止中",
        detail: "正在断开连接。",
      }
    default:
      return {
        dot: "bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.35)]",
        shell:
          "from-rose-100 via-rose-50 to-white border-rose-200/80",
        title: "未连接",
        detail: "尚未建立连接。",
      }
  }
}

export function Sidebar({
  activeNav,
  setActiveNav,
  layoutMode = "full",
  chat,
}: SidebarProps) {
  const [scheduleFileName, setScheduleFileName] = useState("")
  const [scheduleImportHint, setScheduleImportHint] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { data: gatewayStatus } = useGatewayStatus()
  const scheduleFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const openHistory = () => {
    setActiveNav("聊天")
    setHistoryOpen(true)
  }

  const handleSwitchSession = (sessionId: string) => {
    setActiveNav("聊天")
    void chat.switchSession(sessionId)
    setHistoryOpen(false)
  }

  useEffect(() => {
    try {
      const savedName = window.localStorage.getItem(SCHEDULE_ICS_NAME_STORAGE_KEY)
      if (savedName) {
        setScheduleFileName(savedName)
      }
    } catch {}
  }, [])

  const handleScheduleFilePick = (file: File | null) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith(".ics")) {
      setScheduleImportHint("只支持 .ics 课表文件")
      return
    }

    setScheduleImportHint("已导入，可在初始化里继续使用")
    setScheduleFileName(file.name)
    try {
      window.localStorage.setItem(SCHEDULE_ICS_NAME_STORAGE_KEY, file.name)
    } catch {}
  }

  const gatewayAppearance = resolveGatewayAppearance(gatewayStatus?.state)
  const importedScheduleLabel = scheduleFileName ? scheduleFileName : "未导入课表"
  const sessionCount = chat.sessions.length
  const isCompact = layoutMode !== "full"

  const historyOverlay =
    mounted && historyOpen
      ? createPortal(
          <div className="fixed inset-0 z-[1200] bg-black/45 p-4">
            <div className="mx-auto flex h-full w-full max-w-2xl flex-col rounded-[1.6rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,252,247,0.96),rgba(255,245,238,0.9))] shadow-[0_24px_56px_-34px_rgba(116,80,42,0.45)]">
              <div className="flex items-center justify-between border-b border-white/70 px-5 py-4">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    记忆舱
                  </p>
                  <p className="mt-1 text-base font-semibold text-[#4f3725]">会话历史</p>
                </div>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="rounded-full border border-white/75 bg-white/85 p-2 text-[#7f6651] transition hover:bg-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {chat.sessions.length === 0 ? (
                  <div className="flex h-full min-h-[12rem] items-center justify-center rounded-[1.2rem] border border-dashed border-amber-200/70 bg-white/72 px-4 text-center text-sm text-[#8a6b50]">
                    还没有历史对话。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {chat.sessions.map((session) => (
                      <div
                        key={session.id}
                        className={cn(
                          "dashboard-card flex items-start gap-3 rounded-[1.1rem] border px-3 py-3 transition",
                          session.id === chat.activeSessionId
                            ? "border-amber-200 bg-[linear-gradient(140deg,rgba(255,243,224,0.95),rgba(255,250,244,0.9))]"
                            : "border-white/75 bg-white/82 hover:border-amber-100 hover:bg-white",
                        )}
                      >
                        <button
                          onClick={() => handleSwitchSession(session.id)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white to-amber-50 text-[#9a6c45]">
                            <Home className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[#4f3725]">
                              {session.title}
                            </p>
                            <p className="mt-1 text-xs text-[#8a6b50]">
                              {session.messageCount > 0 ? `${session.messageCount} 条消息` : "空白对话"}
                              {" · "}
                              {formatRelativeTime(session.updatedAt)}
                            </p>
                          </div>
                        </button>

                        <button
                          onClick={() => void chat.deleteSession(session.id)}
                          className="rounded-full border border-white/75 bg-white/85 p-2 text-[#8a6b50] transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                          title="删除会话"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  if (layoutMode === "ultra") {
    return (
      <>
        <aside
          className="w-[5.6rem] shrink-0 border-r border-white/45 bg-[linear-gradient(180deg,rgba(255,250,245,0.9),rgba(255,246,238,0.84))]"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <div className="relative flex h-full flex-col overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,255,255,0.86),transparent_35%),radial-gradient(circle_at_78%_18%,rgba(255,214,170,0.22),transparent_32%)]" />

            <div className="relative flex h-full min-h-0 flex-col items-center gap-2 overflow-y-scroll p-2">
              <button
                onClick={() => setActiveNav("聊天")}
                title="桌宠驾驶舱"
                className="dashboard-enter dashboard-card flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,243,228,0.9))] text-amber-700 shadow-sm"
              >
                <Sparkles className="h-5 w-5" />
              </button>

            <button
              onClick={() => {
                setActiveNav("聊天")
                void chat.newChat()
              }}
              title="新建聊天"
              className="dashboard-enter dashboard-card flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-[#6a452a]"
            >
              <Plus className="h-4 w-4" />
            </button>

            <button
              onClick={openOnboardingPopup}
              title="重新初始化"
              className="dashboard-enter dashboard-card flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-[#6a452a]"
            >
              <Sparkles className="h-4 w-4" />
            </button>

            <button
              onClick={() => scheduleFileInputRef.current?.click()}
              title="导入课表"
              className="dashboard-enter dashboard-card flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-[#6a452a]"
            >
              <FolderUp className="h-4 w-4" />
            </button>

            <button
              onClick={openHistory}
              title="会话历史"
              className="dashboard-enter dashboard-card flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-[#6a452a]"
            >
              <Clock className="h-4 w-4" />
            </button>

            <input
              ref={scheduleFileInputRef}
              type="file"
              accept=".ics"
              className="hidden"
              onChange={(event) =>
                handleScheduleFilePick(event.target.files?.[0] ?? null)
              }
            />

            <div className="my-1 h-px w-10 bg-white/70" />

            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = activeNav === item.label
              return (
                <button
                  key={item.label}
                  title={item.label}
                  onClick={() => setActiveNav(item.label)}
                  className={cn(
                    "dashboard-card flex h-12 w-12 items-center justify-center rounded-2xl border transition",
                    isActive
                      ? `bg-gradient-to-r ${item.accent}`
                      : "border-white/75 bg-white/85 text-[#7f6047]",
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </button>
              )
            })}

              <div className="mt-auto h-1" />
            </div>
          </div>
        </aside>
        {historyOverlay}
      </>
    )
  }

  return (
    <aside
      className={cn(
        "min-h-0 h-full w-full border-b border-white/45 bg-[linear-gradient(180deg,rgba(255,250,245,0.88),rgba(255,246,238,0.8),rgba(250,243,238,0.78))] lg:shrink-0 lg:border-b-0 lg:border-r",
        isCompact ? "lg:w-[14.5rem]" : "lg:w-[20rem]",
      )}
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <div className="relative flex h-full flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(255,255,255,0.82),transparent_32%),radial-gradient(circle_at_85%_18%,rgba(255,214,170,0.26),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(255,183,197,0.16),transparent_38%)]" />

        <div
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-y-scroll scroll-pb-6",
            isCompact ? "gap-2 p-2.5 pb-5" : "gap-3 p-3 pb-5",
          )}
        >
          <section className={cn("dashboard-enter dashboard-card rounded-[1.8rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,244,232,0.88),rgba(255,248,242,0.86))] shadow-[0_18px_45px_-28px_rgba(131,84,37,0.52)]", isCompact ? "p-2.5" : "p-3")}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="dashboard-pulse-glow flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 text-white shadow-[0_12px_26px_-18px_rgba(217,119,6,0.7)]">
                  <Sparkles className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-amber-700/75">
                    ClawPet Console
                  </p>
                  <h2 className={cn("mt-1 font-semibold tracking-tight text-[#52331d]", isCompact ? "text-base" : "text-lg")}>
                    桌宠驾驶舱
                  </h2>
                </div>
              </div>
              <span className={cn("rounded-full border border-white/70 bg-white/80 font-medium text-[#876140]", isCompact ? "px-2 py-1 text-[0.68rem]" : "px-2.5 py-1 text-[0.72rem]")}>
                测试版
              </span>
            </div>

             <div className={cn("mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2", isCompact ? "gap-2" : "gap-2.5")}>
              <div
                className={cn(
                  "dashboard-card rounded-[1.2rem] border bg-gradient-to-r shadow-sm",
                  isCompact ? "px-2.5 py-2.5" : "px-3 py-3",
                  gatewayAppearance.shell,
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", gatewayAppearance.dot)} />
                  <span className="text-sm font-semibold text-[#4e3827]">
                    {gatewayAppearance.title}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-2 text-sm leading-5 text-[#83654d] [@media(max-height:860px)]:hidden",
                    isCompact && "hidden",
                  )}
                >
                  {gatewayAppearance.detail}
                </p>
              </div>

              <div className={cn("dashboard-card rounded-[1.2rem] border border-white/75 bg-white/78 shadow-sm", isCompact ? "px-2.5 py-2.5" : "px-3 py-3")}>
                <div className="flex items-center gap-2 text-[#5d4632]">
                  <Cpu className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-semibold">会话概览</span>
                </div>
                <p
                  className={cn(
                    "mt-2 text-sm leading-5 text-[#83654d] [@media(max-height:860px)]:hidden",
                    isCompact && "hidden",
                  )}
                >
                  已保存 {sessionCount} 个会话。
                </p>
              </div>
            </div>

            <div className={cn("mt-3 rounded-[1.2rem] border border-white/70 bg-white/72 px-3 py-2.5 text-xs text-[#7b624f] shadow-sm", isCompact && "hidden")}>
              课表状态：<span className="font-medium text-[#5d4430]">{importedScheduleLabel}</span>
            </div>
          </section>

          {isCompact && (
            <section className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/70 bg-white/64 p-2.5 shadow-[0_16px_36px_-28px_rgba(118,84,49,0.4)] backdrop-blur-xl">
              <button
                onClick={openHistory}
                className="dashboard-card flex w-full items-center justify-between rounded-[1.2rem] border border-white/75 bg-white/82 px-3 py-2.5 text-left"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#4f3725]">
                  <Clock className="h-4 w-4 text-amber-600" />
                  会话历史
                </span>
                <span className="rounded-full border border-white/80 bg-white/85 px-2 py-0.5 text-xs text-[#7f6651]">
                  {sessionCount} 条
                </span>
              </button>
            </section>
          )}

          <section className={cn("grid grid-cols-2", isCompact ? "gap-2" : "gap-3")}>
            <button
              onClick={() => {
                setActiveNav("聊天")
                void chat.newChat()
              }}
              className={cn("dashboard-enter dashboard-card group rounded-[1.4rem] border border-white/80 bg-[linear-gradient(140deg,rgba(255,255,255,0.9),rgba(255,245,235,0.82))] text-left shadow-[0_16px_30px_-24px_rgba(125,81,36,0.48)] transition hover:border-amber-200 hover:shadow-[0_22px_34px_-24px_rgba(217,119,6,0.4)]", isCompact ? "p-2.5" : "p-3")}
            >
              <div className={cn("flex items-center justify-center rounded-2xl bg-amber-100 text-amber-700", isCompact ? "h-8 w-8" : "h-9 w-9")}>
                <Plus className={cn(isCompact ? "h-3.5 w-3.5" : "h-4 w-4")} />
              </div>
              <p className={cn("mt-2 font-semibold text-[#533621]", isCompact ? "text-xs" : "text-sm")}>新建聊天</p>
            </button>

            <button
              onClick={openOnboardingPopup}
              className={cn("dashboard-enter dashboard-card group rounded-[1.4rem] border border-white/80 bg-[linear-gradient(140deg,rgba(255,248,228,0.96),rgba(255,240,214,0.84),rgba(255,248,238,0.8))] text-left shadow-[0_16px_30px_-24px_rgba(150,92,31,0.46)] transition hover:border-orange-200 hover:shadow-[0_22px_34px_-24px_rgba(245,158,11,0.42)]", isCompact ? "p-2.5" : "p-3")}
            >
              <div className={cn("flex items-center justify-center rounded-2xl bg-white/85 text-amber-700", isCompact ? "h-8 w-8" : "h-9 w-9")}>
                <Sparkles className={cn(isCompact ? "h-3.5 w-3.5" : "h-4 w-4")} />
              </div>
              <p className={cn("mt-2 font-semibold text-[#684120]", isCompact ? "text-xs" : "text-sm")}>重新初始化</p>
            </button>

            <button
              onClick={() => scheduleFileInputRef.current?.click()}
              className={cn("dashboard-enter dashboard-card col-span-2 group rounded-[1.4rem] border border-white/80 bg-[linear-gradient(140deg,rgba(245,251,255,0.94),rgba(255,249,243,0.84))] text-left shadow-[0_16px_30px_-24px_rgba(95,119,156,0.32)] transition hover:border-sky-200 hover:shadow-[0_22px_34px_-24px_rgba(56,189,248,0.28)]", isCompact ? "p-2.5" : "p-3")}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={cn("flex items-center justify-center rounded-2xl bg-sky-100 text-sky-700", isCompact ? "h-8 w-8" : "h-9 w-9")}>
                      <FolderUp className={cn(isCompact ? "h-3.5 w-3.5" : "h-4 w-4")} />
                    </div>
                    <div>
                      <p className={cn("font-semibold text-[#4b3a2c]", isCompact ? "text-sm" : "text-base")}>导入课表</p>
                    </div>
                  </div>
                </div>
                <span className={cn("rounded-full border border-white/70 bg-white/80 px-2 py-1 text-[0.65rem] text-[#7d6755]", isCompact ? "inline-flex" : "text-[0.7rem]")}>
                  {scheduleFileName ? "已同步" : "可选"}
                </span>
              </div>
            </button>

            <input
              ref={scheduleFileInputRef}
              type="file"
              accept=".ics"
              className="hidden"
              onChange={(event) =>
                handleScheduleFilePick(event.target.files?.[0] ?? null)
              }
            />
          </section>

          <section
            className={cn(
              "dashboard-enter dashboard-card min-h-0 rounded-[1.8rem] border border-white/70 bg-white/64 shadow-[0_16px_36px_-28px_rgba(118,84,49,0.4)] backdrop-blur-xl",
              isCompact ? "p-2.5" : "p-3",
            )}
          >
            <div className="mb-2 px-1">
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                功能舱
              </p>
            </div>
            <div className="space-y-2 max-h-[16.5rem] overflow-y-auto pr-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = activeNav === item.label

                return (
                  <button
                    key={item.label}
                    onClick={() => setActiveNav(item.label)}
                    className={cn(
                      "dashboard-card group flex w-full items-center gap-3 rounded-[1.3rem] border text-left transition",
                      isCompact ? "px-2.5 py-2" : "px-3 py-3",
                      isActive
                        ? `bg-gradient-to-r ${item.accent} shadow-[0_16px_30px_-24px_rgba(196,128,49,0.34)]`
                        : "border-white/70 bg-white/80 text-[#6d5846] hover:border-amber-100 hover:bg-white hover:shadow-[0_14px_28px_-24px_rgba(130,88,42,0.24)]",
                    )}
                  >
                    <div
                      className={cn(
                        "flex shrink-0 items-center justify-center rounded-2xl border transition",
                        isCompact ? "h-8 w-8" : "h-10 w-10",
                        isActive
                          ? "border-white/60 bg-white/75 text-current"
                          : "border-white/75 bg-gradient-to-br from-white to-amber-50 text-[#9a6c45]",
                      )}
                    >
                      <Icon className={cn(isCompact ? "h-4 w-4" : "h-4.5 w-4.5")} />
                    </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("font-semibold", isCompact ? "text-sm" : "text-[0.95rem]")}>{item.label}</p>
                        {isActive && !isCompact ? (
                          <p className="mt-0.5 truncate text-sm opacity-75">
                            {item.detail}
                          </p>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {!isCompact && (
            <section className="dashboard-enter min-h-0 flex-1 overflow-hidden rounded-[1.8rem] border border-white/70 bg-white/64 shadow-[0_16px_36px_-28px_rgba(118,84,49,0.4)] backdrop-blur-xl">
            <div className="border-b border-white/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                    记忆舱
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#4f3725]">
                    最近对话
                  </p>
                </div>
                <span className="rounded-full border border-white/80 bg-white/85 px-2.5 py-1 text-[0.72rem] text-[#7f6651]">
                  {sessionCount} 条
                </span>
              </div>
            </div>

            <div className="h-full overflow-y-scroll px-3 py-3">
              {chat.sessions.length === 0 ? (
                <div className="flex h-full min-h-[12rem] items-center justify-center rounded-[1.4rem] border border-dashed border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,249,241,0.92),rgba(255,244,234,0.84))] px-4 text-center text-sm leading-6 text-[#8a6b50]">
                  还没有历史对话。开启第一轮聊天后，这里会变成你的记忆舱。
                </div>
              ) : (
                <div className="space-y-2">
                  {chat.sessions.map((session) => (
                    <div
                      key={session.id}
                      className={cn(
                        "dashboard-card flex items-start gap-3 rounded-[1.2rem] border px-3 py-3 transition",
                        session.id === chat.activeSessionId
                          ? "border-amber-200 bg-[linear-gradient(140deg,rgba(255,243,224,0.95),rgba(255,250,244,0.9))] shadow-[0_16px_28px_-24px_rgba(217,119,6,0.28)]"
                          : "border-white/75 bg-white/82 hover:border-amber-100 hover:bg-white hover:shadow-[0_14px_24px_-24px_rgba(125,84,35,0.22)]",
                      )}
                    >
                      <button
                        onClick={() => {
                          setActiveNav("聊天")
                          void chat.switchSession(session.id)
                        }}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-white to-amber-50 text-[#9a6c45] shadow-sm">
                          <Home className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold text-[#4f3725]">
                            {session.title}
                          </p>
                          <p className="mt-1 text-xs text-[#8a6b50]">
                            {session.messageCount > 0 ? `${session.messageCount} 条消息` : "空白对话"}
                            {" · "}
                            {formatRelativeTime(session.updatedAt)}
                          </p>
                        </div>
                      </button>

                      <button
                        onClick={() => void chat.deleteSession(session.id)}
                        className="rounded-full border border-white/75 bg-white/85 p-2 text-[#8a6b50] transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                        title="删除会话"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </section>
          )}

          {(scheduleImportHint || scheduleFileName || gatewayStatus?.restartRequired) && (
            <section className={cn("dashboard-enter dashboard-card rounded-[1.8rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,252,248,0.92),rgba(255,246,238,0.84))] shadow-[0_16px_36px_-28px_rgba(118,84,49,0.36)]", isCompact ? "p-2.5" : "p-3", "mb-1 shrink-0 max-[860px]:p-2")}> 
              {(scheduleImportHint || scheduleFileName) && (
                <div className="rounded-[1.1rem] border border-white/75 bg-white/78 px-3 py-2 text-xs leading-5 text-[#7d6755]">
                  {scheduleImportHint || `已导入：${scheduleFileName}`}
                </div>
              )}

              {gatewayStatus?.restartRequired && (
                <div className="mt-3 flex items-start gap-2 rounded-[1.1rem] border border-orange-200/70 bg-orange-50/90 px-3 py-2 text-xs leading-5 text-[#955924]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>检测到网关需要重启，部分新配置会在重启后生效。</span>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {historyOverlay}
    </aside>
  )
}
