// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { isReactive, reactive } from 'vue'

const entrypoint = fileURLToPath(new URL('./index.ts', import.meta.url))
const built = await Bun.build({
  entrypoints: [entrypoint],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'offline-model-storage',
      setup(build) {
        build.onResolve({ filter: /^@\/message$/ }, () => ({
          path: 'storage',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/utils\/deepmerge$/ }, () => ({
          path: fileURLToPath(new URL('../../utils/deepmerge.ts', import.meta.url)),
        }))
        build.onResolve({ filter: /^\.\/openai$/ }, () => ({
          path: 'openai',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^\.\/chatModel$/ }, () => ({
          path: 'chat',
          namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'storage'
              ? 'export const counter = { storageGet: (...args) => globalThis.__modelStoreFixture.get(...args), storageSet: (...args) => globalThis.__modelStoreFixture.set(...args) }'
              : path === 'openai'
                ? 'export const openai = { info: {} }'
                : 'export {}',
          loader: 'js',
        }))
      },
    },
  ],
})
if (!built.success) throw new Error(built.logs.join('\n'))
const compiled = await built.outputs[0].text()

const model = (key: string) => ({
  key,
  name: `Model ${key}`,
  data: {
    api_key: 'fixture-key',
    base_url: 'https://model.invalid',
    model: 'fixture-model',
    advanced: { extra_body: { settings: { modes: ['text'] } } },
  },
})
let store
let persisted
let writes
let toasts
let getStored
let setStored
let originalToast

function loadStore() {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    createRequire(import.meta.url),
    module,
    module.exports,
  )
  return module.exports.useModel()
}

beforeEach(() => {
  persisted = [model('old')]
  writes = []
  toasts = []
  getStored = async () => structuredClone(persisted)
  setStored = async (key, value) => {
    const detached = structuredClone(value)
    writes.push({ key, value: detached })
    persisted = detached
  }
  globalThis.__modelStoreFixture = {
    get: (...args) => getStored(...args),
    set: (...args) => setStored(...args),
  }
  originalToast = globalThis.useToast
  globalThis.useToast = () => ({ add: (item) => toasts.push(item) })
  store = loadStore()
})

afterEach(() => {
  delete globalThis.__modelStoreFixture
  if (originalToast === undefined) delete globalThis.useToast
  else globalThis.useToast = originalToast
})

describe('offline shared model persistence', () => {
  it('serializes nested reactive model settings and reads them back after a fresh module load', async () => {
    await store.initModel()
    const draft = reactive([model('new')])
    expect(isReactive(draft[0].data.advanced.extra_body.settings)).toBe(true)
    await store.saveModel(draft)
    expect(writes).toEqual([{ key: 'conf-model', value: [model('new')] }])
    expect(store.modelData.value).toEqual([model('new')])
    draft[0].data.advanced.extra_body.settings.modes.push('changed')
    expect(persisted[0].data.advanced.extra_body.settings.modes).toEqual(['text'])
    const refreshed = loadStore()
    await refreshed.initModel()
    expect(refreshed.modelData.value).toEqual([model('new')])
    expect(toasts).toEqual([{ title: '保存成功', color: 'success' }])
  })

  it('updates the shared model list only after storage acknowledges a successful save', async () => {
    await store.initModel()
    let release!: () => void
    const pending = new Promise<void>((resolve) => (release = resolve))
    setStored = async (key, value) => {
      await pending
      persisted = structuredClone(value)
    }
    const saving = store.saveModel(reactive([model('new')]))
    try {
      expect(store.modelData.value.map((item) => item.key)).toEqual(['old'])
      expect(toasts).toEqual([])
    } finally {
      release()
      await saving
    }
    expect(store.modelData.value.map((item) => item.key)).toEqual(['new'])
    expect(toasts).toHaveLength(1)
  })

  it('keeps the prior model list and omits success notifications when storage rejects a save', async () => {
    await store.initModel()
    setStored = async () => {
      throw new Error('storage unavailable')
    }
    await expect(store.saveModel(reactive([model('new')]))).rejects.toThrow('storage unavailable')
    expect(store.modelData.value).toEqual([model('old')])
    expect(persisted).toEqual([model('old')])
    expect(toasts).toEqual([])
  })

  it('does not let an initialization reply overwrite a model saved while that read was pending', async () => {
    let release!: (models) => void
    getStored = () => new Promise((resolve) => (release = resolve))
    const reading = store.initModel()
    await store.saveModel([model('new')])
    release([model('stale')])
    await reading
    expect(store.modelData.value).toEqual([model('new')])
    expect(persisted).toEqual([model('new')])
  })

  it('accepts the stored model initialization reply when an intervening save fails', async () => {
    let release!: (models) => void
    getStored = () => new Promise((resolve) => (release = resolve))
    setStored = async () => {
      throw new Error('storage unavailable')
    }
    const reading = store.initModel()
    await expect(store.saveModel([model('new')])).rejects.toThrow('storage unavailable')
    release([model('old')])
    await reading
    expect(store.modelData.value).toEqual([model('old')])
    expect(persisted).toEqual([model('old')])
    expect(toasts).toEqual([])
  })

  it('supports saving the current shared list without an explicit model argument', async () => {
    await store.initModel()
    store.modelData.value[0].data.advanced.extra_body.settings.modes.push('structured')
    await store.saveModel()
    expect(writes[0].value[0].data.advanced.extra_body.settings.modes).toEqual([
      'text',
      'structured',
    ])
  })
})
