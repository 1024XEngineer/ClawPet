import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react"
import {
  getWebSocketInstance,
  type ModelInfo,
  type ModelListData,
  type UpdateModelRequest,
} from "../lib/api/websocket"

interface ModelsPanelProps {
  onClose: () => void
}

export function ModelsPanel({ onClose }: ModelsPanelProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addingModel, setAddingModel] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelInfo | null>(null)

  const fetchModels = useCallback(async () => {
    try {
      const ws = getWebSocketInstance()
      const resp = await ws.getModelList()
      if (resp.data) {
        const data = resp.data as ModelListData
        setModels(data.models.sort((a, b) => {
          if (a.is_default && !b.is_default) return -1
          if (!a.is_default && b.is_default) return 1
          return a.model_name.localeCompare(b.model_name)
        }))
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const handleSetDefault = async (model: ModelInfo) => {
    if (model.is_default) return
    try {
      const ws = getWebSocketInstance()
      await ws.setDefaultModel(model.model_name)
      await fetchModels()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set default model")
    }
  }

  const handleDelete = async (modelName: string) => {
    try {
      const ws = getWebSocketInstance()
      await ws.deleteModel(modelName)
      await fetchModels()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete model")
    }
  }

  const handleModelSaved = () => {
    setAddingModel(false)
    setEditingModel(null)
    fetchModels()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-2xl rounded-lg shadow-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">模型管理</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">加载中...</div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-3">
              {models.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  暂无模型，请添加
                </div>
              )}

              {models.map((model) => (
                <div
                  key={model.model_name}
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {model.is_default && (
                        <span className="text-yellow-500" title="默认模型">⭐</span>
                      )}
                      <div>
                        <div className="font-medium">{model.model_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {model.model}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingModel(model)}
                        className="rounded px-3 py-1 text-sm bg-muted hover:bg-muted/80 transition-colors"
                      >
                        编辑
                      </button>
                      {!model.is_default && (
                        <button
                          onClick={() => handleSetDefault(model)}
                          className="rounded px-3 py-1 text-sm bg-muted hover:bg-muted/80 transition-colors"
                        >
                          设为默认
                        </button>
                      )}
                      {!model.is_virtual && (
                        <button
                          onClick={() => handleDelete(model.model_name)}
                          className="rounded px-3 py-1 text-sm bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {model.api_base && <span>API: {model.api_base}</span>}
                    {model.rpm && <span>RPM: {model.rpm}</span>}
                    {model.enabled ? (
                      <span className="text-green-600">已启用</span>
                    ) : (
                      <span className="text-muted-foreground">已停用</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3 flex justify-between">
          <button
            onClick={() => setAddingModel(true)}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            添加模型
          </button>
          <button
            onClick={onClose}
            className="rounded bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 transition-colors"
          >
            关闭
          </button>
        </div>

        {addingModel && (
          <AddModelDialog
            onClose={() => setAddingModel(false)}
            onSaved={handleModelSaved}
            existingNames={models.map((m) => m.model_name)}
          />
        )}

        {editingModel && (
          <EditModelDialog
            model={editingModel}
            onClose={() => setEditingModel(null)}
            onSaved={handleModelSaved}
          />
        )}
      </div>
    </div>
  )
}

interface AddModelDialogProps {
  onClose: () => void
  onSaved: () => void
  existingNames: string[]
}

function AddModelDialog({ onClose, onSaved, existingNames }: AddModelDialogProps) {
  const [formData, setFormData] = useState({
    model_name: "",
    model: "",
    api_base: "",
    api_key: "",
    proxy: "",
    rpm: 12,
    thinking_level: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!formData.model_name || !formData.model) {
      setError("模型名称和模型标识不能为空")
      return
    }
    if (existingNames.includes(formData.model_name)) {
      setError("模型名称已存在")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const ws = getWebSocketInstance()
      await ws.addModel({
        model_name: formData.model_name,
        model: formData.model,
        api_base: formData.api_base || undefined,
        api_key: formData.api_key || undefined,
        proxy: formData.proxy || undefined,
        rpm: formData.rpm || undefined,
        thinking_level: formData.thinking_level || undefined,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-md rounded-lg shadow-lg">
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold">添加模型</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">模型名称 *</label>
            <input
              type="text"
              value={formData.model_name}
              onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
              placeholder="如：GPT-4o"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">模型标识 *</label>
            <input
              type="text"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              placeholder="如：openai/gpt-4o"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">API 地址</label>
            <input
              type="text"
              value={formData.api_base}
              onChange={(e) => setFormData({ ...formData, api_base: e.target.value })}
              placeholder="如：https://api.openai.com/v1"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              placeholder="sk-..."
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">代理地址</label>
            <input
              type="text"
              value={formData.proxy}
              onChange={(e) => setFormData({ ...formData, proxy: e.target.value })}
              placeholder="如：http://127.0.0.1:7890"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Thinking Level</label>
            <input
              type="text"
              value={formData.thinking_level}
              onChange={(e) =>
                setFormData({ ...formData, thinking_level: e.target.value })
              }
              placeholder="如：high"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">RPM (每分钟请求数)</label>
            <input
              type="number"
              value={formData.rpm}
              onChange={(e) => setFormData({ ...formData, rpm: parseInt(e.target.value) || 12 })}
              min={1}
              max={10000}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "添加中..." : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface EditModelDialogProps {
  model: ModelInfo
  onClose: () => void
  onSaved: () => void
}

interface EditModelFormState {
  api_base: string
  api_key: string
  proxy: string
  rpm: string
  thinking_level: string
}

function buildModelUpdatePayload(
  modelName: string,
  formData: EditModelFormState,
): UpdateModelRequest {
  const payload: UpdateModelRequest = {
    model_name: modelName,
    api_base: formData.api_base,
    proxy: formData.proxy,
    thinking_level: formData.thinking_level,
  }

  const trimmedAPIKey = formData.api_key.trim()
  if (trimmedAPIKey !== "") {
    payload.api_key = trimmedAPIKey
  }

  const trimmedRPM = formData.rpm.trim()
  if (trimmedRPM !== "") {
    const rpm = Number.parseInt(trimmedRPM, 10)
    if (!Number.isNaN(rpm)) {
      payload.rpm = rpm
    }
  }

  return payload
}

function EditModelDialog({ model, onClose, onSaved }: EditModelDialogProps) {
  const [formData, setFormData] = useState<EditModelFormState>({
    api_base: model.api_base || "",
    api_key: "",
    proxy: model.proxy || "",
    rpm: model.rpm ? String(model.rpm) : "",
    thinking_level: model.thinking_level || "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRPMChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    if (nextValue === "" || /^\d+$/.test(nextValue)) {
      setFormData({ ...formData, rpm: nextValue })
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    setSaving(true)
    setError(null)
    try {
      const ws = getWebSocketInstance()
      await ws.updateModel(buildModelUpdatePayload(model.model_name, formData))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-md rounded-lg shadow-lg">
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold">编辑模型: {model.model_name}</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="rounded bg-muted px-3 py-2 text-sm">
            <div className="text-muted-foreground">模型标识</div>
            <div>{model.model}</div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">API 地址</label>
            <input
              type="text"
              value={formData.api_base}
              onChange={(e) => setFormData({ ...formData, api_base: e.target.value })}
              placeholder="如：https://api.openai.com/v1"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">API Key (留空则不修改)</label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              placeholder="sk-..."
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">代理地址</label>
            <input
              type="text"
              value={formData.proxy}
              onChange={(e) => setFormData({ ...formData, proxy: e.target.value })}
              placeholder="如：http://127.0.0.1:7890"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Thinking Level</label>
            <input
              type="text"
              value={formData.thinking_level}
              onChange={(e) =>
                setFormData({ ...formData, thinking_level: e.target.value })
              }
              placeholder="如：high"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">RPM (每分钟请求数)</label>
            <input
              type="number"
              value={formData.rpm}
              onChange={handleRPMChange}
              min={0}
              max={10000}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
