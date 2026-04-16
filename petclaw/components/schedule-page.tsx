"use client"

import { useState } from "react"
import { Plus, Clock, Play, Pause, Trash2, Edit2, Bell, Calendar, Repeat, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCronJobs, useCronMutations } from "@/hooks/use-picoclaw"
import { Spinner } from "@/components/ui/spinner"

// 默认定时任务数据
const defaultSchedules = [
  {
    id: "1",
    name: "早安问候",
    description: "每天早上 8:00 发送元气满满的早安问候~",
    schedule: "0 8 * * *",
    skill: "暖心小助手",
    enabled: true,
    lastRun: "今天 08:00",
    nextRun: "明天 08:00",
  },
  {
    id: "2",
    name: "喂猫提醒",
    description: "提醒你按时给主子投食，不要饿着猫咪~",
    schedule: "0 7,18 * * *",
    skill: "萌宠翻译官",
    enabled: true,
    lastRun: "今天 18:00",
    nextRun: "明天 07:30",
  },
  {
    id: "3",
    name: "番剧更新提醒",
    description: "追番不迷路，新番更新第一时间通知你！",
    schedule: "0 22 * * 1,3,5",
    skill: "二次元画师",
    enabled: false,
    lastRun: "3天前",
    nextRun: "周五 22:00",
  },
  {
    id: "4",
    name: "学习打卡",
    description: "坚持学习每一天，记录你的成长轨迹~",
    schedule: "0 21 * * 1-5",
    skill: "学习小伙伴",
    enabled: true,
    lastRun: "昨天 21:00",
    nextRun: "今天 21:00",
  },
  {
    id: "5",
    name: "代码日报",
    description: "自动总结今天的代码提交和工作进度",
    schedule: "30 18 * * 1-5",
    skill: "代码小助手",
    enabled: true,
    lastRun: "今天 18:30",
    nextRun: "明天 18:30",
  },
]

const scheduleIcons: Record<string, string> = {
  "早安问候": "sunrise",
  "喂猫提醒": "cat-face",
  "番剧更新提醒": "television",
  "学习打卡": "open-book",
  "代码日报": "laptop",
}

interface CreateScheduleDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (data: { name: string; description: string; schedule: string; skill?: string }) => void
  isCreating: boolean
}

function CreateScheduleDialog({ open, onClose, onCreate, isCreating }: CreateScheduleDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [schedule, setSchedule] = useState("")
  const [skill, setSkill] = useState("")

  const handleSubmit = () => {
    if (!name.trim() || !schedule.trim()) return
    onCreate({ name, description, schedule, skill: skill || undefined })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-2xl p-6 w-full max-w-lg mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">新建定时任务</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">任务名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：早安问候"
              className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1.5">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单描述这个任务的作用..."
              className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30 resize-none h-20"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1.5">Cron 表达式</label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="例如：0 8 * * * (每天早上8点)"
              className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30"
            />
            <p className="text-xs text-muted-foreground mt-1">
              格式：分 时 日 月 周（* 表示任意值）
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1.5">关联技能（可选）</label>
            <input
              type="text"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              placeholder="选择要执行的技能..."
              className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30"
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={isCreating || !name.trim() || !schedule.trim()}
            className="bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0"
          >
            {isCreating ? <Spinner className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            创建
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SchedulePage() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  
  const { data: cronData, isLoading, error, mutate } = useCronJobs()
  const { create, toggle, remove } = useCronMutations()

  // 使用 API 数据或默认数据
  const schedules = cronData?.jobs || defaultSchedules

  // 统计数据
  const runningCount = schedules.filter(s => s.enabled).length
  const todayExecutions = 12 // 模拟数据
  const nextExecution = schedules.find(s => s.enabled)

  const handleCreate = async (data: { name: string; description: string; schedule: string; skill?: string }) => {
    try {
      await create.trigger({
        ...data,
        enabled: true,
      })
      setShowCreateDialog(false)
      mutate()
    } catch (err) {
      console.error("Create failed:", err)
    }
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggle.trigger({ id, enabled: !enabled })
      mutate()
    } catch (err) {
      console.error("Toggle failed:", err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await remove.trigger(id)
      mutate()
    } catch (err) {
      console.error("Delete failed:", err)
    }
  }

  // 解析 cron 表达式为可读格式
  const parseCronTime = (cron: string): string => {
    const parts = cron.split(" ")
    if (parts.length < 5) return cron
    const [minute, hour] = parts
    if (hour.includes(",")) {
      return hour.split(",").map(h => `${h.padStart(2, "0")}:${minute.padStart(2, "0")}`).join(" / ")
    }
    return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
  }

  const parseCronRepeat = (cron: string): string => {
    const parts = cron.split(" ")
    if (parts.length < 5) return "自定义"
    const [, , day, month, weekday] = parts
    
    if (day === "*" && month === "*" && weekday === "*") return "每天"
    if (weekday === "1-5") return "工作日"
    if (weekday === "0,6") return "周末"
    if (weekday.includes(",")) {
      const days = ["日", "一", "二", "三", "四", "五", "六"]
      return "周" + weekday.split(",").map(d => days[parseInt(d)]).join("、周")
    }
    return "自定义"
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center text-white text-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">定时任务</h1>
            <p className="text-sm text-muted-foreground">让 AI 自动帮你完成日常任务，解放双手~</p>
          </div>
        </div>
        <Button 
          onClick={() => setShowCreateDialog(true)}
          className="bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0"
        >
          <Plus className="w-4 h-4 mr-2" />
          新建任务
        </Button>
      </header>

      {/* Stats */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <Play className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">运行中</p>
              <p className="font-semibold text-foreground">{runningCount} 个任务</p>
            </div>
          </div>
          <div className="w-px h-10 bg-border" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
              <Clock className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">今日执行</p>
              <p className="font-semibold text-foreground">{todayExecutions} 次</p>
            </div>
          </div>
          <div className="w-px h-10 bg-border" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Bell className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">下次执行</p>
              <p className="font-semibold text-foreground">
                {nextExecution ? `${nextExecution.nextRun || "待定"} ${nextExecution.name}` : "无"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule List */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner className="w-8 h-8 text-orange-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map((schedule, index) => (
              <div
                key={schedule.id}
                className={cn(
                  "p-4 rounded-2xl border bg-background transition-all",
                  schedule.enabled 
                    ? "border-border hover:border-orange-200 hover:shadow-md" 
                    : "border-dashed border-border/50 opacity-60"
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-100 to-pink-100 flex items-center justify-center text-2xl shrink-0">
                    {index === 0 ? "🌅" : index === 1 ? "🐱" : index === 2 ? "📺" : index === 3 ? "📖" : "💻"}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{schedule.name}</h3>
                      {schedule.enabled && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">运行中</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{schedule.description}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {parseCronTime(schedule.schedule)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Repeat className="w-3 h-3" />
                        {parseCronRepeat(schedule.schedule)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        上次: {schedule.lastRun || "从未"}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggle(schedule.id, schedule.enabled)}
                      className={cn(
                        "w-8 h-8 rounded-lg",
                        schedule.enabled 
                          ? "text-green-600 hover:bg-green-50" 
                          : "text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {schedule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground hover:bg-accent">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => handleDelete(schedule.id)}
                      className="w-8 h-8 rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State Hint */}
        <div className="mt-6 p-6 rounded-2xl border border-dashed border-border bg-muted/30 text-center">
          <div className="text-4xl mb-3">🐾</div>
          <p className="text-muted-foreground text-sm">
            小提示：设置定时任务可以让 AI 自动帮你完成重复性工作哦~
          </p>
        </div>
      </div>

      {/* Create Dialog */}
      <CreateScheduleDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
        isCreating={create.isMutating}
      />
    </div>
  )
}
