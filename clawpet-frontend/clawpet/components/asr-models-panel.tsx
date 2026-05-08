import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react"

import { getWebSocketInstance, type ASRModelData, type ASRModelListData } from "@/lib/api"

interface AsrModelsPanelProps {
  onClose: () => void
  onChanged?: () => void
}

interface AsrModelFormState {
  name: string
  provider: string
  api_base: string
  model: string
  api_key: string
  enabled: boolean
  extra: Record<string, string>
}

const emptyAsrModelForm: AsrModelFormState = {
  name: "",
  provider: "whisper",
  api_base: "",
  model: "whisper-1",
  api_key: "",
  enabled: true,
  extra: {},
}

const PROVIDERS = ["whisper", "baidu", "elevenlabs", "audio_model"]

export function AsrModelsPanel({ onClose, onChanged }: AsrModelsPanelProps) {
  const [models, setModels] = useState<ASRModelData[]>([])
  const [defaultModel, setDefaultModel] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addingModel, setAddingModel] = useState(false)
  const [editingModel, setEditingModel] = useState<ASRModelData | null>(null)

  const fetchModels = useCallback(async () => {
    console.log("[DEBUG fetchModels] Starting")
    try {
      const ws = getWebSocketInstance()
      console.log("[DEBUG fetchModels] Calling getASRModelList")
      const resp = await ws.getASRModelList()
      console.log("[DEBUG fetchModels] getASRModelList returned, resp:", resp)
      const data = resp.data as ASRModelListData | undefined
      const list = data?.models ?? []
      console.log("[DEBUG fetchModels] Models list length:", list.length)
      const defaultName = data?.default || list.find((item) => item.is_default)?.name || ""
      setDefaultModel(defaultName)
      setModels(
        [...list].sort((a, b) => {
          if (a.name === defaultName && b.name !== defaultName) return -1
          if (a.name !== defaultName && b.name === defaultName) return 1
          return a.name.localeCompare(b.name)
        }),
      )
      console.log("[DEBUG fetchModels] State updated, models:", list.map(m => m.name))
      setError(null)
    } catch (loadError) {
      console.error("[DEBUG fetchModels] Error:", loadError)
      setError(loadError instanceof Error ? loadError.message : "加载 ASR 模型失败")
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
      await ws.setDefaultASRModel(modelName)
      await fetchModels()
      onChanged?.()
    } catch (setDefaultError) {
      setError(setDefaultError instanceof Error ? setDefaultError.message : "设置默认 ASR 模型失败")
    }
  }

  const handleDelete = async (modelName: string) => {
    if (!window.confirm(`确定要删除 ASR 模型 "${modelName}" 吗？`)) {
      return
    }
    console.log("[DEBUG handleDelete] Starting delete for:", modelName)
    try {
      const ws = getWebSocketInstance()
      console.log("[DEBUG handleDelete] Calling ws.deleteASRModel")
      const result = await ws.deleteASRModel(modelName)
      console.log("[DEBUG handleDelete] deleteASRModel returned:", result)
      console.log("[DEBUG handleDelete] Calling fetchModels")
      await fetchModels()
      console.log("[DEBUG handleDelete] fetchModels completed")
      onChanged?.()
    } catch (deleteError) {
      console.error("[DEBUG handleDelete] Error:", deleteError)
      setError(deleteError instanceof Error ? deleteError.message : "删除 ASR 模型失败")
    }
  }

  const handleModelSaved = async () => {
    console.log("[DEBUG handleModelSaved] Called, current addingModel:", addingModel)
    setAddingModel(false)
    setEditingModel(null)
    console.log("[DEBUG handleModelSaved] State updated, calling fetchModels")
    await fetchModels()
    console.log("[DEBUG handleModelSaved] fetchModels done")
    onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
      <div className="w-full max-w-3xl max-h-[84vh] overflow-hidden rounded-[1.2rem] border border-white/80 bg-[linear-gradient(145deg,rgba(255,250,245,0.98),rgba(255,244,236,0.95))] shadow-[0_24px_50px_-28px_rgba(110,75,42,0.45)]">
        <div className="flex items-center justify-between border-b border-white/80 px-5 py-4">
          <h2 className="text-4 font-semibold text-[#3c2a1f]">语音识别模型管理</h2>
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
                    暂无 ASR 模型，请添加
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
                            API: {model.api_base || "默认"} · {model.enabled ? "已启用" : "已停用"}
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
                            onClick={() => void handleDelete(model.name)}
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
          <AsrModelDialog
            title="添加 ASR 模型"
            initial={emptyAsrModelForm}
            existingNames={models.map((item) => item.name)}
            onClose={() => setAddingModel(false)}
            onSaved={handleModelSaved}
          />
        )}

        {editingModel && (
          <AsrModelDialog
            title={`编辑 ASR 模型: ${editingModel.name}`}
            initial={{
              name: editingModel.name,
              provider: editingModel.provider,
              api_base: editingModel.api_base,
              model: editingModel.model,
              api_key: "",
              enabled: editingModel.enabled,
              extra: editingModel.extra as Record<string, string>,
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

interface AsrModelDialogProps {
  title: string
  initial: AsrModelFormState
  existingNames: string[]
  editing?: boolean
  onClose: () => void
  onSaved: () => void
}

function AsrModelDialog({
  title,
  initial,
  existingNames,
  editing = false,
  onClose,
  onSaved,
}: AsrModelDialogProps) {
  const [form, setForm] = useState<AsrModelFormState>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (
    key: keyof AsrModelFormState,
    value: string | boolean,
  ) => {
    setForm((prev) => {
      if (key === "provider") {
        const newExtra: Record<string, string> = {}
        if (value === "baidu") {
          newExtra.app_id = prev.extra.app_id || ""
          newExtra.secret_key = prev.extra.secret_key || ""
        }
        return { ...prev, provider: value as string, extra: newExtra }
      }
      return { ...prev, [key]: value }
    })
    setError(null)
  }

  const handleExtraChange = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      extra: { ...prev.extra, [key]: value },
    }))
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
      const extra: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(form.extra)) {
        if (v) extra[k] = v
      }

      if (editing) {
        await ws.updateASRModel({
          name: normalizedName,
          provider: form.provider.trim(),
          api_base: form.api_base.trim() || undefined,
          model: form.model.trim(),
          api_key: form.api_key.trim() || undefined,
          enabled: form.enabled,
          extra: Object.keys(extra).length > 0 ? extra : undefined,
        })
      } else {
        await ws.addASRModel({
          name: normalizedName,
          provider: form.provider.trim(),
          api_base: form.api_base.trim() || undefined,
          model: form.model.trim(),
          api_key: form.api_key.trim() || undefined,
          enabled: form.enabled,
          extra: Object.keys(extra).length > 0 ? extra : undefined,
        })
      }
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 ASR 模型失败")
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
              placeholder="如：my-whisper"
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:bg-[#f0e8df]"
            />
          </label>

          <label className="block text-sm text-[#5c4331]">
            供应商 *
            <select
              value={form.provider}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                handleChange("provider", event.target.value)
              }
              className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[#8a6a52]">选择 ASR 提供商类型</p>
          </label>

          <label className="block text-sm text-[#5c4331]">
            模型 ID *
            <input
              type="text"
              value={form.model}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("model", event.target.value)
              }
              placeholder="如：whisper-1"
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
              placeholder="留空则使用默认值"
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

          {form.provider === "baidu" && (
            <>
              <label className="block text-sm text-[#5c4331]">
                App ID
                <input
                  type="text"
                  value={form.extra.app_id || ""}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    handleExtraChange("app_id", event.target.value)
                  }
                  placeholder="百度 ASR App ID"
                  className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
                />
              </label>
              <label className="block text-sm text-[#5c4331]">
                Secret Key
                <input
                  type="password"
                  value={form.extra.secret_key || ""}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    handleExtraChange("secret_key", event.target.value)
                  }
                  placeholder="百度 ASR Secret Key"
                  className="mt-1 w-full rounded border border-[#dbcbbd] bg-white px-3 py-2 text-sm text-[#3d2a1f] outline-none focus:border-amber-300"
                />
              </label>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-[#5c4331]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleChange("enabled", event.target.checked)
              }
            />
            启用该 ASR 模型
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