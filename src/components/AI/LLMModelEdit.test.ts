// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

import { createRenderer, h, nextTick } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

const componentPath = fileURLToPath(new URL('./LLMModelEdit.vue', import.meta.url))
const source = readFileSync(componentPath, 'utf8')
const { descriptor } = parse(source)
const formPath = fileURLToPath(new URL('./LLMForm.vue', import.meta.url))
const formSource = readFileSync(formPath, 'utf8')
const { descriptor: formDescriptor } = parse(formSource)
const script = compileScript(descriptor, { id: 'llm-model-edit-test' })
const built = await Bun.build({
  entrypoints: [componentPath],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'offline-model-edit',
      setup(build) {
        build.onLoad({ filter: /LLMModelEdit\.vue$/ }, () => ({
          contents: script.content,
          loader: 'ts',
        }))
        build.onResolve({ filter: /^\.\/LLMForm\.vue$/ }, () => ({
          path: 'form',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/message$/ }, () => ({
          path: 'message',
          namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'message'
              ? 'export const counter = { fetchText: async (...args) => { const response = await globalThis.__backgroundFetch(...args); return { status: response.status, text: await response.text() } } }'
              : 'export default { render: () => null }',
          loader: 'js',
        }))
        build.onResolve({ filter: /^@\/composables\/useModel\/connection$/ }, () => ({
          path: fileURLToPath(new URL('../../composables/useModel/connection.ts', import.meta.url)),
        }))
        build.onResolve({ filter: /^@\/utils\/deepmerge$/ }, () => ({
          path: fileURLToPath(new URL('../../utils/deepmerge.ts', import.meta.url)),
        }))
      },
    },
  ],
})
if (!built.success) throw new Error(built.logs.join('\n'))
const compiledModule = { exports: {} }
compileFunction(await built.outputs[0].text(), ['require', 'module', 'exports'])(
  createRequire(import.meta.url),
  compiledModule,
  compiledModule.exports,
)
const Component = compiledModule.exports.default
Component.render = () => null

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
const originalFetch = globalThis.fetch
const originalBackgroundFetch = globalThis.__backgroundFetch
let root
let saved
let creates
let openUpdates

function mount(saving = false) {
  const vnode = h(Component, {
    model: saved,
    modelValue: true,
    saving,
    onCreate: (data) => creates.push(data),
    'onUpdate:modelValue': (value) => openUpdates.push(value),
  })
  renderer.render(vnode, root)
  return vnode.component.setupState
}

function modelsResponse(ids: unknown[]) {
  return Response.json({ data: ids.map((id) => ({ id })) })
}

function deferredFetch() {
  const finishes = []
  let calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finishes.push(resolve)
    })
  }
  return {
    calls: () => calls,
    finish: (response) => finishes.forEach((resolve) => resolve(response.clone())),
  }
}

beforeEach(() => {
  root = { children: [] }
  creates = []
  openUpdates = []
  saved = {
    key: 'fixture-provider',
    name: 'Saved provider',
    color: '#123456',
    data: {
      mode: 'openai',
      base_url: 'https://models.example.invalid/v1',
      api_key: 'fixture-key',
      model: 'manual-model',
      advanced: { extra_headers: { 'X-Fixture': 'original' } },
      other: { retained: true },
    },
  }
  globalThis.fetch = async () => {
    throw new Error('No offline fixture configured')
  }
  globalThis.__backgroundFetch = (...args) => globalThis.fetch(...args)
})

afterEach(() => {
  renderer.render(null, root)
  globalThis.fetch = originalFetch
  globalThis.__backgroundFetch = originalBackgroundFetch
})

describe('offline model editor', () => {
  it('compiles the model editor template', () => {
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: componentPath,
      id: 'llm-model-edit-test',
    })
    expect(template.errors).toEqual([])
  })

  it('compiles the model field template without an icon catalog request', () => {
    const template = compileTemplate({
      source: formDescriptor.template.content,
      filename: formPath,
      id: 'llm-form-test',
    })
    expect(template.errors).toEqual([])
    expect(formSource).not.toContain('fetch(')
  })

  it('checks connection without changing the selected model', async () => {
    globalThis.fetch = async () => modelsResponse(['listed-model'])
    const state = mount()
    await state.testConnection()
    expect(state.connectionResult.status).toBe('connected')
    expect(state.llmFormData.model).toBe('manual-model')
    expect(saved.data.model).toBe('manual-model')
    expect(state.availableModels).toEqual([])
    expect(state.connectionLoading).toBe(false)
  })

  it('uses the extension background fetch instead of the page fetch', async () => {
    let pageFetchCalls = 0
    globalThis.fetch = async () => {
      pageFetchCalls++
      throw new Error('page CORS fetch should not run')
    }
    globalThis.__backgroundFetch = async () => modelsResponse(['background-model'])
    const state = mount()
    await state.testConnection()
    expect(state.connectionResult.status).toBe('connected')
    expect(state.connectionResult.models).toEqual(['background-model'])
    expect(pageFetchCalls).toBe(0)
  })

  it('retains the selected model when it is in the retrieved list', async () => {
    globalThis.fetch = async () => modelsResponse(['first-model', 'manual-model'])
    const state = mount()
    await state.getModels()
    expect(state.llmFormData.model).toBe('manual-model')
    expect(state.availableModels).toEqual(['first-model', 'manual-model'])
  })

  it('defaults the draft to the first valid ID without changing saved data', async () => {
    globalThis.fetch = async () => modelsResponse([null, '', ' first-model ', 'first-model', 42])
    const state = mount()
    await state.getModels()
    expect(state.llmFormData.model).toBe('first-model')
    expect(state.availableModels).toEqual(['first-model'])
    expect(saved.data.model).toBe('manual-model')
  })

  it('preserves manual model ID when retrieval fails', async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 })
    const state = mount()
    await state.getModels()
    expect(state.connectionResult.status).toBe('auth_error')
    expect(state.llmFormData.model).toBe('manual-model')
    expect(state.availableModels).toEqual([])
  })

  it('cancels an edited draft without changing nested saved data', async () => {
    const original = structuredClone(saved)
    const state = mount()
    state.createName = 'Draft provider'
    state.llmFormData.model = 'draft-model'
    state.llmFormData.advanced.extra_headers['X-Fixture'] = 'draft'
    state.llmFormData.other.retained = false
    state.cancel()
    await nextTick()
    expect(saved).toEqual(original)
    expect(creates).toEqual([])
    expect(openUpdates).toEqual([false])
  })

  it('saves the edited configuration and keeps emitted data separate from the draft', () => {
    const original = structuredClone(saved)
    const state = mount()
    state.createName = 'Edited provider'
    state.createColor = '#abcdef'
    state.llmFormData.model = 'edited-model'
    state.llmFormData.advanced.extra_headers['X-Fixture'] = 'edited'
    state.create()
    expect(saved).toEqual(original)
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({
      key: 'fixture-provider',
      name: 'Edited provider',
      color: '#abcdef',
      data: {
        mode: 'openai',
        model: 'edited-model',
        advanced: { extra_headers: { 'X-Fixture': 'edited' } },
        other: { retained: true },
      },
    })
    state.llmFormData.advanced.extra_headers['X-Fixture'] = 'unsaved change'
    expect(creates[0].data.advanced.extra_headers['X-Fixture']).toBe('edited')
  })

  it('prevents submission and cancellation while persistence is pending', () => {
    const state = mount(true)
    state.create()
    state.cancel()
    expect(creates).toEqual([])
    expect(openUpdates).toEqual([])
    expect(state.show).toBe(true)
  })

  for (const firstAction of ['testConnection', 'getModels']) {
    it(`blocks concurrent requests while ${firstAction} is pending`, async () => {
      const request = deferredFetch()
      const state = mount()
      const pending = state[firstAction]()
      const duplicateCheck = state.testConnection()
      const duplicateList = state.getModels()
      const calls = request.calls()
      request.finish(modelsResponse(['manual-model']))
      await Promise.all([pending, duplicateCheck, duplicateList])
      expect(calls).toBe(1)
      expect(state.connectionLoading).toBe(false)
    })
  }

  for (const key of ['base_url', 'api_key', 'extra_headers']) {
    it(`clears fetched options and connection result after changing ${key}`, async () => {
      globalThis.fetch = async () => modelsResponse(['manual-model'])
      const state = mount()
      await state.getModels()
      expect(state.availableModels).toEqual(['manual-model'])
      if (key === 'extra_headers') state.llmFormData.advanced.extra_headers['X-Fixture'] = 'changed'
      else
        state.llmFormData[key] =
          key === 'base_url' ? 'https://other.example.invalid/v1' : 'other-key'
      await nextTick()
      expect(state.availableModels).toEqual([])
      expect(state.connectionResult).toBeUndefined()
      expect(state.llmFormData.model).toBe('manual-model')
    })

    it(`ignores a retrieved list that arrives after changing ${key}`, async () => {
      const request = deferredFetch()
      const state = mount()
      const pending = state.getModels()
      if (key === 'extra_headers') state.llmFormData.advanced.extra_headers['X-Fixture'] = 'changed'
      else
        state.llmFormData[key] =
          key === 'base_url' ? 'https://other.example.invalid/v1' : 'other-key'
      await nextTick()
      request.finish(modelsResponse(['outdated-model']))
      await pending
      expect(state.availableModels).toEqual([])
      expect(state.connectionResult).toBeUndefined()
      expect(state.llmFormData.model).toBe('manual-model')
      expect(state.connectionLoading).toBe(false)
    })
  }
})
