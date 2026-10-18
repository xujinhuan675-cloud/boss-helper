// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'

import { nextTick, reactive, ref } from 'vue'

import { defaultFormData } from '../composables/conf/info'
import { JobLibraryStorage } from '../entrypoints/boss/jobLibraryStorage'
import { mergeJobRecords, JOB_LIBRARY_STORAGE_KEY } from '../entrypoints/boss/jobStore'
import {
  createKeywordRotationPlan,
  DEFAULT_JOB_KEYWORDS,
  KEYWORD_ROTATION_STORAGE_KEY,
} from '../entrypoints/boss/keywordRotation'
import { jsonClone } from '../utils/deepmerge'

const stored = new Map()
const events = {}
const event = (name) => ({
  addListener: (listener) => {
    events[name] = listener
  },
})
const tabs = [
  { id: 1, title: 'first', url: 'https://www.zhipin.com/web/geek/jobs', active: true },
  { id: 2, title: 'second', url: 'https://www.zhipin.com/web/geek/jobs' },
]
let send = async () => ({ ok: true, data: { ready: true, error: '' } })
const calls = []
const panelCalls = []
const createdTabs = []
let panelError = ''
mock.module('#imports', () => ({
  browser: {
    runtime: { getURL: (path) => `chrome-extension://test${path}` },
    sidePanel: {
      open: async (options) => {
        if (panelError) throw new Error(panelError)
        panelCalls.push(options)
      },
    },
    tabs: {
      getCurrent: async () => ({ id: 21, windowId: 7 }),
      query: async () => tabs,
      create: async (options) => createdTabs.push(options),
      sendMessage: async (id, request) => {
        calls.push([id, request.command])
        return send(id, request)
      },
      onRemoved: event('removed'),
      onCreated: event('created'),
      onUpdated: event('updated'),
    },
    storage: { onChanged: event('storage') },
  },
}))
const config = reactive(jsonClone(defaultFormData))
let reading = async () => {}
const preset = ref('default')
const conf = {
  formData: config,
  formDataPreset: preset,
  formDataPresets: ref([{ label: '默认', value: 'default' }]),
  confInit: async () => {
    await reading()
    Object.assign(config, jsonClone(stored.get('config') ?? defaultFormData))
    preset.value = stored.get('preset') ?? 'default'
  },
  confSaving: async () => {
    stored.set('config', jsonClone(config))
  },
}
mock.module('@/composables/conf', () => ({ useConf: () => conf }))
const models = {
  modelData: ref([]),
  getDefaultModelKey: () => models.modelData.value[0]?.key,
  saveModel: async (value) => {
    stored.set('conf-model', value)
    models.modelData.value = value
  },
}
mock.module('@/composables/useModel', () => ({
  confModelKey: 'conf-model',
  useModel: () => models,
  isCompleteModel: (model) =>
    [model?.data?.api_key, model?.data?.base_url, model?.data?.model].every(
      (field) => typeof field === 'string' && !!field.trim(),
    ),
}))
const resumes = {
  resumes: ref([]),
  currentResumeId: ref(null),
  currentResume: ref(null),
  init: async () => {},
}
mock.module('@/composables/useResume', () => ({
  RESUME_STORAGE_KEY: 'local:boss-helper:resumes:v1',
  useResumes: () => resumes,
}))
mock.module('@/composables/useStatistics', () => ({
  todayKey: 'local:today',
  statisticsKey: 'local:history',
}))
let modelReadError = false
const library = new JobLibraryStorage({
  getItem: async (key) => jsonClone(stored.get(key) ?? null),
  setItem: async (key, value) => {
    stored.set(key, jsonClone(value))
  },
})
const modelCalls = []
mock.module('@/composables/useModel/chatModel', () => ({
  ChatModel: class {
    createAgent() {
      return true
    }
    async chat(role, data) {
      modelCalls.push({ role, jd: data.jobData.jobDescription })
      return {
        text:
          role === 'greetings'
            ? '你好，期待沟通。'
            : JSON.stringify({
                dimensions: [
                  { key: 'responsibilities', score: 30, reason: '匹配' },
                  { key: 'skills', score: 25, reason: '匹配' },
                  { key: 'experience', score: 20, reason: '匹配' },
                  { key: 'industry', score: 10, reason: '匹配' },
                  { key: 'preferences', score: 10, reason: '匹配' },
                ],
                strengths: [],
                gaps: [],
                hardRequirements: [],
                uncertainties: [],
              }),
      }
    }
  },
}))
mock.module('@/message', () => ({
  counter: {
    updateJobLibrary: (mutation) => library.update(mutation),
    claimJobAnalysis: (id, token, duration) => library.claimAnalysis(id, token, duration),
    releaseJobAnalysis: (id, token) => library.releaseAnalysis(id, token),
    storageGet: async (key, fallback) => {
      if (key === 'conf-model' && modelReadError) throw new Error('storage read failed')
      return jsonClone(stored.get(key) ?? fallback)
    },
    storageSet: async (key, value) => {
      stored.set(key, jsonClone(value))
    },
  },
}))
const interval = spyOn(globalThis, 'setInterval').mockReturnValue(0)
const store = await import('./store')
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await nextTick()
}
beforeAll(async () => {
  await store.initializeWorkbench()
  await settle()
})
afterAll(() => interval.mockRestore())

describe('workbench synchronization and mutation boundary', () => {
  test('bulk deletes saved jobs through background storage without executor messages', async () => {
    const original = stored.get(JOB_LIBRARY_STORAGE_KEY)
    try {
      stored.set(
        JOB_LIBRARY_STORAGE_KEY,
        mergeJobRecords(
          [],
          [{ encryptJobId: 'one' }, { encryptJobId: 'two' }, { encryptJobId: 'three' }],
          'AI',
          'batch',
        ).records,
      )
      calls.length = 0
      await store.perform(() => store.deleteSavedJobs(['one', 'three']))
      await store.refreshLibrary()
      expect(store.getWorkbenchState().records.map((record) => record.encryptJobId)).toEqual([
        'two',
      ])
      expect(calls).toEqual([])
    } finally {
      stored.set(JOB_LIBRARY_STORAGE_KEY, original ?? [])
      await store.refreshLibrary()
    }
  })

  test('analyzes saved JD without any BOSS tab or executor message', async () => {
    const original = [...tabs]
    const savedModels = stored.get('conf-model')
    const savedLibrary = stored.get(JOB_LIBRARY_STORAGE_KEY)
    try {
      tabs.length = 0
      await store.refreshTabs()
      stored.set('conf-model', [
        {
          key: 'model',
          name: '模型',
          data: { api_key: 'test', base_url: 'https://model.invalid/v1', model: 'saved-model' },
        },
      ])
      resumes.currentResume.value = { id: 'resume', name: '主简历', content: '完整简历正文' }
      const records = mergeJobRecords(
        [],
        [{ encryptJobId: 'offline', jobName: '产品经理' }],
        '产品',
        'batch',
      ).records
      Object.assign(records[0], {
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: '已采集的完整 JD' } },
      })
      stored.set(JOB_LIBRARY_STORAGE_KEY, records)
      calls.length = 0
      modelCalls.length = 0
      await store.perform(() => store.startSavedAnalysis({ limit: 1 }))
      for (let i = 0; i < 100 && store.getWorkbenchState().analysisBusy; i++) await settle()
      expect(calls).toEqual([])
      expect(modelCalls.map((call) => call.role)).toEqual(['filtering', 'greetings'])
      expect(modelCalls.every((call) => call.jd === '已采集的完整 JD')).toBe(true)
      expect(stored.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
        analysisStatus: 'ready',
        finalGreeting: '你好，期待沟通。',
      })
      expect(store.getWorkbenchState().analysisRun).toMatchObject({
        status: 'completed',
        completed: 1,
      })
    } finally {
      tabs.splice(0, tabs.length, ...original)
      stored.set('conf-model', savedModels ?? [])
      stored.set(JOB_LIBRARY_STORAGE_KEY, savedLibrary ?? [])
      resumes.currentResume.value = null
      await store.refreshTabs()
    }
  })

  test('saves native filters offline with a warning and synchronizes the same saved selection on reconnect', async () => {
    const filters = {
      query: 'AI产品经理',
      city: '101020100',
      jobType: '1901',
      salary: '405',
      experience: ['104', '105'],
      degree: [],
      stage: ['803'],
      scale: [],
      industry: [],
    }
    const originalSend = send
    try {
      send = async () => {
        throw new Error('offline')
      }
      await store.refreshRuntime()
      await store.saveConfig({ nativeSearch: filters })
      expect(stored.get('config').nativeSearch).toEqual(filters)
      expect(store.getWorkbenchState().settingsWarning).toContain('尚未同步')
      const sent = []
      send = async (_id, request) => {
        sent.push(request.command)
        return { ok: true, data: { ready: true, error: '' } }
      }
      await store.refreshRuntime()
      await store.saveConfig({ nativeSearch: filters })
      expect(sent).toContainEqual({ type: 'applyNativeFilters', filters })
      expect(store.getWorkbenchState().settingsWarning).toBe('')
      send = async (_id, request) =>
        request.command.type === 'applyNativeFilters'
          ? { ok: false, error: 'busy' }
          : { ok: true, data: { ready: true, error: '' } }
      await expect(store.saveConfig({ nativeSearch: filters })).rejects.toThrow('尚未同步')
      expect(stored.get('config').nativeSearch).toEqual(filters)
    } finally {
      send = originalSend
      stored.delete('config')
      await conf.confInit()
      await store.refreshRuntime()
    }
  })
  test('opens the native task panel and reports browser refusal', async () => {
    const opening = store.openTaskPanel()
    expect(panelCalls).toEqual([{ tabId: 21 }])
    await opening
    panelError = 'browser refused panel'
    try {
      await store.openTaskPanel()
      expect(store.getWorkbenchState().error).toBe(panelError)
    } finally {
      panelError = ''
    }
  })

  test('opens the existing task page when the browser has no side panel', async () => {
    const { browser } = await import('#imports')
    const panel = browser.sidePanel
    browser.sidePanel = undefined
    try {
      await store.openTaskPanel()
      expect(createdTabs.at(-1)).toEqual({ url: 'chrome-extension://test/sidepanel.html' })
    } finally {
      browser.sidePanel = panel
    }
  })

  test('excludes chat and detail pages from executor targets', async () => {
    const original = [...tabs]
    try {
      tabs.splice(
        0,
        tabs.length,
        { id: 9, title: 'chat', url: 'https://www.zhipin.com/web/geek/chat', active: true },
        { id: 10, title: 'detail', url: 'https://www.zhipin.com/job_detail/one.html' },
        { id: 11, title: 'jobs', url: 'https://www.zhipin.com/web/geek/job-recommend?city=1' },
      )
      await store.refreshTabs()
      expect(store.getWorkbenchState().tabs.map((tab) => tab.id)).toEqual([11])
      expect(store.getWorkbenchState().tabId).toBe(11)
      tabs.splice(0, tabs.length, tabs[0])
      await store.refreshTabs()
      expect(store.getWorkbenchState().tabId).toBeNull()
      expect(store.getWorkbenchState().runtime).toBeNull()
    } finally {
      tabs.splice(0, tabs.length, ...original)
      await store.refreshTabs()
    }
  })

  test('selects the default model from the latest storage and rejects removed models', async () => {
    const model = (key) => ({
      key,
      name: key,
      data: { api_key: 'key', base_url: 'https://example.com/v1', model: 'test' },
    })
    stored.set('conf-model', [model('one'), model('two'), model('external')])
    await store.perform(() => store.selectDefaultModel('two'))
    expect(stored.get('conf-model').map((item) => item.key)).toEqual(['two', 'one', 'external'])
    const saved = jsonClone(stored.get('conf-model'))
    await expect(store.perform(() => store.selectDefaultModel('removed'))).rejects.toThrow(
      '已在其他窗口变更',
    )
    expect(stored.get('conf-model')).toEqual(saved)
    await settle()
    stored.set('conf-model', [])
  })

  test('loads and saves editable keywords without a connected BOSS executor', async () => {
    expect(store.getWorkbenchState().keywords).toBe(DEFAULT_JOB_KEYWORDS.join('\n'))
    send = async () => {
      throw new Error('page unavailable')
    }
    await store.refreshRuntime()
    expect(store.getWorkbenchState().connected).toBe(false)
    const plan = createKeywordRotationPlan('已保存岗位\n停用岗位', {
      baseSearchUrl: tabs[0].url,
      city: '',
      salary: '',
    })
    plan.status = 'idle'
    plan.items[1].enabled = false
    stored.set(KEYWORD_ROTATION_STORAGE_KEY, plan)
    events.storage({ [KEYWORD_ROTATION_STORAGE_KEY.replace('local:', '')]: {} }, 'local')
    await settle()
    expect(store.getWorkbenchState().keywords).toBe('已保存岗位')
    calls.length = 0
    await store.perform(() => store.saveKeywords(' 手动岗位 \nAI产品经理\n手动岗位'))
    await settle()
    expect(store.getWorkbenchState().keywords).toBe('手动岗位\nAI产品经理')
    expect(stored.get(KEYWORD_ROTATION_STORAGE_KEY)).toMatchObject({
      status: 'idle',
      baseSearchUrl: tabs[0].url,
      items: [{ keyword: '手动岗位' }, { keyword: 'AI产品经理' }],
    })
    expect(calls).toEqual([])
    const saved = jsonClone(stored.get(KEYWORD_ROTATION_STORAGE_KEY))
    await expect(store.perform(() => store.saveKeywords(' \n'))).rejects.toThrow('关键词')
    expect(stored.get(KEYWORD_ROTATION_STORAGE_KEY)).toEqual(saved)
    saved.status = 'running'
    stored.set(KEYWORD_ROTATION_STORAGE_KEY, saved)
    await expect(store.perform(() => store.saveKeywords('覆盖'))).rejects.toThrow('轮换')
    expect(stored.get(KEYWORD_ROTATION_STORAGE_KEY)).toEqual(saved)
    send = async () => ({ ok: true, data: { ready: true, error: '' } })
    await store.refreshRuntime()
  })
  test('reconnects an unready executor before starting a task and keeps saved keywords on reconnect', async () => {
    send = async (_id, request) =>
      request.command.type === 'snapshot'
        ? { ok: true, data: { ready: false, error: 'page not ready', keywords: 'stale' } }
        : { ok: true }
    await store.refreshRuntime()
    const keywords = store.getWorkbenchState().keywords
    expect(store.getWorkbenchState().connected).toBe(false)
    calls.length = 0
    await store.command({ type: 'collect' })
    expect(calls.slice(0, 2).map(([, command]) => command.type)).toEqual([
      'reloadSettings',
      'collect',
    ])
    send = async () => ({ ok: true, data: { ready: true, error: '', keywords: 'stale' } })
    await store.refreshRuntime()
    expect(store.getWorkbenchState().keywords).toBe(keywords)
    send = async (_id, request) =>
      request.command.type === 'extractKeywords'
        ? { ok: true, data: ['提取岗位', 'AI产品经理'] }
        : { ok: true, data: { ready: true, error: '', keywords: 'stale' } }
    await store.command({ type: 'extractKeywords', input: 'resume' })
    expect(store.getWorkbenchState().keywords).toBe('提取岗位\nAI产品经理')
    send = async () => ({ ok: true, data: { ready: true, error: '' } })
  })
  test('rejects concurrent work and preserves a rejected save as an error', async () => {
    let release
    const running = store.perform(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await expect(store.perform(async () => {})).rejects.toThrow('等待')
    await settle()
    release()
    await running
    await settle()
    await expect(
      store.perform(async () => {
        throw new Error('disk full')
      }),
    ).rejects.toThrow('disk full')
    expect(store.getWorkbenchState().saving).toBe(false)
    expect(store.getWorkbenchState().error).toBe('disk full')
    await settle()
  })
  test('waits for external settings refresh before merging only touched configuration', async () => {
    stored.set('config', { ...jsonClone(defaultFormData), resumeText: 'external resume' })
    let release
    reading = () =>
      new Promise((resolve) => {
        release = resolve
      })
    events.storage({ 'web-geek-job-FormData': { newValue: {} } }, 'local')
    let savingStarted = false
    const saving = store.perform(async () => {
      savingStarted = true
      reading = async () => {}
      await store.saveConfig({ notification: { value: false } })
    })
    await settle()
    expect(savingStarted).toBe(false)
    release()
    await saving
    await settle()
    expect(stored.get('config').resumeText).toBe('external resume')
    expect(stored.get('config').notification.value).toBe(false)
  })
  test('refuses writing an old draft into another preset', async () => {
    stored.set('preset', 'other')
    const before = jsonClone(stored.get('config'))
    await expect(
      store.perform(() => store.saveConfig({ resumeText: 'wrong target' }, 'default')),
    ).rejects.toThrow('预设')
    expect(stored.get('config')).toEqual(before)
    await settle()
  })
  test('saves filters, task settings and greeting edits without overwriting other pages', async () => {
    const initial = jsonClone(defaultFormData)
    stored.set('config', initial)
    const company = { ...initial.company, enable: true, value: ['目标公司'] }
    const notification = { value: false }
    const aiGreeting = { ...initial.aiGreeting, enable: true }
    const customGreeting = { enable: true, value: '您好，我对这个岗位很感兴趣' }
    const greetingVariable = { value: true }

    await store.perform(() => store.saveConfig({ company }))
    await store.perform(() => store.saveConfig({ notification }))
    await store.perform(() => store.saveConfig({ aiGreeting, customGreeting, greetingVariable }))

    expect(stored.get('config')).toMatchObject({
      company,
      notification,
      aiGreeting,
      customGreeting,
      greetingVariable,
    })
    const saved = jsonClone(stored.get('config'))
    await expect(
      store.perform(() =>
        store.saveConfig({
          customGreeting: { enable: true, value: [{ type: 'image', image: 123 }] },
        }),
      ),
    ).rejects.toThrow('招呼语')
    expect(stored.get('config')).toEqual(saved)
    await settle()
  })
  test('reacts to cross-page model storage updates and keeps invalid storage intact', async () => {
    stored.set('conf-model', [{ key: 'one', name: 'external model' }])
    events.storage({ 'conf-model': { newValue: stored.get('conf-model') } }, 'sync')
    await settle()
    expect(store.getWorkbenchState().models[0].name).toBe('external model')
    stored.set('conf-model', [{ key: 'broken', name: {} }])
    events.storage({ 'conf-model': { newValue: stored.get('conf-model') } }, 'sync')
    await settle()
    expect(store.getWorkbenchState().models[0].name).toBe('external model')
    expect(store.getWorkbenchState().error).toContain('原有配置已保留')
    stored.set('conf-model', [])
  })
  test('applies a model edit after a pending cross-page refresh without losing new models', async () => {
    stored.set('conf-model', [{ key: 'one', name: 'one' }])
    events.storage({ 'conf-model': { newValue: stored.get('conf-model') } }, 'sync')
    await settle()
    let release
    reading = () =>
      new Promise((resolve) => {
        release = resolve
      })
    stored.set('conf-model', [
      { key: 'one', name: 'one' },
      { key: 'two', name: 'external' },
    ])
    events.storage({ 'conf-model': { newValue: stored.get('conf-model') } }, 'sync')
    const saving = store.perform(() =>
      store.saveModels((latest) => [...latest, { key: 'three', name: 'new model' }]),
    )
    await settle()
    expect(store.getWorkbenchState().models.map((model) => model.key)).toEqual(['one'])
    reading = async () => {}
    release()
    await saving
    await settle()
    expect(stored.get('conf-model').map((model) => model.key)).toEqual(['one', 'two', 'three'])
  })
  test('reads models again at mutation time even before a storage event arrives', async () => {
    stored.set('conf-model', [
      { key: 'one', name: 'changed elsewhere' },
      { key: 'two', name: 'two' },
    ])
    await store.perform(() => store.saveModels((latest) => [latest[1], latest[0]]))
    await settle()
    expect(stored.get('conf-model')).toEqual([
      { key: 'two', name: 'two' },
      { key: 'one', name: 'changed elsewhere' },
    ])
    stored.set('conf-model', [...stored.get('conf-model'), { key: 'four', name: 'another window' }])
    await store.perform(() =>
      store.saveModels((latest) => latest.filter((model) => model.key !== 'one')),
    )
    await settle()
    expect(stored.get('conf-model').map((model) => model.key)).toEqual(['two', 'four'])
  })
  test('refuses model writes when the latest stored list is invalid', async () => {
    const broken = [{ key: 'broken', name: {} }]
    stored.set('conf-model', broken)
    await expect(store.perform(() => store.saveModels(() => []))).rejects.toThrow()
    expect(stored.get('conf-model')).toEqual(broken)
    await settle()
    stored.set('conf-model', [])
  })
  test('preserves models when reading their latest storage fails', async () => {
    const original = [{ key: 'one', name: 'original' }]
    stored.set('conf-model', original)
    modelReadError = true
    try {
      await expect(
        store.perform(() => store.saveModels([{ key: 'new', name: 'new' }])),
      ).rejects.toThrow('storage read failed')
      expect(stored.get('conf-model')).toEqual(original)
      await settle()
    } finally {
      modelReadError = false
    }
  })
  test('does not render or overwrite a partially damaged library', async () => {
    const records = mergeJobRecords(
      [],
      [{ encryptJobId: 'saved', jobName: 'saved' }],
      'AI',
      'batch',
    ).records
    stored.set(JOB_LIBRARY_STORAGE_KEY, records)
    await store.refreshLibrary()
    stored.set(JOB_LIBRARY_STORAGE_KEY, [...records, { encryptJobId: 'broken' }])
    await store.refreshLibrary()
    expect(store.getWorkbenchState().records).toEqual(records)
    expect(store.getWorkbenchState().libraryError).toContain('已保留原数据')
    expect(stored.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(2)
  })
  test('drops an old tab response and reloads settings before starting a task', async () => {
    let release
    send = async (id) =>
      id === 1
        ? new Promise((resolve) => {
            release = resolve
          })
        : { ok: true, data: { ready: true, error: '', url: 'second' } }
    const polling = store.refreshRuntime()
    store.selectTab(2)
    release({ ok: true, data: { ready: true, error: '', url: 'old' } })
    await polling
    expect(store.getWorkbenchState().runtime).toBeNull()
    await store.refreshRuntime()
    expect(store.getWorkbenchState().runtime.url).toBe('second')
    calls.length = 0
    await store.command({ type: 'collect' })
    expect(calls.slice(0, 2)).toEqual([
      [2, { type: 'reloadSettings' }],
      [2, { type: 'collect' }],
    ])
  })
})
