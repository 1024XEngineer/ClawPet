const LOCAL_DEFAULT_ORIGIN = 'http://127.0.0.1:18790'
const DIRECT_GATEWAY_ENV_ORIGIN = process.env.NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL || ''
const LOCAL_DIRECT_GATEWAY_ORIGIN = 'http://127.0.0.1:18790'
const DIRECT_GATEWAY_CACHE_KEY = 'petclaw.directGatewayBaseUrl'
export const DIRECT_PET_TOKEN_PATH = '/pet/token'
export const DIRECT_PET_WS_PATH = '/pet/ws'
export const DIRECT_PICO_TOKEN_PATH = '/pico/token'
export const DIRECT_PICO_WS_PATH = '/pico/ws'

export const API_BASE_URL = process.env.NEXT_PUBLIC_PICOCLAW_API_URL || ''
export const WS_BASE_URL = process.env.NEXT_PUBLIC_PICOCLAW_WS_URL || ''
export const WSS_BASE_URL = process.env.NEXT_PUBLIC_PICOCLAW_WSS_URL || ''
export const LAUNCHER_TOKEN = process.env.NEXT_PUBLIC_PICOCLAW_LAUNCHER_TOKEN || ''
export const USE_CREDENTIALS = process.env.NEXT_PUBLIC_PICOCLAW_USE_CREDENTIALS !== 'false'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeBaseUrl(value: string): string {
  return trimTrailingSlash(value.trim())
}

function sanitizeDirectGatewayBaseUrl(value: string): string {
  const normalized = normalizeBaseUrl(value)
  if (!normalized) {
    return ''
  }

  try {
    new URL(normalized)
  } catch {
    return ''
  }
  return normalized
}

function isLocalDevPage(): boolean {
  if (typeof window === 'undefined' || !window.location) {
    return false
  }
  const host = window.location.hostname
  const port = window.location.port
  const isLocalHost = host === '127.0.0.1' || host === 'localhost'
  return isLocalHost && (port === '3000' || port === '3001')
}

export function isDirectGatewayEnabled(): boolean {
  const raw = DIRECT_GATEWAY_ENV_ORIGIN.trim().toLowerCase()
  if (!raw) {
    return true
  }
  return raw !== 'false' && raw !== 'off' && raw !== 'disabled'
}

export function getApiBaseUrl(): string {
  if (API_BASE_URL) {
    return API_BASE_URL
  }

  if (typeof window !== 'undefined') {
    const electronApiBase = window.electronAPI?.getApiBaseUrl?.()
    if (electronApiBase && electronApiBase.trim()) {
      return electronApiBase.trim()
    }

    const electronBackendBase = window.electronAPI?.getBackendBaseUrl?.()
    if (electronBackendBase && electronBackendBase.trim()) {
      return electronBackendBase.trim()
    }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const port = window.location.port
    if (port === '3000' || port === '3001') {
      return LOCAL_DEFAULT_ORIGIN
    }
    return window.location.origin
  }

  return LOCAL_DEFAULT_ORIGIN
}

export function getDirectGatewayBaseUrl(): string {
  if (!isDirectGatewayEnabled()) {
    return ''
  }

  const directGatewayEnv = DIRECT_GATEWAY_ENV_ORIGIN.trim()
  if (directGatewayEnv) {
    return sanitizeDirectGatewayBaseUrl(directGatewayEnv)
  }

  // Local dev should always target the fixed local gateway endpoint.
  // This avoids stale cached URLs after launcher/gateway restarts.
  if (isLocalDevPage()) {
    return LOCAL_DIRECT_GATEWAY_ORIGIN
  }

  if (typeof window !== 'undefined') {
    try {
      const cached = window.sessionStorage.getItem(DIRECT_GATEWAY_CACHE_KEY)
      if (cached && cached.trim()) {
        return sanitizeDirectGatewayBaseUrl(cached)
      }
    } catch {
    }

    try {
      const cached = window.localStorage.getItem(DIRECT_GATEWAY_CACHE_KEY)
      if (cached && cached.trim()) {
        return sanitizeDirectGatewayBaseUrl(cached)
      }
    } catch {
    }
  }
  return LOCAL_DIRECT_GATEWAY_ORIGIN
}

export function cacheDirectGatewayBaseUrl(value?: string | null): void {
  if (!isDirectGatewayEnabled()) {
    return
  }

  const normalized = typeof value === 'string'
    ? sanitizeDirectGatewayBaseUrl(value)
    : ''
  if (!normalized) {
    return
  }

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(DIRECT_GATEWAY_CACHE_KEY, normalized)
  } catch {
  }

  try {
    window.localStorage.setItem(DIRECT_GATEWAY_CACHE_KEY, normalized)
  } catch {
  }
}

export function getWsBaseUrl(): string {
  if (WS_BASE_URL) {
    return WS_BASE_URL
  }

  const apiBase = getApiBaseUrl()
  return apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

export function getWssBaseUrl(): string {
  if (WSS_BASE_URL) {
    return WSS_BASE_URL
  }
  return getWsBaseUrl().replace(/^ws:/, 'wss:')
}

export function resolveLauncherToken(): string {
  if (LAUNCHER_TOKEN) {
    return LAUNCHER_TOKEN
  }

  if (typeof window !== 'undefined') {
    const electronToken = window.electronAPI?.getLauncherToken?.()
    if (electronToken && electronToken.trim()) {
      return electronToken.trim()
    }

    const token = new URLSearchParams(window.location.search).get('token')
    if (token && token.trim()) {
      const clean = token.trim()
      try {
        window.sessionStorage.setItem('petclaw.launcher.token', clean)
      } catch {
      }
      return clean
    }

    try {
      const cached = window.sessionStorage.getItem('petclaw.launcher.token')
      if (cached && cached.trim()) {
        return cached.trim()
      }
    } catch {
    }
  }

  return ''
}

export function withLauncherAuthHeader(headers: HeadersInit = {}): HeadersInit {
  const token = resolveLauncherToken()
  if (!token) {
    return headers
  }
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}

function isCrossOriginRequest(input: string): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const target = new URL(input, window.location.href)
    return target.origin !== window.location.origin
  } catch {
    return false
  }
}

export function getAuthRequestCredentials(input: string): RequestCredentials {
  if (!USE_CREDENTIALS) {
    return 'omit'
  }
  if (resolveLauncherToken() && isCrossOriginRequest(input)) {
    return 'omit'
  }
  return 'include'
}

export function withLauncherAuthRequest(input: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: withLauncherAuthHeader(init.headers),
    credentials: init.credentials === 'omit' ? 'omit' : getAuthRequestCredentials(input),
  }
}

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    STATUS: '/api/auth/status',
  },
  GATEWAY: {
    STATUS: '/api/gateway/status',
    START: '/api/gateway/start',
    STOP: '/api/gateway/stop',
    RESTART: '/api/gateway/restart',
    LOGS: '/api/gateway/logs',
  },
  MODELS: {
    LIST: '/api/models',
    DEFAULT: '/api/models/default',
    CREATE: '/api/models',
    UPDATE: (id: string) => `/api/models/${id}`,
    DELETE: (id: string) => `/api/models/${id}`,
  },
  CREDENTIALS: {
    LIST: '/api/credentials',
    CREATE: '/api/credentials',
    UPDATE: (provider: string) => `/api/credentials/${provider}`,
    DELETE: (provider: string) => `/api/credentials/${provider}`,
  },
  CHANNELS: {
    LIST: '/api/channels',
    CATALOG: '/api/channels/catalog',
    STATUS: (id: string) => `/api/channels/${id}/status`,
    ENABLE: (id: string) => `/api/channels/${id}/enable`,
    DISABLE: (id: string) => `/api/channels/${id}/disable`,
    CONFIG: (id: string) => `/api/channels/${id}/config`,
  },
  SKILLS: {
    LIST: '/api/skills',
    DETAIL: (name: string) => `/api/skills/${name}`,
    SEARCH: '/api/skills/search',
    INSTALL: '/api/skills/install',
    IMPORT: '/api/skills/import',
    DELETE: (name: string) => `/api/skills/${name}`,
  },
  TOOLS: {
    LIST: '/api/agent/tools',
    TOGGLE: (id: string) => `/api/agent/tools/${id}/toggle`,
  },
  CRON: {
    LIST: '/api/cron',
    CREATE: '/api/cron',
    UPDATE: (id: string) => `/api/cron/${id}`,
    DELETE: (id: string) => `/api/cron/${id}`,
    TOGGLE: (id: string) => `/api/cron/${id}/toggle`,
  },
  CONFIG: {
    GET: '/api/config',
    UPDATE: '/api/config',
    RAW: '/api/config/raw',
  },
  LOGS: {
    GET: '/api/logs',
    CLEAR: '/api/logs/clear',
  },
  CHAT: {
    WS: '/pet/ws',
    WS_LEGACY: '/pico/ws',
  },
  PET: {
    TOKEN: '/api/pet/token',
    SETUP: '/api/pet/setup',
    ONBOARDING: '/api/pet/onboarding',
  },
  PICO: {
    TOKEN: '/api/pico/token',
    SETUP: '/api/pico/setup',
    ONBOARDING: '/api/pico/onboarding',
  },
} as const
