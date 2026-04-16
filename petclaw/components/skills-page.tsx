"use client"

import { useState } from "react"
import { Search, Sparkles, Code, Palette, Coffee, Heart, Zap, Plus, Upload, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSkills, useSkillMutations } from "@/hooks/use-picoclaw"
import { Spinner } from "@/components/ui/spinner"

const skillCategories = [
  { id: "all", label: "全部", icon: Sparkles },
  { id: "builtin", label: "内置", icon: Code },
  { id: "global", label: "全局", icon: Palette },
  { id: "workspace", label: "工作区", icon: Coffee },
]

// 默认技能数据（当 API 不可用时使用）
const defaultSkills = [
  {
    id: "1",
    name: "代码小助手",
    description: "帮你写代码、debug、解释代码逻辑，支持多种编程语言~",
    source: "builtin" as const,
    category: "code",
    enabled: true,
  },
  {
    id: "2",
    name: "二次元画师",
    description: "生成可爱的二次元角色、场景描述，让你的创意变成画面！",
    source: "builtin" as const,
    category: "creative",
    enabled: true,
  },
  {
    id: "3",
    name: "萌宠翻译官",
    description: "解读你家毛孩子的行为语言，了解它们的小心思~",
    source: "global" as const,
    category: "life",
    enabled: true,
  },
  {
    id: "4",
    name: "文案生成器",
    description: "小红书、抖音、微博文案一键生成，让你的内容出圈！",
    source: "workspace" as const,
    category: "creative",
    enabled: true,
  },
  {
    id: "5",
    name: "学习小伙伴",
    description: "陪你背单词、做笔记、复习知识点，学习不再孤单~",
    source: "builtin" as const,
    category: "life",
    enabled: true,
  },
  {
    id: "6",
    name: "API 调试助手",
    description: "帮你调试 API、分析请求响应、生成接口文档",
    source: "global" as const,
    category: "code",
    enabled: true,
  },
  {
    id: "7",
    name: "角色扮演大师",
    description: "扮演你喜欢的动漫角色，沉浸式对话体验！",
    source: "workspace" as const,
    category: "creative",
    enabled: true,
  },
  {
    id: "8",
    name: "猫咪心情日记",
    description: "记录你和猫主子的日常，生成温馨的回忆录~",
    source: "workspace" as const,
    category: "life",
    enabled: true,
  },
]

const skillIcons: Record<string, string> = {
  code: "code",
  creative: "creative",
  life: "life",
}

const skillColors: Record<string, string> = {
  builtin: "from-blue-400 to-cyan-400",
  global: "from-purple-400 to-violet-400",
  workspace: "from-orange-400 to-pink-400",
}

const skillEmojis: Record<string, string> = {
  "代码小助手": "cat-face",
  "二次元画师": "artist-palette",
  "萌宠翻译官": "dog",
  "文案生成器": "sparkles",
  "学习小伙伴": "books",
  "API 调试助手": "wrench",
  "角色扮演大师": "performing-arts",
  "猫咪心情日记": "cat",
}

export function SkillsPage() {
  const [activeCategory, setActiveCategory] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importMarkdown, setImportMarkdown] = useState("")

  const { data: skillsData, isLoading, error, mutate } = useSkills()
  const { importSkill, remove } = useSkillMutations()

  // 使用 API 数据或默认数据
  const skills = skillsData?.skills || defaultSkills

  // 过滤技能
  const filteredSkills = skills.filter((skill) => {
    const matchesCategory = activeCategory === "all" || skill.source === activeCategory
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  const handleImport = async () => {
    if (!importMarkdown.trim()) return
    try {
      await importSkill.trigger(importMarkdown)
      setImportMarkdown("")
      setShowImportDialog(false)
      mutate()
    } catch (err) {
      console.error("Import failed:", err)
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

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white text-xl">
            S
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">技能市场</h1>
            <p className="text-sm text-muted-foreground">探索各种有趣的 AI 技能，让生活更有趣~</p>
          </div>
        </div>
        <Button 
          onClick={() => setShowImportDialog(true)}
          className="bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0"
        >
          <Upload className="w-4 h-4 mr-2" />
          导入技能
        </Button>
      </header>

      {/* Search & Filter */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索你想要的技能..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30 transition-shadow"
            />
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl p-1">
            {skillCategories.map((cat) => {
              const Icon = cat.icon
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    activeCategory === cat.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Skills Grid */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner className="w-8 h-8 text-orange-500" />
          </div>
        ) : error ? (
          <div className="text-center py-10">
            <p className="text-muted-foreground">加载技能列表时出错，显示默认数据</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSkills.map((skill, index) => (
              <div
                key={skill.id}
                className="group relative p-4 rounded-2xl border border-border bg-background hover:shadow-lg hover:border-orange-200 transition-all cursor-pointer"
              >
                {/* Source Badge */}
                <div className={cn(
                  "absolute -top-2 -right-2 px-2 py-0.5 text-white text-xs rounded-full flex items-center gap-1",
                  skill.source === "builtin" && "bg-blue-500",
                  skill.source === "global" && "bg-purple-500",
                  skill.source === "workspace" && "bg-gradient-to-r from-orange-400 to-pink-500"
                )}>
                  {skill.source === "builtin" && "内置"}
                  {skill.source === "global" && "全局"}
                  {skill.source === "workspace" && "工作区"}
                </div>
                
                {/* Icon */}
                <div className={cn(
                  "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-2xl mb-3",
                  skillColors[skill.source] || "from-gray-400 to-gray-500"
                )}>
                  {["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "cat-face" ? "🐱" :
                   ["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "artist-palette" ? "🎨" :
                   ["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "dog" ? "🐕" :
                   ["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "sparkles" ? "✨" :
                   ["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "books" ? "📚" :
                   ["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "wrench" ? "🔧" :
                   ["cat-face", "artist-palette", "dog", "sparkles", "books", "wrench", "performing-arts", "cat"][index % 8] === "performing-arts" ? "🎭" : "🐈"}
                </div>
                
                {/* Content */}
                <h3 className="font-semibold text-foreground mb-1">{skill.name}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{skill.description}</p>
                
                {/* Footer */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Heart className="w-3 h-3" />
                    <span>{skill.enabled ? "已启用" : "未启用"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {skill.source === "workspace" && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDelete(skill.id)}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 px-2 h-7"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-orange-500 hover:text-orange-600 hover:bg-orange-50 px-2 h-7">
                      使用
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span>想要更多技能？</span>
            <button className="text-orange-500 hover:text-orange-600 font-medium">
              查看全部
            </button>
          </div>
        </div>
      </div>

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-2xl p-6 w-full max-w-lg mx-4">
            <h2 className="text-lg font-semibold mb-4">导入 Markdown 技能</h2>
            <textarea
              value={importMarkdown}
              onChange={(e) => setImportMarkdown(e.target.value)}
              placeholder="粘贴技能的 Markdown 内容..."
              className="w-full h-40 p-3 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-orange-400/30 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                取消
              </Button>
              <Button 
                onClick={handleImport}
                disabled={importSkill.isMutating || !importMarkdown.trim()}
                className="bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0"
              >
                {importSkill.isMutating ? <Spinner className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                导入
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
