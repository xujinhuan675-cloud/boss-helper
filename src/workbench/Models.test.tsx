/** @jsxImportSource react */
// @ts-nocheck
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
dom.window.Element.prototype.getAnimations = () => []
globalThis.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
// JSDOM has no layout; these tests exercise selection rather than resize effects.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Bun does not resolve the WXT source aliases when importing this React entry.
await mock.module('@/composables/conf/info', () => ({ defaultFormData }))
await mock.module('@/composables/useApplying/scoring', () => scoring)
await mock.module('@/composables/useModel/connection', () => connection)
await mock.module('@/utils/deepmerge', () => deepmerge)

const state = {
  loading: false,
  saving: false,
  runtime: null,
  models: [],
  config: defaultFormData,
  preset: 'default',
  resumes: { resumes: [], currentResumeId: null },
  keywords: '',
}
const modelOptions = new Map()
const configWrites = []
const services = { conf: { formDataPreset: { value: 'default' } } }
let modelListStatus = 200
let modelListIds = ['model-a', 'model-b']
let readModelOptions
let optionsWriteError = ''
await mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
await mock.module('./store', () => ({
  perform: async (work) => work(),
  command: async () => {},
  saveModels: async (update) => {
    state.models = update(state.models)
  },
  saveConfig: async (patch) => {
    configWrites.push(structuredClone(patch))
    state.config = { ...state.config, ...patch }
  },
  selectDefaultModel: async () => {},
  copyResume: async () => {},
  deleteResume: async () => {},
  saveKeywords: async () => {},
  saveResume: async () => {},
  selectResume: async () => {},
  services,
}))
await mock.module('@/composables/useModel', () => ({
  isCompleteModel: (model) => !!model?.data?.model,
}))
await mock.module('@/message', () => ({
  counter: {
    storageGet: async (key, fallback) => readModelOptions(key, fallback),
    storageSet: async (key, value) => {
      if (optionsWriteError) throw new Error(optionsWriteError)
      modelOptions.set(key, structuredClone(value))
    },
    fetchText: async () => ({
      status: modelListStatus,
      text: JSON.stringify({ data: modelListIds.map((id) => ({ id })) }),
    }),
  },
}))

const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Models } = await import('./Models')
const { Resumes } = await import('./Resumes')
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

async function openPrompts() {
  await click(
    [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === '提示词'),
  )
}

async function changeText(element, value) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  state.config = structuredClone(defaultFormData)
  state.preset = 'default'
  services.conf.formDataPreset.value = 'default'
  state.runtime = null
  configWrites.length = 0
  modelOptions.clear()
  modelListStatus = 200
  modelListIds = ['model-a', 'model-b']
  readModelOptions = async (key, fallback) => structuredClone(modelOptions.get(key) ?? fallback)
  optionsWriteError = ''
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
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(createElement(Models)))
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  expect(selector().textContent).toContain('model-a')
  await selectModel('model-b')
  expect(selector().textContent).toContain('model-b')
  expect([...modelOptions.keys()].every((key) => !key.includes('offline-fixture-key'))).toBe(true)
})

test('creates models without advanced or avatar controls and settings', async () => {
  await click(button('新建模型'))
  const editor = container.querySelector('[aria-label="模型编辑"]')
  expect(editor.textContent).not.toContain('高级配置')
  expect(editor.textContent).not.toContain('头像地址')
  expect(editor.textContent).not.toContain('参数 JSON')
  await click(button('保存模型'))
  expect(state.models[1].data).toEqual({ mode: 'openai', base_url: '', api_key: '', model: '' })
})

test('does not restore choices from another provider or changed API credentials', async () => {
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(button('获取模型'))
  await click(button('保存模型'))
  state.models[0].data.api_key = 'changed-fixture-key'
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(selector().querySelector('button') ?? selector())
  expect([...document.querySelectorAll('[role="option"]')].map((el) => el.textContent)).toEqual([
    'model-a',
  ])
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  await click(button('取消编辑'))
  state.models[0].data.api_key = 'offline-fixture-key'
  state.models[0].data.base_url = 'https://another-provider.example/v1'
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(selector().querySelector('button') ?? selector())
  expect([...document.querySelectorAll('[role="option"]')].map((el) => el.textContent)).toEqual([
    'model-a',
  ])
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  await click(button('取消编辑'))
})

test('keeps the previous fetched choices if refreshing the model list fails', async () => {
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(button('获取模型'))
  modelListStatus = 401
  await click(button('获取模型'))
  await selectModel('model-b')
  expect(selector().textContent).toContain('model-b')
})

test('keeps fetched options when reopening the same editor', async () => {
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(button('获取模型'))
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await selectModel('model-b')
  expect(selector().textContent).toContain('model-b')
})

test('does not let a late cached reply overwrite a successful fetch', async () => {
  let release
  readModelOptions = () =>
    new Promise((resolve) => {
      release = resolve
    })
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(button('获取模型'))
  await act(async () => release(['stale-model']))
  await selectModel('model-b')
  expect(selector().textContent).toContain('model-b')
})

test('ignores malformed cached choices and reports failed persistence without losing fetched choices', async () => {
  readModelOptions = async () => ['model-a', { invalid: true }]
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  expect(selector().textContent).toContain('saved-model')
  optionsWriteError = 'offline storage failure'
  await click(button('获取模型'))
  expect(container.textContent).toContain('offline storage failure')
  expect(modelOptions.size).toBe(0)
  await selectModel('model-b')
  expect(selector().textContent).toContain('model-b')
})

test('replaces the cached list when a successful refresh returns no models', async () => {
  await click(document.querySelector('[aria-label="编辑 测试服务"]'))
  await click(button('获取模型'))
  modelListIds = []
  await click(button('获取模型'))
  expect([...modelOptions.values()]).toEqual([[]])
})

test('right-aligns model and resume administration', async () => {
  const modelEdit = container.querySelector('[aria-label="编辑 测试服务"]')
  expect(modelEdit.parentElement.className).toContain('justify-end')
  state.resumes = {
    resumes: [
      { id: 'resume', name: '测试简历', content: '正文', updatedAt: '2026-01-01T00:00:00Z' },
    ],
    currentResumeId: 'resume',
  }
  await act(async () => root.render(createElement(Resumes)))
  await act(async () => new Promise(requestAnimationFrame))
  expect(container.querySelector('[aria-label="编辑 测试简历"]').parentElement.className).toContain(
    'justify-end',
  )
})

test('switches between model management and a single message editor without losing drafts', async () => {
  await openPrompts()
  expect(container.querySelector('[aria-label="AI 模型"]')).toBeNull()
  expect(container.querySelectorAll('textarea')).toHaveLength(1)
  await changeText(container.querySelector('textarea'), 'draft system rules')
  await click(button('2. 输入模板user'))
  expect(container.querySelector('textarea').value).toContain('jobData')
  await changeText(container.querySelector('textarea'), 'draft input template')
  await click(
    [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === '模型配置'),
  )
  expect(container.querySelector('[aria-label="AI 模型"]')).toBeTruthy()
  await openPrompts()
  expect(container.querySelector('textarea').value).toBe('draft input template')
  await click(button('1. 匹配规则system'))
  expect(container.querySelector('textarea').value).toBe('draft system rules')
  await click(button('保存提示词'))
  expect(configWrites[0].aiFiltering.prompt).toEqual([
    { role: 'system', content: 'draft system rules' },
    { role: 'user', content: 'draft input template' },
  ])
  expect(button('保存提示词').disabled).toBe(true)
})

test('selects added messages and keeps a usable editor after deleting all messages', async () => {
  await openPrompts()
  await click(container.querySelector('[aria-label="添加提示词消息"]'))
  expect(container.querySelector('textarea').value).toBe('')
  await changeText(container.querySelector('textarea'), 'third message')
  await click(container.querySelector('[aria-label="删除消息 3"]'))
  expect(container.querySelector('textarea').value).toContain('jobData')
  await click(container.querySelector('[aria-label="删除消息 2"]'))
  await click(container.querySelector('[aria-label="删除消息 1"]'))
  expect(container.querySelector('textarea')).toBeNull()
  await click(container.querySelector('[aria-label="添加提示词消息"]'))
  await changeText(container.querySelector('textarea'), 'replacement')
  await click(button('保存提示词'))
  expect(configWrites[0].aiFiltering.prompt).toEqual([{ role: 'user', content: 'replacement' }])
})

test('keeps purpose drafts separate and restores defaults only as an unsaved edit', async () => {
  await openPrompts()
  await changeText(container.querySelector('textarea'), 'filtering draft')
  await click(
    [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === 'AI 招呼语'),
  )
  const greeting = container.querySelector('[aria-label="消息 1 正文"]')
  await changeText(greeting, 'greeting draft')
  await click(
    [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === '岗位匹配'),
  )
  expect(container.querySelector('textarea').value).toBe('filtering draft')
  await click(button('恢复默认提示词'))
  expect(configWrites).toHaveLength(0)
  expect(container.querySelector('textarea').value).toBe(
    defaultFormData.aiFiltering.prompt[0].content,
  )
  await click(button('放弃修改'))
  expect(button('保存提示词').disabled).toBe(true)
  await click(
    [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === 'AI 招呼语'),
  )
  expect(container.querySelector('[aria-label="消息 1 正文"]').value).toBe('greeting draft')
})

test('blocks saving a prompt draft after its preset changes and discards it into the current preset', async () => {
  await openPrompts()
  await changeText(container.querySelector('textarea'), 'old preset draft')
  state.preset = 'another'
  services.conf.formDataPreset.value = 'another'
  state.config = {
    ...state.config,
    aiFiltering: { ...state.config.aiFiltering, prompt: [{ role: 'user', content: 'new preset' }] },
  }
  await act(async () => root.render(createElement(Models)))
  expect(button('保存提示词').disabled).toBe(true)
  await click(button('放弃修改'))
  expect(container.querySelector('textarea').value).toBe('new preset')
  expect(configWrites).toHaveLength(0)
})
