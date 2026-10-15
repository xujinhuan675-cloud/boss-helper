// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

const componentPath = fileURLToPath(new URL('./LLMModelManage.vue', import.meta.url))
const source = readFileSync(componentPath, 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'llm-model-manage-test' })
const storePath = fileURLToPath(new URL('../../composables/useModel/index.ts', import.meta.url))
const storeSource = readFileSync(storePath, 'utf8')
const built = await Bun.build({
  entrypoints: [componentPath],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'offline-model-management',
      setup(build) {
        build.onLoad({ filter: /LLMModelManage\.vue$/ }, () => ({
          contents: script.content,
          loader: 'ts',
        }))
        build.onLoad({ filter: /\.vue$/ }, () => ({
          contents: 'export default { render: () => null }',
          loader: 'js',
        }))
        build.onResolve({ filter: /^@\/composables\/useModel$/ }, () => ({ path: storePath }))
        build.onLoad({ filter: /useModel[\\/]index\.ts$/ }, () => ({
          contents: storeSource,
          loader: 'ts',
        }))
        build.onResolve({ filter: /^@\/utils\/deepmerge$/ }, () => ({
          path: fileURLToPath(new URL('../../utils/deepmerge.ts', import.meta.url)),
        }))
        build.onResolve({ filter: /^@\/message$/ }, () => ({
          path: 'storage',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/utils\/jsonImportExport$/ }, () => ({
          path: 'json',
          namespace: 'fixture',
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
              ? 'export const counter = { storageGet: (...args) => globalThis.__manageModelsFixture.get(...args), storageSet: (...args) => globalThis.__manageModelsFixture.set(...args) }'
              : path === 'json'
                ? 'export const importJson = () => globalThis.__manageModelsFixture.import(); export const exportJson = (...args) => globalThis.__manageModelsFixture.export(...args)'
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

const renderer = createRenderer({
  createElement: () => ({ children: [] }),
  createText: (text) => ({ text }),
  createComment: (text) => ({ text }),
  insert(node, parent) {
    node.parent = parent
    parent.children.push(node)
  },
  remove(node) {
    node.parent.children = node.parent.children.filter((child) => child !== node)
  },
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  setElementText() {},
  setText() {},
  patchProp() {},
})

const model = (key: string) => ({
  key,
  name: `Model ${key}`,
  data: {
    api_key: 'fixture-key',
    base_url: 'https://model.invalid',
    model: 'fixture-model',
    advanced: { extra_body: { tools: ['text'] } },
  },
})
let Component
let root
let state
let persisted
let writes
let reads
let toasts
let imported
let setStored
let originalToast

beforeEach(async () => {
  root = { children: [] }
  persisted = [model('old')]
  writes = []
  reads = 0
  toasts = []
  imported = [model('imported')]
  setStored = async (key, value) => {
    const detached = structuredClone(value)
    writes.push({ key, value: detached })
    persisted = detached
  }
  globalThis.__manageModelsFixture = {
    get: async () => {
      reads++
      return structuredClone(persisted)
    },
    set: (...args) => setStored(...args),
    import: async () => imported,
    export() {},
  }
  originalToast = globalThis.useToast
  globalThis.useToast = () => ({ add: (item) => toasts.push(item) })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    createRequire(import.meta.url),
    module,
    module.exports,
  )
  Component = module.exports.default
  Component.render = () => null
  const vnode = h(Component)
  renderer.render(vnode, root)
  state = vnode.component.setupState
  await state.modelStore.initModel()
  await nextTick()
})

afterEach(() => {
  renderer.render(null, root)
  delete globalThis.__manageModelsFixture
  if (originalToast === undefined) delete globalThis.useToast
  else globalThis.useToast = originalToast
})

describe('offline immediate model management persistence', () => {
  it('compiles the model management template and its disabled saving controls', () => {
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: componentPath,
      id: 'llm-model-manage-test',
    })
    expect(template.errors).toEqual([])
  })

  it('persists nested new model data immediately and closes the editor after acknowledgement', async () => {
    state.newllm()
    const draft = reactive({ ...model(''), name: 'New model' })
    await state.create(draft)
    expect(writes).toHaveLength(1)
    expect(writes[0].key).toBe('conf-model')
    expect(persisted).toHaveLength(2)
    expect(persisted[1]).toMatchObject({
      name: 'New model',
      data: { advanced: { extra_body: { tools: ['text'] } } },
    })
    expect(typeof persisted[1].key).toBe('string')
    expect(persisted[1].key.length).toBeGreaterThan(0)
    expect(state.createBoxShow).toBe(false)
    expect(state.modelStore.modelData.value).toEqual(persisted)
  })

  it('persists edits without duplicating the existing model or changing its key', async () => {
    state.edit(state.modelStore.modelData.value[0])
    const draft = reactive({ ...model('old'), name: 'Edited model' })
    await state.create(draft)
    expect(writes).toHaveLength(1)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ key: 'old', name: 'Edited model' })
    expect(state.createBoxShow).toBe(false)
  })

  it('persists copied models with independent data and unique keys', async () => {
    await state.copy(state.modelStore.modelData.value[0])
    expect(writes).toHaveLength(1)
    expect(persisted).toHaveLength(2)
    expect(persisted[1].name).toBe('Model old 副本')
    expect(persisted[1].key).not.toBe('old')
    state.modelStore.modelData.value[1].data.advanced.extra_body.tools.push('copy change')
    expect(state.modelStore.modelData.value[0].data.advanced.extra_body.tools).toEqual(['text'])
  })

  it('persists deletion immediately and closing does not reload removed models', async () => {
    state.open = true
    await state.del(state.modelStore.modelData.value[0])
    expect(writes).toEqual([{ key: 'conf-model', value: [] }])
    expect(state.modelStore.modelData.value).toEqual([])
    const priorReads = reads
    state.close()
    await nextTick()
    expect(reads).toBe(priorReads)
    expect(state.open).toBe(false)
    expect(state.modelStore.modelData.value).toEqual([])
  })

  it('persists imported model arrays immediately while preserving nested configuration fields', async () => {
    imported[0].extraField = { preserve: true }
    await state.importllm()
    expect(writes).toEqual([{ key: 'conf-model', value: imported }])
    expect(state.modelStore.modelData.value[0]).toMatchObject({
      key: 'imported',
      extraField: { preserve: true },
    })
  })

  it.each([
    [{ models: [] }],
    [[null]],
    [[{ key: '', name: 'invalid' }]],
    [[{ key: 'invalid', name: 3 }]],
    [[{ ...model('invalid'), data: null }]],
    [[{ ...model('invalid'), data: [] }]],
    [[{ ...model('invalid'), data: { api_key: 123 } }]],
    [[{ ...model('invalid'), data: { base_url: {} } }]],
    [[{ ...model('invalid'), data: { model: false } }]],
    [[{ ...model('invalid'), data: { advanced: [] } }]],
  ])(
    'rejects invalid imported model JSON without writing over the old library: %j',
    async (invalid) => {
      imported = invalid
      await state.importllm()
      expect(writes).toEqual([])
      expect(persisted).toEqual([model('old')])
      expect(state.modelStore.modelData.value).toEqual([model('old')])
      expect(toasts.some((toast) => toast.color === 'error')).toBe(true)
    },
  )

  it('allows incomplete imported model drafts with optional configuration fields', async () => {
    imported = [{ key: 'draft', name: 'Draft', data: { mode: 'openai', api_key: '' } }]
    await state.importllm()
    expect(writes).toEqual([{ key: 'conf-model', value: imported }])
  })

  it('keeps the old library and draft editor open when an immediate save fails', async () => {
    state.edit(state.modelStore.modelData.value[0])
    const draft = reactive({ ...model('old'), name: 'Unsaved draft' })
    setStored = async () => {
      throw new Error('storage unavailable')
    }
    await state.create(draft)
    expect(state.createBoxShow).toBe(true)
    expect(draft.name).toBe('Unsaved draft')
    expect(state.modelStore.modelData.value).toEqual([model('old')])
    expect(persisted).toEqual([model('old')])
    expect(toasts.some((toast) => toast.color === 'success')).toBe(false)
    expect(toasts.some((toast) => toast.color === 'error')).toBe(true)
    expect(state.saving).toBe(false)
  })

  it('prevents duplicate mutations and closing while a model save is pending', async () => {
    state.newllm()
    state.open = true
    let release!: () => void
    const acknowledgement = new Promise<void>((resolve) => (release = resolve))
    let attempts = 0
    setStored = async (key, value) => {
      attempts++
      await acknowledgement
      persisted = structuredClone(value)
    }
    const draft = reactive({ ...model(''), name: 'Pending draft' })
    const saving = state.create(draft)
    try {
      expect(state.saving).toBe(true)
      expect(state.createBoxShow).toBe(true)
      expect(state.modelStore.modelData.value).toEqual([model('old')])
      await state.create(draft)
      await state.copy(state.modelStore.modelData.value[0])
      await state.del(state.modelStore.modelData.value[0])
      await state.importllm()
      state.close()
      expect(attempts).toBe(1)
      expect(state.open).toBe(true)
    } finally {
      release()
      await saving
    }
    expect(state.saving).toBe(false)
    expect(state.createBoxShow).toBe(false)
    expect(state.modelStore.modelData.value).toHaveLength(2)
    expect(toasts.filter((toast) => toast.color === 'success')).toHaveLength(1)
  })
})
