export interface PetChannelRequest<TData = Record<string, unknown>> {
  action: string
  data: TData
  request_id?: string
}

export interface PetChannelResponse<TData = Record<string, unknown>> {
  status: "ok" | "error" | "pending"
  action: string
  data?: TData
  error?: string
  request_id?: string
}

export interface PetChannelPush<TData = Record<string, unknown>> {
  type: "push"
  push_type: string
  data?: TData
  timestamp?: number
  is_final?: boolean
}

export interface AudioFrameData {
  audio: string
  format: "pcm"
  sample_rate: 16000
  channels: 1
  sequence: number
  timestamp: number
  session_key: string
}

export type AudioFrameRequest = PetChannelRequest<AudioFrameData>

export interface ChatRequestData {
  text: string
  session_key: string
}

export type ChatRequest = PetChannelRequest<ChatRequestData>

export interface PetAiChatPushData {
  chat_id?: number
  type?: "text" | "final"
  text?: string
  emotion?: string
  action?: string
}

export function isPetChannelEnvelope(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false
  }
  const message = payload as Record<string, unknown>
  return (
    typeof message.action === "string" ||
    message.type === "push" ||
    typeof message.push_type === "string"
  )
}

export function createAudioFrameRequest(
  audio: string,
  sequence: number,
  sessionKey: string,
  requestId?: string,
): AudioFrameRequest {
  return {
    action: "audio_frame",
    data: {
      audio,
      format: "pcm",
      sample_rate: 16000,
      channels: 1,
      sequence,
      timestamp: Date.now(),
      session_key: sessionKey,
    },
    request_id: requestId,
  }
}

export function createChatRequest(
  text: string,
  sessionKey: string,
  requestId?: string,
): ChatRequest {
  return {
    action: "chat",
    data: {
      text,
      session_key: sessionKey,
    },
    request_id: requestId,
  }
}
