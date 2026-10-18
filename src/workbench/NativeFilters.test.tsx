/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { defaultFormData } from '../composables/conf/info'
import { nativeSearchFromUrl } from '../entrypoints/boss/nativeSearch'

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
])
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
dom.window.Element.prototype.getAnimations = () => []

const state = {
  config: structuredClone(defaultFormData),
  preset: 'default',
  keywords: '产品经理\nAI产品经理',
  connected: true,
  runtime: null,
  tabs: [{ id: 1, url: 'https://www.zhipin.com/web/geek/jobs?query=当前页&city=101010100' }],
  tabId: 1,
  settingsWarning: '',
}
const saves = []
let saveError = ''
mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))

let fail = false
mock.module('@/message', () => ({
  counter: {
    fetchText: async ({ url }) => {
      if (fail) throw new Error('offline')
      let zpData
      if (url.includes('condition')) {
        zpData = Object.fromEntries(
          ['salary', 'jobType', 'experience', 'degree', 'stage', 'scale'].map((key) => [
            `${key}List`,
            [
              { code: 0, name: '不限' },
              { code: 101, name: '选项一' },
              { code: 102, name: '选项二' },
            ],
          ]),
        )
      } else if (url.includes('industry')) {
        zpData = [1, 2, 3, 4].map((code) => ({ code, name: `行业${code}` }))
      } else {
        zpData = {
          cityList: [
            {
              code: 101000000,
              name: '北京',
              subLevelModelList: [{ code: 101010100, name: '北京市' }],
            },
          ],
          hotCityList: [{ code: 100010000, name: '全国' }],
        }
      }
      return { text: JSON.stringify({ code: 0, zpData }) }
    },
  },
}))
mock.module('./store', () => ({
  perform: async (work) => work(),
  saveConfig: async (patch, preset) => {
    if (saveError) throw new Error(saveError)
    saves.push({ patch, preset })
    state.config = { ...state.config, ...patch }
  },
}))

const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { NativeFilters, SearchFilters } = await import('./NativeFilters')
let root, container, value

function Form() {
  const [current, setCurrent] = useState(
    nativeSearchFromUrl('https://www.zhipin.com/web/geek/jobs'),
  )
  value = current
  return createElement(NativeFilters, {
    value: current,
    onChange: setCurrent,
    disabled: false,
    keywords: ['产品经理', 'AI产品经理'],
  })
}
async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click())
}
async function open(label) {
  if (['工作经验', '公司行业'].includes(label)) {
    const more = container.querySelector('button[aria-expanded][aria-controls]')
    if (more?.getAttribute('aria-expanded') === 'false') await click(more)
  }
  const field = document.querySelector(`[aria-label="${label}"]`)
  await click((field.closest('[data-slot="combo-box"]') ?? field).querySelector('button') ?? field)
}
const option = (text) =>
  [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === text)
beforeEach(async () => {
  fail = false
  saveError = ''
  saves.length = 0
  state.preset = 'default'
  state.connected = true
  state.runtime = null
  state.keywords = '产品经理\nAI产品经理'
  state.config = structuredClone(defaultFormData)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
afterAll(() => dom.window.close())
async function render() {
  await act(async () => root.render(createElement(Form)))
  await act(async () => new Promise(requestAnimationFrame))
}

test('selects multiple native codes and clears them with unrestricted', async () => {
  await render()
  await open('工作经验')
  await click(option('选项一'))
  await click(option('选项二'))
  expect(value.experience).toEqual(['101', '102'])
  await click(option('不限'))
  expect(value.experience).toEqual([])
  await click(option('选项二'))
  expect(value.experience).toEqual(['102'])
})

test('limits industries to three while allowing deselection and unrestricted', async () => {
  await render()
  await open('公司行业')
  for (const text of ['行业1', '行业2', '行业3', '行业4']) await click(option(text))
  expect(value.industry).toEqual(['1', '2', '3'])
  expect(option('行业4').getAttribute('aria-disabled')).toBe('true')
  await click(option('行业2'))
  await click(option('行业4'))
  expect(value.industry).toEqual(['1', '3', '4'])
  await click(option('不限'))
  expect(value.industry).toEqual([])
})

test('clears a single native salary and city selection', async () => {
  await render()
  await open('薪资待遇')
  await click(option('选项一'))
  expect(value.salary).toBe('101')
  await open('薪资待遇')
  await click(option('不限'))
  expect(value.salary).toBe('')
  await open('工作城市')
  await click(option('北京市'))
  expect(value.city).toBe('101010100')
  await open('工作城市')
  await click(option('不限'))
  expect(value.city).toBe('')
})

test('retries failed metadata loading without changing filters', async () => {
  fail = true
  await render()
  expect(container.textContent).toContain('筛选选项加载失败')
  fail = false
  await click([...container.querySelectorAll('button')].find((el) => el.textContent === '重试'))
  expect(container.textContent).not.toContain('筛选选项加载失败')
  await open('工作经验')
  await click(option('选项一'))
  expect(value.experience).toEqual(['101'])
})

const button = (text) =>
  [...container.querySelectorAll('button')].find((el) => el.textContent === text)
const renderSearch = (disabled = false) =>
  act(async () => root.render(createElement(SearchFilters, { disabled })))
async function expandFilters() {
  const toggle = container.querySelector('button[aria-expanded][aria-controls]')
  expect(toggle).toBeTruthy()
  if (toggle.getAttribute('aria-expanded') === 'false') await click(toggle)
  return toggle
}

test('reads the connected page and applies only native filters with the originating preset', async () => {
  await renderSearch()
  await expandFilters()
  await click(container.querySelector('[aria-label="读取 BOSS 当前筛选"]'))
  await open('职位关键词')
  await click(option('AI产品经理'))
  await click(button('应用到 BOSS'))
  expect(saves).toEqual([
    {
      patch: { nativeSearch: { ...nativeSearchFromUrl(state.tabs[0].url), query: 'AI产品经理' } },
      preset: 'default',
    },
  ])
})

test('keeps a failed filter draft and blocks saving it after another window changes the preset', async () => {
  await renderSearch()
  await expandFilters()
  await open('职位关键词')
  await click(option('AI产品经理'))
  saveError = '同步失败'
  await click(button('应用到 BOSS'))
  expect(saves).toEqual([])
  expect(container.querySelector('[aria-label="职位关键词"]').textContent).toContain('AI产品经理')
  state.preset = 'another'
  await renderSearch()
  expect(button('应用到 BOSS').disabled).toBe(true)
  expect(container.textContent).toContain('配置预设已变更')
  await click(container.querySelector('[aria-label="放弃筛选修改"]'))
  expect(container.querySelector('[aria-label="职位关键词"]').textContent).not.toContain(
    'AI产品经理',
  )
  saveError = ''
  await renderSearch(true)
  expect(button('应用到 BOSS').disabled).toBe(true)
})

test('keeps one filter heading and reveals actions only inside the expanded panel', async () => {
  await renderSearch()
  expect([...container.querySelectorAll('h2, h3')].map((el) => el.textContent)).toEqual(['筛选'])
  const toggle = await expandFilters()
  expect(toggle.querySelector('span.font-semibold')?.textContent).toBe('筛选')
  expect(toggle.classList.contains('w-full')).toBe(true)
  expect(toggle.classList.contains('justify-between')).toBe(true)
  expect([...container.querySelectorAll('h2, h3')].map((el) => el.textContent)).toEqual(['筛选'])
  const panel = document.getElementById(toggle.getAttribute('aria-controls'))
  expect(panel.contains(button('应用到 BOSS'))).toBe(true)
  expect(panel.contains(container.querySelector('[aria-label="放弃筛选修改"]'))).toBe(true)
  expect(panel.contains(container.querySelector('[aria-label="读取 BOSS 当前筛选"]'))).toBe(true)
  await open('职位关键词')
  await click(option('AI产品经理'))
  await click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect([...container.querySelectorAll('h2, h3')].map((el) => el.textContent)).toEqual(['筛选'])
  await expandFilters()
  expect(container.querySelector('[aria-label="职位关键词"]').textContent).toContain('AI产品经理')
})

test('uses saved rotation keywords instead of an unrelated native query and follows active rotation', async () => {
  state.config.nativeSearch = nativeSearchFromUrl(
    'https://www.zhipin.com/web/geek/jobs?query=旧搜索词',
  )
  await renderSearch()
  const selector = () => container.querySelector('[aria-label="职位关键词"]')
  expect(selector()?.textContent).toContain('产品经理')
  expect(container.querySelector('input[maxlength="100"]')).toBeNull()
  await open('职位关键词')
  expect([...document.querySelectorAll('[role="option"]')].map((el) => el.textContent)).toEqual([
    '产品经理',
    'AI产品经理',
  ])
  await click(option('AI产品经理'))
  await expandFilters()
  await click(button('应用到 BOSS'))
  expect(saves[0].patch.nativeSearch.query).toBe('AI产品经理')
  expect(state.keywords).toBe('产品经理\nAI产品经理')
  state.runtime = {
    keywordRotationBusy: true,
    keywordRotation: { cursor: 0, items: [{ keyword: '产品经理' }, { keyword: 'AI产品经理' }] },
  }
  await renderSearch(true)
  expect(selector().textContent).toContain('产品经理')
  state.runtime.keywordRotation.cursor = 1
  await renderSearch(true)
  expect(selector().textContent).toContain('AI产品经理')
})
