import { atom, getDefaultStore } from "jotai"

import {
  getInitialActiveSessionId,
  writeStoredSessionId,
} from "@/features/chat/state"

export interface ChatAttachment {
  type: "image"
  url: string
  filename?: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number | string
  attachments?: ChatAttachment[]
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"

export type AudioRecordingState =
  | "idle"
  | "recording"
  | "recognizing"
  | "error"

export type ChatProtocolMode = "pico" | "pet"

export interface ChatStoreState {
  messages: ChatMessage[]
  connectionState: ConnectionState
  isTyping: boolean
  audioRecordingState: AudioRecordingState
  audioError?: string
  audioSequence: number
  protocolMode: ChatProtocolMode
  activeSessionId: string
  hasHydratedActiveSession: boolean
}

type ChatStorePatch = Partial<ChatStoreState>

const DEFAULT_CHAT_STATE: ChatStoreState = {
  messages: [],
  connectionState: "disconnected",
  isTyping: false,
  audioRecordingState: "idle",
  audioError: undefined,
  audioSequence: 0,
  protocolMode: "pico",
  activeSessionId: getInitialActiveSessionId(),
  hasHydratedActiveSession: false,
}

export const chatAtom = atom<ChatStoreState>(DEFAULT_CHAT_STATE)

const store = getDefaultStore()

export function getChatState() {
  return store.get(chatAtom)
}

export function updateChatStore(
  patch:
    | ChatStorePatch
    | ((prev: ChatStoreState) => ChatStorePatch | ChatStoreState),
) {
  store.set(chatAtom, (prev) => {
    const nextPatch = typeof patch === "function" ? patch(prev) : patch
    const next = { ...prev, ...nextPatch }

    if (next.activeSessionId !== prev.activeSessionId) {
      writeStoredSessionId(next.activeSessionId)
    }

    return next
  })
}
