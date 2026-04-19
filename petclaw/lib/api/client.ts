import {
  API_ENDPOINTS,
  cacheDirectGatewayBaseUrl,
  getApiBaseUrl,
  getDirectGatewayBaseUrl,
  getAuthRequestCredentials,
  withLauncherAuthHeader,
} from './config'
import { fetchWithAuthRetry } from './auth-bootstrap'

// API 请求错误类
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// 基础请求函数
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${getApiBaseUrl()}${endpoint}`
  
  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  }

  const config: RequestInit = {
    ...options,
    headers: withLauncherAuthHeader({
      ...defaultHeaders,
      ...options.headers,
    }),
    credentials: getAuthRequestCredentials(url),
  }

  const shouldRetryAuth = !endpoint.startsWith('/api/auth/')
  const response = await fetchWithAuthRetry(url, config, shouldRetryAuth)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      errorData.message || `HTTP error ${response.status}`,
      errorData
    )
  }

  // 处理空响应
  const text = await response.text()
  if (!text) return {} as T
  
  return JSON.parse(text)
}

async function fetchDirectGatewayHealth(baseUrl?: string): Promise<{ uptime?: string } | null> {
  const targetBase = (baseUrl || getDirectGatewayBaseUrl()).trim()
  if (!targetBase) {
    return null
  }

  try {
    const res = await fetch(`${targetBase}/health`)
    if (!res.ok) {
      return null
    }
    return (await res.json()) as { uptime?: string }
  } catch {
    return null
  }
}

export interface GatewayStatus {
  running: boolean
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting'
  pid?: number
  restartRequired: boolean
  startAllowed?: boolean
  startReason?: string
  uptime?: string
}

// 认证 API
export const authApi = {
  login: (token: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.AUTH.LOGIN, {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  logout: () =>
    request<{ success: boolean }>(API_ENDPOINTS.AUTH.LOGOUT, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  status: () =>
    request<{ authenticated: boolean; expires?: string }>(API_ENDPOINTS.AUTH.STATUS),
}

// 网关 API
export const gatewayApi = {
  status: async (): Promise<GatewayStatus> => {
    let raw:
      | {
          gateway_status?: 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'error'
          pid?: number
          gateway_base_url?: string
          gateway_restart_required?: boolean
          gateway_start_allowed?: boolean
          gateway_start_reason?: string
        }
      | null = null

    try {
      raw = await request<{
        gateway_status?: 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'error'
        pid?: number
        gateway_base_url?: string
        gateway_restart_required?: boolean
        gateway_start_allowed?: boolean
        gateway_start_reason?: string
      }>(API_ENDPOINTS.GATEWAY.STATUS)
    } catch (error) {
      const direct = await fetchDirectGatewayHealth()
      if (!direct) {
        throw error
      }
      return {
        running: true,
        state: 'running' as const,
        pid: undefined,
        restartRequired: false,
        startAllowed: false,
        startReason: 'direct gateway fallback',
        uptime: direct.uptime,
      }
    }

    if (raw.gateway_base_url) {
      cacheDirectGatewayBaseUrl(raw.gateway_base_url)
    }

    const direct = await fetchDirectGatewayHealth(raw.gateway_base_url)
    if (direct && raw.gateway_status !== 'running') {
      return {
        running: true,
        state: 'running' as const,
        pid: raw.pid,
        restartRequired: Boolean(raw.gateway_restart_required),
        startAllowed: raw.gateway_start_allowed,
        startReason: raw.gateway_start_reason || 'direct gateway fallback',
        uptime: direct.uptime,
      }
    }

    const state = raw.gateway_status === 'error' ? 'stopped' : (raw.gateway_status || 'stopped')
    return {
      running: state === 'running',
      state,
      pid: raw.pid,
      restartRequired: Boolean(raw.gateway_restart_required),
      startAllowed: raw.gateway_start_allowed,
      startReason: raw.gateway_start_reason,
      uptime: direct?.uptime,
    }
  },

  start: () =>
    request<{ success: boolean }>(API_ENDPOINTS.GATEWAY.START, { method: 'POST' }),

  stop: () =>
    request<{ success: boolean }>(API_ENDPOINTS.GATEWAY.STOP, { method: 'POST' }),

  restart: () =>
    request<{ success: boolean }>(API_ENDPOINTS.GATEWAY.RESTART, { method: 'POST' }),

  logs: () =>
    request<{ logs: string[] }>(API_ENDPOINTS.GATEWAY.LOGS),
}

// 模型 API
export interface Model {
  id: string
  name: string
  provider: string
  model: string
  isDefault: boolean
  hasCredentials: boolean
}

export const modelsApi = {
  list: () => request<{ models: Model[] }>(API_ENDPOINTS.MODELS.LIST),

  getDefault: () => request<{ model: Model | null }>(API_ENDPOINTS.MODELS.DEFAULT),

  setDefault: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.MODELS.DEFAULT, {
      method: 'POST',
      body: JSON.stringify({ model_name: id }),
    }),

  create: (model: Omit<Model, 'id' | 'isDefault' | 'hasCredentials'>) =>
    request<{ model: Model }>(API_ENDPOINTS.MODELS.CREATE, {
      method: 'POST',
      body: JSON.stringify(model),
    }),

  update: (id: string, model: Partial<Model>) =>
    request<{ model: Model }>(API_ENDPOINTS.MODELS.UPDATE(id), {
      method: 'PUT',
      body: JSON.stringify(model),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.MODELS.DELETE(id), {
      method: 'DELETE',
    }),
}

// 渠道 API
export interface Channel {
  id: string
  type: string
  name: string
  enabled: boolean
  connected: boolean
  config: Record<string, unknown>
}

export const channelsApi = {
  list: () => request<{ channels: Channel[] }>(API_ENDPOINTS.CHANNELS.LIST),

  catalog: () =>
    request<{
      catalog: Array<{
        type: string
        name: string
        description: string
        configSchema: Record<string, unknown>
      }>
    }>(API_ENDPOINTS.CHANNELS.CATALOG),

  status: (id: string) =>
    request<{ connected: boolean; error?: string }>(API_ENDPOINTS.CHANNELS.STATUS(id)),

  enable: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.CHANNELS.ENABLE(id), { method: 'POST' }),

  disable: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.CHANNELS.DISABLE(id), { method: 'POST' }),

  updateConfig: (id: string, config: Record<string, unknown>) =>
    request<{ success: boolean }>(API_ENDPOINTS.CHANNELS.CONFIG(id), {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
}

// 技能 API
export interface Skill {
  id: string
  name: string
  description: string
  source: 'builtin' | 'global' | 'workspace'
  category?: string
  enabled: boolean
}

export const skillsApi = {
  list: () => request<{ skills: Skill[] }>(API_ENDPOINTS.SKILLS.LIST),

  builtin: () => request<{ skills: Skill[] }>(API_ENDPOINTS.SKILLS.BUILTIN),

  global: () => request<{ skills: Skill[] }>(API_ENDPOINTS.SKILLS.GLOBAL),

  workspace: () => request<{ skills: Skill[] }>(API_ENDPOINTS.SKILLS.WORKSPACE),

  import: (markdown: string) =>
    request<{ skill: Skill }>(API_ENDPOINTS.SKILLS.IMPORT, {
      method: 'POST',
      body: JSON.stringify({ markdown }),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.SKILLS.DELETE(id), {
      method: 'DELETE',
    }),
}

// 工具 API
export interface Tool {
  id: string
  name: string
  description: string
  enabled: boolean
  source: string
}

export const toolsApi = {
  list: () => request<{ tools: Tool[] }>(API_ENDPOINTS.TOOLS.LIST),

  toggle: (id: string, enabled: boolean) =>
    request<{ success: boolean }>(API_ENDPOINTS.TOOLS.TOGGLE(id), {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
}

// 定时任务 API
export interface CronJob {
  id: string
  name: string
  description: string
  schedule: string
  skill?: string
  command?: string
  enabled: boolean
  lastRun?: string
  nextRun?: string
}

export const cronApi = {
  list: () => request<{ jobs: CronJob[] }>(API_ENDPOINTS.CRON.LIST),

  create: (job: Omit<CronJob, 'id' | 'lastRun' | 'nextRun'>) =>
    request<{ job: CronJob }>(API_ENDPOINTS.CRON.CREATE, {
      method: 'POST',
      body: JSON.stringify(job),
    }),

  update: (id: string, job: Partial<CronJob>) =>
    request<{ job: CronJob }>(API_ENDPOINTS.CRON.UPDATE(id), {
      method: 'PUT',
      body: JSON.stringify(job),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.CRON.DELETE(id), {
      method: 'DELETE',
    }),

  toggle: (id: string, enabled: boolean) =>
    request<{ success: boolean }>(API_ENDPOINTS.CRON.TOGGLE(id), {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
}

// 配置 API
export interface Config {
  agent?: {
    defaultModel?: string
    systemPrompt?: string
  }
  exec?: {
    enabled?: boolean
    allowedCommands?: string[]
  }
  cron?: {
    enabled?: boolean
  }
  launcher?: {
    port?: number
    publicAccess?: boolean
    allowedCidrs?: string[]
  }
}

export const configApi = {
  get: () => request<{ config: Config }>(API_ENDPOINTS.CONFIG.GET),

  update: (config: Partial<Config>) =>
    request<{ success: boolean }>(API_ENDPOINTS.CONFIG.UPDATE, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  getRaw: () => request<{ json: string }>(API_ENDPOINTS.CONFIG.RAW),

  updateRaw: (json: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.CONFIG.RAW, {
      method: 'PUT',
      body: JSON.stringify({ json }),
    }),
}

// 日志 API
export const logsApi = {
  get: () => request<{ logs: string[] }>(API_ENDPOINTS.LOGS.GET),

  clear: () =>
    request<{ success: boolean }>(API_ENDPOINTS.LOGS.CLEAR, { method: 'POST' }),
}
