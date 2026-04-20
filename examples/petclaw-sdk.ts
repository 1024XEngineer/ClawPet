export interface LauncherAuthStatus {
  authenticated: boolean
  token_help?: {
    env_var_name: string
    log_file?: string
    config_file?: string
    tray_copy_menu: boolean
    console_stdout: boolean
  }
}

export interface GatewayStatus {
  gateway_status?: "stopped" | "starting" | "running" | "stopping" | "restarting" | "error"
  gateway_start_allowed?: boolean
  gateway_start_reason?: string
  gateway_restart_required?: boolean
  config_default_model?: string
  pid?: number
}

export interface PetTokenResponse {
  enabled?: boolean
  token?: string
  ws_url?: string
  protocol?: string
}

export interface ChatRequestData {
  text: string
  session_key: string
}

export interface OnboardingConfigRequestData {
  pet_name: string
  pet_persona: string
  pet_persona_type: string
}

export interface EmotionGetRequestData {
  pet_id?: string
}

export interface CharacterConfig {
  pet_id: string
  pet_name: string
  pet_persona: string
  pet_persona_type: string
  avatar?: string
  created_at: string
  updated_at: string
}

export interface MBTIConfig {
  ie: number
  sn: number
  tf: number
  jp: number
}

export interface EmotionState {
  pet_id: string
  emotion: string
  joy: number
  anger: number
  sadness: number
  disgust: number
  surprise: number
  fear: number
  description: string
}

export interface InitStatusPushData {
  need_config: boolean
  has_character: boolean
  character?: CharacterConfig
  mbti: MBTIConfig
  emotion_state: EmotionState
}

export interface StreamData {
  chat_id: number
  type: "text" | "final" | "tool" | string
  text: string
  emotion?: string
  action?: string
}

export interface AudioPushData {
  chat_id?: number
  type?: "audio" | "error" | string
  text?: string
  is_final?: boolean
}

export interface EmotionChangePushData {
  emotion: string
  score: number
  description: string
}

export interface ActionTriggerPushData {
  action: string
  expression: string
}

export interface PetRequest<T = Record<string, unknown>> {
  action: string
  data?: T
  request_id?: string
}

export interface PetResponse<T = Record<string, unknown>> {
  status: "ok" | "error" | "pending"
  action?: string
  data?: T
  error?: string
  request_id?: string
}

export interface PetPush<T = Record<string, unknown> | string> {
  type: "push"
  push_type:
    | "init_status"
    | "ai_chat"
    | "audio"
    | "emotion_change"
    | "action_trigger"
    | "heartbeat"
    | "character_switch"
  data?: T
  timestamp: number
  is_final?: boolean
}

export type PetInboundMessage =
  | PetResponse
  | PetPush<InitStatusPushData | StreamData | AudioPushData | EmotionChangePushData | ActionTriggerPushData | string>

export interface LauncherClientOptions {
  baseUrl?: string
  token?: string
  fetchImpl?: typeof fetch
}

export class LauncherClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: LauncherClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://127.0.0.1:18800").replace(/\/+$/, "")
    this.token = options.token || ""
    this.fetchImpl = options.fetchImpl || fetch
  }

  private withAuth(init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers || {})
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`)
    }
    return { ...init, headers }
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, this.withAuth(init))
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`${init.method || "GET"} ${path} failed: ${res.status}${body ? ` ${body}` : ""}`)
    }
    return (await res.json()) as T
  }

  async login(token = this.token): Promise<void> {
    if (!token) {
      throw new Error("dashboard token is required")
    }
    await this.requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "include",
    })
  }

  async authStatus(): Promise<LauncherAuthStatus> {
    return this.requestJson<LauncherAuthStatus>("/api/auth/status", {
      credentials: "include",
    })
  }

  async gatewayStatus(): Promise<GatewayStatus> {
    return this.requestJson<GatewayStatus>("/api/gateway/status", {
      credentials: "include",
    })
  }

  async startGateway(): Promise<void> {
    await this.requestJson("/api/gateway/start", {
      method: "POST",
      credentials: "include",
    })
  }

  async ensurePetSetup(): Promise<void> {
    await this.requestJson("/api/pet/setup", {
      method: "POST",
      credentials: "include",
    })
  }

  async getPetToken(): Promise<PetTokenResponse> {
    return this.requestJson<PetTokenResponse>("/api/pet/token", {
      credentials: "include",
    })
  }
}

export interface PetSocketClientOptions {
  sessionId: string
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket
}

export class PetSocketClient {
  private readonly sessionId: string
  private readonly webSocketFactory: (url: string, protocols?: string | string[]) => WebSocket
  private socket: WebSocket | null = null

  constructor(options: PetSocketClientOptions) {
    this.sessionId = options.sessionId
    this.webSocketFactory = options.webSocketFactory || ((url, protocols) => new WebSocket(url, protocols))
  }

  connect(tokenResponse: PetTokenResponse): Promise<void> {
    if (!tokenResponse.ws_url) {
      throw new Error("ws_url is missing")
    }

    const wsUrl = new URL(tokenResponse.ws_url)
    wsUrl.searchParams.set("session", this.sessionId)
    wsUrl.searchParams.set("session_id", this.sessionId)

    const protocols = tokenResponse.token ? [`token.${tokenResponse.token}`] : undefined

    return new Promise((resolve, reject) => {
      const socket = this.webSocketFactory(wsUrl.toString(), protocols)
      this.socket = socket

      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error("websocket connect failed"))
    })
  }

  send<T>(request: PetRequest<T>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("websocket is not open")
    }
    this.socket.send(JSON.stringify(request))
  }

  sendChat(text: string): void {
    this.send<ChatRequestData>({
      action: "chat",
      data: {
        text,
        session_key: this.sessionId,
      },
      request_id: `req-chat-${Date.now()}`,
    })
  }

  sendOnboardingConfig(data: OnboardingConfigRequestData): void {
    this.send<OnboardingConfigRequestData>({
      action: "onboarding_config",
      data,
      request_id: `req-onboarding-${Date.now()}`,
    })
  }

  sendEmotionGet(data: EmotionGetRequestData = {}): void {
    this.send<EmotionGetRequestData>({
      action: "emotion_get",
      data,
      request_id: `req-emotion-${Date.now()}`,
    })
  }

  onMessage(handler: (payload: PetInboundMessage) => void): void {
    if (!this.socket) {
      throw new Error("websocket is not initialized")
    }
    this.socket.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as PetInboundMessage
      handler(payload)
    }
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }
}

export interface PetclawSdkOptions extends LauncherClientOptions {
  sessionId?: string
}

export class PetclawSdk {
  readonly launcher: LauncherClient
  readonly sessionId: string
  socket: PetSocketClient | null = null

  constructor(options: PetclawSdkOptions = {}) {
    this.launcher = new LauncherClient(options)
    this.sessionId = options.sessionId || `session-${Date.now()}`
  }

  async bootstrap(): Promise<PetSocketClient> {
    const auth = await this.launcher.authStatus()
    if (!auth.authenticated) {
      await this.launcher.login()
    }

    const gateway = await this.launcher.gatewayStatus()
    if (gateway.gateway_status !== "running") {
      await this.launcher.ensurePetSetup()
      await this.launcher.startGateway()
    }

    const token = await this.launcher.getPetToken()
    const socket = new PetSocketClient({ sessionId: this.sessionId })
    await socket.connect(token)
    this.socket = socket
    return socket
  }

  sendChat(text: string): void {
    if (!this.socket) {
      throw new Error("socket not initialized")
    }
    this.socket.sendChat(text)
  }

  sendOnboardingConfig(data: OnboardingConfigRequestData): void {
    if (!this.socket) {
      throw new Error("socket not initialized")
    }
    this.socket.sendOnboardingConfig(data)
  }

  sendEmotionGet(data: EmotionGetRequestData = {}): void {
    if (!this.socket) {
      throw new Error("socket not initialized")
    }
    this.socket.sendEmotionGet(data)
  }
}
