// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { computed, ref } from 'vue'

import { jsonClone } from '../../utils/deepmerge'
import deepmerge, { isPlainObject } from '../../utils/deepmerge'
import { defaultFormData } from './info'

const saved = new Map()
let imported
let storageError: Error | undefined
let storageWriteError: Error | undefined
let storageWrites = 0
mock.module('@vueuse/core', () => ({
  useStorageAsync: (_key, value) => ref(value),
  watchThrottled() {},
  reactiveComputed: (fn) => computed(fn),
}))
mock.module('@/message', () => ({
  counter: {
    storageGet: async (key, fallback) => {
      if (storageError) throw storageError
      return jsonClone(saved.has(key) ? saved.get(key) : fallback)
    },
    storageSet: async (key, value) => {
      storageWrites++
      if (storageWriteError) throw storageWriteError
      return saved.set(key, jsonClone(value))
    },
  },
  ExtStorage: {},
}))
mock.module('@/utils/deepmerge', () => ({ default: deepmerge, isPlainObject, jsonClone }))
mock.module('@/utils/jsonImportExport', () => ({
  importJson: async () => jsonClone(imported),
  exportJson() {},
}))
mock.module('@/utils/logger', () => ({ logger: { debug() {}, error() {} } }))
globalThis.useToast = () => ({ add() {} })
const { useConf } = await import('./index')
const defaults = jsonClone(defaultFormData)

beforeEach(() => {
  saved.clear()
  imported = undefined
  storageError = undefined
  storageWriteError = undefined
  storageWrites = 0
  const conf = useConf()
  Object.assign(conf.formData, jsonClone(defaults))
  conf.formDataPreset.value = 'default'
  conf.formDataPresets.value = [{ label: '默认配置', value: 'default' }]
})

describe('percentage scoring configuration', () => {
  it('normalizes retired address, keyword modes and commute settings', async () => {
    const legacy = jsonClone(defaults)
    legacy.jobAddress = { value: ['downtown'], enable: true, include: true, options: [] }
    legacy.jobTitle = { value: ['intern'], options: [], enable: true, include: true }
    legacy.amap = {
      key: 'key',
      origins: '1,2',
      straightDistance: 10,
      drivingDistance: 30,
      drivingDuration: 45,
      walkingDistance: 5,
      walkingDuration: 60,
      enable: false,
    }
    saved.set('local:web-geek-job-FormData', legacy)
    const conf = useConf()
    Object.assign(conf.formData, legacy)
    await conf.confInit()

    expect(conf.formData).not.toHaveProperty('jobAddress')
    expect(conf.formData.jobTitle).toEqual({ value: ['intern'], options: [] })
    expect(conf.formData.amap).toEqual({ key: 'key', origins: '1,2', straightDistance: 0 })
    expect(saved.get('local:web-geek-job-FormData')).not.toHaveProperty('jobAddress')
  })

  it('removes retired local ranges from active settings and persisted presets', async () => {
    const config = jsonClone(defaults)
    config.salaryRange = { value: [8, 13, false], enable: true }
    config.companySizeRange = { value: [500, 2000, true], enable: true }
    saved.set('local:web-geek-job-FormData', config)
    const conf = useConf()
    Object.assign(conf.formData, config)
    await conf.confInit()
    for (const key of ['salaryRange', 'companySizeRange']) {
      expect(conf.formData).not.toHaveProperty(key)
      expect(saved.get('local:web-geek-job-FormData')).not.toHaveProperty(key)
    }
    expect(conf.formData.company).toEqual(config.company)
    await conf.confSaving()
    expect(saved.get('local:web-geek-job-FormData')).not.toHaveProperty('salaryRange')
  })
  it('strips retired ranges from older imports regardless of their format', async () => {
    const config = await useConf().prepareConfig({
      salaryRange: { value: '8-13' },
      companySizeRange: null,
    })
    expect(config).not.toHaveProperty('salaryRange')
    expect(config).not.toHaveProperty('companySizeRange')
  })
  it.each(['confReload', 'confImport'])(
    'removes retired fields from active settings through %s',
    async (method) => {
      const legacy = { ...jsonClone(defaults), salaryRange: null, companySizeRange: '500-2000' }
      saved.set('local:web-geek-job-FormData', legacy)
      imported = legacy
      const conf = useConf()
      Object.assign(conf.formData, legacy)
      await conf[method]()
      expect(conf.formData).not.toHaveProperty('salaryRange')
      expect(conf.formData).not.toHaveProperty('companySizeRange')
      await conf.confSaving()
      expect(saved.get('local:web-geek-job-FormData')).not.toHaveProperty('salaryRange')
      expect(saved.get('local:web-geek-job-FormData')).not.toHaveProperty('companySizeRange')
    },
  )
  it('preserves active and stored settings if retired-field cleanup cannot be persisted', async () => {
    const legacy = { ...jsonClone(defaults), salaryRange: { value: '8-13' } }
    saved.set('local:web-geek-job-FormData', legacy)
    const conf = useConf()
    const before = jsonClone(conf.formData)
    storageWriteError = new Error('cleanup write failed')
    await expect(conf.confInit()).rejects.toThrow('cleanup write failed')
    expect(jsonClone(conf.formData)).toEqual(before)
    expect(saved.get('local:web-geek-job-FormData')).toEqual(legacy)
  })
  it.each([
    ['local:FormDataPrese', null],
    ['local:FormDataPrese', []],
    ['local:FormDataPrese', ''],
    ['local:FormDataPreses', null],
    ['local:FormDataPreses', {}],
    ['local:FormDataPreses', [null]],
    ['local:FormDataPreses', [{ label: 'saved', value: 1 }]],
    ['local:FormDataPreses', [{ label: {}, value: 'saved' }]],
    ['local:web-geek-job-FormData', null],
    ['local:web-geek-job-FormData', []],
    ['local:web-geek-job-FormData', 'broken'],
  ])(
    'rejects malformed %s without writing or changing the active settings: %j',
    async (key, value) => {
      const conf = useConf()
      const before = jsonClone(conf.formData)
      const presetBefore = conf.formDataPreset.value
      const presetsBefore = jsonClone(conf.formDataPresets.value)
      saved.set(key, value)
      await expect(conf.confInit()).rejects.toThrow('格式异常')
      expect(jsonClone(conf.formData)).toEqual(before)
      expect(conf.formDataPreset.value).toBe(presetBefore)
      expect(jsonClone(conf.formDataPresets.value)).toEqual(presetsBefore)
      expect(storageWrites).toBe(0)
      expect(saved.get(key)).toEqual(value)
    },
  )

  it('reads a validated saved preset before replacing active settings', async () => {
    saved.set('local:FormDataPrese', 'saved')
    saved.set('local:FormDataPreses', [{ label: 'Saved', value: 'saved' }])
    saved.set('local:web-geek-job-FormData-saved', {
      version: '20261016',
      resumeText: 'Saved resume',
    })
    const conf = useConf()
    await conf.confInit()
    expect(conf.formDataPreset.value).toBe('saved')
    expect(jsonClone(conf.formDataPresets.value)).toEqual([{ label: 'Saved', value: 'saved' }])
    expect(conf.formData.resumeText).toBe('Saved resume')
    expect(storageWrites).toBe(0)
  })

  it('propagates migration failure without writing or replacing active settings', async () => {
    const malformed = { version: '20240401', delay: null }
    saved.set('local:web-geek-job-FormData', malformed)
    const conf = useConf()
    const before = jsonClone(conf.formData)
    await expect(conf.confInit()).rejects.toThrow()
    expect(jsonClone(conf.formData)).toEqual(before)
    expect(saved.get('local:web-geek-job-FormData')).toEqual(malformed)
    expect(storageWrites).toBe(0)
  })

  it.each(['createPreset', 'switchPreset'])(
    'propagates preset storage failure through %s',
    async (method) => {
      const conf = useConf()
      storageWriteError = new Error('preset write failed')
      await expect(conf[method]('another preset')).rejects.toThrow('preset write failed')
      expect(conf.isLoading.value).toBe(false)
    },
  )

  it('propagates read failures while switching to a saved preset', async () => {
    storageError = new Error('preset read failed')
    await expect(useConf().switchPreset('saved')).rejects.toThrow('preset read failed')
  })

  it('propagates initialization failures without replacing saved configuration', async () => {
    const stored = { ...defaults, resumeText: 'saved resume' }
    saved.set('local:web-geek-job-FormData', jsonClone(stored))
    storageError = new Error('storage unavailable')
    await expect(useConf().confInit()).rejects.toThrow('storage unavailable')
    expect(saved.get('local:web-geek-job-FormData')).toEqual(stored)
  })
  it.each(['confInit', 'confReload', 'confImport'])(
    'replaces obsolete scoring through %s with the current rubric',
    async (method) => {
      const old = {
        version: '20261015',
        aiFiltering: {
          enable: true,
          model: 'my-model',
          score: -5,
          prompt: [{ role: 'system', content: '返回 positive / negative，每项加减 10 分' }],
        },
      }
      imported = old
      saved.set('local:web-geek-job-FormData', old)
      const conf = useConf()
      await conf[method]()
      expect(jsonClone(conf.formData.aiFiltering)).toMatchObject({
        score: 70,
        scoringVersion: 'weighted-v1',
        enable: true,
        prompt: defaults.aiFiltering.prompt,
      })
      await conf.confSaving()
      expect(saved.get('local:web-geek-job-FormData').aiFiltering.score).toBe(70)
      expect(saved.get('local:web-geek-job-FormData').aiFiltering.legacyScore).toBeUndefined()
    },
  )

  it.each(['confInit', 'confReload', 'confImport'])(
    'removes legacy prompt model overrides through %s without changing prompt content',
    async (method) => {
      const legacy = jsonClone(defaults)
      for (const key of ['aiFiltering', 'aiGreeting', 'aiReply']) legacy[key].model = 'old-model'
      imported = legacy
      saved.set('local:web-geek-job-FormData', legacy)
      const conf = useConf()
      await conf[method]()
      for (const key of ['aiFiltering', 'aiGreeting', 'aiReply']) {
        expect(conf.formData[key].model).toBeUndefined()
        expect(jsonClone(conf.formData[key].prompt)).toEqual(defaults[key].prompt)
      }
    },
  )

  it('discards previously retained old prompts and legacyScore even after the first upgrade', async () => {
    saved.set('local:web-geek-job-FormData', {
      version: '20261016',
      aiFiltering: {
        ...defaults.aiFiltering,
        legacyScore: 10,
        prompt: [{ role: 'system', content: 'positive / negative' }],
      },
    })
    const conf = useConf()
    await conf.confInit()
    expect(jsonClone(conf.formData.aiFiltering.prompt)).toEqual(defaults.aiFiltering.prompt)
    expect(conf.formData.aiFiltering.legacyScore).toBeUndefined()
    expect(saved.get('local:web-geek-job-FormData').aiFiltering).toEqual(defaults.aiFiltering)
    await conf.confSaving()
    expect(saved.get('local:web-geek-job-FormData').aiFiltering.legacyScore).toBeUndefined()
  })

  it('preserves an edited percentage threshold after saving and reloading', async () => {
    const conf = useConf()
    await conf.confInit()
    conf.formData.aiFiltering.score = 85
    await conf.confSaving()
    await conf.confInit()
    expect(conf.formData.aiFiltering.score).toBe(85)
    expect(conf.formData.aiFiltering.scoringVersion).toBe('weighted-v1')
  })
})
