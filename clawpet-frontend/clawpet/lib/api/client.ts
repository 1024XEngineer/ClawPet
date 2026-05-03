import {
  API_ENDPOINTS,
  cacheDirectGatewayBaseUrl,
  getApiBaseUrl,
  getDirectGatewayBaseUrl,
  getAuthRequestCredentials,
  isDirectGatewayEnabled,
  withLauncherAuthHeader,
} from './config'
import { fetchWithAuthRetry } from './auth-bootstrap'
import { getWebSocketInstance } from './websocket'

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

async function requestWithBase<T>(
  baseUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${baseUrl}${endpoint}`

  const method = (options.method || 'GET').toUpperCase()
  const hasBody = options.body !== undefined && options.body !== null
  const isFormDataBody =
    typeof FormData !== 'undefined' && options.body instanceof FormData
  const shouldSetJsonContentType = !isFormDataBody && hasBody && method !== 'GET' && method !== 'HEAD'
  const defaultHeaders: HeadersInit = shouldSetJsonContentType
    ? { 'Content-Type': 'application/json' }
    : {}

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
  const text = await response.text()

  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
        ? ((data as { message: string }).message || `HTTP error ${response.status}`)
        : typeof data === 'string' && data.trim()
          ? data.trim()
          : `HTTP error ${response.status}`

    throw new ApiError(response.status, message, data)
  }

  // 处理空响应
  if (!text) return {} as T
  if (typeof data === 'string') {
    throw new ApiError(response.status, 'Expected JSON response', data)
  }

  return data as T
}

// 基础请求函数
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return requestWithBase<T>(getApiBaseUrl(), endpoint, options)
}

function getSkillsRestFallbackBaseUrl(): string {
  const primary = getApiBaseUrl().trim()
  if (!primary) {
    return ''
  }

  try {
    const parsed = new URL(primary)
    const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    if (!isLocal || parsed.port !== '18790') {
      return ''
    }
    parsed.port = '18800'
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

async function requestSkillsWithRestFallback<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    return await request<T>(endpoint, options)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error
    }

    const fallbackBase = getSkillsRestFallbackBaseUrl()
    if (!fallbackBase) {
      throw error
    }

    return requestWithBase<T>(fallbackBase, endpoint, options)
  }
}

async function fetchDirectGatewayHealth(baseUrl?: string): Promise<{ uptime?: string } | null> {
  if (!isDirectGatewayEnabled()) {
    return null
  }

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

// Gateway management APIs should always go through Launcher (18800),
// not directly to Gateway (18790).
function getLauncherBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const launcherUrl = (window as any).electronAPI?.getLauncherBaseUrl?.()
    if (launcherUrl && launcherUrl.trim()) {
      return launcherUrl.trim()
    }
  }
  // Fallback to default launcher port
  return 'http://127.0.0.1:18800'
}

async function requestToLauncher<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return requestWithBase<T>(getLauncherBaseUrl(), endpoint, options)
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
      // Gateway management APIs must go through Launcher (18800)
      raw = await requestToLauncher<{
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
  name: string
  path: string
  description: string
  source: 'builtin' | 'global' | 'workspace'
  origin_kind?: 'builtin' | 'manual' | 'third_party' | string
  registry_name?: string
  registry_url?: string
  installed_version?: string
  installed_at?: number
}

export interface SkillSearchResult {
  score: number
  slug: string
  display_name: string
  summary: string
  version: string
  registry_name: string
  url?: string
  installed: boolean
  installed_name?: string
}

export interface SkillSearchResponse {
  results: SkillSearchResult[]
  limit: number
  offset: number
  next_offset?: number
  has_more: boolean
}

async function requestSkillAction<T extends Record<string, unknown>>(
  action: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const ws = getWebSocketInstance()
  const response = await ws.requestAction<T>(action, data, 20000)
  if (response.status === 'error') {
    const message =
      String(response.error || (response.data?.error as string) || `Action failed: ${action}`)
    throw new ApiError(502, message, response)
  }
  return (response.data ?? {}) as T
}

function normalizeSkillFromWs(raw: {
  name?: string
  path?: string
  description?: string
  source?: string
}): Skill {
  const source =
    raw.source === 'builtin' || raw.source === 'global' || raw.source === 'workspace'
      ? raw.source
      : 'workspace'
  return {
    name: raw.name ?? '',
    path: raw.path ?? '',
    description: raw.description ?? '',
    source,
    origin_kind: source === 'builtin' ? 'builtin' : 'manual',
  }
}

async function fallbackSkillListFromWs(): Promise<{ skills: Skill[] }> {
  const payload = await requestSkillAction<{ skills?: Array<Record<string, unknown>> }>(
    'skill_list',
  )
  const skills = Array.isArray(payload.skills)
    ? payload.skills.map((item) =>
        normalizeSkillFromWs(item as { name?: string; path?: string; description?: string; source?: string }),
      )
    : []
  return { skills }
}

async function fallbackSkillSearchFromWs(
  query: string,
  limit: number,
  offset: number,
): Promise<SkillSearchResponse> {
  const [searchPayload, listPayload] = await Promise.all([
    requestSkillAction<{ results?: Array<Record<string, unknown>> }>('skill_search', {
      query,
      limit: Math.max(limit + offset, limit),
    }),
    fallbackSkillListFromWs(),
  ])
  const installedByName = new Set(listPayload.skills.map((skill) => skill.name))
  const rawResults = Array.isArray(searchPayload.results) ? searchPayload.results : []
  const page = rawResults.slice(offset, offset + limit)
  const results: SkillSearchResult[] = page.map((item) => {
    const slug = String(item.slug ?? '')
    const installedName = installedByName.has(slug) ? slug : undefined
    return {
      score: Number(item.score ?? 0),
      slug,
      display_name: String(item.display_name ?? slug),
      summary: String(item.summary ?? ''),
      version: String(item.version ?? ''),
      registry_name: String(item.registry_name ?? 'clawhub'),
      installed: Boolean(installedName),
      installed_name: installedName,
    }
  })

  const nextOffset = offset + results.length
  const hasMore = nextOffset < rawResults.length

  return {
    results,
    limit,
    offset,
    next_offset: hasMore ? nextOffset : undefined,
    has_more: hasMore,
  }
}

function isUnknownWsSkillActionError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 502 &&
    /unknown action:\s*skill_/i.test(error.message)
  )
}

export const skillsApi = {
  list: async () => {
    try {
      return await requestSkillsWithRestFallback<{ skills: Skill[] }>(API_ENDPOINTS.SKILLS.LIST)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
        try {
          return await fallbackSkillListFromWs()
        } catch (wsError) {
          if (isUnknownWsSkillActionError(wsError)) {
            throw new ApiError(
              501,
              '当前运行网关不支持 skill_* 接口；请使用 18800 的 /api/skills 或升级网关版本',
              wsError,
            )
          }
          throw wsError
        }
      }
      throw error
    }
  },

  search: async (query: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: String(offset),
    })
    const endpoint = `${API_ENDPOINTS.SKILLS.SEARCH}?${params.toString()}`
    try {
      return await requestSkillsWithRestFallback<SkillSearchResponse>(endpoint)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
        try {
          return await fallbackSkillSearchFromWs(query, limit, offset)
        } catch (wsError) {
          if (isUnknownWsSkillActionError(wsError)) {
            throw new ApiError(
              501,
              '当前运行网关不支持 skill_search；请使用 18800 的 /api/skills/search 或升级网关版本',
              wsError,
            )
          }
          throw wsError
        }
      }
      throw error
    }
  },

  install: async (input: {
    slug: string
    registry: string
    version?: string
    force?: boolean
  }) => {
    try {
      return await requestSkillsWithRestFallback<{ status: string; skill?: Skill }>(
        API_ENDPOINTS.SKILLS.INSTALL,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      )
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 401)) {
        throw error
      }
      try {
        await requestSkillAction<Record<string, unknown>>('skill_install', {
          slug: input.slug,
          registry: input.registry,
          version: input.version,
        })
        const skills = await fallbackSkillListFromWs()
        return {
          status: 'ok',
          skill: skills.skills.find((skill) => skill.name === input.slug),
        }
      } catch (wsError) {
        if (isUnknownWsSkillActionError(wsError)) {
          throw new ApiError(
            501,
            '当前运行网关不支持 skill_install；请使用 18800 的 /api/skills/install 或升级网关版本',
            wsError,
          )
        }
        throw wsError
      }
    }
  },

  import: (file: File) => {
    const formData = new FormData()
    formData.set('file', file)
    return request<Skill>(API_ENDPOINTS.SKILLS.IMPORT, {
      method: 'POST',
      body: formData,
    })
  },

  delete: async (name: string) => {
    try {
      return await requestSkillsWithRestFallback<{ status: string }>(
        API_ENDPOINTS.SKILLS.DELETE(encodeURIComponent(name)),
        {
          method: 'DELETE',
        },
      )
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 401)) {
        throw error
      }
      try {
        await requestSkillAction<Record<string, unknown>>('skill_remove', { name })
        return { status: 'ok' }
      } catch (wsError) {
        if (isUnknownWsSkillActionError(wsError)) {
          throw new ApiError(
            501,
            '当前运行网关不支持 skill_remove；请使用 18800 的 /api/skills/{name} 或升级网关版本',
            wsError,
          )
        }
        throw wsError
      }
    }
  },
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
export type CronScheduleType = 'cron' | 'every' | 'at'

export interface CronJob {
  id: string
  name: string
  description: string
  message: string
  scheduleType: CronScheduleType
  schedule: string
  cronExpr?: string
  everySeconds?: number
  atMs?: number
  command?: string
  enabled: boolean
  channel?: string
  to?: string
  lastRunAtMs?: number
  nextRunAtMs?: number
  lastStatus?: string
  lastError?: string
  createdAtMs?: number
  updatedAtMs?: number
}

export interface CronJobInput {
  name: string
  description: string
  scheduleType: CronScheduleType
  schedule?: string
  cronExpr?: string
  everySeconds?: number
  atMs?: number
  delaySeconds?: number
  command?: string
  enabled?: boolean
  channel?: string
  to?: string
}

export const cronApi = {
  list: () => request<{ jobs: CronJob[] }>(API_ENDPOINTS.CRON.LIST),

  create: (job: CronJobInput) =>
    request<{ job: CronJob }>(API_ENDPOINTS.CRON.CREATE, {
      method: 'POST',
      body: JSON.stringify(job),
    }),

  update: (id: string, job: Partial<CronJobInput>) =>
    request<{ job: CronJob }>(API_ENDPOINTS.CRON.UPDATE(id), {
      method: 'PUT',
      body: JSON.stringify(job),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(API_ENDPOINTS.CRON.DELETE(id), {
      method: 'DELETE',
    }),

  toggle: (id: string, enabled: boolean) =>
    request<{ success: boolean; job: CronJob }>(API_ENDPOINTS.CRON.TOGGLE(id), {
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

export type OnboardingStep = 1 | 2 | 3
export type Chronotype = 'morning' | 'balanced' | 'night'
export type ReminderCadence = 'light' | 'standard' | 'intensive'
export type PressureLevel = 'low' | 'medium' | 'high' | 'critical'

export interface OnboardingPayloadV1 {
  schemaVersion: 1
  onboardingId: string
  step: OnboardingStep
  profile: {
    displayName: string
    role: string
    language: string
  }
  pet: {
    petName: string
    personality: string
    voiceStyle: string
  }
  app: {
    autoConnectOnLaunch: boolean
    enableDesktopBubble: boolean
    openConsoleOnPetClick: boolean
  }
  studentInsights?: {
    learningRhythm: {
      chronotype: Chronotype
      focusWindows: string[]
      quietWindows: string[]
      reminderCadence: ReminderCadence
      summary: string
    }
    pressurePlan: {
      level: PressureLevel
      strategy: string
      reminderIntervalsMinutes: number[]
      toneGuide: string
      templates: {
        soft: string
        normal: string
        strong: string
      }
    }
  }
}

export interface OnboardingStatusData {
  completed: boolean
  completedAt: string | null
  hasDraft: boolean
  step: OnboardingStep | null
  onboardingId: string | null
  schemaVersion: 1 | null
  draftUpdatedAt: string | null
  payload: OnboardingPayloadV1 | null
}

function isOnboardingFallbackError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405)
}

function emptyOnboardingStatus(): OnboardingStatusData {
  return {
    completed: false,
    completedAt: null,
    hasDraft: false,
    step: null,
    onboardingId: null,
    schemaVersion: null,
    draftUpdatedAt: null,
    payload: null,
  }
}

export const onboardingApi = {
  status: async () => {
    try {
      return await request<{ code?: string; data?: OnboardingStatusData } | OnboardingStatusData>(
        API_ENDPOINTS.PET.ONBOARDING,
      )
    } catch (error) {
      if (isOnboardingFallbackError(error)) {
        return emptyOnboardingStatus()
      }
      throw error
    }
  },

  saveDraft: async (payload: OnboardingPayloadV1) => {
    try {
      return await request<{ code?: string; data?: { saved: boolean; draftUpdatedAt?: string } }>(
        API_ENDPOINTS.PET.ONBOARDING,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      )
    } catch (error) {
      if (isOnboardingFallbackError(error)) {
        return {
          code: 'FALLBACK',
          data: {
            saved: true,
          },
        }
      }
      throw error
    }
  },

  complete: async (params: { schemaVersion: 1; onboardingId: string }) => {
    try {
      return await request<{ code?: string; data?: { completed: boolean; completedAt?: string } }>(
        API_ENDPOINTS.PET.ONBOARDING,
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
      )
    } catch (error) {
      if (isOnboardingFallbackError(error)) {
        return {
          code: 'FALLBACK',
          data: {
            completed: true,
            completedAt: new Date().toISOString(),
          },
        }
      }
      throw error
    }
  },

  reset: async (reason = 'manual-rerun') => {
    try {
      return await request<{ code?: string; data?: { completed: boolean; hasDraft: boolean } }>(
        API_ENDPOINTS.PET.ONBOARDING,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        },
      )
    } catch (error) {
      if (isOnboardingFallbackError(error)) {
        return {
          code: 'FALLBACK',
          data: {
            completed: false,
            hasDraft: false,
          },
        }
      }
      throw error
    }
  },
}
