import { getApiBaseUrl, withLauncherAuthRequest } from "./config"

export interface SessionListItem {
  id: string
  title: string
  preview: string
  message_count: number
  created: string
  updated: string
}

export interface SessionDetail {
  id: string
  messages: Array<{
    role: "user" | "assistant"
    content: string
    media?: string[]
  }>
  summary: string
  created: string
  updated: string
}

async function sessionFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = getApiBaseUrl()
  const url = input.startsWith("http") ? input : `${baseUrl}${input}`
  return fetch(url, withLauncherAuthRequest(url, init))
}

export async function getSessions(offset = 0, limit = 20): Promise<SessionListItem[]> {
  const params = new URLSearchParams({
    offset: offset.toString(),
    limit: limit.toString(),
  })

  try {
    const res = await sessionFetch(`/api/sessions?${params.toString()}`)
    if (!res.ok) {
      console.warn("[petclaw] Failed to fetch sessions:", res.status)
      return []
    }
    return res.json()
  } catch (err) {
    console.warn("[petclaw] Fetch sessions error:", err)
    return []
  }
}

export async function getSessionHistory(id: string): Promise<SessionDetail | null> {
  try {
    const res = await sessionFetch(`/api/sessions/${encodeURIComponent(id)}`)
    if (!res.ok) {
      console.warn("[petclaw] Failed to fetch session history:", id, res.status)
      return null
    }
    return res.json()
  } catch (err) {
    console.warn("[petclaw] Fetch session history error:", id, err)
    return null
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    const res = await sessionFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (res.ok || res.status === 404) {
      return true
    }
    console.warn("[petclaw] Failed to delete session:", id, res.status)
    return false
  } catch (err) {
    console.warn("[petclaw] Delete session error:", id, err)
    return false
  }
}
