"use client"

import { useState, useRef, useEffect } from "react"
import { FileText, Trash2, Download, RefreshCw, Search, Filter, ChevronDown, AlertCircle, Info, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useLogs, useClearLogs } from "@/hooks/use-picoclaw"
import { Spinner } from "@/components/ui/spinner"

// 默认日志数据
const defaultLogs = [
  { time: "2024-01-15 10:30:15", level: "INFO", message: "Gateway started successfully on port 18800" },
  { time: "2024-01-15 10:30:16", level: "INFO", message: "Pico channel connected" },
  { time: "2024-01-15 10:30:18", level: "INFO", message: "Telegram channel initialized" },
  { time: "2024-01-15 10:30:20", level: "DEBUG", message: "Loading model configuration..." },
  { time: "2024-01-15 10:30:22", level: "INFO", message: "Default model set to: gpt-4-turbo" },
  { time: "2024-01-15 10:31:05", level: "INFO", message: "User connected via Pico channel" },
  { time: "2024-01-15 10:31:08", level: "DEBUG", message: "Processing message: 你好" },
  { time: "2024-01-15 10:31:10", level: "INFO", message: "LLM request sent to OpenAI" },
  { time: "2024-01-15 10:31:15", level: "INFO", message: "Response received, tokens: 150" },
  { time: "2024-01-15 10:32:00", level: "WARN", message: "Rate limit approaching for OpenAI API" },
  { time: "2024-01-15 10:35:22", level: "INFO", message: "Cron job executed: 早安问候" },
  { time: "2024-01-15 10:40:00", level: "ERROR", message: "Discord channel connection failed: timeout" },
  { time: "2024-01-15 10:40:05", level: "INFO", message: "Retrying Discord connection..." },
  { time: "2024-01-15 10:40:10", level: "INFO", message: "Discord channel reconnected successfully" },
  { time: "2024-01-15 10:45:30", level: "DEBUG", message: "Tool invoked: web_search" },
  { time: "2024-01-15 10:45:35", level: "INFO", message: "Web search completed, 5 results found" },
]

const levelColors: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  INFO: { bg: "bg-blue-100", text: "text-blue-700", icon: Info },
  DEBUG: { bg: "bg-gray-100", text: "text-gray-700", icon: CheckCircle },
  WARN: { bg: "bg-yellow-100", text: "text-yellow-700", icon: AlertCircle },
  ERROR: { bg: "bg-red-100", text: "text-red-700", icon: AlertCircle },
}

export function LogsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [levelFilter, setLevelFilter] = useState<string>("all")
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const { data: logsData, isLoading, mutate } = useLogs()
  const clearLogs = useClearLogs()

  // 解析日志
  const parsedLogs = (logsData?.logs || defaultLogs.map(l => 
    `${l.time} [${l.level}] ${l.message}`
  )).map((log) => {
    if (typeof log === "string") {
      const match = log.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.*)$/)
      if (match) {
        return { time: match[1], level: match[2], message: match[3] }
      }
      return { time: "", level: "INFO", message: log }
    }
    return log
  })

  // 过滤日志
  const filteredLogs = parsedLogs.filter((log) => {
    const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLevel = levelFilter === "all" || log.level === levelFilter
    return matchesSearch && matchesLevel
  })

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [filteredLogs, autoScroll])

  const handleClear = async () => {
    try {
      await clearLogs.trigger()
      mutate()
    } catch (err) {
      console.error("Clear failed:", err)
    }
  }

  const handleDownload = () => {
    const content = filteredLogs.map(l => `${l.time} [${l.level}] ${l.message}`).join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `picoclaw-logs-${new Date().toISOString().split("T")[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 统计各级别日志数量
  const logCounts = {
    INFO: parsedLogs.filter(l => l.level === "INFO").length,
    DEBUG: parsedLogs.filter(l => l.level === "DEBUG").length,
    WARN: parsedLogs.filter(l => l.level === "WARN").length,
    ERROR: parsedLogs.filter(l => l.level === "ERROR").length,
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">日志查看器</h1>
            <p className="text-sm text-muted-foreground">查看网关运行日志和调试信息</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => mutate()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
          <Button variant="outline" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            下载
          </Button>
          <Button 
            variant="outline" 
            onClick={handleClear}
            disabled={clearLogs.isMutating}
            className="text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            {clearLogs.isMutating ? <Spinner className="w-4 h-4 mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            清空
          </Button>
        </div>
      </header>

      {/* Stats */}
      <div className="px-6 py-3 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">总计:</span>
            <span className="font-medium">{parsedLogs.length}</span>
          </div>
          <div className="w-px h-4 bg-border" />
          {Object.entries(logCounts).map(([level, count]) => {
            const style = levelColors[level]
            return (
              <div key={level} className="flex items-center gap-1.5 text-sm">
                <span className={cn("w-2 h-2 rounded-full", style.bg.replace("100", "500"))} />
                <span className="text-muted-foreground">{level}:</span>
                <span className="font-medium">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="px-6 py-3 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索日志内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-slate-400/30 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:ring-2 focus:ring-slate-400/30"
            >
              <option value="all">全部级别</option>
              <option value="INFO">INFO</option>
              <option value="DEBUG">DEBUG</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-border"
            />
            自动滚动
          </label>
        </div>
      </div>

      {/* Log Content */}
      <div 
        ref={logContainerRef}
        className="flex-1 overflow-auto p-4 bg-muted/30 font-mono text-sm"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner className="w-8 h-8 text-slate-500" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <FileText className="w-10 h-10 mb-2 opacity-50" />
            <p>暂无日志</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log, index) => {
              const style = levelColors[log.level] || levelColors.INFO
              const Icon = style.icon
              return (
                <div
                  key={index}
                  className={cn(
                    "flex items-start gap-2 px-3 py-1.5 rounded-lg hover:bg-background/50 transition-colors",
                    log.level === "ERROR" && "bg-red-50/50",
                    log.level === "WARN" && "bg-yellow-50/50"
                  )}
                >
                  <span className="text-muted-foreground shrink-0 w-36">{log.time}</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-medium shrink-0 w-14 text-center",
                    style.bg,
                    style.text
                  )}>
                    {log.level}
                  </span>
                  <span className="text-foreground break-all">{log.message}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-2 border-t border-border text-xs text-muted-foreground">
        日志存储在内存环形缓冲区中，重启后会清空。日志文件路径：~/.picoclaw/logs/
      </div>
    </div>
  )
}
