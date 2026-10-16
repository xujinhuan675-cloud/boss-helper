// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { computed, ref } from 'vue'

import { jsonClone } from '../../utils/deepmerge'
import deepmerge from '../../utils/deepmerge'
import { defaultFormData } from './info'

const saved = new Map()
let imported
mock.module('@vueuse/core', () => ({
  useStorageAsync: (_key, value) => ref(value),
  watchThrottled() {},
  reactiveComputed: (fn) => computed(fn),
}))
mock.module('@/message', () => ({
  counter: {
    storageGet: async (key, fallback) => jsonClone(saved.get(key) ?? fallback),
    storageSet: async (key, value) => saved.set(key, jsonClone(value)),
  },
  ExtStorage: {},
}))
mock.module('@/utils/deepmerge', () => ({ default: deepmerge, jsonClone }))
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
  Object.assign(useConf().formData, jsonClone(defaults))
})

describe('percentage scoring configuration', () => {
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
        model: 'my-model',
        prompt: defaults.aiFiltering.prompt,
      })
      await conf.confSaving()
      expect(saved.get('local:web-geek-job-FormData').aiFiltering.score).toBe(70)
      expect(saved.get('local:web-geek-job-FormData').aiFiltering.legacyScore).toBeUndefined()
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
