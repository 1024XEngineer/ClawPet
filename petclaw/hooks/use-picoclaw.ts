"use client"

import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'
import {
  authApi,
  gatewayApi,
  modelsApi,
  channelsApi,
  skillsApi,
  toolsApi,
  cronApi,
  configApi,
  logsApi,
  type Model,
  type Channel,
  type Skill,
  type Tool,
  type CronJob,
  type Config,
} from '@/lib/api'

// 通用 fetcher
const fetcher = <T>(fn: () => Promise<T>) => fn()

// 认证状态
export function useAuthStatus() {
  return useSWR('auth-status', () => fetcher(authApi.status), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
}

export function useLogin() {
  return useSWRMutation('auth-login', (_, { arg }: { arg: string }) =>
    authApi.login(arg)
  )
}

export function useLogout() {
  return useSWRMutation('auth-logout', () => authApi.logout())
}

// 网关状态
export function useGatewayStatus() {
  return useSWR('gateway-status', () => fetcher(gatewayApi.status), {
    refreshInterval: 5000, // 每 5 秒刷新
  })
}

export function useGatewayControl() {
  const start = useSWRMutation('gateway-start', () => gatewayApi.start())
  const stop = useSWRMutation('gateway-stop', () => gatewayApi.stop())
  const restart = useSWRMutation('gateway-restart', () => gatewayApi.restart())
  return { start, stop, restart }
}

// 模型管理
export function useModels() {
  return useSWR('models', () => fetcher(modelsApi.list))
}

export function useDefaultModel() {
  return useSWR('default-model', () => fetcher(modelsApi.getDefault))
}

export function useModelMutations() {
  const create = useSWRMutation(
    'models',
    (_, { arg }: { arg: Omit<Model, 'id' | 'isDefault' | 'hasCredentials'> }) =>
      modelsApi.create(arg)
  )
  const update = useSWRMutation(
    'models',
    (_, { arg }: { arg: { id: string; model: Partial<Model> } }) =>
      modelsApi.update(arg.id, arg.model)
  )
  const remove = useSWRMutation('models', (_, { arg }: { arg: string }) =>
    modelsApi.delete(arg)
  )
  const setDefault = useSWRMutation(
    'default-model',
    (_, { arg }: { arg: string }) => modelsApi.setDefault(arg)
  )
  return { create, update, remove, setDefault }
}

// 渠道管理
export function useChannels() {
  return useSWR('channels', () => fetcher(channelsApi.list))
}

export function useChannelCatalog() {
  return useSWR('channel-catalog', () => fetcher(channelsApi.catalog))
}

export function useChannelMutations() {
  const enable = useSWRMutation('channels', (_, { arg }: { arg: string }) =>
    channelsApi.enable(arg)
  )
  const disable = useSWRMutation('channels', (_, { arg }: { arg: string }) =>
    channelsApi.disable(arg)
  )
  const updateConfig = useSWRMutation(
    'channels',
    (_, { arg }: { arg: { id: string; config: Record<string, unknown> } }) =>
      channelsApi.updateConfig(arg.id, arg.config)
  )
  return { enable, disable, updateConfig }
}

// 技能管理
export function useSkills() {
  return useSWR('skills', () => fetcher(skillsApi.list))
}

export function useBuiltinSkills() {
  return useSWR('skills-builtin', () => fetcher(skillsApi.builtin))
}

export function useWorkspaceSkills() {
  return useSWR('skills-workspace', () => fetcher(skillsApi.workspace))
}

export function useSkillMutations() {
  const importSkill = useSWRMutation(
    'skills',
    (_, { arg }: { arg: string }) => skillsApi.import(arg)
  )
  const remove = useSWRMutation('skills', (_, { arg }: { arg: string }) =>
    skillsApi.delete(arg)
  )
  return { importSkill, remove }
}

// 工具管理
export function useTools() {
  return useSWR('tools', () => fetcher(toolsApi.list))
}

export function useToggleTool() {
  return useSWRMutation(
    'tools',
    (_, { arg }: { arg: { id: string; enabled: boolean } }) =>
      toolsApi.toggle(arg.id, arg.enabled)
  )
}

// 定时任务
export function useCronJobs() {
  return useSWR('cron-jobs', () => fetcher(cronApi.list))
}

export function useCronMutations() {
  const create = useSWRMutation(
    'cron-jobs',
    (_, { arg }: { arg: Omit<CronJob, 'id' | 'lastRun' | 'nextRun'> }) =>
      cronApi.create(arg)
  )
  const update = useSWRMutation(
    'cron-jobs',
    (_, { arg }: { arg: { id: string; job: Partial<CronJob> } }) =>
      cronApi.update(arg.id, arg.job)
  )
  const remove = useSWRMutation('cron-jobs', (_, { arg }: { arg: string }) =>
    cronApi.delete(arg)
  )
  const toggle = useSWRMutation(
    'cron-jobs',
    (_, { arg }: { arg: { id: string; enabled: boolean } }) =>
      cronApi.toggle(arg.id, arg.enabled)
  )
  return { create, update, remove, toggle }
}

// 配置管理
export function useConfig() {
  return useSWR('config', () => fetcher(configApi.get))
}

export function useUpdateConfig() {
  return useSWRMutation(
    'config',
    (_, { arg }: { arg: Partial<Config> }) => configApi.update(arg)
  )
}

// 日志
export function useLogs() {
  return useSWR('logs', () => fetcher(logsApi.get), {
    refreshInterval: 3000, // 每 3 秒刷新
  })
}

export function useClearLogs() {
  return useSWRMutation('logs', () => logsApi.clear())
}
