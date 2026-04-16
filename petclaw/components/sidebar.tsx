"use client"

import { useState } from "react"
import { 
  Plus, MessageSquare, Layers, Clock, Radio, CreditCard, Tag, User, Settings, Moon, Sun, Home,
  Wrench, FileText, Cpu, Power, AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useGatewayStatus } from "@/hooks/use-picoclaw"

interface SidebarProps {
  activeNav: string
  setActiveNav: (nav: string) => void
}

const navItems = [
  { icon: MessageSquare, label: "聊天" },
  { icon: Layers, label: "技能" },
  { icon: Clock, label: "定时任务" },
  { icon: Radio, label: "频道" },
  { icon: Wrench, label: "工具" },
  { icon: Settings, label: "配置" },
  { icon: FileText, label: "日志" },
  { icon: CreditCard, label: "价格" },
]

// 静态 mock 数据，避免 API 调用
const mockGatewayStatus = { state: "running" } as any

export function Sidebar({ activeNav, setActiveNav }: SidebarProps) {
  const [isDarkMode, setIsDarkMode] = useState(false)
  // 直接使用静态数据，跳过 API 调用
  const gatewayStatus = mockGatewayStatus

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode)
    document.documentElement.classList.toggle("dark")
  }

  const getStatusColor = () => {
    if (!gatewayStatus) return "bg-gray-400"
    switch (gatewayStatus.state) {
      case "running": return "bg-green-500"
      case "starting":
      case "restarting": return "bg-yellow-500 animate-pulse"
      case "stopping": return "bg-orange-500"
      default: return "bg-red-500"
    }
  }

  const getStatusText = () => {
    if (!gatewayStatus) return "检查中..."
    switch (gatewayStatus.state) {
      case "running": return "运行中"
      case "starting": return "启动中"
      case "restarting": return "重启中"
      case "stopping": return "停止中"
      default: return "已停止"
    }
  }

  return (
    <aside className="w-56 border-r border-border bg-background flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-4 h-4 text-white"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="7" cy="7" r="2" fill="white" />
            <circle cx="17" cy="7" r="2" fill="white" />
            <circle cx="7" cy="17" r="2" fill="white" />
            <circle cx="17" cy="17" r="2" fill="white" />
            <circle cx="12" cy="12" r="3" fill="white" />
          </svg>
        </div>
        <span className="font-semibold text-foreground">PetClaw AI</span>
        <span className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground">
          测试版
        </span>
      </div>

      {/* Gateway Status */}
      <div className="px-3 mb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Cpu className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">网关状态</p>
            <div className="flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", getStatusColor())} />
              <span className="text-sm text-foreground truncate">{getStatusText()}</span>
            </div>
          </div>
          {gatewayStatus?.restartRequired && (
            <AlertCircle className="w-4 h-4 text-orange-500" title="需要重启" />
          )}
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-3 mb-2">
        <Button
          variant="outline"
          className="w-full justify-center gap-2 h-10 bg-background hover:bg-accent"
          onClick={() => setActiveNav("聊天")}
        >
          <Plus className="w-4 h-4" />
          <span>新建聊天</span>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 overflow-auto">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeNav === item.label
            return (
              <li key={item.label}>
                <button
                  onClick={() => setActiveNav(item.label)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>

        {/* Chat History Section */}
        <div className="mt-6">
          <p className="text-xs text-muted-foreground px-3 mb-2">对话记录</p>
          <button 
            onClick={() => setActiveNav("聊天")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Home className="w-4 h-4" />
            <div className="flex flex-col items-start">
              <span className="text-foreground">你好</span>
              <span className="text-xs text-muted-foreground">1天前</span>
            </div>
          </button>
        </div>
      </nav>

      {/* Bottom Actions */}
      <div className="p-3 border-t border-border">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground mb-2">
          <Tag className="w-4 h-4" />
          <span>邀请码</span>
        </button>
        <div className="flex items-center justify-between px-2">
          <button className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            <User className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setActiveNav("配置")}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
