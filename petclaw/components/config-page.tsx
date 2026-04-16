"use client"

import { useState } from "react"
import { Settings, Save, RotateCcw, Code, Eye, AlertTriangle, Check, Cpu, Globe, Clock, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useConfig, useUpdateConfig, useGatewayStatus, useGatewayControl } from "@/hooks/use-picoclaw"
import { Spinner } from "@/components/ui/spinner"

export function ConfigPage() {
  const [activeTab, setActiveTab] = useState<"visual" | "raw">("visual")
  const [rawJson, setRawJson] = useState("")
  const [hasChanges, setHasChanges] = useState(false)

  const { data: configData, isLoading, mutate } = useConfig()
  const updateConfig = useUpdateConfig()
  const { data: gatewayStatus } = useGatewayStatus()
  const { restart } = useGatewayControl()

  // 配置状态
  const [formData, setFormData] = useState({
    defaultModel: "",
    systemPrompt: "",
    execEnabled: false,
    cronEnabled: true,
    publicAccess: false,
    port: 18800,
  })

  // 更新表单数据
  const handleInputChange = (field: string, value: string | boolean | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  // 保存配置
  const handleSave = async () => {
    try {
      await updateConfig.trigger({
        agent: {
          defaultModel: formData.defaultModel,
          systemPrompt: formData.systemPrompt,
        },
        exec: {
          enabled: formData.execEnabled,
        },
        cron: {
          enabled: formData.cronEnabled,
        },
        launcher: {
          port: formData.port,
          publicAccess: formData.publicAccess,
        },
      })
      setHasChanges(false)
      mutate()
    } catch (err) {
      console.error("Save failed:", err)
    }
  }

  // 重启网关
  const handleRestart = async () => {
    try {
      await restart.trigger()
    } catch (err) {
      console.error("Restart failed:", err)
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">系统配置</h1>
            <p className="text-sm text-muted-foreground">管理 PicoClaw 的各项设置</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-sm text-orange-500 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              有未保存的更改
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setHasChanges(false)
              mutate()
            }}
            disabled={!hasChanges}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            重置
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateConfig.isMutating}
            className="bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0"
          >
            {updateConfig.isMutating ? <Spinner className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            保存配置
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("visual")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === "visual"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Eye className="w-4 h-4" />
            可视化配置
          </button>
          <button
            onClick={() => setActiveTab("raw")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === "raw"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Code className="w-4 h-4" />
            原始 JSON
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner className="w-8 h-8 text-gray-500" />
          </div>
        ) : activeTab === "visual" ? (
          <div className="max-w-2xl space-y-6">
            {/* Gateway Status Card */}
            <div className="p-4 rounded-2xl border border-border bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <Cpu className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">网关状态</h3>
                    <p className="text-sm text-muted-foreground">
                      {gatewayStatus?.running ? "网关正在运行" : "网关已停止"}
                      {gatewayStatus?.uptime && ` - 运行时间: ${Math.floor(gatewayStatus.uptime / 60)} 分钟`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleRestart}
                  disabled={restart.isMutating}
                  className={cn(
                    gatewayStatus?.restartRequired && "border-orange-500 text-orange-500"
                  )}
                >
                  {restart.isMutating ? <Spinner className="w-4 h-4 mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                  {gatewayStatus?.restartRequired ? "需要重启" : "重启网关"}
                </Button>
              </div>
            </div>

            {/* Agent Settings */}
            <div className="p-4 rounded-2xl border border-border">
              <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 text-sm">🤖</span>
                智能体设置
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">默认模型</label>
                  <input
                    type="text"
                    value={formData.defaultModel}
                    onChange={(e) => handleInputChange("defaultModel", e.target.value)}
                    placeholder="例如：gpt-4, claude-3-opus"
                    className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-blue-400/30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">系统提示词</label>
                  <textarea
                    value={formData.systemPrompt}
                    onChange={(e) => handleInputChange("systemPrompt", e.target.value)}
                    placeholder="设置 AI 的角色和行为..."
                    className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-blue-400/30 resize-none h-24"
                  />
                </div>
              </div>
            </div>

            {/* Runtime Settings */}
            <div className="p-4 rounded-2xl border border-border">
              <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 text-sm">⚡</span>
                运行时设置
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">命令执行</p>
                    <p className="text-sm text-muted-foreground">允许 AI 执行系统命令</p>
                  </div>
                  <button
                    onClick={() => handleInputChange("execEnabled", !formData.execEnabled)}
                    className={cn(
                      "relative w-12 h-6 rounded-full transition-colors",
                      formData.execEnabled ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                        formData.execEnabled ? "translate-x-7" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">定时任务</p>
                    <p className="text-sm text-muted-foreground">启用定时任务功能</p>
                  </div>
                  <button
                    onClick={() => handleInputChange("cronEnabled", !formData.cronEnabled)}
                    className={cn(
                      "relative w-12 h-6 rounded-full transition-colors",
                      formData.cronEnabled ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                        formData.cronEnabled ? "translate-x-7" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Launcher Settings */}
            <div className="p-4 rounded-2xl border border-border">
              <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 text-sm">🚀</span>
                启动器设置
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">端口号</label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) => handleInputChange("port", parseInt(e.target.value) || 18800)}
                    className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground outline-none focus:ring-2 focus:ring-purple-400/30"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">局域网访问</p>
                    <p className="text-sm text-muted-foreground">允许局域网中其他设备访问</p>
                  </div>
                  <button
                    onClick={() => handleInputChange("publicAccess", !formData.publicAccess)}
                    className={cn(
                      "relative w-12 h-6 rounded-full transition-colors",
                      formData.publicAccess ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                        formData.publicAccess ? "translate-x-7" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="p-4 rounded-2xl border border-orange-200 bg-orange-50">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-foreground mb-1">安全提示</h4>
                  <p className="text-sm text-muted-foreground">
                    启用命令执行和公网访问可能带来安全风险。请确保你了解这些设置的影响，
                    并在生产环境中使用适当的访问控制措施。
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl">
            <textarea
              value={rawJson || JSON.stringify(configData?.config || {}, null, 2)}
              onChange={(e) => {
                setRawJson(e.target.value)
                setHasChanges(true)
              }}
              className="w-full h-[500px] px-4 py-3 border border-border rounded-xl bg-muted/30 text-foreground font-mono text-sm outline-none focus:ring-2 focus:ring-gray-400/30 resize-none"
              placeholder="请输入有效的 JSON 配置..."
            />
            <p className="text-xs text-muted-foreground mt-2">
              配置文件路径：~/.picoclaw/config.json
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
