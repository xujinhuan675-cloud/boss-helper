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
let storageRemoveError: Error | undefined
let storageWrites = 0
let afterWrite: ((key: string) => Promise<void>) | undefined
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
      saved.set(key, jsonClone(value))
      await afterWrite?.(key)
    },
    storageRm: async (key) => {
      if (storageRemoveError) throw storageRemoveError
      saved.delete(key)
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
  storageRemoveError = undefined
  storageWrites = 0
  afterWrite = undefined
  const conf = useConf()
  Object.assign(conf.formData, jsonClone(defaults))
  conf.formDataPreset.value = 'default'
  conf.formDataPresets.value = [{ label: '默认配置', value: 'default' }]
})

describe('preset persistence', () => {
  it('keeps newly created plans when an older page saves rules with a stale plan list', async () => {
    const conf = useConf()
    await conf.createPreset('AI 产品经理')
    const created = conf.formDataPreset.value
    const presets = jsonClone(saved.get('local:FormDataPreses'))
    conf.formDataPresets.value = [{ label: '默认配置', value: 'default' }]
    conf.formDataPreset.value = 'default'
    conf.formData.delayDeliveryInterval = 23
    await conf.confSaving()
    expect(saved.get('local:FormDataPreses')).toEqual(presets)
    expect(saved.get('local:FormDataPrese')).toBe(created)
    await conf.switchPreset('default')
    await conf.switchPreset(created)
    expect(conf.formDataPresets.value).toContainEqual({ label: 'AI 产品经理', value: created })
  })

  it('publishes the complete new plan before selection can trigger a settings refresh', async () => {
    const conf = useConf()
    saved.set('local:web-geek-job-FormData', jsonClone(defaults))
    await conf.confInit()
    conf.formData.deliveryLimit.value = 77
    afterWrite = async (key) => {
      if (key === 'local:FormDataPrese') await conf.confInit()
    }
    await conf.createPreset('产品负责人')
    const created = conf.formDataPreset.value
    expect(saved.get('local:FormDataPreses')).toContainEqual({
      label: '产品负责人',
      value: created,
    })
    expect(saved.get(conf.formDataKey(created)).deliveryLimit.value).toBe(77)
    await conf.switchPreset('default')
    await conf.switchPreset(created)
    expect(conf.formData.deliveryLimit.value).toBe(77)
    expect(conf.formDataPresets.value).toContainEqual({ label: '产品负责人', value: created })
  })

  it('rejects switching to a missing plan without publishing a phantom selection', async () => {
    const conf = useConf()
    const before = [...saved.entries()]
    await expect(conf.switchPreset('missing')).rejects.toThrow('不存在')
    expect([...saved.entries()]).toEqual(before)
    expect(conf.formDataPreset.value).toBe('default')
  })
})

describe('preset deletion', () => {
  async function setup() {
    saved.set('local:FormDataPreses', [
      { label: '默认配置', value: 'default' },
      { label: '产品经理', value: 'product' },
      { label: '工程师', value: 'engineering' },
    ])
    saved.set('local:web-geek-job-FormData', jsonClone(defaults))
    saved.set('local:web-geek-job-FormData-product', { resumeText: 'product config' })
    saved.set('local:web-geek-job-FormData-engineering', { resumeText: 'engineering config' })
    const conf = useConf()
    await conf.confInit()
    return conf
  }

  it('removes only the selected preset and its stored configuration', async () => {
    const conf = await setup()
    await conf.deletePreset('product')
    expect(conf.formDataPresets.value.map((item) => item.value)).toEqual(['default', 'engineering'])
    expect(saved.get('local:FormDataPreses').map((item) => item.value)).toEqual([
      'default',
      'engineering',
    ])
    expect(saved.has('local:web-geek-job-FormData-product')).toBe(false)
    expect(saved.get('local:web-geek-job-FormData-engineering')).toEqual({
      resumeText: 'engineering config',
    })
    expect(saved.get('local:web-geek-job-FormData')).toEqual(defaults)
    await conf.confInit()
    expect(conf.formDataPresets.value.map((item) => item.value)).toEqual(['default', 'engineering'])
  })

  it.each(['default', 'missing'])(
    'rejects deletion of %s without changing stored data',
    async (value) => {
      const conf = await setup()
      const before = [...saved.entries()]
      await expect(conf.deletePreset(value)).rejects.toThrow()
      expect([...saved.entries()]).toEqual(before)
    },
  )

  it('requires switching away from the active preset before deleting it', async () => {
    const conf = await setup()
    conf.formDataPreset.value = 'product'
    await expect(conf.deletePreset('product')).rejects.toThrow('切换')
    expect(saved.has('local:web-geek-job-FormData-product')).toBe(true)
  })

  it.each(['write', 'remove'])(
    'retains the preset and config when storage %s fails',
    async (phase) => {
      const conf = await setup()
      const before = [...saved.entries()]
      const presetsBefore = jsonClone(conf.formDataPresets.value)
      if (phase === 'write') storageWriteError = new Error('delete write failed')
      else storageRemoveError = new Error('delete remove failed')
      await expect(conf.deletePreset('product')).rejects.toThrow('failed')
      expect([...saved.entries()]).toEqual(before)
      expect(jsonClone(conf.formDataPresets.value)).toEqual(presetsBefore)
      expect(conf.isLoading.value).toBe(false)
    },
  )
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

  it('loads the selected configuration when preset metadata is malformed without rewriting it', async () => {
    const malformedSelection = null
    const malformedPresets = [{ label: 'Saved', value: 'saved' }, null]
    saved.set('local:FormDataPrese', malformedSelection)
    saved.set('local:FormDataPreses', malformedPresets)
    saved.set('local:web-geek-job-FormData', { ...jsonClone(defaults), resumeText: 'kept config' })
    const conf = useConf()

    await conf.confInit()

    expect(conf.formDataPreset.value).toBe('default')
    expect(jsonClone(conf.formDataPresets.value)).toEqual([
      { label: 'Saved', value: 'saved' },
      { label: '默认配置', value: 'default' },
    ])
    expect(conf.formData.resumeText).toBe('kept config')
    expect(saved.get('local:FormDataPrese')).toBe(malformedSelection)
    expect(saved.get('local:FormDataPreses')).toEqual(malformedPresets)
    expect(storageWrites).toBe(0)

    await conf.confSaving()
    expect(saved.get('local:FormDataPrese')).toBe(malformedSelection)
    expect(saved.get('local:FormDataPreses')).toEqual(malformedPresets)
  })

  it('keeps a valid selected preset when its preset list contains malformed entries', async () => {
    saved.set('local:FormDataPrese', 'saved')
    saved.set('local:FormDataPreses', [null])
    saved.set('local:web-geek-job-FormData-saved', {
      ...jsonClone(defaults),
      resumeText: 'saved preset config',
    })
    const conf = useConf()

    await conf.confInit()

    expect(conf.formDataPreset.value).toBe('saved')
    expect(jsonClone(conf.formDataPresets.value)).toContainEqual({
      label: '当前方案',
      value: 'saved',
    })
    expect(conf.formData.resumeText).toBe('saved preset config')
    expect(saved.get('local:FormDataPreses')).toEqual([null])
    expect(storageWrites).toBe(0)
  })

  it('reads a validated saved preset before replacing active settings', async () => {
    saved.set('local:FormDataPrese', 'saved')
    saved.set('local:FormDataPreses', [{ label: 'Saved', value: 'saved' }])
    saved.set('local:web-geek-job-FormData-saved', {
      version: defaults.version,
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

  it('persists the new collection defaults once without replacing custom timing', async () => {
    const key = 'local:web-geek-job-FormData'
    saved.set(key, {
      version: '20261016',
      delayCollectionScrollMin: 1,
      delayCollectionScrollMax: 2,
      delayCollectionDetailMin: 2,
      delayCollectionDetailMax: 5,
      resumeText: 'retained resume',
    })
    const conf = useConf()
    await conf.confInit()
    expect(saved.get(key)).toMatchObject({
      version: defaults.version,
      delayCollectionScrollMin: 1,
      delayCollectionScrollMax: 2,
      delayCollectionDetailMin: 3,
      delayCollectionDetailMax: 5,
      collectionMaxRuntimeMinutes: 60,
      resumeText: 'retained resume',
    })
    const writes = storageWrites
    await conf.confInit()
    expect(storageWrites).toBe(writes)

    saved.set(key, {
      version: '20261016',
      delayCollectionDetailMin: 7,
      delayCollectionDetailMax: 12,
    })
    await conf.confInit()
    expect(conf.formData.delayCollectionDetailMin).toBe(7)
    expect(conf.formData.delayCollectionDetailMax).toBe(12)
  })

  it('runs older migrations in order before updating the timing defaults', async () => {
    const config = await useConf().prepareConfig({
      version: '20240401',
      aiGreeting: { prompt: 'retained prompt' },
      delay: { deliveryInterval: 17 },
    })
    expect(config.aiGreeting.prompt).toEqual([{ role: 'user', content: 'retained prompt' }])
    expect(config.delayDeliveryInterval).toBe(17)
    expect(config).not.toHaveProperty('delay')
    expect(config.version).toBe(defaults.version)
  })

  it('preserves a current-version explicit timing choice and a failed migration write', async () => {
    const key = 'local:web-geek-job-FormData'
    saved.set(key, { ...jsonClone(defaults), delayCollectionDetailMin: 2 })
    const conf = useConf()
    await conf.confInit()
    expect(conf.formData.delayCollectionDetailMin).toBe(2)
    const before = jsonClone(conf.formData)
    const legacy = { version: '20261016', delayCollectionDetailMin: 2, delayCollectionDetailMax: 5 }
    saved.set(key, legacy)
    storageWriteError = new Error('migration write failed')
    await expect(conf.confInit()).rejects.toThrow('migration write failed')
    expect(jsonClone(conf.formData)).toEqual(before)
    expect(saved.get(key)).toEqual(legacy)
  })

  it.each(['createPreset', 'switchPreset'])(
    'propagates preset storage failure through %s',
    async (method) => {
      const conf = useConf()
      saved.set('local:FormDataPreses', [
        { label: '默认配置', value: 'default' },
        { label: 'Another', value: 'another preset' },
      ])
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
