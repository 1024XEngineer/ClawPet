import { useEffect, useMemo, useRef, useState } from 'react'

import { API_ENDPOINTS, fetchWithAuthRetry, getApiBaseUrl } from '../lib/api'
import { SCHEDULE_ICS_NAME_STORAGE_KEY, saveOnboardingState } from '../lib/onboarding'
import { buildLearningRhythm, buildPressurePlan } from '../lib/student-insights'

type SetupStatus = 'pending' | 'running' | 'done' | 'failed'
type PersonalityTone = '阴阳怪气' | '抽象发疯' | '甜心夹子'

interface SetupTask {
  id: string
  label: string
  detail: string
  status: SetupStatus
}

interface OnboardingWizardProps {
  onFinish: () => void
}

const steps = ['情报录入', '桌宠人格', '契约确认']
const setupTemplate: SetupTask[] = [
  { id: 'env', label: '环境检查', detail: '检查 Launcher 服务连通性', status: 'pending' },
  { id: 'gateway', label: '网关状态', detail: '确认网关可用', status: 'pending' },
  { id: 'pico', label: '配置 Pet Channel', detail: '初始化桌宠通信通道', status: 'pending' },
  { id: 'token', label: '连接验证', detail: '拉取 Pico Token 并完成连通', status: 'pending' },
]

const majors = ['计算机', '法学', '临床医学', '汉语言', '金融', '艺术设计']
const breakerVocabulary = ['高数', '四六级', '早八', '实验报告', '课程设计', '论文', '答辩']
const nicknameTags = ['义父', '铲屎官', '大冤种', '少侠', '学术巨佬']
const loadingComfortLines = [
  '正在帮你给小窝通风，马上就好喵。',
  '我在和网关贴贴握手，别急别急。',
  '最后几步啦，桌宠已经在门口摇尾巴。',
]
const showcaseGifs = ['/standby1.gif', '/happy1.gif', '/listening.gif', '/celebrate_out.gif']
const MIN_SUMMON_LOADING_MS = 4200

function pickRandomIndex(size: number, current?: number): number {
  if (size <= 1) return 0
  let next = Math.floor(Math.random() * size)
  while (typeof current === 'number' && next === current) {
    next = Math.floor(Math.random() * size)
  }
  return next
}

function withStatus(tasks: SetupTask[], id: string, status: SetupStatus): SetupTask[] {
  return tasks.map((task) => (task.id === id ? { ...task, status } : task))
}

function statusIcon(status: SetupStatus): string {
  if (status === 'done') return '✓'
  if (status === 'running') return '...'
  if (status === 'failed') return '!'
  return '○'
}

export function OnboardingWizard({ onFinish }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [profileRole, setProfileRole] = useState('计算机')
  const [sleepHour, setSleepHour] = useState(1)
  const [selectedBreakers, setSelectedBreakers] = useState<string[]>(['早八', '论文'])
  const [icsFileName, setIcsFileName] = useState('')
  const [anxietyLevel, setAnxietyLevel] = useState(58)

  const [personalityTone, setPersonalityTone] = useState<PersonalityTone>('阴阳怪气')
  const [activityLevel, setActivityLevel] = useState(65)
  const [nickname, setNickname] = useState('义父')
  const [customNickname, setCustomNickname] = useState('')

  const [apiKey, setApiKey] = useState('')
  const [setupTasks, setSetupTasks] = useState<SetupTask[]>(setupTemplate)
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [loadingLineIndex, setLoadingLineIndex] = useState(0)
  const [previewReminderText, setPreviewReminderText] = useState('')
  const [showCompletionCard, setShowCompletionCard] = useState(false)
  const [summonInProgress, setSummonInProgress] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(0)
  const displayProgressRef = useRef(0)
  const [showcaseIndex, setShowcaseIndex] = useState(0)

  const [appSettings, setAppSettings] = useState({
    autoConnectOnLaunch: true,
    enableDesktopBubble: true,
    openConsoleOnPetClick: true,
  })

  useEffect(() => {
    displayProgressRef.current = displayProgress
  }, [displayProgress])

  useEffect(() => {
    setShowcaseIndex(pickRandomIndex(showcaseGifs.length))
    const timer = window.setInterval(() => {
      setShowcaseIndex((prev) => pickRandomIndex(showcaseGifs.length, prev))
    }, 3800)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!setupRunning) {
      setLoadingLineIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingLineIndex((prev) => (prev + 1) % loadingComfortLines.length)
    }, 1500)

    return () => window.clearInterval(timer)
  }, [setupRunning])

  useEffect(() => {
    if (!summonInProgress) {
      setDisplayProgress(0)
      return
    }

    const timer = window.setInterval(() => {
      setDisplayProgress((prev) => {
        const cap = setupRunning ? 94 : 98
        const stepSize = setupRunning ? 1.65 : 0.6
        return Math.min(cap, prev + stepSize)
      })
    }, 120)

    return () => window.clearInterval(timer)
  }, [setupRunning, summonInProgress])

  useEffect(() => {
    try {
      const savedName = window.localStorage.getItem(SCHEDULE_ICS_NAME_STORAGE_KEY)
      if (savedName) {
        setIcsFileName(savedName)
      }
    } catch {
    }
  }, [])

  const learningRhythmInsight = useMemo(() => buildLearningRhythm({
    major: profileRole,
    sleepHour,
    anxietyLevel,
    deadlineDate: '',
    selectedBreakers,
    hasScheduleFile: Boolean(icsFileName),
  }), [anxietyLevel, icsFileName, profileRole, selectedBreakers, sleepHour])

  const pressurePlanInsight = useMemo(() => buildPressurePlan({
    major: profileRole,
    sleepHour,
    anxietyLevel,
    deadlineDate: '',
    selectedBreakers,
    hasScheduleFile: Boolean(icsFileName),
  }), [anxietyLevel, icsFileName, profileRole, selectedBreakers, sleepHour])

  const toggleBreaker = (value: string) => {
    setSelectedBreakers((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]))
  }

  const pickIcsFile = (file: File | null) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.ics')) {
      setSetupError('只支持 .ics 课表文件，请重新选择。')
      return
    }
    setSetupError(null)
    setIcsFileName(file.name)
    try {
      window.localStorage.setItem(SCHEDULE_ICS_NAME_STORAGE_KEY, file.name)
    } catch {
    }
  }

  const runSetup = async (): Promise<boolean> => {
    setSetupRunning(true)
    setSetupError(null)
    setSetupTasks(setupTemplate)

    try {
      const baseUrl = getApiBaseUrl()

      setSetupTasks((prev) => withStatus(prev, 'env', 'running'))
      const authRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.AUTH.STATUS}`, { credentials: 'include' }, false)
      if (![200, 401].includes(authRes.status)) throw new Error(`环境检查失败（${authRes.status}）`)

      setSetupTasks((prev) => withStatus(withStatus(prev, 'env', 'done'), 'gateway', 'running'))
      const gatewayRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.GATEWAY.STATUS}`, { credentials: 'include' })
      if (![200, 401].includes(gatewayRes.status)) throw new Error(`网关检查失败（${gatewayRes.status}）`)

      setSetupTasks((prev) => withStatus(withStatus(prev, 'gateway', 'done'), 'pico', 'running'))
      let setupRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.PET.SETUP}`, { method: 'POST', credentials: 'include' })
      if (setupRes.status === 404) {
        setupRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.PICO.SETUP}`, { method: 'POST', credentials: 'include' })
      }
      if (!setupRes.ok) throw new Error(`Pet Channel 初始化失败（${setupRes.status}）`)

      setSetupTasks((prev) => withStatus(withStatus(prev, 'pico', 'done'), 'token', 'running'))
      let tokenRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.PET.TOKEN}`, { credentials: 'include' })
      if (tokenRes.status === 404) {
        tokenRes = await fetchWithAuthRetry(`${baseUrl}${API_ENDPOINTS.PICO.TOKEN}`, { credentials: 'include' })
      }
      if (!tokenRes.ok) throw new Error(`连接验证失败（${tokenRes.status}）`)

      setSetupTasks((prev) => withStatus(prev, 'token', 'done'))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : '初始化失败'
      setSetupError(message)
      setSetupTasks((prev) => prev.map((task) => (task.status === 'running' ? { ...task, status: 'failed' } : task)))
      return false
    } finally {
      setSetupRunning(false)
    }
  }

  const previewReminder = () => {
    const candidate = pressurePlanInsight.level === 'critical'
      ? pressurePlanInsight.templates.strong
      : pressurePlanInsight.level === 'high'
        ? pressurePlanInsight.templates.normal
        : pressurePlanInsight.templates.soft

    setPreviewReminderText(candidate)
    window.electronAPI?.showBubble?.(candidate, 'neutral')
  }

  const complete = async () => {
    const trimmedApiKey = apiKey.trim()
    if (trimmedApiKey) {
      try {
        window.localStorage.setItem('petclaw.apiKeyDraft', trimmedApiKey)
      } catch {
      }
    }

    setSummonInProgress(true)
    setDisplayProgress(4)

    const [ready] = await Promise.all([
      runSetup(),
      new Promise((resolve) => window.setTimeout(resolve, MIN_SUMMON_LOADING_MS)),
    ])

    await new Promise<void>((resolve) => {
      const start = performance.now()
      const from = displayProgressRef.current
      const duration = 850
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        setDisplayProgress(from + (100 - from) * eased)
        if (t < 1) {
          window.requestAnimationFrame(tick)
          return
        }
        resolve()
      }
      window.requestAnimationFrame(tick)
    })

    if (!ready) {
      setSetupError('自动配置未完全成功，已先进入桌宠；你可以稍后在设置页重试。')
    }

    const finalNickname = customNickname.trim() || nickname
    const voiceStyle = activityLevel >= 65 ? '活泼碎碎念' : '温和陪伴型'

    try {
      window.localStorage.setItem('petclaw.userIdentity', 'student')
      window.localStorage.setItem('petclaw.studentInsights', JSON.stringify({
        learningRhythm: learningRhythmInsight,
        pressurePlan: pressurePlanInsight,
      }))
      window.localStorage.setItem('petclaw.moodLevel', pressurePlanInsight.level)
    } catch {
    }

    saveOnboardingState({
      version: 1,
      completed: true,
      completedAt: new Date().toISOString(),
      profile: {
        displayName: finalNickname,
        role: profileRole,
        language: '中文',
      },
      pet: {
        petName: finalNickname,
        personality: personalityTone,
        voiceStyle,
      },
      app: appSettings,
      studentInsights: {
        learningRhythm: learningRhythmInsight,
        pressurePlan: pressurePlanInsight,
      },
    })

    window.setTimeout(onFinish, 320)
  }

  const progressPercent = ((step + 1) / steps.length) * 100

  return (
    <div className="onboarding-shell">
      <div className="onboarding-header" data-electron-drag-region="true">
        <div className="onboarding-title-block" data-electron-no-drag="true">
          <p className="onboarding-kicker">PetClaw 初始化向导</p>
          <h1>{steps[step]}</h1>
          <p className="onboarding-step">已完成 {step + 1}/3</p>
        </div>
        <div className="onboarding-window-actions" data-electron-no-drag="true">
          <button onClick={() => window.electronAPI?.minimizeWindow?.()}>_</button>
          <button onClick={() => window.electronAPI?.toggleMaximizeWindow?.()}>[]</button>
          <button className="danger" onClick={() => window.electronAPI?.closeWindow?.()}>X</button>
        </div>
      </div>

      <div className="onboarding-progress"><span style={{ width: `${progressPercent}%` }} /></div>

      <div className="onboarding-content">
        <section className="onboarding-main" data-electron-no-drag="true">
          {step === 0 && (
            <div className="onboarding-card-grid">
              <label className="onboarding-card">
                <span>主修方向</span>
                <select value={profileRole} onChange={(event) => setProfileRole(event.target.value)}>
                  {majors.map((major) => <option key={major} value={major}>{major}</option>)}
                </select>
              </label>

              <label className="onboarding-card">
                <span>常见入睡时间：{sleepHour.toString().padStart(2, '0')}:00</span>
                <input type="range" min={0} max={23} value={sleepHour} onChange={(event) => setSleepHour(Number(event.target.value))} />
              </label>

              <div className="onboarding-card">
                <span>破防词汇（多选）</span>
                <div className="chip-wrap">
                  {breakerVocabulary.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={selectedBreakers.includes(item) ? 'chip active' : 'chip'}
                      onClick={() => toggleBreaker(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <label className="onboarding-card">
                <span>课表导入（.ics）</span>
                <input type="file" accept=".ics" onChange={(event) => pickIcsFile(event.target.files?.[0] ?? null)} />
                <small>{icsFileName ? `已接收：${icsFileName}` : '可选：不导入也能继续'}</small>
              </label>

              <label className="onboarding-card">
                <span>学习压力感知：{anxietyLevel}%</span>
                <input type="range" min={0} max={100} value={anxietyLevel} onChange={(event) => setAnxietyLevel(Number(event.target.value))} />
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-card-grid">
              <div className="onboarding-card">
                <span>嘴替流派</span>
                <div className="chip-wrap">
                  {(['阴阳怪气', '抽象发疯', '甜心夹子'] as PersonalityTone[]).map((tone) => (
                    <button
                      type="button"
                      key={tone}
                      className={personalityTone === tone ? 'chip active' : 'chip'}
                      onClick={() => setPersonalityTone(tone)}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>

              <label className="onboarding-card">
                <span>显眼包指数：{activityLevel}%</span>
                <input type="range" min={0} max={100} value={activityLevel} onChange={(event) => setActivityLevel(Number(event.target.value))} />
              </label>

              <div className="onboarding-card">
                <span>认贼作父（昵称）</span>
                <div className="chip-wrap">
                  {nicknameTags.map((tag) => (
                    <button type="button" key={tag} className={nickname === tag ? 'chip active' : 'chip'} onClick={() => setNickname(tag)}>
                      {tag}
                    </button>
                  ))}
                </div>
                <input
                  placeholder="或者你起一个专属爱称"
                  value={customNickname}
                  onChange={(event) => setCustomNickname(event.target.value)}
                />
              </div>

              <label className="onboarding-card switch-row">
                <span>启动后自动连接</span>
                <input
                  type="checkbox"
                  checked={appSettings.autoConnectOnLaunch}
                  onChange={(event) => setAppSettings((prev) => ({ ...prev, autoConnectOnLaunch: event.target.checked }))}
                />
              </label>

              <label className="onboarding-card switch-row">
                <span>点击桌宠打开控制台</span>
                <input
                  type="checkbox"
                  checked={appSettings.openConsoleOnPetClick}
                  onChange={(event) => setAppSettings((prev) => ({ ...prev, openConsoleOnPetClick: event.target.checked }))}
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-card-grid">
              <label className="onboarding-card">
                <span>API Key（可选）</span>
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="不填也可继续" />
              </label>

              <div className="onboarding-card compact">
                <span>学习节奏</span>
                <p>{learningRhythmInsight.summary}</p>
                <p>高专注窗口：{learningRhythmInsight.focusWindows.join(' / ')}</p>
                <p>压力等级：{pressurePlanInsight.level}</p>
                <p>提醒间隔：{pressurePlanInsight.reminderIntervalsMinutes.join(' / ')} 分钟</p>
              </div>

              <div className="onboarding-card compact">
                <span>首条提醒预览</span>
                <p>{previewReminderText || '点击“试试第一条提醒”预览桌宠语气。'}</p>
                <button type="button" onClick={previewReminder}>试试第一条提醒</button>
              </div>
            </div>
          )}
        </section>

        <aside className="onboarding-aside" data-electron-no-drag="true">
          <p className="aside-label">桌宠候场区</p>
          <div className="pet-preview-panel">
            <img src={showcaseGifs[showcaseIndex]} alt="桌宠预览" />
          </div>
          <div className="onboarding-note">{setupRunning ? loadingComfortLines[loadingLineIndex] : '填完这一轮，桌宠就会按你的节奏出没。'}</div>
        </aside>
      </div>

      <div className="onboarding-footer" data-electron-no-drag="true">
        <button type="button" onClick={() => setStep((prev) => Math.max(0, prev - 1))} disabled={step === 0 || setupRunning}>上一步</button>
        {step < 2 ? (
          <button type="button" className="primary" onClick={() => setStep((prev) => Math.min(2, prev + 1))}>
            下一步
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => setShowCompletionCard(true)}>
            大功告成，召唤桌宠
          </button>
        )}
      </div>

      {showCompletionCard && (
        <div className="onboarding-modal" data-electron-no-drag="true">
          <div className="onboarding-modal-card">
            {!summonInProgress && (
              <>
                <h2>你的人设画像已准备好</h2>
                <p>确认后会自动完成环境检查和桌宠通信配置。</p>
                <div className="modal-actions">
                  <button type="button" onClick={() => setShowCompletionCard(false)}>再看一下</button>
                  <button type="button" className="primary" onClick={complete}>确认并召唤桌宠</button>
                </div>
              </>
            )}

            {summonInProgress && (
              <>
                <h2>正在召唤桌宠</h2>
                <p>{loadingComfortLines[loadingLineIndex]}</p>
                <div className="progress-rail"><span style={{ width: `${displayProgress}%` }} /></div>
                <p className="progress-label">{Math.round(displayProgress)}%</p>
                <div className="task-list">
                  {setupTasks.map((task) => (
                    <div key={task.id} className="task-row">
                      <span>{statusIcon(task.status)}</span>
                      <div>
                        <strong>{task.label}</strong>
                        <small>{task.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>
                {setupError && <div className="setup-error">{setupError}</div>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
