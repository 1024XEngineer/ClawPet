export interface StudentInsightInput {
  major: string
  sleepHour: number
  anxietyLevel: number
  deadlineDate: string
  selectedBreakers: string[]
  hasScheduleFile: boolean
}

export interface LearningRhythmInsight {
  chronotype: 'morning' | 'balanced' | 'night'
  focusWindows: string[]
  quietWindows: string[]
  reminderCadence: 'light' | 'standard' | 'intensive'
  summary: string
}

export interface PressurePlanInsight {
  level: 'low' | 'medium' | 'high' | 'critical'
  strategy: string
  reminderIntervalsMinutes: number[]
  toneGuide: string
  templates: {
    soft: string
    normal: string
    strong: string
  }
}

function getDaysUntil(dateText: string): number | null {
  if (!dateText) return null
  const target = new Date(dateText)
  if (Number.isNaN(target.getTime())) return null

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const ms = targetDay.getTime() - today.getTime()
  return Math.floor(ms / 86400000)
}

export function buildLearningRhythm(input: StudentInsightInput): LearningRhythmInsight {
  const chronotype = input.sleepHour <= 0 || input.sleepHour >= 2
    ? 'night'
    : input.sleepHour <= 22
      ? 'morning'
      : 'balanced'

  const focusWindows = chronotype === 'night'
    ? ['10:00-12:00', '15:00-17:00', '20:30-23:00']
    : chronotype === 'morning'
      ? ['08:00-10:30', '14:00-16:00', '19:30-21:30']
      : ['09:00-11:00', '15:00-17:00', '20:00-22:00']

  const quietWindows = input.hasScheduleFile
    ? ['上课时段自动降噪', '23:30-07:30 默认静默']
    : ['23:30-07:30 默认静默']

  const reminderCadence = input.anxietyLevel >= 75
    ? 'intensive'
    : input.anxietyLevel >= 45
      ? 'standard'
      : 'light'

  const summary = `${input.major}方向，${chronotype === 'night' ? '夜型' : chronotype === 'morning' ? '晨型' : '均衡型'}节奏，提醒强度${reminderCadence === 'intensive' ? '高' : reminderCadence === 'standard' ? '中' : '低'}。`

  return {
    chronotype,
    focusWindows,
    quietWindows,
    reminderCadence,
    summary,
  }
}

export function buildPressurePlan(input: StudentInsightInput): PressurePlanInsight {
  const daysUntil = getDaysUntil(input.deadlineDate)
  const breakerWeight = Math.min(20, input.selectedBreakers.length * 4)
  const ddlWeight = daysUntil === null ? 0 : daysUntil <= 1 ? 30 : daysUntil <= 3 ? 20 : daysUntil <= 7 ? 10 : 0
  const score = Math.min(100, input.anxietyLevel + breakerWeight + ddlWeight)

  const level = score >= 85 ? 'critical' : score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low'

  const reminderIntervalsMinutes = level === 'critical'
    ? [240, 120, 45, 15]
    : level === 'high'
      ? [360, 180, 60]
      : level === 'medium'
        ? [480, 240, 90]
        : [720, 360]

  const strategy = level === 'critical'
    ? '开启强提醒，任务拆分为可执行小步，并缩短催办间隔。'
    : level === 'high'
      ? '保持连续督促，优先推进最临近的1-2个任务。'
      : level === 'medium'
        ? '维持日常提醒，早晚各做一次任务盘点。'
        : '轻提醒陪跑，以节奏稳定和复盘为主。'

  const toneGuide = level === 'critical'
    ? '直接、短句、结果导向'
    : level === 'high'
      ? '坚定推进，减少情绪化措辞'
      : level === 'medium'
        ? '鼓励 + 提醒并重'
        : '温和陪伴，防打扰'

  return {
    level,
    strategy,
    reminderIntervalsMinutes,
    toneGuide,
    templates: {
      soft: '先做10分钟就好，开个头我们就赢一半。',
      normal: '现在是你计划的推进窗口，先把最小任务做完。',
      strong: 'DDL 进入关键区间，先停下分心项，立即执行当前任务。',
    },
  }
}
