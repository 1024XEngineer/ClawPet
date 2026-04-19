const LOCAL_DEFAULT_ORIGIN = 'http://127.0.0.1:18800'
const DIRECT_GATEWAY_ENV_ORIGIN = process.env.NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL || ''
const LOCAL_DIRECT_GATEWAY_ORIGIN = DIRECT_GATEWAY_ENV_ORIGIN || 'http://127.0.0.1:18790'
const DIRECT_GATEWAY_CACHE_KEY = 'petclaw.directGatewayBaseUrl'
export const DIRECT_PET_TOKEN_PATH = '/pet/token'
export const DIRECT_PET_WS_PATH = '/pet/ws'

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

export function getApiBaseUrl(): string {
  if (API_BASE_URL) {
    return API_BASE_URL
  }

  if (typeof window !== 'undefined') {
    const electronApiBase = window.electronAPI?.getBackendBaseUrl?.()
    if (electronApiBase && electronApiBase.trim()) {
      return electronApiBase.trim()
    }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const port = window.location.port
    if (port === '3000' || port === '3001' || port === '5173') {
      return LOCAL_DEFAULT_ORIGIN
    }
    return window.location.origin
  }

  return LOCAL_DEFAULT_ORIGIN
}

export function getDirectGatewayBaseUrl(): string {
  if (DIRECT_GATEWAY_ENV_ORIGIN.trim()) {
    return normalizeBaseUrl(DIRECT_GATEWAY_ENV_ORIGIN)
  }

  if (typeof window !== 'undefined') {
    try {
      const cached = window.sessionStorage.getItem(DIRECT_GATEWAY_CACHE_KEY)
      if (cached && cached.trim()) {
        return normalizeBaseUrl(cached)
      }
    } catch {
    }

    try {
      const cached = window.localStorage.getItem(DIRECT_GATEWAY_CACHE_KEY)
      if (cached && cached.trim()) {
        return normalizeBaseUrl(cached)
      }
    } catch {
    }
  }
  return normalizeBaseUrl(LOCAL_DIRECT_GATEWAY_ORIGIN)
}

export function cacheDirectGatewayBaseUrl(value?: string | null): void {
  const normalized = typeof value === 'string' ? normalizeBaseUrl(value) : ''
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
    LIST: '/api/agent/skills',
    BUILTIN: '/api/agent/skills/builtin',
    GLOBAL: '/api/agent/skills/global',
    WORKSPACE: '/api/agent/skills/workspace',
    IMPORT: '/api/agent/skills/import',
    DELETE: (id: string) => `/api/agent/skills/${id}`,
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
