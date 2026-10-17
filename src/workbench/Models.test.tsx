/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { defaultFormData } from '../composables/conf/info'
import * as scoring from '../composables/useApplying/scoring'
import * as connection from '../composables/useModel/connection'
import * as deepmerge from '../utils/deepmerge'

// Reuse the DOM implementation already installed by the workspace's UI package.
const require = createRequire(new URL('../../packages/devlog-ui/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://extension.example/',
  pretendToBeVisual: true,
})
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'SVGElement',
  'Document',
  'DocumentFragment',
  'ShadowRoot',
  'Element',
  'Node',
  'NodeFilter',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'InputEvent',
  'MouseEvent',
  'FocusEvent',
  'KeyboardEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
// JSDOM has no layout; these tests exercise selection rather than resize effects.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Bun does not resolve the WXT source aliases when importing this React entry.
mock.module('@/composables/conf/info', () => ({ defaultFormData }))
mock.module('@/composables/useApplying/scoring', () => scoring)
mock.module('@/composables/useModel/connection', () => connection)
mock.module('@/utils/deepmerge', () => deepmerge)

const state = {
  loading: false,
  saving: false,
  runtime: null,
  models: [],
  config: defaultFormData,
  preset: 'default',
}
mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
mock.module('./store', () => ({
  perform: async (work) => work(),
  saveModels: async (update) => {
    state.models = update(state.models)
  },
  saveConfig: async () => {},
  selectDefaultModel: async () => {},
  services: { conf: { formDataPreset: { value: 'default' } } },
}))
mock.module('@/composables/useModel', () => ({
  isCompleteModel: (model) => !!model?.data?.model,
}))
mock.module('@/message', () => ({
  counter: {
    fetchText: async () => ({
      status: 200,
      text: JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }),
    }),
  },
}))

const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Models } = await import('./Models')
let root
let container

async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click())
}

const button = (text) =>
  [...document.querySelectorAll('button')].find((el) => el.textContent === text)
const selector = () => document.querySelector('[aria-label="已获取的模型"]')

async function selectModel(id) {
  await click(selector().querySelector('button') ?? selector())
  await click([...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === id))
}

beforeEach(async () => {
  state.models = [
    {
      key: 'provider',
      name: '测试服务',
      data: {
        mode: 'openai',
        base_url: 'https://model-provider.example/v1',
        api_key: 'offline-fixture-key',
        model: 'saved-model',
        advanced: {},
        other: {},
      },
    },
  ]
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Models)))
  await act(async () => new Promise(requestAnimationFrame))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
afterAll(() => dom.window.close())

test('shows the saved model in the sole selector before fetching', async () => {
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  expect(selector()).toBeTruthy()
  expect(selector().textContent).toContain('saved-model')
  expect([...document.querySelectorAll('label')].map((el) => el.textContent)).not.toContain(
    '模型 ID',
  )
})

test('keeps fetched choices after repeated selection and saves the selected model', async () => {
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(button('获取模型'))
  await selectModel('model-b')
  await click(button('连接测试'))
  await selectModel('model-a')
  await click(button('保存模型'))
  expect(state.models[0].data.model).toBe('model-a')
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  expect(selector().textContent).toContain('model-a')
})
