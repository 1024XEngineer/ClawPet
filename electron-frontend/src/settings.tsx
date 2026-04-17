import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePicoClaw } from './usePicoClaw'
import { useVoiceInput } from './useVoiceInput'
import './settings.css'

type PageType = 'chat' | 'settings'
type MainMenu = 'chat' | 'skills' | 'cron' | 'channels' | 'pricing'
type ToolStatus = 'enabled' | 'disabled' | 'blocked'

interface ChatMessage {
  id: string
  text: string
  time: string
  isUser?: boolean
  emotion?: string
  action?: string
}

interface InitStatus {
  need_config: boolean
  has_character: boolean
  character?: {
    pet_name: string
    pet_persona: string
    pet_persona_type: string
  }
  emotion_state?: { emotion: string }
}

interface SkillItem {
  name: string
  source: string
  description: string
  installed_version?: string
}

interface ToolItem {
  name: string
  category: string
  description: string
  status: ToolStatus
  reason_code?: string
}

interface ChannelItem {
  key: string
  label: string
  configKey: string
  variant?: string
  enabled: boolean
  secrets: number
  source: 'live' | 'mock'
}

interface CronItem {
  id: string
  name: string
  scheduleText: string
  enabled: boolean
  description: string
  nextRunText: string
  lastResultText: string
  source: 'live' | 'mock'
}

interface CronScheduleDTO {
  kind: string
  atMs?: number
  everyMs?: number
  expr?: string
  tz?: string
}

interface CronPayloadDTO {
  message: string
  channel?: string
  to?: string
  command?: string
}

interface CronStateDTO {
  nextRunAtMs?: number
  lastRunAtMs?: number
  lastStatus?: string
  lastError?: string
}

interface CronJobDTO {
  id: string
  name: string
  enabled: boolean
  schedule: CronScheduleDTO
  payload: CronPayloadDTO
  state?: CronStateDTO
}

const API_BASE = 'http://127.0.0.1:18790'

const ASSET_PREFIX =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? '/'
    : './'

function assetPath(name: string) {
  return `${ASSET_PREFIX}${name.replace(/^\/+/, '')}`
}

const FORCE_TEST_ONBOARDING = (() => {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    const byQuery = new URLSearchParams(window.location.search).get('onboarding') === '1'
    const byStorage = window.localStorage.getItem('clawpet.forceOnboarding') === '1'
    return byQuery || byStorage
  } catch {
    return false
  }
})()
const ONBOARDING_DONE_KEY = 'clawpet.onboardingDone'

const ALLOWED_PERSONA_TYPES = new Set(['gentle', 'playful', 'cool'])
const MIN_PET_NAME_LENGTH = 2
const MAX_PET_NAME_LENGTH = 24
const MIN_PERSONA_LENGTH = 8
const MAX_PERSONA_LENGTH = 300

const CHARACTERS = [
  { id: 'lively', name: '活泼', desc: '元气满满' },
  { id: 'healing', name: '治愈', desc: '温暖贴心' },
  { id: 'cool', name: '高冷', desc: '克制理性' },
]

const MOCK_SKILLS: SkillItem[] = [
  { name: 'daily-care', source: 'workspace', description: 'Daily companion reminders.' },
  { name: 'frontend-helper', source: 'builtin', description: 'UI copy and edge-case checklist.' },
]

const MOCK_TOOLS: ToolItem[] = [
  { name: 'exec', category: 'filesystem', description: 'Run shell commands.', status: 'enabled' },
  { name: 'read_file', category: 'filesystem', description: 'Read workspace files.', status: 'enabled' },
  { name: 'web_search', category: 'web', description: 'Search web content.', status: 'disabled' },
]

const MOCK_CHANNELS: ChannelItem[] = [
  { key: 'pico', label: 'Pico', configKey: 'pico', enabled: true, secrets: 1, source: 'mock' },
  { key: 'pet', label: 'Pet', configKey: 'pet', enabled: true, secrets: 0, source: 'mock' },
]

const MOCK_CRON: CronItem[] = [
  {
    id: '1',
    name: '早安问候',
    scheduleText: 'cron · 0 8 * * *',
    enabled: true,
    description: '每天 08:00 发送早安消息',
    nextRunText: '明天 08:00',
    lastResultText: '最近执行：ok',
    source: 'mock',
  },
  {
    id: '2',
    name: '学习打卡',
    scheduleText: 'cron · 0 21 * * 1-5',
    enabled: false,
    description: '工作日 21:00 提醒打卡',
    nextRunText: '已暂停',
    lastResultText: '最近执行：- ',
    source: 'mock',
  },
]

const PRICING = [
  { name: '免费版', price: '¥0', detail: '基础聊天、基础记忆' },
  { name: '专业版', price: '¥29/月', detail: '无限聊天、工具管理、定时任务' },
  { name: '团队版', price: '¥99/月/人', detail: '多人协作、权限管理、专属支持' },
]

const SUGGESTIONS = [
  { icon: '💬', title: '聊聊心情', desc: '和桌宠分享你的感受', text: '今天过得怎么样？' },
  { icon: '📋', title: '今日任务', desc: '帮你安排待办事项', text: '帮我整理一下今天的任务' },
  { icon: '🎭', title: '性格调整', desc: '进入设置页', action: 'settings' as const },
  { icon: '🧠', title: '记忆回顾', desc: '看看桌宠记住了什么', text: '你还记得我之前说过什么吗？' },
]

const emotionToGif: Record<string, string[]> = {
  joy: ['happy1.gif', 'happy2.gif'],
  happy: ['happy1.gif', 'happy2.gif'],
  sadness: ['sad.gif'],
  anger: ['shake-head_out.gif'],
  surprise: ['celebrate_out.gif'],
  neutral: ['standby1.gif', 'standby2.gif', 'standby3.gif'],
}

function getEmotionGif(emotion: string) {
  const gifs = emotionToGif[emotion] || emotionToGif.neutral
  return gifs[Math.floor(Math.random() * gifs.length)]
}

function timeText() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function titleCase(v: string) {
  return v.split('_').join(' ').replace(/\b\w/g, (m: string) => m.toUpperCase())
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

function parseMaybeJSON<T>(raw: unknown): T | null {
  if (raw == null) {
    return null
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  return raw as T
}

function mergeFinalText(streamed: string, finalChunk?: string) {
  const streamText = streamed || ''
  const finalText = finalChunk || ''

  if (!streamText) {
    return finalText.trim()
  }
  if (!finalText) {
    return streamText.trim()
  }
  if (streamText === finalText) {
    return finalText.trim()
  }
  if (streamText.includes(finalText)) {
    return streamText.trim()
  }
  if (finalText.includes(streamText)) {
    return finalText.trim()
  }
  return `${streamText}${finalText}`.trim()
}

export default function PetClawApp() {
  const [page, setPage] = useState<PageType>('chat')
  const [menu, setMenu] = useState<MainMenu>('chat')
  const [inputText, setInputText] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [petGif, setPetGif] = useState('/standby1.gif')
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [needOnboarding, setNeedOnboarding] = useState(FORCE_TEST_ONBOARDING)
  const [onboardingSubmitting, setOnboardingSubmitting] = useState(false)
  const [onboardingError, setOnboardingError] = useState('')
  const [petName, setPetName] = useState('ClawPet')
  const [petPersona, setPetPersona] = useState('温柔体贴，善于倾听。')
  const [petPersonaType, setPetPersonaType] = useState('gentle')
  const [conversationHistory, setConversationHistory] = useState<{ id: string; name: string; time: string }[]>([])

  const [skills, setSkills] = useState<SkillItem[]>(MOCK_SKILLS)
  const [tools, setTools] = useState<ToolItem[]>(MOCK_TOOLS)
  const [channels, setChannels] = useState<ChannelItem[]>(MOCK_CHANNELS)
  const [cronItems, setCronItems] = useState<CronItem[]>(MOCK_CRON)
  const [skillsSource, setSkillsSource] = useState<'live' | 'mock'>('mock')
  const [toolsSource, setToolsSource] = useState<'live' | 'mock'>('mock')
  const [channelsSource, setChannelsSource] = useState<'live' | 'mock'>('mock')
  const [moduleLoading, setModuleLoading] = useState(false)
  const [moduleError, setModuleError] = useState('')
  const [settingsCharacter, setSettingsCharacter] = useState('lively')

  const chatRef = useRef('')
  const emotionRef = useRef('neutral')
  const msgListRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef('')
  const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { isListening, toggleListening } = useVoiceInput({
    onResult: (txt) => setInputText((v) => `${v}${txt}`),
  })

  const { send, on, off, isConnected, isConnecting } = usePicoClaw(API_BASE, {
    onConnectionChange: (ok) => {
      if (ok) {
        window.electronAPI?.sendConnectionAlive?.()
      }
    },
  })

  useEffect(() => {
    setConnStatus(isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected')
  }, [isConnected, isConnecting])

  useEffect(() => {
    if (msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight
    }
  }, [chatHistory, streamingText])

  const clearResponseTimeout = useCallback(() => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearResponseTimeout()
    }
  }, [clearResponseTimeout])

  useEffect(() => {
    on('init_status', (raw) => {
      const data = parseMaybeJSON<InitStatus>(raw)
      if (!data) {
        return
      }

      if (data.character) {
        setPetName(data.character.pet_name || 'ClawPet')
        setPetPersona(data.character.pet_persona || '温柔体贴，善于倾听。')
        setPetPersonaType(data.character.pet_persona_type || 'gentle')
      }

      if (!FORCE_TEST_ONBOARDING) {
        let showOnboarding = Boolean(data.need_config)
        if (!showOnboarding) {
          try {
            showOnboarding = window.localStorage.getItem(ONBOARDING_DONE_KEY) !== '1'
          } catch {
            showOnboarding = false
          }
        }
        setNeedOnboarding(showOnboarding)
      }

      if (data.emotion_state?.emotion) {
        emotionRef.current = data.emotion_state.emotion
        setPetGif(getEmotionGif(data.emotion_state.emotion))
      }
    })

    on('emotion_change', (raw) => {
      const data = parseMaybeJSON<{ emotion?: string }>(raw)
      if (!data?.emotion) {
        return
      }
      emotionRef.current = data.emotion
      setPetGif(getEmotionGif(data.emotion))
    })

    on('ai_chat', (raw) => {
      const data = parseMaybeJSON<{
        text?: string
        emotion?: string
        action?: string
        is_final?: boolean
      }>(raw)
      if (!data) {
        return
      }
      clearResponseTimeout()

      if (data.is_final) {
        const text = mergeFinalText(chatRef.current, data.text)
        chatRef.current = ''
        setStreamingText('')
        if (text) {
          setChatHistory((p) => [
            ...p,
            {
              id: `ai_${Date.now()}`,
              text,
              time: timeText(),
              emotion: emotionRef.current,
              action: data.action,
            },
          ])
        }
        return
      }

      if (!data.text) {
        return
      }

      if (data.emotion) {
        emotionRef.current = data.emotion
      }
      chatRef.current += data.text
      setStreamingText(chatRef.current)
    })

    on('audio', (raw) => {
      const data = parseMaybeJSON<{ text?: string; is_final?: boolean }>(raw)
      if (!data) {
        return
      }
      if (data.text) {
        audioRef.current += data.text
      }
      if (data.is_final && audioRef.current) {
        window.electronAPI?.showBubble({
          text: null,
          emotion: emotionRef.current,
          audio: audioRef.current,
        })
        audioRef.current = ''
      }
    })

    return () => {
      off('init_status')
      off('emotion_change')
      off('ai_chat')
      off('audio')
    }
  }, [clearResponseTimeout, on, off])

  const sendMessage = useCallback(
    async (text?: string) => {
      const msg = (text || inputText).trim()
      if (!msg || needOnboarding) {
        return
      }

      setChatHistory((p) => [...p, { id: `u_${Date.now()}`, text: msg, time: timeText(), isUser: true }])
      setInputText('')

      try {
        await send('chat', { text: msg })
        clearResponseTimeout()
        responseTimeoutRef.current = setTimeout(() => {
          setChatHistory((p) => [
            ...p,
            {
              id: `timeout_${Date.now()}`,
              text: '后端暂未返回，请先检查网关 /ready 状态与模型配置。',
              time: timeText(),
              emotion: 'neutral',
            },
          ])
        }, 12000)
      } catch (error) {
        clearResponseTimeout()
        const message = error instanceof Error ? error.message : '发送失败'
        setChatHistory((p) => [
          ...p,
          {
            id: `err_${Date.now()}`,
            text: `发送失败：${message}`,
            time: timeText(),
            emotion: 'neutral',
          },
        ])
      }
    },
    [clearResponseTimeout, inputText, needOnboarding, send],
  )

  const submitOnboarding = useCallback(async () => {
    if (onboardingSubmitting) {
      return
    }

    const name = petName.trim()
    const persona = petPersona.trim()
    const personaType = (petPersonaType || 'gentle').trim()

    if (!isConnected) {
      setOnboardingError('当前未连接后端，请先启动网关后再完成引导')
      return
    }
    if (!name || !persona) {
      setOnboardingError('请填写宠物名称和性格描述')
      return
    }
    if (name.length < MIN_PET_NAME_LENGTH || name.length > MAX_PET_NAME_LENGTH) {
      setOnboardingError(`宠物名称需为 ${MIN_PET_NAME_LENGTH}-${MAX_PET_NAME_LENGTH} 个字符`)
      return
    }
    if (persona.length < MIN_PERSONA_LENGTH || persona.length > MAX_PERSONA_LENGTH) {
      setOnboardingError(`性格描述需为 ${MIN_PERSONA_LENGTH}-${MAX_PERSONA_LENGTH} 个字符`)
      return
    }
    if (!ALLOWED_PERSONA_TYPES.has(personaType)) {
      setOnboardingError('性格类型不合法，请选择 gentle / playful / cool')
      return
    }

    setOnboardingSubmitting(true)
    setOnboardingError('')

    try {
      await send('onboarding_config', {
        pet_name: name,
        pet_persona: persona,
        pet_persona_type: personaType,
      })
      try {
        window.localStorage.setItem(ONBOARDING_DONE_KEY, '1')
      } catch {
        // ignore localStorage failures
      }
      setNeedOnboarding(false)
      const emotion = (await send('emotion_get', {})) as { emotion?: string }
      if (emotion?.emotion) {
        emotionRef.current = emotion.emotion
        setPetGif(getEmotionGif(emotion.emotion))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交失败，请检查后端连接'
      setOnboardingError(message)
    } finally {
      setOnboardingSubmitting(false)
    }
  }, [isConnected, onboardingSubmitting, petName, petPersona, petPersonaType, send])

  const loadSkillsAndTools = useCallback(async () => {
    setModuleLoading(true)
    setModuleError('')

    try {
      const [s, t] = await Promise.allSettled([
        fetchJSON<{ skills: SkillItem[] }>(`${API_BASE}/api/skills`),
        fetchJSON<{ tools: ToolItem[] }>(`${API_BASE}/api/tools`),
      ])

      if (s.status === 'fulfilled') {
        setSkills(s.value.skills || [])
        setSkillsSource('live')
      } else {
        setSkills(MOCK_SKILLS)
        setSkillsSource('mock')
      }

      if (t.status === 'fulfilled') {
        setTools(t.value.tools || [])
        setToolsSource('live')
      } else {
        setTools(MOCK_TOOLS)
        setToolsSource('mock')
      }

      if (s.status === 'rejected' && t.status === 'rejected') {
        setModuleError('技能与工具接口不可用，已切换 mock')
      }
    } finally {
      setModuleLoading(false)
    }
  }, [])

  const loadChannels = useCallback(async () => {
    setModuleLoading(true)
    setModuleError('')

    try {
      const catalog = await fetchJSON<{
        channels: { name: string; config_key: string; variant?: string }[]
      }>(`${API_BASE}/api/channels/catalog`)

      const details = await Promise.allSettled(
        catalog.channels.map((c) =>
          fetchJSON<{
            config?: { enabled?: boolean }
            configured_secrets?: string[]
            config_key?: string
            variant?: string
          }>(`${API_BASE}/api/channels/${encodeURIComponent(c.name)}/config`),
        ),
      )

      const rows = catalog.channels.map((c, i) => {
        const d = details[i]
        if (d.status !== 'fulfilled') {
          return {
            key: c.name,
            label: titleCase(c.name),
            configKey: c.config_key,
            variant: c.variant,
            enabled: false,
            secrets: 0,
            source: 'mock' as const,
          }
        }

        return {
          key: c.name,
          label: titleCase(c.name),
          configKey: d.value.config_key || c.config_key,
          variant: d.value.variant || c.variant,
          enabled: Boolean(d.value.config?.enabled),
          secrets: d.value.configured_secrets?.length || 0,
          source: 'live' as const,
        }
      })

      setChannels(rows)
      setChannelsSource(rows.some((r) => r.source === 'mock') ? 'mock' : 'live')
    } catch {
      setChannels(MOCK_CHANNELS)
      setChannelsSource('mock')
      setModuleError('频道接口不可用，已切换 mock')
    } finally {
      setModuleLoading(false)
    }
  }, [])

  useEffect(() => {
    if (page !== 'chat') {
      return
    }
    if (menu === 'skills') {
      void loadSkillsAndTools()
    }
    if (menu === 'channels') {
      void loadChannels()
    }
  }, [menu, page, loadSkillsAndTools, loadChannels])

  const toggleTool = useCallback(
    async (name: string, enable: boolean) => {
      const before = tools.find((t) => t.name === name)?.status || 'disabled'
      setTools((p) => p.map((t) => (t.name === name ? { ...t, status: enable ? 'enabled' : 'disabled' } : t)))

      if (toolsSource !== 'live') {
        return
      }

      try {
        await fetchJSON(`${API_BASE}/api/tools/${encodeURIComponent(name)}/state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enable }),
        })
      } catch {
        setTools((p) => p.map((t) => (t.name === name ? { ...t, status: before } : t)))
        setModuleError(`更新工具 ${name} 失败`)
      }
    },
    [tools, toolsSource],
  )

  const newChat = () => {
    if (chatHistory.length > 0) {
      setConversationHistory((p) => [
        {
          id: `c_${Date.now()}`,
          name: chatHistory[0].text.slice(0, 18),
          time: new Date().toLocaleDateString('zh-CN'),
        },
        ...p,
      ].slice(0, 8))
    }
    setChatHistory([])
    setStreamingText('')
    chatRef.current = ''
    setMenu('chat')
  }

  const hasMessages = chatHistory.length > 0 || Boolean(streamingText)
  const enabledTools = useMemo(() => tools.filter((t) => t.status === 'enabled').length, [tools])

  return (
    <div className="petclaw-app">
      <div className="sidebar">
        <div className="sidebar-header">
          <img
            src="/pet.svg"
            alt="logo"
            className="sidebar-logo"
            onError={(e) => {
              const target = e.currentTarget
              if (!target.src.endsWith('/standby1.gif')) {
                target.src = '/standby1.gif'
              }
            }}
          />
          <span className="sidebar-brand">ClawPet AI</span>
          <span className="sidebar-badge">测试版</span>
        </div>

        <button className="new-chat-btn" onClick={newChat}>
          + 新建聊天
        </button>

        <div className="sidebar-menu">
          {([
            { k: 'chat', i: '💬', n: 'ClawPet' },
            { k: 'skills', i: '🧩', n: '技能' },
            { k: 'cron', i: '⏰', n: '定时任务' },
            { k: 'channels', i: '📡', n: '频道' },
            { k: 'pricing', i: '💳', n: '价格' },
          ] as { k: MainMenu; i: string; n: string }[]).map((m) => (
            <button
              key={m.k}
              className={`menu-item ${menu === m.k ? 'active' : ''}`}
              onClick={() => {
                setMenu(m.k)
                setPage('chat')
              }}
            >
              <span className="menu-icon">{m.i}</span>
              <span className="menu-label">{m.n}</span>
            </button>
          ))}

          {conversationHistory.length > 0 && (
            <>
              <div className="sidebar-section-title">对话记录</div>
              {conversationHistory.map((h) => (
                <div key={h.id} className="history-item">
                  <span className="history-icon">🗒️</span>
                  <div className="history-info">
                    <div className="history-name">{h.name}</div>
                    <div className="history-time">{h.time}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="invite-btn">🏷 邀请码</button>
          <div className="sidebar-footer-row">
            <div className="footer-icons">
              <button className="footer-icon-btn">👤</button>
              <button className="footer-icon-btn" onClick={() => setPage('settings')}>
                ⚙️
              </button>
              <button className="footer-icon-btn">🌙</button>
            </div>
          </div>
        </div>
      </div>

      <div className="main-area" style={{ position: 'relative' }}>
        {FORCE_TEST_ONBOARDING && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              background: 'linear-gradient(90deg, #ff6b6b, #feca57)',
              color: '#111',
              padding: '8px 16px',
              textAlign: 'center',
              fontWeight: 700,
              fontSize: '14px',
              zIndex: 9999,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
          >
            调试模式：已强制开启引导页（onboarding）
          </div>
        )}

        <div className="top-bar">
          <div className="top-left">
            <span className={`conn-dot ${connStatus}`}></span>
            <span className="conn-text">
              {connStatus === 'connected'
                ? '已连接'
                : connStatus === 'connecting'
                  ? '连接中'
                  : '未连接'}
            </span>
          </div>

          <div className="top-center">
            <button
              className={`tab-btn ${menu === 'chat' ? 'active' : ''}`}
              onClick={() => {
                setPage('chat')
                setMenu('chat')
              }}
            >
              ClawPet
            </button>
            <button
              className={`tab-btn ${menu !== 'chat' ? 'active' : ''}`}
              onClick={() => {
                setPage('chat')
                if (menu === 'chat') {
                  setMenu('skills')
                }
              }}
            >
              工作
            </button>
          </div>

          <div className="top-right">
            <span className="plan-text">Free</span>
            <button className="upgrade-btn">升级</button>
            <div className="window-controls">
              <button className="win-btn" onClick={() => window.electronAPI?.minimizeSettings()}>
                —
              </button>
              <button className="win-btn" onClick={() => window.electronAPI?.maximizeSettings()}>
                □
              </button>
              <button className="win-btn close" onClick={() => window.electronAPI?.closeSettings()}>
                ×
              </button>
            </div>
          </div>
        </div>

        {needOnboarding && (
          <div className="onboarding-overlay">
            <div className="onboarding-card">
              <h2>欢迎来到 ClawPet</h2>
              <p>先完成一次宠物初始化配置，之后再开始聊天。</p>

              <div className="onboarding-form">
                <label>宠物名称</label>
                <input value={petName} onChange={(e) => setPetName(e.target.value)} />

                <label>性格类型</label>
                <select value={petPersonaType} onChange={(e) => setPetPersonaType(e.target.value)}>
                  <option value="gentle">gentle</option>
                  <option value="playful">playful</option>
                  <option value="cool">cool</option>
                </select>

                <label>性格描述</label>
                <textarea rows={4} value={petPersona} onChange={(e) => setPetPersona(e.target.value)} />
              </div>

              {onboardingError && <div className="onboarding-error">{onboardingError}</div>}

              <div className="onboarding-actions">
                <button className="onboarding-submit" onClick={submitOnboarding} disabled={onboardingSubmitting}>
                  {onboardingSubmitting ? '提交中...' : '完成引导'}
                </button>
              </div>
            </div>
          </div>
        )}

        {page === 'chat' && (
          <div className="chat-content">
            {menu === 'chat' && (
              <>
                {!hasMessages ? (
                  <div className="empty-state">
                    <img src={petGif} alt="pet" className="pet-avatar" />
                    <div className="greeting-text">今天有什么可以帮你？</div>
                    <div className="suggestion-grid">
                      {SUGGESTIONS.map((s, i) => (
                        <div
                          key={i}
                          className="suggestion-card"
                          onClick={() => (s.action === 'settings' ? setPage('settings') : void sendMessage(s.text))}
                        >
                          <span className="suggestion-icon">{s.icon}</span>
                          <div className="suggestion-info">
                            <div className="suggestion-title">{s.title}</div>
                            <div className="suggestion-desc">{s.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="message-list" ref={msgListRef}>
                    {chatHistory.map((m) => (
                      <div key={m.id} className={`chat-msg ${m.isUser ? 'user' : 'ai'}`}>
                        {!m.isUser && (
                          <img
                            src={m.emotion ? getEmotionGif(m.emotion) : petGif}
                            alt="pet"
                            className="msg-avatar pet-gif"
                          />
                        )}
                        <div className="msg-body">
                          <div className="msg-bubble">{m.text}</div>
                          <span className="msg-time">
                            {m.time}
                            {!m.isUser && m.action ? ` · Tool: ${m.action}` : ''}
                          </span>
                        </div>
                        {m.isUser && <div style={{ width: 32 }} />}
                      </div>
                    ))}

                    {streamingText && (
                      <div className="streaming-indicator">
                        <img src={petGif} alt="pet" className="msg-avatar pet-gif" />
                        <div className="streaming-bubble">{streamingText}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="input-bar">
                  <div className="toolbar-row">
                    <button className="toolbar-btn">+</button>
                    <button className="toolbar-btn">快速 ▾</button>
                  </div>
                  <div className="input-row">
                    <input
                      className="input-text"
                      placeholder="输入消息..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendMessage()
                        }
                      }}
                    />
                    <div className="input-actions">
                      <button className={`input-icon-btn ${isListening ? 'listening' : ''}`} onClick={toggleListening}>
                        🎤
                      </button>
                      <button
                        className="send-btn"
                        onClick={() => void sendMessage()}
                        disabled={!inputText.trim() || !isConnected || needOnboarding}
                      >
                        ➤
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {menu !== 'chat' && (
              <div className="module-page">
                <div className="module-header">
                  <h2>
                    {menu === 'skills'
                      ? '技能与工具'
                      : menu === 'cron'
                        ? '定时任务'
                        : menu === 'channels'
                          ? '频道配置'
                          : '价格计划'}
                  </h2>
                  <span className="module-source">
                    {menu === 'skills'
                      ? `skills:${skillsSource} tools:${toolsSource}`
                      : menu === 'channels'
                        ? channelsSource
                        : 'mock'}
                  </span>
                </div>

                {moduleError && <div className="module-error">{moduleError}</div>}
                {moduleLoading && (menu === 'skills' || menu === 'channels') && (
                  <div className="module-loading">加载中...</div>
                )}

                {menu === 'skills' && !moduleLoading && (
                  <>
                    <div className="module-block">
                      <h3>已安装技能</h3>
                      <div className="module-grid">
                        {skills.map((s) => (
                          <div key={s.name} className="module-card">
                            <div className="module-card-title">{s.name}</div>
                            <div className="module-card-meta">
                              {s.source}
                              {s.installed_version ? ` · ${s.installed_version}` : ''}
                            </div>
                            <div className="module-card-desc">{s.description || 'No description'}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="module-block">
                      <h3>{`Tool 能力（已启用 ${enabledTools}/${tools.length}）`}</h3>
                      <div className="module-list">
                        {tools.map((t) => (
                          <div key={t.name} className="module-list-item">
                            <div>
                              <div className="module-card-title">{t.name}</div>
                              <div className="module-card-meta">{t.category}</div>
                              <div className="module-card-desc">{t.description}</div>
                            </div>
                            <button
                              className={`switch-btn ${t.status === 'enabled' ? 'on' : ''}`}
                              disabled={t.status === 'blocked'}
                              onClick={() => void toggleTool(t.name, t.status !== 'enabled')}
                            >
                              {t.status === 'blocked' ? 'blocked' : t.status === 'enabled' ? 'on' : 'off'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {menu === 'cron' && (
                  <div className="module-list">
                    {cronItems.map((c) => (
                      <div key={c.id} className="module-list-item">
                        <div>
                          <div className="module-card-title">{c.name}</div>
                          <div className="module-card-meta">{c.schedule}</div>
                          <div className="module-card-desc">{c.description}</div>
                        </div>
                        <button
                          className={`switch-btn ${c.enabled ? 'on' : ''}`}
                          onClick={() =>
                            setCronItems((p) => p.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)))
                          }
                        >
                          {c.enabled ? 'on' : 'off'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {menu === 'channels' && !moduleLoading && (
                  <div className="module-grid">
                    {channels.map((c) => (
                      <div key={`${c.key}:${c.variant || ''}`} className="module-card">
                        <div className="module-card-title">{c.label}</div>
                        <div className="module-card-meta">
                          {c.configKey}
                          {c.variant ? ` · ${c.variant}` : ''}
                        </div>
                        <div className="module-card-desc">
                          {`enabled: ${String(c.enabled)}`}
                          <br />
                          {`configured secrets: ${c.secrets}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {menu === 'pricing' && (
                  <div className="module-grid">
                    {PRICING.map((p) => (
                      <div key={p.name} className="module-card">
                        <div className="module-card-title">{p.name}</div>
                        <div className="module-price">{p.price}</div>
                        <div className="module-card-desc">{p.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {page === 'settings' && (
          <div className="settings-overlay">
            <div className="settings-panel-header">
              <button className="settings-back-btn" onClick={() => setPage('chat')}>
                ← 返回
              </button>
              <span className="settings-panel-title">偏好设置</span>
            </div>
            <div className="settings-panel-body">
              <div className="setting-section">
                <h3>人格切换</h3>
                <div className="char-grid">
                  {CHARACTERS.map((c) => (
                    <div
                      key={c.id}
                      className={`char-card ${settingsCharacter === c.id ? 'active' : ''}`}
                      onClick={() => setSettingsCharacter(c.id)}
                    >
                      <div className="char-name">{c.name}</div>
                      <div className="char-desc">{c.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="setting-section">
                <h3>后端</h3>
                <div className="setting-item">
                  <label>Gateway</label>
                  <input type="text" readOnly value={API_BASE || '(same-origin in dev)'} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
