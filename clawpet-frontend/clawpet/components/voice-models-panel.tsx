import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react"

import { getWebSocketInstance, type VoiceModelData, type VoiceModelListData } from "@/lib/api"

interface VoiceModelsPanelProps {
  onClose: () => void
  onChanged?: () => void
}

interface VoiceModelFormState {
  name: string
  provider: string
  api_base: string
  model: string
  voice_id: string
  api_key: string
  enabled: boolean
}

const emptyVoiceModelForm: VoiceModelFormState = {
  name: "",
  provider: "minimax",
  api_base: "",
  model: "",
  voice_id: "",
  api_key: "",
  enabled: true,
}

export function VoiceModelsPanel({ onClose, onChanged }: VoiceModelsPanelProps) {
  const [models, setModels] = useState<VoiceModelData[]>([])
  const [defaultModel, setDefaultModel] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addingModel, setAddingModel] = useState(false)
  const [editingModel, setEditingModel] = useState<VoiceModelData | null>(null)

  const fetchModels = useCallback(async () => {
    try {
      const ws = getWebSocketInstance()
      const resp = await ws.getVoiceModelList()
      const data = resp.data as VoiceModelListData | undefined
      const list = data?.models ?? []
      const defaultName = data?.default || list.find((item) => item.is_default)?.name || ""
      setDefaultModel(defaultName)
      setModels(
        [...list].sort((a, b) => {
          if (a.name === defaultName && b.name !== defaultName) return -1
          if (a.name !== defaultName && b.name === defaultName) return 1
          return a.name.localeCompare(b.name)
        }),
      )
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载语音模型失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchModels()
  }, [fetchModels])

  const handleSetDefault = async (modelName: string) => {
    if (modelName === defaultModel) {
      return
    }
    try {
      const ws = getWebSocketInstance()
      await ws.setDefaultVoiceModel(modelName)
      await fetchModels()
      onChanged?.()
    } catch (setDefaultError) {
      setError(setDefaultError instanceof Error ? setDefaultError.message : "设置默认语音模型失败")
    }
  }

  const handleModelSaved = async () => {
    setAddingModel(false)
    setEditingModel(null)
    await fetchModels()
    onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
      <div className="w-full max-w-3xl max-h-[84vh] overflow-hidden rounded-[1.2rem] border border-white/80 bg-[linear-gradient(145deg,rgba(255,250,245,0.98),rgba(255,244,236,0.95))] shadow-[0_24px_50px_-28px_rgba(110,75,42,0.45)]">
        <div className="flex items-center justify-between border-b border-white/80 px-5 py-4">
          <h2 className="text-4 font-semibold text-[#3c2a1f]">语音模型管理</h2>
          <button onClick={onClose} className="text-[#8b6a4d] transition hover:text-[#3c2a1f]">
            ✕
          </button>
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center text-[#7a5f49]">加载中...</div>
          ) : (
            <>
              {error && (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {notice && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {notice}
                </div>
              )}

              <div className="space-y-3">
                {models.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#d7c7b8] bg-[#f7ede5] px-4 py-8 text-center text-sm text-[#7a5f49]">
                    暂无语音模型，请添加
                  </div>
                ) : (
                  models.map((model) => (
                    <div key={model.name} className="rounded-[1rem] border border-white/80 bg-white/82 px-4 py-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {model.name === defaultModel && <span title="默认模型">⭐</span>}
                            <p className="truncate text-2xl font-semibold text-[#3d2a1f]">{model.name}</p>
                          </div>
                          <p className="mt-1 truncate text-sm text-[#6f5642]">
                            {model.provider}/{model.model}
                          </p>
                          <p className="mt-2 text-sm text-[#6f5642]">
                            API: {model.api_base || "未配置"} · {model.enabled ? "已启用" : "已停用"}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNotice(null)
                              setEditingModel(model)
                            }}
                            className="rounded-[0.7rem] bg-[#ebe4de] px-3 py-2 text-sm text-[#3d2a1f] transition hover:bg-[#e2d7ce]"
                          >
                            编辑
                          </button>
                          {model.name !== defaultModel && (
                            <button
                              type="button"
                              onClick={() => {
                                setNotice(null)
                                void handleSetDefault(model.name)
                              }}
                              className="rounded-[0.7rem] bg-[#ebe4de] px-3 py-2 text-sm text-[#3d2a1f] transition hover:bg-[#e2d7ce]"
                            >
                              设为默认
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setNotice("删除语音模型暂不可用，后续版本开放。")}
                            className="rounded-[0.7rem] bg-rose-100 px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-200"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/80 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setAddingModel(true)
            }}
            className="rounded-[0.8rem] bg-[#ea6b2d] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#dd5e20]"
          >
            添加模型
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[0.8rem] bg-[#e8e2dc] px-4 py-2 text-sm font-medium text-[#3d2a1f] transition hover:bg-[#ddd4cb]"
          >
            关闭
          </button>
        </div>

        {addingModel && (
          <VoiceModelDialog
            title="添加语音模型"
            initial={emptyVoiceModelForm}
            existingNames={models.map((item) => item.name)}
            onClose={() => setAddingModel(false)}
            onSaved={handleModelSaved}
          />
        )}

        {editingModel && (
          <VoiceModelDialog
            title={`编辑语音模型: ${editingModel.name}`}
            initial={{
              name: editingModel.name,
              provider: editingModel.provider,
              api_base: editingModel.api_base,
              model: editingModel.model,
              voice_id: editingModel.voice_id,
              api_key: "",
              enabled: editingModel.enabled,
            }}
            editing
            existingNames={models.map((item) => item.name)}
            onClose={() => setEditingModel(null)}
            onSaved={handleModelSaved}
          />
        )}
      </div>
    </div>
  )
}

interface VoiceModelDialogProps {
  title: string
  initial: VoiceModelFormState
  existingNames: string[]
  editing?: boolean
  onClose: () => void
  onSaved: () => void
}

function VoiceModelDialog({
  title,
  initial,
  existingNames,
  editing = false,
  onClose,
  onSaved,
}: VoiceModelDialogProps) {
  const [form, setForm] = useState<VoiceModelFormState>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (
    key: keyof VoiceModelFormState,
    value: string | boolean,
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.name.trim() || !form.provider.trim() || !form.model.trim()) {
      setError("模型名称、供应商、模型 ID 为必填项")
      return
    }

    const normalizedName = form.name.trim()
    if (!editing && existingNames.includes(normalizedName)) {
      setError("模型名称已存在")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const ws = getWebSocketInstance()
      await ws.updateVoiceModel({
        name: normalizedName,
        api_base: form.api_base.trim() || undefined,
        model: form.model.trim(),
        voice_id: form.voice_id.trim() || undefined,
        api_key: form.api_key.trim() || undefined,
        enabled: form.enabled,
        extra: {
          provider: form.provider.trim(),
        },
      })
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存语音模型失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-xl rounded-[1rem] border border-white/80 bg-[linear-gradient(145deg,rgba(255,249,243,0.98),rgba(255,241,231,0.95))] shadow-[0_24px_50px_-30px_rgba(110,75,42,0.45)]">
        <div className="border-b border-white/80 px-5 py-4">
          <h3 className="text-lg font-semibold text-[#3d2a1f]">{title}</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <label className="block text-sm text-[#5c4331]">
            模型名称 *
            <input
              type="text"
              value={form.name}
              disabled={editing}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("name", event.target.value)
              }
              placeholder="如：minimax"
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:bg-[#f0e8df]"
            />
          </label>

          <label className="block text-sm text-[#5c4331]">
            供应商 *
            <input
              type="text"
              list="voice-provider-suggestions"
              value={form.provider}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("provider", event.target.value)
              }
              placeholder="如：minimax / doubao / volcengine"
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
            />
            <datalist id="voice-provider-suggestions">
              <option value="minimax" />
              <option value="doubao" />
              <option value="volcengine" />
              <option value="custom" />
            </datalist>
            <p className="mt-1 text-xs text-[#8a6a52]">可自由输入未预置的供应商标识。</p>
          </label>

          <label className="block text-sm text-[#5c4331]">
            模型 ID *
            <input
              type="text"
              value={form.model}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("model", event.target.value)
              }
              placeholder="如：speech-2.8-hd"
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
            />
          </label>

          <label className="block text-sm text-[#5c4331]">
            API 地址
            <input
              type="text"
              value={form.api_base}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("api_base", event.target.value)
              }
              placeholder="如：https://api.minimaxi.com/v1/t2a_v2"
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
            />
          </label>

          <label className="block text-sm text-[#5c4331]">
            API Key
            <input
              type="password"
              value={form.api_key}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("api_key", event.target.value)
              }
              placeholder="sk-..."
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
            />
          </label>

          <label className="block text-sm text-[#5c4331]">
            音色 ID
            <input
              type="text"
              value={form.voice_id}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("voice_id", event.target.value)
              }
              placeholder="如：danya_xuejie"
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-[#5c4331]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("enabled", event.target.checked)
              }
            />
            启用该语音模型
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[0.8rem] bg-[#e8e2dc] px-4 py-2 text-sm text-[#3d2a1f] transition hover:bg-[#ddd4cb]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-[0.8rem] bg-[#ea6b2d] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#dd5e20] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
