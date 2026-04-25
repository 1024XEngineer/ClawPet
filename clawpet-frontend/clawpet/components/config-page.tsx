"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Code,
  Cpu,
  Eye,
  Globe,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Sparkles,
  User,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  useConfig,
  useGatewayControl,
  useGatewayStatus,
  useUpdateConfig,
} from "@/hooks/use-picoclaw"
import {
  configApi,
  getWebSocketInstance,
  type CharacterProfileData,
  type Config,
  type UserProfileData,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type ConfigTab = "visual" | "raw"

interface ConfigFormState {
  defaultModel: string
  systemPrompt: string
  execEnabled: boolean
  cronEnabled: boolean
  publicAccess: boolean
  port: number
}

interface PersonalityFormState {
  petId: string
  petName: string
  petPersona: string
  petPersonaType: string
  personalityTone: string
  language: string
  emotionEnabled: boolean
}

const emptyPersonalityForm: PersonalityFormState = {
  petId: "",
  petName: "",
  petPersona: "",
  petPersonaType: "gentle",
  personalityTone: "正常",
  language: "zh-CN",
  emotionEnabled: true,
}

const emptyFormState: ConfigFormState = {
  defaultModel: "",
  systemPrompt: "",
  execEnabled: false,
  cronEnabled: true,
  publicAccess: false,
  port: 18790,
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return "操作失败，请稍后再试。"
}

function mapConfigToForm(config?: Config): ConfigFormState {
  return {
    defaultModel: config?.agent?.defaultModel ?? "",
    systemPrompt: config?.agent?.systemPrompt ?? "",
    execEnabled: Boolean(config?.exec?.enabled),
    cronEnabled: config?.cron?.enabled ?? true,
    publicAccess: Boolean(config?.launcher?.publicAccess),
    port: config?.launcher?.port ?? 18790,
  }
}

function mapCharacterToPersonalityForm(
  character?: CharacterProfileData,
  profile?: UserProfileData,
  config?: { language?: string; emotion_enabled?: boolean },
): PersonalityFormState {
  return {
    petId: character?.pet_id ?? "",
    petName: character?.pet_name ?? "",
    petPersona: character?.pet_persona ?? "",
    petPersonaType: character?.pet_persona_type ?? "gentle",
    personalityTone: profile?.personality_tone ?? "正常",
    language: config?.language ?? "zh-CN",
    emotionEnabled: config?.emotion_enabled ?? true,
  }
}

function stringifyConfig(config?: Config): string {
  return JSON.stringify(config ?? {}, null, 2)
}

export function ConfigPage() {
  const [activeTab, setActiveTab] = useState<ConfigTab>("visual")
  const [rawJson, setRawJson] = useState("")
  const [hasChanges, setHasChanges] = useState(false)
  const [actionState, setActionState] = useState<{
    type: "error" | "success"
    message: string
  } | null>(null)

  const { data: configData, isLoading, mutate } = useConfig()
  const updateConfig = useUpdateConfig()
  const { data: gatewayStatus } = useGatewayStatus()
  const { restart } = useGatewayControl()

  const [formData, setFormData] = useState<ConfigFormState>(emptyFormState)
  const [personalityForm, setPersonalityForm] = useState<PersonalityFormState>(
    emptyPersonalityForm,
  )
  const [personalityBaseline, setPersonalityBaseline] =
    useState<PersonalityFormState>(emptyPersonalityForm)
  const [personalityDirty, setPersonalityDirty] = useState(false)
  const [personalityLoading, setPersonalityLoading] = useState(false)
  const [personalitySaving, setPersonalitySaving] = useState(false)
  const [personalityState, setPersonalityState] = useState<{
    type: "error" | "success"
    message: string
  } | null>(null)

  useEffect(() => {
    if (!configData?.config || hasChanges) {
      return
    }
    setFormData(mapConfigToForm(configData.config))
    setRawJson(stringifyConfig(configData.config))
  }, [configData, hasChanges])

  useEffect(() => {
    let cancelled = false

    const loadPersonality = async () => {
      setPersonalityLoading(true)
      setPersonalityState(null)
      try {
        const ws = getWebSocketInstance()
        const [characterResp, userProfileResp, petConfigResp] = await Promise.all([
          ws.getCharacter(),
          ws.getUserProfile(),
          ws.getPetConfig(),
        ])

        if (cancelled) {
          return
        }

        const nextForm = mapCharacterToPersonalityForm(
          characterResp.data,
          userProfileResp.data,
          petConfigResp.data,
        )
        setPersonalityForm(nextForm)
        setPersonalityBaseline(nextForm)
        setPersonalityDirty(false)
      } catch (loadError) {
        if (cancelled) {
          return
        }
        setPersonalityState({
          type: "error",
          message: `加载桌宠个性失败：${getErrorMessage(loadError)}`,
        })
      } finally {
        if (!cancelled) {
          setPersonalityLoading(false)
        }
      }
    }

    void loadPersonality()

    return () => {
      cancelled = true
    }
  }, [])

  const gatewaySummary = useMemo(() => {
    if (!gatewayStatus) {
      return {
        label: "检查中",
        detail: "桌宠正在读取网关状态。",
        shell: "from-slate-100 via-slate-50 to-white border-slate-200/80",
        tone: "text-slate-700",
      }
    }

    if (gatewayStatus.running) {
      return {
        label: "运行中",
        detail: gatewayStatus.uptime
          ? `已稳定运行约 ${Math.floor(Number(gatewayStatus.uptime) / 60)} 分钟。`
          : "网关已在线，桌宠可以正常工作。",
        shell: "from-emerald-100 via-emerald-50 to-white border-emerald-200/80",
        tone: "text-emerald-700",
      }
    }

    return {
      label: "已停止",
      detail: gatewayStatus.startReason || "当前网关离线，桌宠能力会受限。",
      shell: "from-rose-100 via-rose-50 to-white border-rose-200/80",
      tone: "text-rose-700",
    }
  }, [gatewayStatus])

  function applySnapshot(config?: Config) {
    const nextConfig = config ?? configData?.config
    setFormData(mapConfigToForm(nextConfig))
    setRawJson(stringifyConfig(nextConfig))
    setHasChanges(false)
    setActionState(null)
  }

  function handleInputChange(
    field: keyof ConfigFormState,
    value: string | boolean | number,
  ) {
    setFormData((prev) => ({ ...prev, [field]: value } as ConfigFormState))
    setHasChanges(true)
    setActionState(null)
  }

  function handlePersonalityInputChange(
    field: keyof PersonalityFormState,
    value: string | boolean,
  ) {
    setPersonalityForm((prev) => ({
      ...prev,
      [field]: value,
    }))
    setPersonalityDirty(true)
    setPersonalityState(null)
  }

  async function handleSavePersonality() {
    setPersonalitySaving(true)
    setPersonalityState(null)

    try {
      const ws = getWebSocketInstance()

      const characterPayload: {
        pet_id?: string
        pet_name?: string
        pet_persona?: string
        pet_persona_type?: string
      } = {
        pet_name: personalityForm.petName.trim(),
        pet_persona: personalityForm.petPersona.trim(),
        pet_persona_type: personalityForm.petPersonaType,
      }
      if (personalityForm.petId.trim()) {
        characterPayload.pet_id = personalityForm.petId.trim()
      }

      await ws.updateCharacter(characterPayload)

      await ws.updateUserProfile({
        personality_tone: personalityForm.personalityTone.trim() || "正常",
        language: personalityForm.language,
      })

      await ws.updatePetConfig({
        emotion_enabled: personalityForm.emotionEnabled,
        language: personalityForm.language,
      })

      const [refreshedCharacter, refreshedProfile, refreshedConfig] = await Promise.all([
        ws.getCharacter(),
        ws.getUserProfile(),
        ws.getPetConfig(),
      ])
      const nextForm = mapCharacterToPersonalityForm(
        refreshedCharacter.data,
        refreshedProfile.data,
        refreshedConfig.data,
      )
      setPersonalityForm(nextForm)
      setPersonalityBaseline(nextForm)
      setPersonalityDirty(false)
      setPersonalityState({
        type: "success",
        message: "桌宠个性已更新，新对话会立即生效。",
      })
    } catch (saveError) {
      setPersonalityState({
        type: "error",
        message: `保存桌宠个性失败：${getErrorMessage(saveError)}`,
      })
    } finally {
      setPersonalitySaving(false)
    }
  }

  async function handleSave() {
    setActionState(null)

    try {
      if (activeTab === "raw") {
        JSON.parse(rawJson)
        await configApi.updateRaw(rawJson)
      } else {
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
      }

      const refreshed = await mutate()
      applySnapshot(refreshed?.config ?? configData?.config)
      setActionState({ type: "success", message: "配置已保存。" })
    } catch (saveError) {
      setActionState({
        type: "error",
        message: getErrorMessage(saveError),
      })
    }
  }

  async function handleRestart() {
    setActionState(null)
    try {
      await restart.trigger()
      setActionState({ type: "success", message: "已发出重启网关请求。" })
    } catch (restartError) {
      setActionState({
        type: "error",
        message: getErrorMessage(restartError),
      })
    }
  }

  const visualCards = [
    {
      icon: Cpu,
      title: "桌宠大脑",
      description: "决定默认模型和基础语气，让桌宠像谁、怎么说话。",
      shell: "from-amber-100 via-orange-50 to-white border-amber-200/80",
    },
    {
      icon: Shield,
      title: "自动化闸门",
      description: "控制命令执行和定时任务权限，决定桌宠能做多深。",
      shell: "from-violet-100 via-purple-50 to-white border-violet-200/80",
    },
    {
      icon: Globe,
      title: "启动器表面",
      description: "管理端口、可见性以及其他设备如何接入桌宠。",
      shell: "from-sky-100 via-cyan-50 to-white border-sky-200/80",
    },
  ]

  const saving = updateConfig.isMutating
  const restarting = restart.isMutating

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,246,237,0.78),rgba(255,249,245,0.94),rgba(255,252,249,0.98))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(255,255,255,0.84),transparent_28%),radial-gradient(circle_at_84%_12%,rgba(191,219,254,0.2),transparent_24%),radial-gradient(circle_at_82%_78%,rgba(254,205,211,0.16),transparent_28%)]" />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto px-6 py-5">
        <div className="dashboard-enter dashboard-card rounded-[2rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,251,246,0.95),rgba(255,245,237,0.9),rgba(255,250,245,0.92))] px-6 py-6 shadow-[0_24px_58px_-36px_rgba(118,83,43,0.42)]">
          <div className="flex flex-wrap items-start justify-between gap-4 max-[1180px]:flex-col max-[1180px]:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/82 px-3 py-1.5 text-sm font-medium text-[#7f5a38]">
                <Settings className="h-4 w-4 text-amber-600" />
                控制面板
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[#3d2718]">
                调校桌宠的行为与边界
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-8 text-[#816451]">
                这里不再是普通后台表单，而是桌宠的控制舱。模型、自动化闸门和启动器表面都在同一套驾驶台里完成。
              </p>
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-2 max-[1180px]:justify-start">
              <Button
                variant="outline"
                onClick={() => applySnapshot()}
                disabled={!hasChanges}
                className="h-8 shrink-0 rounded-full border-white/80 bg-white/82 px-3 text-xs text-[#6d5846] hover:bg-white"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                重置
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className="h-8 shrink-0 rounded-full border-0 bg-[linear-gradient(135deg,#9a5929_0%,#c87734_48%,#e1a05b_100%)] px-3 text-xs text-amber-50 shadow-[0_18px_26px_-18px_rgba(154,89,41,0.75)] hover:brightness-105"
              >
                {saving ? (
                  <Spinner className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                保存
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {visualCards.map((card) => {
              const Icon = card.icon
              return (
                <div
                  key={card.title}
                  className={cn(
                    "dashboard-card rounded-[1.4rem] border bg-gradient-to-r px-4 py-4 shadow-sm",
                    card.shell,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4.5 w-4.5 text-[#714728]" />
                    <p className="text-sm font-semibold text-[#4f3725]">
                      {card.title}
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#816451]">
                    {card.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="dashboard-enter mt-5 rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-4 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/75 bg-white/82 p-1">
              <button
                onClick={() => setActiveTab("visual")}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                  activeTab === "visual"
                    ? "bg-[linear-gradient(135deg,rgba(255,245,227,0.98),rgba(255,253,246,0.92))] text-[#734826] shadow-sm"
                    : "text-[#86674f] hover:text-[#4d3420]",
                )}
              >
                <Eye className="h-4 w-4" />
                可视化
              </button>
              <button
                onClick={() => setActiveTab("raw")}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                  activeTab === "raw"
                    ? "bg-[linear-gradient(135deg,rgba(255,245,227,0.98),rgba(255,253,246,0.92))] text-[#734826] shadow-sm"
                    : "text-[#86674f] hover:text-[#4d3420]",
                )}
              >
                <Code className="h-4 w-4" />
                原始 JSON
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className={cn(
                  "dashboard-pulse-glow rounded-full border bg-gradient-to-r px-3 py-1.5 text-sm font-medium",
                  gatewaySummary.shell,
                  gatewaySummary.tone,
                )}
              >
                {gatewaySummary.label}
              </div>
              <Button
                variant="outline"
                onClick={handleRestart}
                disabled={restarting}
                className={cn(
                  "rounded-full border-white/80 bg-white/82 text-[#6d5846] hover:bg-white",
                  gatewayStatus?.restartRequired &&
                    "border-orange-300 text-orange-700",
                )}
              >
                {restarting ? (
                  <Spinner className="mr-2 h-4 w-4" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                {gatewayStatus?.restartRequired ? "需要重启" : "重启网关"}
              </Button>
            </div>
          </div>

          {actionState && (
            <div
              className={cn(
                "mt-4 rounded-[1.2rem] border px-4 py-3 text-sm",
                actionState.type === "error"
                  ? "border-rose-200 bg-rose-50/95 text-rose-700"
                  : "border-emerald-200 bg-emerald-50/95 text-emerald-700",
              )}
            >
              {actionState.message}
            </div>
          )}
        </div>

        <div className="mt-5 flex-1">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="h-8 w-8 text-orange-500" />
            </div>
          ) : activeTab === "visual" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <article className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-5 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)]">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-amber-600" />
                  <h2 className="text-xl font-semibold text-[#4f3725]">
                    桌宠大脑
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#816451]">
                  设置默认模型和系统提示词，决定桌宠如何思考、如何表达。
                </p>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                      默认模型
                    </label>
                    <input
                      type="text"
                      value={formData.defaultModel}
                      onChange={(event) =>
                        handleInputChange("defaultModel", event.target.value)
                      }
                      placeholder="例如：gpt-4o 或 claude-sonnet"
                      className="w-full rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                      系统提示词
                    </label>
                    <textarea
                      value={formData.systemPrompt}
                      onChange={(event) =>
                        handleInputChange("systemPrompt", event.target.value)
                      }
                      placeholder="描述桌宠的角色、语气与行为边界..."
                      className="h-36 w-full resize-none rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                    />
                  </div>
                </div>
              </article>

              <article className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-5 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)]">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-violet-600" />
                  <h2 className="text-xl font-semibold text-[#4f3725]">
                    自动化闸门
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#816451]">
                  决定桌宠能否运行命令，以及是否允许它使用定时自动化。
                </p>

                <div className="mt-5 space-y-4">
                  {[
                    {
                      key: "execEnabled" as const,
                      title: "命令执行",
                      description: "允许桌宠运行 shell 命令。",
                    },
                    {
                      key: "cronEnabled" as const,
                      title: "定时任务",
                      description: "允许桌宠创建提醒和周期性自动化。",
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="dashboard-card flex items-center justify-between gap-4 rounded-[1.2rem] border border-white/80 bg-white/82 px-4 py-4"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#4f3725]">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[#816451]">
                          {item.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-pressed={formData[item.key]}
                        onClick={() =>
                          handleInputChange(item.key, !formData[item.key])
                        }
                        className={cn(
                          "relative h-7 w-14 rounded-full transition",
                          formData[item.key]
                            ? "bg-emerald-500"
                            : "bg-[#e7ddd3]",
                        )}
                        title={item.title}
                      >
                        <span
                          className={cn(
                            "absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform",
                            formData[item.key]
                              ? "translate-x-7"
                              : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </article>

              <article className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-5 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)]">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-sky-600" />
                  <h2 className="text-xl font-semibold text-[#4f3725]">
                    启动器表面
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#816451]">
                  管理启动器端口，以及是否允许其他设备访问这个桌宠入口。
                </p>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                      端口
                    </label>
                    <input
                      type="number"
                      value={formData.port}
                      onChange={(event) =>
                        handleInputChange(
                          "port",
                          Number.parseInt(event.target.value, 10) || 18790,
                        )
                      }
                      className="w-full rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                    />
                  </div>

                  <div className="dashboard-card flex items-center justify-between gap-4 rounded-[1.2rem] border border-white/80 bg-white/82 px-4 py-4">
                    <div>
                      <p className="text-sm font-semibold text-[#4f3725]">
                        局域网访问
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#816451]">
                        允许同一网络内的其他设备访问这个启动器。
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={formData.publicAccess}
                      onClick={() =>
                        handleInputChange("publicAccess", !formData.publicAccess)
                      }
                      className={cn(
                        "relative h-7 w-14 rounded-full transition",
                        formData.publicAccess
                          ? "bg-emerald-500"
                          : "bg-[#e7ddd3]",
                      )}
                      title="局域网访问"
                    >
                      <span
                        className={cn(
                          "absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform",
                          formData.publicAccess
                            ? "translate-x-7"
                            : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>
                </div>
              </article>

              <article className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-5 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)]">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-rose-600" />
                  <h2 className="text-xl font-semibold text-[#4f3725]">
                    对话个性
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#816451]">
                  直接调用 character/config/user_profile 接口，控制桌宠名字、语气、性格和情绪表现强度。
                </p>

                {personalityState && (
                  <div
                    className={cn(
                      "mt-4 rounded-[1rem] border px-3 py-2 text-xs",
                      personalityState.type === "error"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {personalityState.message}
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                      桌宠昵称
                    </label>
                    <input
                      type="text"
                      value={personalityForm.petName}
                      onChange={(event) =>
                        handlePersonalityInputChange("petName", event.target.value)
                      }
                      placeholder="例如：艾莉"
                      className="w-full rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                      人设描述
                    </label>
                    <textarea
                      value={personalityForm.petPersona}
                      onChange={(event) =>
                        handlePersonalityInputChange("petPersona", event.target.value)
                      }
                      placeholder="例如：直球吐槽但不攻击，先给结论再给行动建议。"
                      className="h-24 w-full resize-none rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                        角色类型
                      </label>
                      <select
                        value={personalityForm.petPersonaType}
                        onChange={(event) =>
                          handlePersonalityInputChange("petPersonaType", event.target.value)
                        }
                        className="w-full rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                      >
                        <option value="gentle">gentle（温柔陪伴）</option>
                        <option value="cool">cool（冷静直接）</option>
                        <option value="playful">playful（活泼外向）</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-[#5d4430]">
                        用户偏好语气
                      </label>
                      <select
                        value={personalityForm.personalityTone}
                        onChange={(event) =>
                          handlePersonalityInputChange("personalityTone", event.target.value)
                        }
                        className="w-full rounded-[1.2rem] border border-white/80 bg-white/84 px-4 py-3 text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                      >
                        <option value="正常">正常</option>
                        <option value="温柔">温柔</option>
                        <option value="阴阳怪气">阴阳怪气</option>
                        <option value="严格教练">严格教练</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-white/80 bg-white/82 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-[#4f3725]">情绪驱动回复</p>
                      <p className="mt-1 text-xs text-[#816451]">开启后，情绪状态会更明显地影响回答风格。</p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={personalityForm.emotionEnabled}
                      onClick={() =>
                        handlePersonalityInputChange(
                          "emotionEnabled",
                          !personalityForm.emotionEnabled,
                        )
                      }
                      className={cn(
                        "relative h-7 w-14 rounded-full transition",
                        personalityForm.emotionEnabled
                          ? "bg-emerald-500"
                          : "bg-[#e7ddd3]",
                      )}
                      title="情绪驱动回复"
                    >
                      <span
                        className={cn(
                          "absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform",
                          personalityForm.emotionEnabled
                            ? "translate-x-7"
                            : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      {
                        label: "温柔学伴",
                        tone: "温柔",
                        type: "gentle",
                        persona: "先安抚情绪，再给清晰步骤；语言短句，避免压迫感。",
                      },
                      {
                        label: "冷静教练",
                        tone: "严格教练",
                        type: "cool",
                        persona: "先给结论，再给执行清单；指出问题但不人身攻击。",
                      },
                      {
                        label: "毒舌搭子",
                        tone: "阴阳怪气",
                        type: "playful",
                        persona: "允许轻度吐槽和反差幽默，但结论必须专业、可执行。",
                      },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setPersonalityForm((prev) => ({
                            ...prev,
                            petPersonaType: preset.type,
                            personalityTone: preset.tone,
                            petPersona: preset.persona,
                          }))
                          setPersonalityDirty(true)
                          setPersonalityState(null)
                        }}
                        className="rounded-full border border-white/80 bg-white/85 px-3 py-1.5 text-xs text-[#6d5846] transition hover:bg-white"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPersonalityForm(personalityBaseline)
                        setPersonalityDirty(false)
                        setPersonalityState(null)
                      }}
                      disabled={!personalityDirty || personalityLoading || personalitySaving}
                      className="h-8 rounded-full border-white/80 bg-white/82 px-3 text-xs text-[#6d5846] hover:bg-white"
                    >
                      重置
                    </Button>
                    <Button
                      onClick={handleSavePersonality}
                      disabled={personalityLoading || personalitySaving || !personalityDirty}
                      className="h-8 rounded-full border-0 bg-[linear-gradient(135deg,#9a5929_0%,#c87734_48%,#e1a05b_100%)] px-3 text-xs text-amber-50 shadow-[0_18px_26px_-18px_rgba(154,89,41,0.75)] hover:brightness-105"
                    >
                      {personalitySaving ? (
                        <Spinner className="mr-1.5 h-3.5 w-3.5" />
                      ) : (
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      应用个性
                    </Button>
                  </div>
                </div>
              </article>

              <article className="dashboard-enter dashboard-card rounded-[1.8rem] border border-orange-200/80 bg-[linear-gradient(145deg,rgba(255,247,238,0.96),rgba(255,242,232,0.9))] p-5 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.24)]">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                  <div>
                    <h2 className="text-xl font-semibold text-[#4f3725]">
                      安全提醒
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[#816451]">
                      命令执行和局域网访问都很强大，但也会扩大信任边界。只有在你真正需要时再开启它们。
                    </p>
                  </div>
                </div>
              </article>
            </div>
          ) : (
            <div className="dashboard-enter dashboard-card rounded-[1.8rem] border border-white/75 bg-[linear-gradient(145deg,rgba(255,252,247,0.94),rgba(255,247,242,0.88))] p-5 shadow-[0_20px_42px_-32px_rgba(116,80,42,0.34)]">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-600" />
                <h2 className="text-xl font-semibold text-[#4f3725]">
                  原始配置牌堆
                </h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#816451]">
                当你需要绝对精细的控制时，可以直接编辑原始 JSON。
              </p>

              <textarea
                value={rawJson}
                onChange={(event) => {
                  setRawJson(event.target.value)
                  setHasChanges(true)
                  setActionState(null)
                }}
                className="mt-5 h-[34rem] w-full resize-none rounded-[1.4rem] border border-white/80 bg-white/88 px-4 py-4 font-mono text-sm text-[#4b3422] outline-none transition focus:border-amber-200 focus:bg-white"
                placeholder="在这里输入有效的 JSON 配置..."
              />

              <p className="mt-3 text-xs leading-5 text-[#8a6b50]">
                路径：<code className="rounded bg-white/70 px-1.5 py-0.5">~/.picoclaw/config.json</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
