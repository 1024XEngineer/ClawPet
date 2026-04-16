"use client"

import { useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { ChatArea } from "@/components/chat-area"
import { SkillsPage } from "@/components/skills-page"
import { SchedulePage } from "@/components/schedule-page"
import { ChannelPage } from "@/components/channel-page"
import { PricingPage } from "@/components/pricing-page"
import { ToolsPage } from "@/components/tools-page"
import { ConfigPage } from "@/components/config-page"
import { LogsPage } from "@/components/logs-page"

export default function Home() {
  const [activeNav, setActiveNav] = useState("聊天")

  const renderContent = () => {
    switch (activeNav) {
      case "聊天":
        return <ChatArea />
      case "技能":
        return <SkillsPage />
      case "定时任务":
        return <SchedulePage />
      case "频道":
        return <ChannelPage />
      case "工具":
        return <ToolsPage />
      case "配置":
        return <ConfigPage />
      case "日志":
        return <LogsPage />
      case "价格":
        return <PricingPage />
      default:
        return <ChatArea />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeNav={activeNav} setActiveNav={setActiveNav} />
      {renderContent()}
    </div>
  )
}
