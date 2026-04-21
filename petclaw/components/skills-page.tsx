"use client"

import { useMemo, useState } from "react"
import {
  Code,
  Coffee,
  Palette,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useSkills, useSkillMutations } from "@/hooks/use-picoclaw"
import { cn } from "@/lib/utils"

const skillCategories = [
  { id: "all", label: "全部", icon: Sparkles },
  { id: "builtin", label: "内置", icon: Code },
  { id: "global", label: "全局", icon: Palette },
  { id: "workspace", label: "工作区", icon: Coffee },
]

const defaultSkills = [
  {
    id: "skill-1",
    name: "代码搭子",
    description: "陪你写代码、解释逻辑、重构和排查问题，语气更像稳定的协作伙伴。",
    source: "builtin" as const,
    category: "code",
    enabled: true,
  },
  {
    id: "skill-2",
    name: "提示词锻造师",
    description: "把粗糙想法整理成更清晰的提示词、模板和可复用结构。",
    source: "builtin" as const,
    category: "creative",
    enabled: true,
  },
  {
    id: "skill-3",
    name: "学习督导员",
    description: "把复习目标拆成日程、提醒和更容易坚持的小检查点。",
    source: "global" as const,
    category: "life",
    enabled: true,
  },
  {
    id: "skill-4",
    name: "工作区书记官",
    description: "总结仓库上下文、近期改动和工作记录，方便快速接续上下文。",
    source: "workspace" as const,
    category: "code",
    enabled: true,
  },
]

const sourceTheme: Record<string, { shell: string; badge: string; icon: string }> = {
  builtin: {
    shell:
      "from-amber-100 via-orange-50 to-white border-amber-200/80 text-[#7b4d28]",
    badge: "bg-amber-100 text-amber-700 border-amber-200/80",
    icon: "from-amber-400 to-orange-500",
  },
  global: {
    shell:
      "from-violet-100 via-purple-50 to-white border-violet-200/80 text-[#5b4687]",
    badge: "bg-violet-100 text-violet-700 border-violet-200/80",
    icon: "from-violet-400 to-purple-500",
  },
  workspace: {
    shell:
      "from-sky-100 via-cyan-50 to-white border-sky-200/80 text-[#365f87]",
    badge: "bg-sky-100 text-sky-700 border-sky-200/80",
    icon: "from-sky-400 to-cyan-500",
  },
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return "操作失败，请稍后再试。"
}

export function SkillsPage() {
  const [activeCategory, setActiveCategory] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importMarkdown, setImportMarkdown] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: skillsData, isLoading, error, mutate } = useSkills()
  const { importSkill, remove } = useSkillMutations()

  const skills = skillsData?.skills ?? defaultSkills

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const matchesCategory =
        activeCategory === "all" || skill.source === activeCategory
      const query = searchQuery.trim().toLowerCase()
      const matchesSearch =
        !query ||
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    })
  }, [activeCategory, searchQuery, skills])

  const stats = useMemo(() => {
    const builtinCount = skills.filter((skill) => skill.source === "builtin").length
    const globalCount = skills.filter((skill) => skill.source === "global").length
    const workspaceCount = skills.filter((skill) => skill.source === "workspace").length
    return [
      {
        label: "技能总数",
        value: skills.length,
        shell: "from-amber-100 via-orange-50 to-white border-amber-200/80",
      },
      {
        label: "内置能力",
        value: builtinCount,
        shell: "from-violet-100 via-purple-50 to-white border-violet-200/80",
      },
      {
        label: "外部扩展",
        value: workspaceCount + globalCount,
        shell: "from-sky-100 via-cyan-50 to-white border-sky-200/80",
      },
    ]
  }, [skills])

  async function handleImport() {
    if (!importMarkdown.trim()) {
      return
    }

    setActionError(null)
    try {
      await importSkill.trigger(importMarkdown)
      setImportMarkdown("")
      setShowImportDialog(false)
      await mutate()
    } catch (importError) {
      setActionError(getErrorMessage(importError))
    }
  }

  async function handleDelete(id: string) {
    setActionError(null)
    try {
      await remove.trigger(id)
      await mutate()
    } catch (removeError) {
      setActionError(getErrorMessage(removeError))
    }
  }

  const visibleError = actionError || (error ? getErrorMessage(error) : null)

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,246,237,0.78),rgba(255,249,245,0.94),rgba(255,252,249,0.98))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(255,255,255,0.82),transparent_28%),radial-gradient(circle_at_84%_10%,rgba(255,221,189,0.28),transparent_24%),radial-gradient(circle_at_82%_78%,rgba(196,181,253,0.18),transparent_28%)]" />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto px-6 py-5">
        <div className="dashboard-enter dashboard-card rounded-[2rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,251,246,0.95),rgba(255,245,237,0.9),rgba(255,250,245,0.92))] px-6 py-6 shadow-[0_24px_58px_-36px_rgba(118,83,43,0.42)]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 max-[1280px]:grid-cols-1">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/82 px-3 py-1.5 text-sm font-medium text-[#7f5a38]">
                <Sparkles className="h-4 w-4 text-amber-600" />
                能力牌组
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[#3d2718]">
                技能像一套活的法术卡
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-8 text-[#816451]">
                这里不再是干巴巴的技能列表，而是桌宠的法术书。你可以浏览内置天赋、共享能力和工作区专属卡片。
              </p>
            </div>

            <Button
              onClick={() => setShowImportDialog(true)}
              className="h-8 max-w-full justify-self-end whitespace-nowrap rounded-full border-0 bg-[linear-gradient(135deg,#9a5929_0%,#c87734_48%,#e1a05b_100%)] px-3 text-xs text-amber-50 shadow-[0_18px_26px_-18px_rgba(154,89,41,0.75)] hover:brightness-105 max-[1280px]:justify-self-start"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              导入技能
            </Button>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {stats.map((item) => (
              <div
                key={item.label}
                className={cn(
                  "dashboard-card rounded-[1.4rem] border bg-gradient-to-r px-4 py-4 shadow-sm",
                  item.shell,
                )}
              >
                <p className="text-xs uppercase tracking-[0.18em] text-[#9b7555]">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-[#3f2b1d]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-enter mt-5 rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-4 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b19278]" />
              <input
                type="text"
                placeholder="搜索技能、能力标签或适用场景..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-full border border-white/80 bg-white/84 py-3 pl-11 pr-4 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {skillCategories.map((category) => {
                const Icon = category.icon
                const isActive = activeCategory === category.id
                return (
                  <button
                    key={category.id}
                    onClick={() => setActiveCategory(category.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                      isActive
                        ? "border-amber-200/90 bg-[linear-gradient(135deg,rgba(255,245,227,0.98),rgba(255,253,246,0.92))] text-[#734826] shadow-sm"
                        : "border-white/80 bg-white/82 text-[#86674f] hover:border-amber-100 hover:bg-white",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {category.label}
                  </button>
                )
              })}
            </div>
          </div>

          {visibleError && (
            <div className="mt-4 rounded-[1.2rem] border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-700">
              {visibleError}
            </div>
          )}
        </div>

        <div className="mt-5 flex-1">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="h-8 w-8 text-orange-500" />
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="dashboard-enter rounded-[2rem] border border-dashed border-amber-200/80 bg-[linear-gradient(145deg,rgba(255,249,241,0.94),rgba(255,245,237,0.86))] px-6 py-14 text-center shadow-[0_20px_40px_-34px_rgba(118,80,42,0.22)]">
              <div className="dashboard-float-slow mx-auto flex h-16 w-16 items-center justify-center rounded-[1.6rem] bg-white/88 text-amber-600 shadow-sm">
                <WandSparkles className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#4f3725]">
                暂时没有匹配的技能
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#8a6b50]">
                你可以换个关键词、切换牌组筛选，或者导入一张新的技能卡来扩充桌宠能力。
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredSkills.map((skill) => {
                const theme = sourceTheme[skill.source] ?? sourceTheme.builtin
                return (
                  <article
                    key={skill.id}
                    className={cn(
                      "dashboard-enter dashboard-card group rounded-[1.8rem] border bg-gradient-to-br p-5 shadow-[0_18px_34px_-28px_rgba(121,85,44,0.34)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_40px_-28px_rgba(121,85,44,0.42)]",
                      theme.shell,
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={cn(
                          "dashboard-pulse-glow flex h-12 w-12 items-center justify-center rounded-[1.2rem] bg-gradient-to-br text-white shadow-sm",
                          theme.icon,
                        )}
                      >
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-medium",
                          theme.badge,
                        )}
                      >
                        {skill.source === "builtin"
                          ? "内置"
                          : skill.source === "global"
                            ? "全局"
                            : "工作区"}
                      </span>
                    </div>

                    <h3 className="mt-4 text-xl font-semibold text-[#3f2b1d]">
                      {skill.name}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[#7f5f48]">
                      {skill.description}
                    </p>

                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-xs text-[#7d6755]">
                        {skill.enabled ? "已启用" : "未启用"}
                      </span>
                      <div className="flex items-center gap-2">
                        {skill.source === "workspace" && (
                          <button
                            onClick={() => handleDelete(skill.id)}
                            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-white/78 text-rose-600 transition hover:border-rose-200 hover:bg-white"
                            title="删除技能"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        <Button
                          variant="outline"
                          className="rounded-full border-white/75 bg-white/82 text-[#6d5846] hover:bg-white"
                        >
                          使用技能
                        </Button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="dashboard-enter dashboard-card w-full max-w-2xl rounded-[2rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.98),rgba(255,246,241,0.94))] p-6 shadow-[0_28px_70px_-38px_rgba(87,56,26,0.66)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[#b07b4d]">
                  导入技能
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#4f3725]">
                  往牌组里塞一张新的能力卡
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#8a6b50]">
                  粘贴 Markdown 内容，桌宠会把它变成一张新的工作区技能卡。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportDialog(false)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-white/82 text-[#6d5846] transition hover:bg-white"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={importMarkdown}
              onChange={(event) => setImportMarkdown(event.target.value)}
              placeholder="在这里粘贴技能 Markdown..."
              className="mt-5 h-56 w-full resize-none rounded-[1.4rem] border border-white/80 bg-white/88 px-4 py-4 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
            />

            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowImportDialog(false)}
                className="rounded-full border-white/75 bg-white/82 text-[#6d5846] hover:bg-white"
              >
                取消
              </Button>
              <Button
                onClick={handleImport}
                disabled={importSkill.isMutating || !importMarkdown.trim()}
                className="rounded-full border-0 bg-[linear-gradient(135deg,#9a5929_0%,#c87734_48%,#e1a05b_100%)] text-amber-50 shadow-[0_18px_26px_-18px_rgba(154,89,41,0.75)] hover:brightness-105"
              >
                {importSkill.isMutating ? (
                  <Spinner className="mr-2 h-4 w-4" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                导入
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
