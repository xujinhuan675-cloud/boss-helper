// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'

import { nextTick, reactive, ref } from 'vue'

import { defaultFormData } from '../composables/conf/info'
import { mergeJobRecords, JOB_LIBRARY_STORAGE_KEY } from '../entrypoints/boss/jobStore'
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
mock.module('#imports', () => ({
  browser: {
    tabs: {
      query: async () => tabs,
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
  saveModel: async (value) => {
    stored.set('conf-model', value)
    models.modelData.value = value
  },
}
mock.module('@/composables/useModel', () => ({
  confModelKey: 'conf-model',
  useModel: () => models,
}))
const resumes = { resumes: ref([]), currentResumeId: ref(null), init: async () => {} }
mock.module('@/composables/useResume', () => ({
  RESUME_STORAGE_KEY: 'local:boss-helper:resumes:v1',
  useResumes: () => resumes,
}))
mock.module('@/composables/useStatistics', () => ({
  todayKey: 'local:today',
  statisticsKey: 'local:history',
}))
mock.module('@/message', () => ({
  counter: { storageGet: async (key, fallback) => jsonClone(stored.get(key) ?? fallback) },
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
