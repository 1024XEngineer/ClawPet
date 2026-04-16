// PicoClaw API 配置
// 后端默认运行在 127.0.0.1:18800

export const API_BASE_URL = process.env.NEXT_PUBLIC_PICOCLAW_API_URL || 'http://127.0.0.1:18800'
export const WS_BASE_URL = process.env.NEXT_PUBLIC_PICOCLAW_WS_URL || 'ws://127.0.0.1:18800'
export const WSS_BASE_URL = process.env.NEXT_PUBLIC_PICOCLAW_WSS_URL || 'wss://127.0.0.1:18800'

// API 端点
export const API_ENDPOINTS = {
  // 认证
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    STATUS: '/api/auth/status',
  },
  // 网关管理
  GATEWAY: {
    STATUS: '/api/gateway/status',
    START: '/api/gateway/start',
    STOP: '/api/gateway/stop',
    RESTART: '/api/gateway/restart',
    LOGS: '/api/gateway/logs',
  },
  // 模型管理
  MODELS: {
    LIST: '/api/models',
    DEFAULT: '/api/models/default',
    CREATE: '/api/models',
    UPDATE: (id: string) => `/api/models/${id}`,
    DELETE: (id: string) => `/api/models/${id}`,
  },
  // 凭据管理
  CREDENTIALS: {
    LIST: '/api/credentials',
    CREATE: '/api/credentials',
    UPDATE: (provider: string) => `/api/credentials/${provider}`,
    DELETE: (provider: string) => `/api/credentials/${provider}`,
  },
  // 渠道管理
  CHANNELS: {
    LIST: '/api/channels',
    CATALOG: '/api/channels/catalog',
    STATUS: (id: string) => `/api/channels/${id}/status`,
    ENABLE: (id: string) => `/api/channels/${id}/enable`,
    DISABLE: (id: string) => `/api/channels/${id}/disable`,
    CONFIG: (id: string) => `/api/channels/${id}/config`,
  },
  // 技能管理
  SKILLS: {
    LIST: '/api/agent/skills',
    BUILTIN: '/api/agent/skills/builtin',
    GLOBAL: '/api/agent/skills/global',
    WORKSPACE: '/api/agent/skills/workspace',
    IMPORT: '/api/agent/skills/import',
    DELETE: (id: string) => `/api/agent/skills/${id}`,
  },
  // 工具管理
  TOOLS: {
    LIST: '/api/agent/tools',
    TOGGLE: (id: string) => `/api/agent/tools/${id}/toggle`,
  },
  // 定时任务
  CRON: {
    LIST: '/api/cron',
    CREATE: '/api/cron',
    UPDATE: (id: string) => `/api/cron/${id}`,
    DELETE: (id: string) => `/api/cron/${id}`,
    TOGGLE: (id: string) => `/api/cron/${id}/toggle`,
  },
  // 配置管理
  CONFIG: {
    GET: '/api/config',
    UPDATE: '/api/config',
    RAW: '/api/config/raw',
  },
  // 日志
  LOGS: {
    GET: '/api/logs',
    CLEAR: '/api/logs/clear',
  },
  // 聊天 WebSocket
  CHAT: {
    WS: '/pico/ws',
  },
  // Pico Channel
  PICO: {
    TOKEN: '/api/pico/token',
    SETUP: '/api/pico/setup',
  },
} as const
