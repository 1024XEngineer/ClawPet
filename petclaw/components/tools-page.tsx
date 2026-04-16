"use client"

import { useState } from "react"
import { Search, Wrench, ToggleLeft, ToggleRight, ExternalLink, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTools, useToggleTool } from "@/hooks/use-picoclaw"
import { Spinner } from "@/components/ui/spinner"

// 默认工具数据
const defaultTools = [
  {
    id: "web_search",
    name: "网页搜索",
    description: "在互联网上搜索信息，获取最新资讯",
    enabled: true,
    source: "builtin",
  },
  {
    id: "code_interpreter",
    name: "代码执行",
    description: "运行 Python 代码，进行数据分析和计算",
    enabled: true,
    source: "builtin",
  },
  {
    id: "file_browser",
    name: "文件浏览",
    description: "浏览和读取本地文件内容",
    enabled: false,
    source: "builtin",
  },
  {
    id: "image_gen",
    name: "图像生成",
    description: "根据描述生成图像，支持多种风格",
    enabled: true,
    source: "mcp",
  },
  {
    id: "weather",
    name: "天气查询",
    description: "查询指定城市的天气信息",
    enabled: true,
    source: "mcp",
  },
  {
    id: "calculator",
    name: "计算器",
    description: "执行数学计算和单位换算",
    enabled: true,
    source: "builtin",
  },
  {
    id: "translator",
    name: "翻译助手",
    description: "多语言翻译，支持中英日韩等",
    enabled: false,
    source: "mcp",
  },
  {
    id: "shell_exec",
    name: "Shell 执行",
    description: "执行系统命令（需要授权）",
    enabled: false,
    source: "builtin",
  },
]

const toolIcons: Record<string, string> = {
  web_search: "search",
  code_interpreter: "code",
  file_browser: "file",
  image_gen: "image",
  weather: "cloud",
  calculator: "calc",
  translator: "language",
  shell_exec: "terminal",
}

export function ToolsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all")

  const { data: toolsData, isLoading, error, mutate } = useTools()
  const toggleTool = useToggleTool()

  // 使用 API 数据或默认数据
  const tools = toolsData?.tools || defaultTools

  // 过滤工具
  const filteredTools = tools.filter((tool) => {
    const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filter === "all" || 
      (filter === "enabled" && tool.enabled) || 
      (filter === "disabled" && !tool.enabled)
    return matchesSearch && matchesFilter
  })

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleTool.trigger({ id, enabled: !enabled })
      mutate()
    } catch (err) {
      console.error("Toggle failed:", err)
    }
  }

  const enabledCount = tools.filter(t => t.enabled).length

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">工具管理</h1>
            <p className="text-sm text-muted-foreground">管理 AI 可使用的工具，增强交互能力</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full">
            {enabledCount} 个已启用
          </span>
          <span className="px-2 py-1 bg-muted rounded-full">
            {tools.length - enabledCount} 个已禁用
          </span>
        </div>
      </header>

      {/* Search & Filter */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索工具..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-emerald-400/30 transition-shadow"
            />
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl p-1">
            {[
              { id: "all" as const, label: "全部" },
              { id: "enabled" as const, label: "已启用" },
              { id: "disabled" as const, label: "已禁用" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  filter === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tools List */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner className="w-8 h-8 text-emerald-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTools.map((tool, index) => (
              <div
                key={tool.id}
                className={cn(
                  "p-4 rounded-2xl border bg-background transition-all",
                  tool.enabled
                    ? "border-border hover:border-emerald-200 hover:shadow-md"
                    : "border-dashed border-border/50 opacity-70"
                )}
              >
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0",
                    tool.enabled
                      ? "bg-gradient-to-br from-emerald-100 to-teal-100"
                      : "bg-muted"
                  )}>
                    {index === 0 ? "🔍" :
                     index === 1 ? "💻" :
                     index === 2 ? "📁" :
                     index === 3 ? "🎨" :
                     index === 4 ? "🌤️" :
                     index === 5 ? "🧮" :
                     index === 6 ? "🌐" : "🖥️"}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{tool.name}</h3>
                      <span className={cn(
                        "px-1.5 py-0.5 text-xs rounded-full",
                        tool.source === "builtin"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-purple-100 text-purple-700"
                      )}>
                        {tool.source === "builtin" ? "内置" : "MCP"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{tool.description}</p>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(tool.id, tool.enabled)}
                    disabled={toggleTool.isMutating}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      tool.enabled
                        ? "text-emerald-600 hover:bg-emerald-50"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {tool.enabled ? (
                      <ToggleRight className="w-8 h-8" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 p-4 rounded-2xl border border-border bg-blue-50/50">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-foreground mb-1">关于工具</h4>
              <p className="text-sm text-muted-foreground">
                工具可以扩展 AI 的能力，让它能够执行更多操作。内置工具由 PicoClaw 提供，
                MCP 工具来自 Model Context Protocol 服务器。启用工具后，AI 会在需要时自动调用。
              </p>
              <a
                href="https://github.com/sipeed/picoclaw"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
              >
                了解更多
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
