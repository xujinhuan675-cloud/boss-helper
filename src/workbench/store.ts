import { watch } from 'vue'

import { browser } from '#imports'
import { useConf } from '@/composables/conf'
import { confModelKey, isCompleteModel, useModel } from '@/composables/useModel'
import type { ModelConf } from '@/composables/useModel'
import { RESUME_STORAGE_KEY, useResumes } from '@/composables/useResume'
import type { ResumeStoreData } from '@/composables/useResume'
import { statisticsKey, todayKey } from '@/composables/useStatistics'
import type { BossJobLibraryRecord } from '@/entrypoints/boss/jobStore'
import { counter } from '@/message'
import type { FormData, Statistics } from '@/types/formData'

import { MATCH_SCORING_VERSION } from '../composables/useApplying/scoring'
import { getSavedJobData } from '../entrypoints/boss/jobData'
import type { JobLibraryMutation } from '../entrypoints/boss/jobLibraryStorage'
import {
  assertJobLibrary,
  JOB_LIBRARY_STORAGE_KEY,
  normalizeJobLibraryAnalysis,
} from '../entrypoints/boss/jobStore'
import {
  createKeywordRotationPlan,
  DEFAULT_JOB_KEYWORDS,
  isKeywordRotationPlan,
  KEYWORD_ROTATION_STORAGE_KEY,
  normalizeKeywordList,
} from '../entrypoints/boss/keywordRotation'
import { SavedJobAnalyzer } from '../entrypoints/boss/savedAnalysis'
import type { SavedAnalysisRun } from '../entrypoints/boss/savedAnalysis'
import { jsonClone } from '../utils/deepmerge'
import { diagnostic } from '../utils/diagnostics'
import { requestExecutor } from './client'
import type { ExecutorCommand, ExecutorSnapshot } from './protocol'
import { validateConfig, validateModels } from './settingsValidation'
import { isStatistics } from './statistics'

export const services = { conf: useConf(), models: useModel(), resumes: useResumes() }

export type WorkbenchState = {
  loading: boolean
  error: string
  libraryError: string
  connectionError: string
  settingsWarning: string
  saving: boolean
  records: BossJobLibraryRecord[]
  today: Statistics | null
  statistics: Statistics[]
  config: FormData
  models: ModelConf[]
  resumes: ResumeStoreData
  keywords: string
  presets: { label: string; value: string }[]
  preset: string
  tabs: { id: number; title: string; url: string }[]
  tabId: number | null
  runtime: ExecutorSnapshot | null
  connected: boolean
  analysisBusy: boolean
  analysisRun: SavedAnalysisRun | null
}

let state: WorkbenchState = {
  loading: true,
  error: '',
  libraryError: '',
  connectionError: '',
  settingsWarning: '',
  saving: false,
  records: [],
  today: null,
  statistics: [],
  config: jsonClone(services.conf.formData),
  models: [],
  resumes: { resumes: [], currentResumeId: null },
  keywords: DEFAULT_JOB_KEYWORDS.join('\n'),
  presets: [],
  preset: 'default',
  tabs: [],
  tabId: null,
  runtime: null,
  connected: false,
  analysisBusy: false,
  analysisRun: null,
}
const listeners = new Set<() => void>()
export const getWorkbenchState = () => state
export const subscribeWorkbench = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function update(patch: Partial<WorkbenchState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// shortcut: Runs stop when this document closes; move to background when continuation is required.
const savedAnalyzer = new SavedJobAnalyzer({
  ...services,
  getJobLibrary: async () => {
    const records = await counter.storageGet<unknown>(JOB_LIBRARY_STORAGE_KEY, [])
    assertJobLibrary(records)
    return normalizeJobLibraryAnalysis(records, MATCH_SCORING_VERSION)
  },
  getSavedJobData,
  saveJobAnalysis: async (jobId, patch) => {
    const timer = setTimeout(() => update({ error: '岗位分析保存尚未响应；请等待保存确认' }), 8000)
    try {
      return (await counter.updateJobLibrary({ type: 'analysis', jobId, patch })).updated
    } finally {
      clearTimeout(timer)
    }
  },
  claimJobAnalysis: (id, token, duration) => counter.claimJobAnalysis(id, token, duration),
  releaseJobAnalysis: (id, token) => counter.releaseJobAnalysis(id, token),
})
watch(savedAnalyzer.run, (run) => update({ analysisRun: jsonClone(run) }), {
  deep: true,
  flush: 'sync',
})

export async function startSavedAnalysis({
  limit = 20,
  jobId,
}: { limit?: number; jobId?: string } = {}) {
  if (state.analysisBusy) throw new Error('本地岗位分析正在进行，请等待当前请求结束')
  await services.conf.confInit()
  const models = await counter.storageGet<unknown>(confModelKey, [])
  validateModels(models)
  services.models.modelData.value = jsonClone(models)
  await services.resumes.init(services.conf.formData.resumeText)
  if (jobId) await savedAnalyzer.validateOne(jobId)
  const task = savedAnalyzer.start({ limit: jobId ? 1 : limit, ...(jobId ? { jobId } : {}) })
  // Validation runs before the first await; rejected starts still reach the caller.
  if (!savedAnalyzer.busy.value) {
    await task
    return
  }
  update({ analysisBusy: true, error: '' })
  void task
    .then((run) => {
      if (run.error) update({ error: run.error })
    })
    .catch((error) => update({ error: message(error) }))
    .finally(() => {
      update({ analysisBusy: false })
      void refreshLibrary()
    })
}

export async function stopSavedAnalysis() {
  savedAnalyzer.stop()
}

export async function updateSavedJob(
  mutation: Extract<JobLibraryMutation, { type: 'funnel' | 'processing' }>,
) {
  await counter.updateJobLibrary(mutation)
  await refreshLibrary()
}

export async function deleteSavedJob(jobId: string) {
  await counter.updateJobLibrary({ type: 'delete', jobId })
}

export async function deleteSavedJobs(jobIds: string[]) {
  await counter.updateJobLibrary({ type: 'deleteMany', jobIds })
}

watch(
  [
    services.conf.formData,
    services.conf.formDataPreset,
    services.conf.formDataPresets,
    services.models.modelData,
    services.resumes.resumes,
    services.resumes.currentResumeId,
  ],
  () => {
    try {
      validateConfig(services.conf.formData)
      validateModels(services.models.modelData.value)
      update({
        config: jsonClone(services.conf.formData),
        preset: services.conf.formDataPreset.value,
        presets: jsonClone(services.conf.formDataPresets.value),
        models: jsonClone(services.models.modelData.value),
        resumes: jsonClone({
          resumes: services.resumes.resumes.value,
          currentResumeId: services.resumes.currentResumeId.value,
        }),
      })
    } catch (error) {
      update({ error: message(error) })
    }
  },
  { deep: true, immediate: true },
)

export async function perform<T>(work: () => Promise<T>): Promise<T> {
  if (state.saving) throw new Error('请等待当前操作完成')
  update({ saving: true, error: '' })
  try {
    await settingsRefresh
    return await work()
  } catch (error) {
    diagnostic('workbench.action', { error })
    update({ error: message(error) })
    throw error
  } finally {
    update({ saving: false })
    settingsChanged = true
    void refreshSettings()
  }
}

export async function refreshLibrary() {
  try {
    const records = await counter.storageGet<unknown>(JOB_LIBRARY_STORAGE_KEY, [])
    assertJobLibrary(records)
    update({
      records: normalizeJobLibraryAnalysis(records, MATCH_SCORING_VERSION),
      libraryError: '',
    })
  } catch (error) {
    diagnostic('library.read', { error })
    update({ libraryError: message(error) })
  }
}

async function refreshKeywords() {
  try {
    const plan = await counter.storageGet<unknown>(KEYWORD_ROTATION_STORAGE_KEY, null)
    if (plan !== null && !isKeywordRotationPlan(plan))
      throw new Error('岗位关键词格式无效，原数据已保留')
    update({
      keywords: plan
        ? plan.items
            .filter((item) => item.enabled)
            .map((item) => item.keyword)
            .join('\n')
        : DEFAULT_JOB_KEYWORDS.join('\n'),
    })
  } catch (error) {
    diagnostic('keywords.read', { error })
    update({ error: message(error) })
  }
}

export async function saveKeywords(input: string) {
  const keywords = normalizeKeywordList(input)
  if (!keywords.length) throw new Error('请至少输入一个岗位关键词')
  if (state.connected) {
    await command({ type: 'saveKeywords', input: keywords.join('\n') })
  } else {
    const stored = await counter.storageGet<unknown>(KEYWORD_ROTATION_STORAGE_KEY, null)
    if (stored !== null && !isKeywordRotationPlan(stored))
      throw new Error('岗位关键词格式无效，原数据已保留')
    if (stored?.status === 'running')
      throw new Error('关键词轮换正在运行，请先连接 BOSS 页面并停止轮换')
    const selected = state.tabs.find((tab) => tab.id === state.tabId)
    const url = new URL(
      selected?.url || stored?.baseSearchUrl || 'https://www.zhipin.com/web/geek/jobs',
    )
    const plan = createKeywordRotationPlan(keywords, {
      baseSearchUrl: url.href,
      salary: url.searchParams.get('salary') ?? '',
      city: url.searchParams.get('city') ?? '',
    })
    plan.status = 'idle'
    await counter.storageSet(KEYWORD_ROTATION_STORAGE_KEY, plan)
  }
  await refreshKeywords()
}

let polling = false
let chatJobKey: string | undefined
export async function refreshRuntime() {
  if (polling) return
  polling = true
  const target = state.tabId
  const selectedChat = chatJobKey
  try {
    if (target === null) {
      update({ runtime: null, connected: false })
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let runtime: ExecutorSnapshot
    try {
      runtime = (await Promise.race([
        requestExecutor((id, request) => browser.tabs.sendMessage(id, request), target, {
          type: 'snapshot',
          ...(chatJobKey ? { chatJobKey } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('执行器尚未响应，请确认 BOSS 页面已加载')
            diagnostic('executor.snapshot.timeout', {
              error,
              context: { tabId: target, timeoutMs: 5000 },
            })
            reject(error)
          }, 5000)
        }),
      ])) as ExecutorSnapshot
    } finally {
      clearTimeout(timer)
    }
    if (!runtime || typeof runtime.ready !== 'boolean')
      throw new Error('执行器版本不匹配，请刷新 BOSS 页面')
    if (target === state.tabId && selectedChat === chatJobKey)
      update({
        runtime,
        connected: runtime.ready,
        connectionError: runtime.error,
      })
  } catch (error) {
    if (target === state.tabId)
      update({ runtime: null, connected: false, connectionError: message(error) })
  } finally {
    polling = false
  }
}

export async function refreshTabs() {
  const tabs = (
    await browser.tabs.query({ url: ['*://zhipin.com/*', '*://*.zhipin.com/*'] })
  ).filter(
    (tab) =>
      tab.id !== undefined &&
      /^https?:\/\/(?:[^/]+\.)?zhipin\.com\/web\/geek\/(?:jobs|job-recommend)\/?(?:[?#]|$)/.test(
        tab.url || '',
      ),
  )
  const selected =
    tabs.find((tab) => tab.id === state.tabId) ?? tabs.find((tab) => tab.active) ?? tabs[0]
  const tabId = selected?.id ?? null
  const changed = tabId !== state.tabId
  update({
    tabs: tabs.map((tab) => ({ id: tab.id!, title: tab.title || 'BOSS 直聘', url: tab.url || '' })),
    tabId,
    ...(changed ? { runtime: null, connected: false, connectionError: '' } : {}),
  })
  await refreshRuntime()
}

export async function reconnectExecutor() {
  await refreshTabs()
  if (!state.connected) await command({ type: 'reloadSettings' })
}

export function selectTab(tabId: number) {
  if (!state.tabs.some((tab) => tab.id === tabId)) return
  chatJobKey = undefined
  update({ tabId, runtime: null, connected: false, connectionError: '' })
  void refreshRuntime()
}
export function selectChat(key: string) {
  chatJobKey = key
  void refreshRuntime()
}

export async function command(command: ExecutorCommand) {
  if (state.tabId === null) await refreshTabs()
  const tabId = state.tabId
  if (tabId === null) throw new Error('请先打开 BOSS 职位搜索页，再重试此操作')
  const send = (value: ExecutorCommand) =>
    requestExecutor((id, request) => browser.tabs.sendMessage(id, request), tabId, value)
  try {
    if (
      [
        'collect',
        'rotate',
        'analyze',
        'analyzeOne',
        'startDelivery',
        'sendGreeting',
        'extractKeywords',
      ].includes(command.type)
    ) {
      await send({ type: 'reloadSettings' })
      update({ settingsWarning: '' })
    }
    const result = await send(command)
    if (command.type === 'extractKeywords') {
      if (!Array.isArray(result) || result.some((keyword) => typeof keyword !== 'string'))
        throw new Error('提取的岗位关键词格式无效，请重试')
      update({ keywords: normalizeKeywordList(result).join('\n') })
    }
    return result
  } finally {
    await refreshRuntime()
  }
}

export async function saveConfig(
  patch: Partial<FormData>,
  preset = services.conf.formDataPreset.value,
) {
  await services.conf.confInit()
  if (preset !== services.conf.formDataPreset.value)
    throw new Error('预设已在其他窗口切换，请重新载入后保存')
  const next = { ...jsonClone(services.conf.formData), ...jsonClone(patch) }
  validateConfig(next)
  Object.assign(services.conf.formData, next)
  await services.conf.confSaving()
  await reloadExecutorSettings()
  if (patch.nativeSearch) {
    if (!state.connected) {
      update({ settingsWarning: '配置已保存，尚未同步到 BOSS；连接岗位页后请点击“应用到 BOSS”。' })
      return
    }
    try {
      await command({ type: 'applyNativeFilters', filters: next.nativeSearch! })
      update({ settingsWarning: '' })
    } catch (error) {
      diagnostic('settings.applyNativeFilters', { error })
      const warning = `配置已保存，尚未同步到 BOSS：${message(error)}`
      update({ settingsWarning: warning })
      throw new Error(warning)
    }
  }
}
export async function reloadExecutorSettings() {
  if (!state.connected) return
  try {
    await command({ type: 'reloadSettings' })
    update({ settingsWarning: '' })
  } catch (error) {
    diagnostic('settings.reloadExecutor', { error })
    update({
      settingsWarning: '配置已保存；执行器将在下一次启动任务前重新读取。当前任务继续使用原配置。',
    })
  }
}
export async function saveModels(models: ModelConf[] | ((latest: ModelConf[]) => ModelConf[])) {
  const latest = await counter.storageGet<unknown>(confModelKey, [])
  validateModels(latest)
  const next = typeof models === 'function' ? models(jsonClone(latest)) : models
  validateModels(next)
  await services.models.saveModel(next)
  await reloadExecutorSettings()
}
export async function selectDefaultModel(key: string) {
  await saveModels((latest) => {
    const selected = latest.find((model) => model.key === key)
    if (!isCompleteModel(selected)) throw new Error('模型已在其他窗口变更，请重新选择默认模型')
    return [selected, ...latest.filter((model) => model.key !== key)]
  })
}
export async function saveResume(id: string | null, name: string, content: string) {
  await services.resumes.init(services.conf.formData.resumeText)
  if (id) await services.resumes.updateResume(id, name, content)
  else await services.resumes.createResume(name, content)
  await reloadExecutorSettings()
}
export async function selectResume(id: string | null) {
  await services.resumes.init(services.conf.formData.resumeText)
  await services.resumes.selectResume(id)
  await reloadExecutorSettings()
}
export async function deleteResume(id: string, replacementId?: string | null) {
  await services.resumes.init(services.conf.formData.resumeText)
  await services.resumes.deleteResume(id, replacementId)
  await reloadExecutorSettings()
}
export async function copyResume(id: string) {
  await services.resumes.init(services.conf.formData.resumeText)
  await services.resumes.copyResume(id)
  await reloadExecutorSettings()
}
export async function openWorkbench(view = 'jobs') {
  await browser.tabs.create({ url: browser.runtime.getURL(`/workbench.html#${view}`) })
}
let workbenchTabId: number | undefined
export async function openTaskPanel() {
  try {
    if (browser.sidePanel) {
      if (workbenchTabId === undefined) throw new Error('未找到当前扩展页，请刷新后重试')
      await browser.sidePanel.open({ tabId: workbenchTabId })
    } else {
      await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') })
    }
  } catch (error) {
    update({ error: message(error) })
  }
}
export async function openBoss() {
  const tab = state.tabs.find((tab) => tab.id === state.tabId)
  if (tab) {
    await browser.tabs.update(tab.id, { active: true })
  } else await browser.tabs.create({ url: 'https://www.zhipin.com/web/geek/jobs' })
}

let settingsChanged = false
let settingsRefresh: Promise<void> | undefined
async function refreshSettings() {
  if (settingsRefresh) return settingsRefresh
  if (!settingsChanged || state.saving) return
  settingsRefresh = (async () => {
    settingsChanged = false
    try {
      await services.conf.confInit()
      validateConfig(services.conf.formData)
      const models = await counter.storageGet<unknown>(confModelKey, [])
      validateModels(models)
      services.models.modelData.value = jsonClone(models)
      await services.resumes.init(services.conf.formData.resumeText)
    } catch (error) {
      diagnostic('settings.refresh', { error })
      update({ error: message(error) })
    } finally {
      settingsRefresh = undefined
      if (settingsChanged) void refreshSettings()
    }
  })()
  return settingsRefresh
}

export async function initializeWorkbench() {
  settingsChanged = true
  await refreshSettings()
  await refreshLibrary()
  await refreshKeywords()
  try {
    await refreshStatistics()
  } catch (error) {
    update({ error: message(error) })
  }
  try {
    // Read before the click so opening the panel preserves the user gesture.
    if (browser.sidePanel) workbenchTabId = (await browser.tabs.getCurrent())?.id
    await refreshTabs()
  } catch (error) {
    update({ error: message(error) })
  }
  update({ loading: false })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEYWORD_ROTATION_STORAGE_KEY.replace('local:', '')])
      void refreshKeywords()
    if (area === 'local' && changes[JOB_LIBRARY_STORAGE_KEY.replace('local:', '')])
      void refreshLibrary()
    if (
      area === 'local' &&
      (changes[todayKey.replace('local:', '')] || changes[statisticsKey.replace('local:', '')])
    ) {
      void refreshStatistics().catch((error) => update({ error: message(error) }))
    }
    if (
      (area === 'sync' && changes[confModelKey]) ||
      (area === 'local' &&
        Object.keys(changes).some(
          (key) =>
            key.startsWith('web-geek-job-FormData') ||
            key.startsWith('FormDataPrese') ||
            key === RESUME_STORAGE_KEY.replace('local:', ''),
        ))
    ) {
      settingsChanged = true
      void refreshSettings()
    }
  })
  browser.tabs.onRemoved.addListener(() => {
    void refreshTabs()
  })
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.url?.includes('zhipin.com/')) void refreshTabs()
  })
  browser.tabs.onUpdated.addListener((id, changes, tab) => {
    if (
      (changes.status === 'complete' || changes.url) &&
      (state.tabs.some((item) => item.id === id) || tab.url?.includes('zhipin.com/'))
    )
      void refreshTabs()
  })
  setInterval(() => {
    void refreshRuntime()
  }, 1500)
}

async function refreshStatistics() {
  const today = await counter.storageGet<unknown>(todayKey, null)
  const statistics = await counter.storageGet<unknown>(statisticsKey, [])
  if (
    (today !== null && !isStatistics(today)) ||
    !Array.isArray(statistics) ||
    !statistics.every(isStatistics)
  )
    throw new Error('投递统计格式无效，原数据已保留')
  update({ today, statistics })
}
