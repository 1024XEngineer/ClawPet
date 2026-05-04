import { launcherFetch } from "@/api/http"

// API client for Pico Channel configuration.

interface PicoTokenResponse {
  token: string
  ws_url: string
  enabled: boolean
  protocol?: "pico" | "pet"
}

interface PicoSetupResponse {
  token: string
  ws_url: string
  enabled: boolean
  changed: boolean
  protocol?: "pico" | "pet"
}

const BASE_URL = ""

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await launcherFetch(`${BASE_URL}${path}`, options)
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function getPicoToken(): Promise<PicoTokenResponse> {
  return request<PicoTokenResponse>("/api/pet/token")
}

export async function regenPicoToken(): Promise<PicoTokenResponse> {
  return request<PicoTokenResponse>("/api/pet/token", { method: "POST" })
}

export async function setupPico(): Promise<PicoSetupResponse> {
  return request<PicoSetupResponse>("/api/pet/setup", { method: "POST" })
}

export type { PicoTokenResponse, PicoSetupResponse }
