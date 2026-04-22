"use client"

import { useEffect, useState } from "react"
import {
  AlertCircle,
  Bell,
  Calendar,
  Clock,
  Edit2,
  Pause,
  Play,
  Plus,
  Repeat,
  Terminal,
  Trash2,
  X,
} from "lucide-react"

import { useCronJobs, useCronMutations } from "@/hooks/use-picoclaw"
import type { CronJob, CronJobInput, CronScheduleType } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

const scheduleTypeOptions: Array<{ value: CronScheduleType; label: string; hint: string }> = [
  { value: "cron", label: "Cron", hint: "按固定时间表达式执行" },
  { value: "every", label: "间隔", hint: "每隔 N 秒重复执行" },
  { value: "at", label: "单次", hint: "在指定时间只执行一次" },
]

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return "操作失败，请稍后再试。"
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function formatDateTime(ms?: number): string {
  if (!ms) {
    return "尚未执行"
  }

  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toDatetimeLocalValue(ms?: number): string {
  if (!ms) {
    return ""
  }

  const date = new Date(ms)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function isToday(ms?: number): boolean {
  if (!ms) {
    return false
  }

  const target = new Date(ms)
  const now = new Date()
  return (
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  )
}

function formatEveryLabel(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return "未设置"
  }

  if (seconds % 86_400 === 0) {
    return `每 ${seconds / 86_400} 天`
  }
  if (seconds % 3_600 === 0) {
    return `每 ${seconds / 3_600} 小时`
  }
  if (seconds % 60 === 0) {
    return `每 ${seconds / 60} 分钟`
  }
  return `每 ${seconds} 秒`
}

function formatCronSummary(expr?: string): string {
  if (!expr) {
    return "Cron 计划"
  }

  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) {
    return expr
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const hasFixedTime = /^\d+$/.test(minute) && /^\d+$/.test(hour)
  const timeLabel = hasFixedTime ? `${pad(Number(hour))}:${pad(Number(minute))}` : expr

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `每天 ${timeLabel}`
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return `工作日 ${timeLabel}`
  }
  if (dayOfMonth === "*" && month === "*" && (dayOfWeek === "0,6" || dayOfWeek === "6,0")) {
    return `周末 ${timeLabel}`
  }

  return `Cron：${expr}`
}

function getScheduleLabel(job: CronJob): string {
  switch (job.scheduleType) {
    case "every":
      return formatEveryLabel(job.everySeconds)
    case "at":
      return `One-time at ${formatDateTime(job.atMs)}`
    case "cron":
    default:
      return formatCronSummary(job.cronExpr || job.schedule)
  }
}

function getScheduleMeta(job: CronJob): string {
  switch (job.scheduleType) {
    case "every":
      return "Repeats on a fixed interval"
    case "at":
      return "执行后自动移除"
    case "cron":
    default:
      return job.cronExpr || job.schedule || "Cron 表达式"
  }
}

function sortJobs(jobs: CronJob[]): CronJob[] {
  return [...jobs].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1
    }

    const leftNext = left.nextRunAtMs ?? Number.MAX_SAFE_INTEGER
    const rightNext = right.nextRunAtMs ?? Number.MAX_SAFE_INTEGER
    if (leftNext !== rightNext) {
      return leftNext - rightNext
    }

    const leftUpdated = left.updatedAtMs ?? 0
    const rightUpdated = right.updatedAtMs ?? 0
    return rightUpdated - leftUpdated
  })
}

interface ScheduleDialogProps {
  open: boolean
  mode: "create" | "edit"
  job?: CronJob | null
  submitting: boolean
  onClose: () => void
  onSubmit: (input: CronJobInput) => Promise<void>
}

function ScheduleDialog({ open, mode, job, submitting, onClose, onSubmit }: ScheduleDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [scheduleType, setScheduleType] = useState<CronScheduleType>("cron")
  const [cronExpr, setCronExpr] = useState("0 9 * * *")
  const [everySeconds, setEverySeconds] = useState("300")
  const [atValue, setAtValue] = useState("")
  const [command, setCommand] = useState("")

  useEffect(() => {
    if (!open) {
      return
    }

    if (mode === "edit" && job) {
      setName(job.name)
      setDescription(job.description || job.message || "")
      setScheduleType(job.scheduleType || "cron")
      setCronExpr(job.cronExpr || job.schedule || "0 9 * * *")
      setEverySeconds(job.everySeconds ? String(job.everySeconds) : "300")
      setAtValue(toDatetimeLocalValue(job.atMs))
      setCommand(job.command || "")
      return
    }

    setName("")
    setDescription("")
    setScheduleType("cron")
    setCronExpr("0 9 * * *")
    setEverySeconds("300")
    setAtValue("")
    setCommand("")
  }, [job, mode, open])

  if (!open) {
    return null
  }

  const parsedEverySeconds = Number(everySeconds)
  const parsedAtMs = atValue ? new Date(atValue).getTime() : NaN
  const isCronValid = scheduleType !== "cron" || cronExpr.trim().length > 0
  const isEveryValid = scheduleType !== "every" || (Number.isFinite(parsedEverySeconds) && parsedEverySeconds > 0)
  const isAtValid = scheduleType !== "at" || (Number.isFinite(parsedAtMs) && parsedAtMs > Date.now())
  const canSubmit =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    isCronValid &&
    isEveryValid &&
    isAtValid

  async function handleSubmit() {
    if (!canSubmit) {
      return
    }

    const payload: CronJobInput = {
      name: name.trim(),
      description: description.trim(),
      scheduleType,
      command: command.trim() || undefined,
    }

    if (scheduleType === "cron") {
      payload.schedule = cronExpr.trim()
    } else if (scheduleType === "every") {
      payload.everySeconds = Math.floor(parsedEverySeconds)
    } else {
      payload.atMs = parsedAtMs
    }

    await onSubmit(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-xl rounded-3xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {mode === "edit" ? "编辑定时任务" : "新建定时任务"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              支持 Cron、固定间隔和单次执行三种方式。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">任务名称</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：晨间提醒"
              className="w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-400/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">任务内容</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="写下任务触发后要让 AI 做什么，或者要提醒你的内容。"
              className="h-24 w-full resize-none rounded-2xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-400/20"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">调度方式</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {scheduleTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setScheduleType(option.value)}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-left transition",
                    scheduleType === option.value
                      ? "border-orange-300 bg-orange-50 text-orange-900"
                      : "border-border bg-background text-foreground hover:border-orange-200 hover:bg-muted/40"
                  )}
                >
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{option.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {scheduleType === "cron" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Cron 表达式</label>
              <input
                type="text"
                value={cronExpr}
                onChange={(event) => setCronExpr(event.target.value)}
                placeholder="例如：0 9 * * *"
                className="w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-400/20"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                例如：`0 9 * * *` 表示每天 09:00，`0 18 * * 1-5` 表示工作日 18:00。
              </p>
            </div>
          )}

          {scheduleType === "every" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">执行间隔（秒）</label>
              <input
                type="number"
                min={1}
                value={everySeconds}
                onChange={(event) => setEverySeconds(event.target.value)}
                placeholder="例如：300"
                className="w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-400/20"
              />
              <p className="mt-1 text-xs text-muted-foreground">例如：300 表示每 5 分钟执行一次。</p>
            </div>
          )}

          {scheduleType === "at" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">执行时间</label>
              <input
                type="datetime-local"
                value={atValue}
                onChange={(event) => setAtValue(event.target.value)}
                className="w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-400/20"
              />
              <p className="mt-1 text-xs text-muted-foreground">单次任务执行完成后会自动移除。</p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">命令（可选）</label>
            <input
              type="text"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="例如：echo hello"
              className="w-full rounded-2xl border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-400/20"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              留空时触发 AI 任务；填写后会直接执行这条命令。
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="border-0 bg-gradient-to-r from-orange-400 to-pink-500 text-white hover:from-orange-500 hover:to-pink-600"
          >
            {submitting ? <Spinner className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
            {mode === "edit" ? "保存修改" : "创建任务"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ScheduleCard({
  job,
  onEdit,
  onToggle,
  onDelete,
}: {
  job: CronJob
  onEdit: (job: CronJob) => void
  onToggle: (job: CronJob) => void
  onDelete: (job: CronJob) => void
}) {
  const label = getScheduleLabel(job)
  const meta = getScheduleMeta(job)

  return (
    <div
      className={cn(
        "dashboard-enter dashboard-card rounded-[1.8rem] border bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-5 shadow-[0_18px_34px_-28px_rgba(121,85,44,0.3)] transition",
        job.enabled
          ? "border-white/75 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-[0_24px_40px_-28px_rgba(121,85,44,0.38)]"
          : "border-dashed border-amber-200/70 opacity-80"
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white",
            job.scheduleType === "every"
              ? "bg-gradient-to-br from-orange-400 to-pink-500"
              : job.scheduleType === "at"
                ? "bg-gradient-to-br from-blue-400 to-cyan-500"
                : "bg-gradient-to-br from-violet-500 to-indigo-500"
          )}
        >
          {job.scheduleType === "every" ? (
            <Repeat className="h-5 w-5" />
          ) : job.scheduleType === "at" ? (
            <Bell className="h-5 w-5" />
          ) : (
            <Clock className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{job.name}</h3>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                job.enabled
                  ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-700"
                  : "border-white/80 bg-white/78 text-[#7d6755]"
              )}
            >
              {job.enabled ? "运行中" : "已暂停"}
            </span>
            {job.lastStatus === "error" && (
              <span
                className="rounded-full border border-rose-200/80 bg-rose-50/90 px-2.5 py-1 text-xs font-medium text-rose-700"
                title={job.lastError || "最近一次执行失败"}
              >
                异常
              </span>
            )}
          </div>

          <p className="text-sm leading-6 text-muted-foreground">{job.description || job.message}</p>

          {job.command && (
            <div className="mt-3 flex items-start gap-2 rounded-[1.2rem] border border-white/70 bg-white/72 px-3 py-2">
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="break-all text-xs text-foreground">{job.command}</code>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {label}
            </span>
            <span className="flex items-center gap-1">
              <Repeat className="h-3.5 w-3.5" />
              {meta}
            </span>
            <span className="flex items-center gap-1">
              <Bell className="h-3.5 w-3.5" />
              下次：{job.nextRunAtMs ? formatDateTime(job.nextRunAtMs) : "未安排"}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              上次：{job.lastRunAtMs ? formatDateTime(job.lastRunAtMs) : "从未执行"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggle(job)}
            className={cn(
              "h-9 w-9 rounded-xl",
              job.enabled
                ? "text-green-600 hover:bg-green-50"
                : "text-muted-foreground hover:bg-white/80"
            )}
          >
            {job.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(job)}
            className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-white/80"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(job)}
            className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SchedulePage() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: cronData, isLoading, error, mutate } = useCronJobs()
  const { create, update, toggle, remove } = useCronMutations()

  const schedules = sortJobs(cronData?.jobs ?? [])
  const runningCount = schedules.filter((job) => job.enabled).length
  const todayExecutions = schedules.filter((job) => isToday(job.lastRunAtMs)).length
  const nextExecution = schedules
    .filter((job) => job.enabled && typeof job.nextRunAtMs === "number")
    .sort((left, right) => (left.nextRunAtMs ?? Number.MAX_SAFE_INTEGER) - (right.nextRunAtMs ?? Number.MAX_SAFE_INTEGER))[0]

  async function refreshJobs() {
    await mutate()
  }

  async function handleCreate(input: CronJobInput) {
    setActionError(null)
    try {
      await create.trigger({ ...input, enabled: true })
      setShowCreateDialog(false)
      await refreshJobs()
    } catch (createError) {
      setActionError(getErrorMessage(createError))
      throw createError
    }
  }

  async function handleUpdate(input: CronJobInput) {
    if (!editingJob) {
      return
    }

    setActionError(null)
    try {
      await update.trigger({ id: editingJob.id, job: input })
      setEditingJob(null)
      await refreshJobs()
    } catch (updateError) {
      setActionError(getErrorMessage(updateError))
      throw updateError
    }
  }

  async function handleToggle(job: CronJob) {
    setActionError(null)
    try {
      await toggle.trigger({ id: job.id, enabled: !job.enabled })
      await refreshJobs()
    } catch (toggleError) {
      setActionError(getErrorMessage(toggleError))
    }
  }

  async function handleDelete(job: CronJob) {
    if (!window.confirm(`确定删除任务“${job.name}”吗？`)) {
      return
    }

    setActionError(null)
    try {
      await remove.trigger(job.id)
      await refreshJobs()
    } catch (removeError) {
      setActionError(getErrorMessage(removeError))
    }
  }

  const pageError = error ? getErrorMessage(error) : null
  const visibleError = actionError || pageError
  const dialogSubmitting = create.isMutating || update.isMutating

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,246,237,0.78),rgba(255,249,245,0.94),rgba(255,252,249,0.98))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(255,255,255,0.84),transparent_28%),radial-gradient(circle_at_84%_12%,rgba(191,219,254,0.18),transparent_24%),radial-gradient(circle_at_82%_78%,rgba(254,205,211,0.16),transparent_28%)]" />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto px-6 py-5">
        <div className="dashboard-enter dashboard-card rounded-[2rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,251,246,0.95),rgba(255,245,237,0.9),rgba(255,250,245,0.92))] px-6 py-6 shadow-[0_24px_58px_-36px_rgba(118,83,43,0.42)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/82 px-3 py-1.5 text-sm font-medium text-[#7f5a38]">
                <Clock className="h-4 w-4 text-amber-600" />
                时间舱
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[#3d2718]">
                让自动化像一条有呼吸的时间轨道
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-8 text-[#816451]">
                在这里管理提醒、循环自动化和单次任务。它不再是僵硬的后台列表，而是一块更柔和的时间舞台。
              </p>
            </div>

            <Button
              onClick={() => setShowCreateDialog(true)}
              className="rounded-full border-0 bg-[linear-gradient(135deg,#9a5929_0%,#c87734_48%,#e1a05b_100%)] px-5 text-amber-50 shadow-[0_18px_26px_-18px_rgba(154,89,41,0.75)] hover:brightness-105"
            >
              <Plus className="mr-2 h-4 w-4" />
              新建任务
            </Button>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="rounded-[1.4rem] border border-emerald-200/80 bg-gradient-to-r from-emerald-100 via-emerald-50 to-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-700">
                  <Play className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">运行中任务</p>
                <p className="text-lg font-semibold text-foreground">{runningCount}</p>
              </div>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-amber-200/80 bg-gradient-to-r from-amber-100 via-orange-50 to-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
                  <Calendar className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">今日执行</p>
                <p className="text-lg font-semibold text-foreground">{todayExecutions}</p>
              </div>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-sky-200/80 bg-gradient-to-r from-sky-100 via-cyan-50 to-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">最近一次即将执行</p>
                <p className="truncate text-sm font-semibold text-foreground">
                  {nextExecution ? `${formatDateTime(nextExecution.nextRunAtMs)} · ${nextExecution.name}` : "暂无待执行任务"}
                </p>
              </div>
              </div>
            </div>
          </div>
        </div>

        {visibleError && (
          <div className="mt-5 rounded-[1.2rem] border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-700">
            {visibleError}
          </div>
        )}

        <div className="mt-5 flex-1">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-8 w-8 text-orange-500" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="dashboard-enter rounded-[2rem] border border-dashed border-amber-200/80 bg-[linear-gradient(145deg,rgba(255,249,241,0.94),rgba(255,245,237,0.86))] px-6 py-12 text-center shadow-[0_20px_40px_-34px_rgba(118,80,42,0.22)]">
            <div className="dashboard-float-slow mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/88 text-orange-500 shadow-sm">
              <Bell className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">还没有定时任务</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              你可以在这里创建循环任务、间隔自动化，或者只执行一次的提醒。
            </p>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="mt-5 border-0 bg-gradient-to-r from-orange-400 to-pink-500 text-white hover:from-orange-500 hover:to-pink-600"
            >
              <Plus className="mr-2 h-4 w-4" />
              创建第一个任务
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {schedules.map((job) => (
              <ScheduleCard
                key={job.id}
                job={job}
                onEdit={setEditingJob}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
        </div>

        <ScheduleDialog
          open={showCreateDialog}
          mode="create"
          submitting={dialogSubmitting}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={handleCreate}
        />

        <ScheduleDialog
          open={Boolean(editingJob)}
          mode="edit"
          job={editingJob}
          submitting={dialogSubmitting}
          onClose={() => setEditingJob(null)}
          onSubmit={handleUpdate}
        />
      </div>
    </section>
  )
}
