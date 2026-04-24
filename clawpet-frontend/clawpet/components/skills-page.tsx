"use client"

import { useMemo, useState } from "react"
import {
  Search,
  Upload,
  Trash2,
  Plus,
  Package,
  Store,
  RefreshCw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useSkillMutations, useSkills } from "@/hooks/use-picoclaw"
import { skillsApi, type Skill, type SkillSearchResult } from "@/lib/api"
import { cn } from "@/lib/utils"

type SkillSourceFilter = "all" | "builtin" | "global" | "workspace"

const sourceFilterOptions: Array<{ id: SkillSourceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "builtin", label: "内置" },
  { id: "global", label: "全局" },
  { id: "workspace", label: "工作区" },
]

function sourceLabel(source: Skill["source"]) {
  switch (source) {
    case "builtin":
      return "内置"
    case "global":
      return "全局"
    case "workspace":
      return "工作区"
    default:
      return source
  }
}

function originLabel(originKind?: string) {
  switch (originKind) {
    case "manual":
      return "手动导入"
    case "third_party":
      return "市场安装"
    case "builtin":
      return "内置来源"
    default:
      return "未知来源"
  }
}

export function SkillsPage() {
  const [sourceFilter, setSourceFilter] = useState<SkillSourceFilter>("all")
  const [installedSearch, setInstalledSearch] = useState("")
  const [marketSearch, setMarketSearch] = useState("")
  const [marketResults, setMarketResults] = useState<SkillSearchResult[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [marketHasMore, setMarketHasMore] = useState(false)
  const [marketNextOffset, setMarketNextOffset] = useState(0)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)

  const { data: skillsData, isLoading, error, mutate } = useSkills()
  const { importSkill, installSkill, remove } = useSkillMutations()

  const installedSkills = skillsData?.skills ?? []

  const filteredInstalledSkills = useMemo(() => {
    return installedSkills.filter((skill) => {
      const sourceMatched =
        sourceFilter === "all" ? true : skill.source === sourceFilter
      const keyword = installedSearch.trim().toLowerCase()
      if (!keyword) {
        return sourceMatched
      }
      return (
        sourceMatched &&
        `${skill.name} ${skill.description} ${skill.registry_name ?? ""}`
          .toLowerCase()
          .includes(keyword)
      )
    })
  }, [installedSkills, sourceFilter, installedSearch])

  const handleDeleteSkill = async (name: string) => {
    try {
      await remove.trigger(name)
      await mutate()
    } catch (err) {
      console.error("Delete skill failed:", err)
    }
  }

  const handleImportSkill = async () => {
    if (!importFile) {
      return
    }
    try {
      await importSkill.trigger(importFile)
      setImportFile(null)
      setImportDialogOpen(false)
      await mutate()
    } catch (err) {
      console.error("Import skill failed:", err)
    }
  }

  const handleSearchMarket = async (append = false) => {
    const query = marketSearch.trim()
    if (!query) {
      setMarketResults([])
      setMarketError(null)
      setMarketHasMore(false)
      setMarketNextOffset(0)
      return
    }

    setMarketLoading(true)
    setMarketError(null)
    try {
      const response = await skillsApi.search(query, 20, append ? marketNextOffset : 0)
      setMarketResults((prev) => (append ? [...prev, ...response.results] : response.results))
      setMarketHasMore(response.has_more)
      setMarketNextOffset(response.next_offset ?? 0)
    } catch (err) {
      const message = err instanceof Error ? err.message : "技能市场搜索失败"
      setMarketError(message)
      if (!append) {
        setMarketResults([])
      }
      setMarketHasMore(false)
    } finally {
      setMarketLoading(false)
    }
  }

  const handleInstallFromMarket = async (result: SkillSearchResult) => {
    try {
      setInstallingSlug(result.slug)
      const installResponse = await installSkill.trigger({
        slug: result.slug,
        registry: result.registry_name,
        version: result.version,
      })
      const installedName =
        installResponse?.skill?.name ?? result.installed_name ?? result.slug
      await mutate()
      setMarketResults((prev) =>
        prev.map((item) =>
          item.slug === result.slug
            ? { ...item, installed: true, installed_name: installedName }
            : item
        )
      )
    } catch (err) {
      console.error("Install skill failed:", err)
    } finally {
      setInstallingSlug(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/70 bg-card">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 text-white flex items-center justify-center">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">技能市场</h1>
            <p className="text-sm text-muted-foreground">
              已安装技能来自后端 /api/skills，可导入、安装和删除工作区技能
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void mutate()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
          <Button
            onClick={() => setImportDialogOpen(true)}
            className="bg-amber-900 hover:bg-amber-800 text-amber-50 border-0"
          >
            <Upload className="w-4 h-4 mr-2" />
            导入技能
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
        <section className="min-h-0 rounded-2xl border border-border/70 bg-card/80 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border/70">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-4 h-4 text-orange-500" />
              <h2 className="font-medium">已安装技能（后端）</h2>
              <span className="text-xs text-muted-foreground">
                共 {installedSkills.length} 个
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={installedSearch}
                  onChange={(e) => setInstalledSearch(e.target.value)}
                  placeholder="搜索已安装技能..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-amber-400/30"
                />
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                {sourceFilterOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setSourceFilter(option.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      sourceFilter === option.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {isLoading ? (
              <div className="h-32 flex items-center justify-center">
                <Spinner className="w-7 h-7 text-amber-500" />
              </div>
            ) : error ? (
              <div className="text-sm text-red-500">
                技能列表加载失败：{String(error)}
              </div>
            ) : filteredInstalledSkills.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                当前没有匹配的技能
              </div>
            ) : (
              filteredInstalledSkills.map((skill) => (
                <div
                  key={`${skill.source}:${skill.name}`}
                  className="rounded-xl border border-border/70 bg-background p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-foreground">
                          {skill.name}
                        </h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {sourceLabel(skill.source)}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          {originLabel(skill.origin_kind)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {skill.description || "无描述"}
                      </p>
                      {skill.registry_name ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          registry: {skill.registry_name}
                        </p>
                      ) : null}
                    </div>

                    {skill.source === "workspace" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => void handleDeleteSkill(skill.name)}
                        disabled={remove.isMutating}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="min-h-0 rounded-2xl border border-border/70 bg-card/80 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border/70">
            <h2 className="font-medium mb-3">技能市场搜索</h2>
            <div className="flex items-center gap-2">
              <input
                value={marketSearch}
                onChange={(e) => setMarketSearch(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void handleSearchMarket()
                  }
                }}
                placeholder="例如：github, playwright, weather..."
                className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30"
              />
              <Button
                onClick={() => void handleSearchMarket()}
                disabled={marketLoading}
                className="bg-orange-500 hover:bg-orange-600 text-white border-0"
              >
                {marketLoading ? (
                  <Spinner className="w-4 h-4 mr-2" />
                ) : (
                  <Search className="w-4 h-4 mr-2" />
                )}
                搜索
              </Button>
            </div>
            {marketError ? (
              <p className="text-xs text-red-500 mt-2">{marketError}</p>
            ) : null}
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {marketLoading ? (
              <div className="h-32 flex items-center justify-center">
                <Spinner className="w-7 h-7 text-orange-500" />
              </div>
            ) : marketResults.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                输入关键词并搜索，可从 registry 安装技能
              </div>
            ) : (
              marketResults.map((result) => (
                <div
                  key={`${result.registry_name}:${result.slug}`}
                  className="rounded-xl border border-border/70 bg-background p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-foreground">
                          {result.display_name || result.slug}
                        </h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {result.registry_name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          v{result.version}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {result.summary || "无描述"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={result.installed ? "outline" : "default"}
                      className={
                        result.installed
                          ? ""
                          : "bg-amber-900 hover:bg-amber-800 text-amber-50 border-0"
                      }
                      disabled={
                        result.installed ||
                        installSkill.isMutating ||
                        installingSlug === result.slug
                      }
                      onClick={() => void handleInstallFromMarket(result)}
                    >
                      {installingSlug === result.slug ? (
                        <Spinner className="w-4 h-4 mr-1" />
                      ) : (
                        <Plus className="w-4 h-4 mr-1" />
                      )}
                      {result.installed
                        ? "已安装"
                        : installingSlug === result.slug
                          ? "安装中"
                          : "安装"}
                    </Button>
                  </div>
                </div>
              ))
            )}

            {marketResults.length > 0 ? (
              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void handleSearchMarket(true)}
                  disabled={marketLoading || !marketHasMore}
                >
                  {marketLoading ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  {marketHasMore ? "加载更多可下载技能" : "没有更多可下载技能"}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {importDialogOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center">
          <div className="w-full max-w-lg mx-4 rounded-2xl border border-border bg-background p-5">
            <h3 className="font-semibold text-foreground mb-2">导入技能文件</h3>
            <p className="text-sm text-muted-foreground mb-4">
              支持 .md 或 .zip，后端接口：/api/skills/import
            </p>

            <input
              type="file"
              accept=".md,.zip,text/markdown,application/zip"
              onChange={(event) =>
                setImportFile(event.target.files?.[0] ?? null)
              }
              className="block w-full text-sm"
            />

            {importFile ? (
              <p className="text-xs text-muted-foreground mt-3">
                已选择：{importFile.name}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setImportDialogOpen(false)
                  setImportFile(null)
                }}
              >
                取消
              </Button>
              <Button
                onClick={() => void handleImportSkill()}
                disabled={!importFile || importSkill.isMutating}
                className="bg-amber-900 hover:bg-amber-800 text-amber-50 border-0"
              >
                {importSkill.isMutating ? (
                  <Spinner className="w-4 h-4 mr-2" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                导入
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
