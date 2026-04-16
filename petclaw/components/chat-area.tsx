"use client"

import { useState, useRef, useEffect } from "react"
import { Plus, Mic, Send, ChevronDown, Lightbulb, PenTool, Search, FileText, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useChat } from "@/hooks/use-chat"
import { Spinner } from "@/components/ui/spinner"

const suggestions = [
  {
    icon: Lightbulb,
    iconColor: "text-yellow-500",
    title: "React Hooks",
    description: "Explain UseEffect dependency arrays simply.",
  },
  {
    icon: PenTool,
    iconColor: "text-orange-500",
    title: "PR Intro",
    description: "Draft a concise pull request description.",
  },
  {
    icon: Search,
    iconColor: "text-blue-500",
    title: "Flexbox Ref",
    description: "Find the CSS property for centering items.",
  },
  {
    icon: FileText,
    iconColor: "text-orange-400",
    title: "Blog Outline",
    description: "Outline a tech post about AI tools.",
  },
]

export function ChatArea() {
  const [activeTab, setActiveTab] = useState("聊天")
  const [message, setMessage] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { 
    messages, 
    isConnected, 
    isTyping, 
    error, 
    sendMessage, 
    reconnect 
  } = useChat()

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = () => {
    if (message.trim()) {
      sendMessage(message)
      setMessage("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSuggestionClick = (title: string, description: string) => {
    sendMessage(`${title}: ${description}`)
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full",
            isConnected ? "bg-green-500" : "bg-red-500"
          )}></span>
          <span className="text-sm text-muted-foreground">
            {isConnected ? "已连接" : "未连接"}
          </span>
          {!isConnected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reconnect}
              className="h-6 px-2 text-xs"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              重连
            </Button>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-muted rounded-full p-1">
          <button
            onClick={() => setActiveTab("聊天")}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
              activeTab === "聊天"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            聊天
          </button>
          <button
            onClick={() => setActiveTab("工作")}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
              activeTab === "工作"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            工作
          </button>
        </div>

        {/* Upgrade */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Free</span>
          <Button
            variant="outline"
            size="sm"
            className="text-orange-500 border-orange-500 hover:bg-orange-50 hover:text-orange-600"
          >
            升级
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {hasMessages ? (
          // Chat Messages
          <div className="flex-1 overflow-auto px-6 py-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-3",
                      msg.role === "user"
                        ? "bg-foreground text-background"
                        : "bg-muted text-foreground"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.streaming && (
                      <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
                    )}
                  </div>
                </div>
              ))}
              {isTyping && !messages.some(m => m.streaming) && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          // Welcome Screen
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            {/* Robot Icon */}
            <div className="mb-6 relative">
              <div className="w-16 h-16 bg-background rounded-2xl border border-border flex items-center justify-center shadow-sm">
                <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none">
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                  <circle cx="28" cy="12" r="4" fill="currentColor" />
                  <circle cx="12" cy="28" r="4" fill="currentColor" />
                  <circle cx="28" cy="28" r="4" fill="currentColor" />
                  <circle cx="20" cy="20" r="5" fill="currentColor" />
                </svg>
              </div>
              {/* Sparkles */}
              <div className="absolute -top-1 -right-1">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-foreground" fill="currentColor">
                  <path d="M12 0L13.5 8.5L22 10L13.5 11.5L12 20L10.5 11.5L2 10L10.5 8.5L12 0Z" />
                </svg>
              </div>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-medium text-foreground mb-8">
              今天有什么可以帮你?
            </h1>

            {/* Error Message */}
            {error && (
              <div className="mb-4 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Suggestion Cards */}
            <div className="grid grid-cols-2 gap-4 max-w-2xl w-full">
              {suggestions.map((item, index) => {
                const Icon = item.icon
                return (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(item.title, item.description)}
                    className="flex items-start gap-3 p-4 rounded-xl border border-border bg-background hover:bg-accent transition-colors text-left"
                  >
                    <Icon className={cn("w-5 h-5 mt-0.5", item.iconColor)} />
                    <div>
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {item.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="px-6 pb-6">
        <div className="max-w-3xl mx-auto">
          <div className="border border-border rounded-2xl bg-background shadow-sm">
            {/* Text Input */}
            <div className="px-4 py-3">
              <input
                type="text"
                placeholder="输入消息..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="w-4 h-4" />
                </button>
                <button className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground text-sm">
                  <span>快速</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Mic className="w-4 h-4" />
                </button>
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!message.trim() || !isConnected}
                  className="rounded-full bg-foreground text-background hover:bg-foreground/90 w-9 h-9 disabled:opacity-50"
                >
                  {isTyping ? (
                    <Spinner className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
