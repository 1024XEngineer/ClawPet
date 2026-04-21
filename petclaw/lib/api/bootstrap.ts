import {
  API_ENDPOINTS,
  cacheDirectGatewayBaseUrl,
  DIRECT_PICO_TOKEN_PATH,
  DIRECT_PET_TOKEN_PATH,
  getApiBaseUrl,
  getDirectGatewayBaseUrl,
} from './config'
import { ensureLauncherAuthSession, fetchWithAuthRetry } from './auth-bootstrap'

interface GatewayStatusResponse {
  gateway_status?: string
  gateway_base_url?: string
  gateway_start_allowed?: boolean
  gateway_start_reason?: string
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
  const data = (await res.json()) as GatewayStatusResponse
  if (data.gateway_base_url) {
    cacheDirectGatewayBaseUrl(data.gateway_base_url)
  }
  return data
}

async function isDirectGatewayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${getDirectGatewayBaseUrl()}/health`)
    return res.ok
  } catch {
    return false
  }
}

async function isDirectPetChannelReady(): Promise<boolean> {
  try {
    const res = await fetch(`${getDirectGatewayBaseUrl()}${DIRECT_PET_TOKEN_PATH}`)
    if (!res.ok) {
      return false
    }
    const data = (await res.json()) as { enabled?: boolean; ws_url?: string }
    return Boolean(data.enabled && data.ws_url)
  } catch {
    return false
  }
}

async function isDirectPicoChannelReady(): Promise<boolean> {
  try {
    const res = await fetch(`${getDirectGatewayBaseUrl()}${DIRECT_PICO_TOKEN_PATH}`)
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
  if (await isDirectPetChannelReady()) {
    return true
  }
  return isDirectPicoChannelReady()
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

async function isLauncherPetChannelReady(): Promise<boolean> {
  let res = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.PET.TOKEN}`, {
    credentials: 'include',
  })

  if (res.status === 404) {
    res = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.PICO.TOKEN}`, {
      credentials: 'include',
    })
  }

  if (!res.ok) {
    return false
  }

  const data = (await res.json()) as { enabled?: boolean; ws_url?: string }
  return Boolean(data.enabled && data.ws_url)
}

async function ensureChannelSetup(): Promise<void> {
  let setupRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.PET.SETUP}`, {
    method: 'POST',
    credentials: 'include',
  })

  if (setupRes.status === 404) {
    setupRes = await fetchWithAuthRetry(`${getApiBaseUrl()}${API_ENDPOINTS.PICO.SETUP}`, {
      method: 'POST',
      credentials: 'include',
    })
  }

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
    const channelReady = await isLauncherPetChannelReady()
    return channelReady
      ? { ok: true }
      : { ok: false, reason: 'pet channel token unavailable (gateway not ready)' }
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

  const channelReady = await isLauncherPetChannelReady()
  if (!channelReady) {
    return {
      ok: false,
      reason: 'pet channel token unavailable (gateway not ready)',
    }
  }

  return { ok: true }
}
