const DEFAULT_API_BASE = 'http://127.0.0.1:18790'

export const API_ENDPOINTS = {
  AUTH: {
    STATUS: '/api/auth/status',
  },
  GATEWAY: {
    STATUS: '/api/gateway/status',
  },
  PET: {
    TOKEN: '/api/pet/token',
    SETUP: '/api/pet/setup',
  },
  PICO: {
    TOKEN: '/api/pico/token',
    SETUP: '/api/pico/setup',
  },
} as const

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getApiBaseUrl(): string {
  const fromElectron = window.electronAPI?.getBackendBaseUrl?.()
  if (fromElectron && fromElectron.trim()) {
    return trimTrailingSlash(fromElectron.trim())
  }

  return DEFAULT_API_BASE
}

export function resolveLauncherToken(): string {
  const fromElectron = window.electronAPI?.getLauncherToken?.()
  if (fromElectron && fromElectron.trim()) {
    return fromElectron.trim()
  }

  const fromQuery = new URLSearchParams(window.location.search).get('token')
  if (fromQuery && fromQuery.trim()) {
    return fromQuery.trim()
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
  try {
    const target = new URL(input, window.location.href)
    return target.origin !== window.location.origin
  } catch {
    return false
  }
}

export function getAuthRequestCredentials(input: string): RequestCredentials {
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

export async function fetchWithAuthRetry(input: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
  const first = await fetch(input, withLauncherAuthRequest(input, init))
  if (!allowRetry || first.status !== 401) {
    return first
  }

  return fetch(input, withLauncherAuthRequest(input, init))
}
