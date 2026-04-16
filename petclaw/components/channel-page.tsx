"use client"

import { useState } from "react"
import { Plus, Users, Lock, Globe, MessageCircle, Crown, Star, Settings, Power, PowerOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useChannels, useChannelCatalog, useChannelMutations } from "@/hooks/use-picoclaw"
import { Spinner } from "@/components/ui/spinner"

// PicoClaw 支持的渠道类型
const channelTypes = {
  telegram: { name: "Telegram", icon: "tg", color: "from-blue-400 to-blue-600" },
  discord: { name: "Discord", icon: "dc", color: "from-indigo-400 to-purple-600" },
  weixin: { name: "微信", icon: "wx", color: "from-green-400 to-green-600" },
  slack: { name: "Slack", icon: "sl", color: "from-purple-400 to-pink-600" },
  feishu: { name: "飞书", icon: "fs", color: "from-blue-400 to-cyan-500" },
  dingtalk: { name: "钉钉", icon: "dd", color: "from-blue-500 to-blue-700" },
  line: { name: "LINE", icon: "ln", color: "from-green-400 to-green-600" },
  qq: { name: "QQ", icon: "qq", color: "from-blue-400 to-cyan-500" },
  onebot: { name: "OneBot", icon: "ob", color: "from-gray-400 to-gray-600" },
  wecom: { name: "企业微信", icon: "wc", color: "from-blue-400 to-blue-600" },
  whatsapp: { name: "WhatsApp", icon: "wa", color: "from-green-400 to-green-600" },
  matrix: { name: "Matrix", icon: "mx", color: "from-gray-500 to-gray-700" },
  irc: { name: "IRC", icon: "ir", color: "from-gray-400 to-gray-600" },
  pico: { name: "Pico", icon: "pc", color: "from-orange-400 to-pink-500" },
  maixcam: { name: "MaixCAM", icon: "mc", color: "from-orange-400 to-red-500" },
}

// 默认频道数据（社区模式）
const defaultChannels = [
  {
    id: "1",
    type: "telegram",
    name: "Telegram Bot",
    enabled: true,
    connected: true,
    config: {},
  },
  {
    id: "2",
    type: "discord",
    name: "Discord Server",
    enabled: true,
    connected: true,
    config: {},
  },
  {
    id: "3",
    type: "weixin",
    name: "微信公众号",
    enabled: false,
    connected: false,
    config: {},
  },
  {
    id: "4",
    type: "pico",
    name: "Pico Channel (Web)",
    enabled: true,
    connected: true,
    config: {},
  },
]

// 社区频道数据
const communityChannels = [
  {
    id: "c1",
    name: "二次元聊天室",
    description: "聊聊你最近在追的番剧、喜欢的角色，找到同好！",
    icon: "🎌",
    members: 2341,
    messages: "12.5k",
    isPublic: true,
    isJoined: true,
    tags: ["动漫", "轻小说", "同人"],
  },
  {
    id: "c2",
    name: "萌宠俱乐部",
    description: "晒晒你家的毛孩子，分享养宠心得，云吸猫云撸狗~",
    icon: "🐱",
    members: 1856,
    messages: "8.9k",
    isPublic: true,
    isJoined: true,
    tags: ["猫咪", "狗狗", "仓鼠"],
  },
  {
    id: "c3",
    name: "程序员摸鱼角",
    description: "摸鱼一时爽，一直摸鱼一直爽。分享技术和日常~",
    icon: "💻",
    members: 3210,
    messages: "25.3k",
    isPublic: true,
    isJoined: false,
    tags: ["编程", "摸鱼", "技术"],
  },
  {
    id: "c4",
    name: "AI 绘画工坊",
    description: "分享 AI 绘画作品、提示词技巧，一起创作美图！",
    icon: "🎨",
    members: 987,
    messages: "5.2k",
    isPublic: true,
    isJoined: false,
    tags: ["AI绘画", "Stable Diffusion", "Midjourney"],
  },
  {
    id: "c5",
    name: "OpenClaw 开发组",
    description: "产品内测讨论、Bug 反馈、功能建议",
    icon: "🔧",
    members: 156,
    messages: "3.1k",
    isPublic: false,
    isJoined: true,
    tags: ["内测", "反馈", "开发"],
  },
  {
    id: "c6",
    name: "深夜食堂",
    description: "深夜发吃，分享美食照片和食谱，小心饿哦~",
    icon: "🍜",
    members: 1423,
    messages: "7.8k",
    isPublic: true,
    isJoined: false,
    tags: ["美食", "夜宵", "食谱"],
  },
]

const featuredChannel = {
  name: "PetClaw 官方频道",
  description: "官方公告、活动通知、新功能预告，第一时间获取最新消息！",
  icon: "🐾",
  members: 15234,
  isOfficial: true,
}

export function ChannelPage() {
  const [activeTab, setActiveTab] = useState<"integrations" | "community">("integrations")
  const [selectedCategory, setSelectedCategory] = useState("全部")

  const { data: channelsData, isLoading, error, mutate } = useChannels()
  const { data: catalogData } = useChannelCatalog()
  const { enable, disable } = useChannelMutations()

  // 使用 API 数据或默认数据
  const channels = channelsData?.channels || defaultChannels

  const handleToggleChannel = async (id: string, enabled: boolean) => {
    try {
      if (enabled) {
        await disable.trigger(id)
      } else {
        await enable.trigger(id)
      }
      mutate()
    } catch (err) {
      console.error("Toggle failed:", err)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xl">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">频道管理</h1>
            <p className="text-sm text-muted-foreground">管理通信渠道和加入社区频道~</p>
          </div>
        </div>
        <Button className="bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0">
          <Plus className="w-4 h-4 mr-2" />
          添加渠道
        </Button>
      </header>

      {/* Tabs */}
      <div className="px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("integrations")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === "integrations"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            通信渠道
          </button>
          <button
            onClick={() => setActiveTab("community")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === "community"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            社区广场
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === "integrations" ? (
          // Integration Channels
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              配置 PicoClaw 的通信渠道，支持 Telegram、Discord、微信等多个平台
            </p>
            
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Spinner className="w-8 h-8 text-orange-500" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {channels.map((channel) => {
                  const typeInfo = channelTypes[channel.type as keyof typeof channelTypes] || {
                    name: channel.type,
                    icon: "ch",
                    color: "from-gray-400 to-gray-600",
                  }
                  return (
                    <div
                      key={channel.id}
                      className={cn(
                        "p-4 rounded-2xl border bg-background transition-all",
                        channel.enabled
                          ? "border-border hover:border-orange-200 hover:shadow-md"
                          : "border-dashed border-border/50 opacity-70"
                      )}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-sm font-bold uppercase",
                          typeInfo.color
                        )}>
                          {typeInfo.icon}
                        </div>
                        <div className="flex items-center gap-2">
                          {channel.connected && (
                            <span className="flex items-center gap-1 text-xs text-green-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              已连接
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleChannel(channel.id, channel.enabled)}
                            className={cn(
                              "w-8 h-8 rounded-lg",
                              channel.enabled
                                ? "text-green-600 hover:bg-green-50"
                                : "text-muted-foreground hover:bg-accent"
                            )}
                          >
                            {channel.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      
                      <h3 className="font-semibold text-foreground">{channel.name}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{typeInfo.name}</p>
                      
                      <div className="flex items-center justify-between">
                        <span className={cn(
                          "px-2 py-0.5 text-xs rounded-full",
                          channel.enabled
                            ? "bg-green-100 text-green-700"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {channel.enabled ? "已启用" : "已禁用"}
                        </span>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                          <Settings className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
                
                {/* Add New Channel Card */}
                <div className="p-4 rounded-2xl border border-dashed border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[160px]">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-2">
                    <Plus className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">添加新渠道</p>
                </div>
              </div>
            )}

            {/* Supported Channels Info */}
            <div className="mt-8 p-4 rounded-2xl border border-border bg-muted/30">
              <h3 className="font-medium text-foreground mb-2">支持的渠道类型</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(channelTypes).map(([key, value]) => (
                  <span
                    key={key}
                    className="px-3 py-1 bg-background rounded-full text-sm text-muted-foreground border border-border"
                  >
                    {value.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Community Channels
          <div>
            {/* Featured Channel */}
            <div className="mb-6">
              <div className="relative p-6 rounded-2xl bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500 text-white overflow-hidden">
                <div className="absolute top-4 right-4 text-6xl opacity-20">🐾</div>
                <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
                
                <div className="relative flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-3xl">
                    {featuredChannel.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-bold">{featuredChannel.name}</h2>
                      <Crown className="w-5 h-5 text-yellow-300" />
                    </div>
                    <p className="text-white/80 text-sm mb-2">{featuredChannel.description}</p>
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Users className="w-4 h-4" />
                      <span>{featuredChannel.members.toLocaleString()} 成员</span>
                    </div>
                  </div>
                  <Button className="bg-white text-orange-500 hover:bg-white/90 border-0">
                    <Star className="w-4 h-4 mr-2" />
                    已加入
                  </Button>
                </div>
              </div>
            </div>

            {/* Channel Categories */}
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
              {["全部", "已加入", "热门", "二次元", "萌宠", "技术", "生活"].map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedCategory(tag)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                    selectedCategory === tag
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>

            {/* Channel Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {communityChannels.map((channel) => (
                <div
                  key={channel.id}
                  className="p-4 rounded-2xl border border-border bg-background hover:shadow-lg hover:border-orange-200 transition-all cursor-pointer group"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-100 to-pink-100 flex items-center justify-center text-2xl shrink-0">
                      {channel.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground truncate">{channel.name}</h3>
                        {channel.isPublic ? (
                          <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{channel.description}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {channel.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded-full"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {channel.members.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {channel.messages}
                      </span>
                    </div>
                    <Button
                      variant={channel.isJoined ? "outline" : "default"}
                      size="sm"
                      className={cn(
                        "h-7 px-3 text-xs",
                        channel.isJoined
                          ? "text-muted-foreground"
                          : "bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0"
                      )}
                    >
                      {channel.isJoined ? "已加入" : "加入"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
