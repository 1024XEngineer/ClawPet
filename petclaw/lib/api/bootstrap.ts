import {
  API_ENDPOINTS,
  DIRECT_PET_TOKEN_PATH,
  getApiBaseUrl,
  getDirectGatewayBaseUrl,
  isDirectGatewayEnabled,
  withLauncherAuthRequest,
} from './config'
import { ensureLauncherAuthSession, fetchWithAuthRetry } from './auth-bootstrap'

interface GatewayStatusResponse {
  gateway_status?: string
  gateway_start_allowed?: boolean
  gateway_start_reason?: string
}

interface TokenStatusResponse {
  enabled?: boolean
  ws_url?: string
}

interface ModelListResponse {
  default_model?: string
  models?: Array<{
    index?: number
    model_name?: string
    model?: string
    enabled?: boolean
    is_virtual?: boolean
  }>
}

export interface BackendBootstrapResult {
  ok: boolean
  reason?: string
}

const ONE_CLICK_MODEL_NAME = 'petclaw-default'
const ONE_CLICK_MODEL_ID = 'openai/gpt-4o-mini'

function parseDefaultModelNameFromReason(reason?: string): string {
  if (!reason) return ''
  const matched = reason.match(/default model\s+"([^"]+)"/i)
  return matched?.[1]?.trim() || ''
}

function readDraftApiKey(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const key = window.localStorage.getItem('petclaw.apiKeyDraft')
    return key?.trim() || ''
  } catch {
    return ''
  }
}

async function getGatewayStatus(): Promise<GatewayStatusResponse> {
  const res = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.GATEWAY.STATUS}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`gateway status failed: ${res.status}`)
  }
  return (await res.json()) as GatewayStatusResponse
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

async function isDirectPetChannelReady(): Promise<boolean> {
  if (!isDirectGatewayEnabled()) {
    return false
  }

  const directBase = getDirectGatewayBaseUrl()
  if (!directBase) {
    return false
  }

  try {
    const res = await fetch(`${directBase}${DIRECT_PET_TOKEN_PATH}`)
    if (!res.ok) {
      return false
    }
    const data = (await res.json()) as { enabled?: boolean; ws_url?: string }
    return Boolean(data.enabled && data.ws_url)
  } catch {
    return false
  }
}

async function isDirectGatewayReady(): Promise<boolean> {
  if (!(await isDirectGatewayHealthy())) {
    return false
  }
  return isDirectPetChannelReady()
}

async function startGateway(): Promise<void> {
  const res = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.GATEWAY.START}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`gateway start failed: ${res.status}${text ? ` ${text}` : ''}`)
  }
}

async function waitGatewayRunning(maxAttempts = 12, delayMs = 800): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getGatewayStatus()
    if (status.gateway_status === 'running') {
      return true
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }
  return false
}

async function isLauncherTokenReady(tokenPath: string): Promise<boolean> {
  const url = `${getApiBaseUrl()}${tokenPath}`
  const res = await fetch(url, withLauncherAuthRequest(url, { method: 'GET' }))
  if (!res.ok) {
    return false
  }
  const data = (await res.json()) as TokenStatusResponse
  return Boolean(data.enabled && data.ws_url)
}

async function ensureWsProxyReady(): Promise<boolean> {
  return isLauncherTokenReady(API_ENDPOINTS.PET.TOKEN).catch(() => false)
}

async function ensureChannelSetup(): Promise<void> {
  const setupRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.PET.SETUP}`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!setupRes.ok) {
    throw new Error(`channel setup failed: ${setupRes.status}`)
  }
}

async function ensureDefaultModelIfNeeded(startReason?: string): Promise<void> {
  if (!startReason) {
    return
  }

  const needsModelFix =
    startReason.includes('no default model configured') ||
    startReason.includes('default model')

  if (!needsModelFix) {
    return
  }

  const listRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.MODELS.LIST}`, {
    credentials: 'include',
  })
  if (!listRes.ok) {
    throw new Error(`list models failed: ${listRes.status}`)
  }

  const listData = (await listRes.json()) as ModelListResponse

  const defaultModelName = (listData.default_model || parseDefaultModelNameFromReason(startReason)).trim()

  const apiKey = readDraftApiKey()
  const defaultHasNoCreds = startReason.includes('has no credentials configured')
  if (defaultHasNoCreds && defaultModelName && apiKey) {
    const target = listData.models?.find((m) => m.model_name === defaultModelName)
    if (target?.index !== undefined && target.model_name && target.model) {
      const patchRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.MODELS.UPDATE(String(target.index))}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          model_name: target.model_name,
          model: target.model,
          api_key: apiKey,
          enabled: target.enabled ?? true,
        }),
      })

      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => '')
        throw new Error(`patch default model credentials failed: ${patchRes.status}${text ? ` ${text}` : ''}`)
      }
      return
    }
  }

  if (listData.default_model) {
    return
  }

  const existingCandidate = listData.models?.find((m) => m.model_name && !m.is_virtual)?.model_name
  if (existingCandidate) {
    const setDefaultExistingRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.MODELS.DEFAULT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        model_name: existingCandidate,
      }),
    })

    if (setDefaultExistingRes.ok) {
      return
    }
  }

  if (!apiKey) {
    throw new Error('no default model configured and API key missing')
  }

  const hasOneClickModel = Boolean(listData.models?.some((m) => m.model_name === ONE_CLICK_MODEL_NAME))

  if (!hasOneClickModel) {
    const createRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.MODELS.CREATE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        model_name: ONE_CLICK_MODEL_NAME,
        model: ONE_CLICK_MODEL_ID,
        api_key: apiKey,
        enabled: true,
      }),
    })

    if (!createRes.ok && createRes.status !== 409) {
      const text = await createRes.text().catch(() => '')
      throw new Error(`create default model failed: ${createRes.status}${text ? ` ${text}` : ''}`)
    }
  }

  const setDefaultRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.MODELS.DEFAULT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      model_name: ONE_CLICK_MODEL_NAME,
    }),
  })

  if (!setDefaultRes.ok) {
    const text = await setDefaultRes.text().catch(() => '')
    throw new Error(`set default model failed: ${setDefaultRes.status}${text ? ` ${text}` : ''}`)
  }
}

export async function ensureBackendReadyForChat(): Promise<BackendBootstrapResult> {
  if (await isDirectGatewayReady()) {
    return { ok: true }
  }

  const authed = await ensureLauncherAuthSession()
  if (!authed) {
    return { ok: false, reason: 'dashboard auth missing' }
  }

  const status = await getGatewayStatus()
  if (status.gateway_status === 'running') {
    if (await isDirectGatewayReady()) {
      return { ok: true }
    }
    const wsReady = await ensureWsProxyReady()
    return wsReady
      ? { ok: true }
      : { ok: false, reason: 'websocket proxy unavailable (gateway not ready)' }
  }

  if (await isDirectGatewayReady()) {
    return { ok: true }
  }

  await ensureDefaultModelIfNeeded(status.gateway_start_reason)
  await ensureChannelSetup()
  await startGateway()

  const running = await waitGatewayRunning()
  if (!running) {
    const latest = await getGatewayStatus()
    return {
      ok: false,
      reason: latest.gateway_start_reason || 'gateway not running after bootstrap',
    }
  }

  if (await isDirectGatewayReady()) {
    return { ok: true }
  }

  const wsReady = await ensureWsProxyReady()
  if (!wsReady) {
    return {
      ok: false,
      reason: 'websocket proxy unavailable (gateway not ready)',
    }
  }

  return { ok: true }
}
