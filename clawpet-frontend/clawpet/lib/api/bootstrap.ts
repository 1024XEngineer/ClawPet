import {
  DIRECT_PET_TOKEN_PATH,
  DIRECT_PICO_TOKEN_PATH,
  getDirectGatewayBaseUrl,
  isDirectGatewayEnabled,
} from './config'

interface TokenStatusResponse {
  enabled?: boolean
  ws_url?: string
}

export interface BackendBootstrapResult {
  ok: boolean
  reason?: string
}

async function isDirectGatewayHealthy(): Promise<boolean> {
  if (!isDirectGatewayEnabled()) {
    return false
  }

  const directBase = getDirectGatewayBaseUrl()
  if (!directBase) {
    return false
  }

  try {
    const res = await fetch(`${directBase}/health`)
    return res.ok
  } catch {
    return false
  }
}

async function isDirectTokenReady(tokenPath: string): Promise<boolean> {
  if (!isDirectGatewayEnabled()) {
    return false
  }

  const directBase = getDirectGatewayBaseUrl()
  if (!directBase) {
    return false
  }

  try {
    const res = await fetch(`${directBase}${tokenPath}`)
    if (!res.ok) {
      return false
    }
    const data = (await res.json()) as TokenStatusResponse
    return Boolean(data.enabled && data.ws_url)
  } catch {
    return false
  }
}

async function isDirectPetChannelReady(): Promise<boolean> {
  const petReady = await isDirectTokenReady(DIRECT_PET_TOKEN_PATH)
  if (petReady) {
    return true
  }
  return isDirectTokenReady(DIRECT_PICO_TOKEN_PATH)
}

export async function ensureBackendReadyForChat(): Promise<BackendBootstrapResult> {
  if (!isDirectGatewayEnabled()) {
    return { ok: false, reason: 'direct gateway disabled' }
  }

  const healthy = await isDirectGatewayHealthy()
  if (!healthy) {
    return { ok: false, reason: 'gateway not reachable' }
  }

  const channelReady = await isDirectPetChannelReady()
  if (!channelReady) {
    return { ok: false, reason: 'pet channel token unavailable' }
  }

  return { ok: true }
}
