/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { defaultFormData } from '../composables/conf/info'
import * as deepmerge from '../utils/deepmerge'

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
const { createRoot } = await import('react-dom/client')

const state = {
  loading: false,
  saving: false,
  connected: false,
  runtime: null,
  config: defaultFormData,
  preset: 'default',
  presets: [],
  tabs: [],
  tabId: null,
  settingsWarning: '配置已保存，尚未同步到 BOSS',
}
mock.module('@/composables/conf/info', () => ({ defaultFormData }))
mock.module('@/utils/deepmerge', () => deepmerge)
mock.module('@/utils/jsonImportExport', () => ({ exportJson: () => {} }))
mock.module('@/message', () => ({
  counter: {
    fetchText: async () => {
      throw new Error('offline')
    },
  },
}))
mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
mock.module('./store', () => ({
  perform: async (work) => work(),
  command: async () => {},
  saveConfig: async (patch) => {
    state.config = { ...state.config, ...patch }
  },
  reloadExecutorSettings: async () => {},
  services: { conf: { formDataPreset: { value: 'default' } } },
}))

const { Settings } = await import('./Settings')
let root
let container
beforeEach(() => {
  state.config = structuredClone(defaultFormData)
  state.runtime = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => {
    await new Promise(requestAnimationFrame)
    root.unmount()
  })
  container.remove()
})
afterAll(() => dom.window.close())
const render = () => act(async () => root.render(createElement(Settings)))
const button = (text, scope = container) =>
  [...scope.querySelectorAll('button')].find((element) => element.textContent === text)
const click = (element) => act(async () => element.click())
async function fill(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

test('replaces numeric ranges with native filters above optional local rules', () => {
  const html = renderToStaticMarkup(createElement(Settings, { page: 'filters' }))
  for (const label of [
    '工作城市',
    '职位类型',
    '薪资待遇',
    '工作经验',
    '学历要求',
    '融资阶段',
    '公司规模',
    '公司行业',
    '保存并同步 BOSS',
  ])
    expect(html).toContain(label)
  for (const label of ['月薪（K）下限', '公司人数上限', '严格匹配', '同步时薪、日薪与月薪'])
    expect(html).not.toContain(label)
  expect(html.indexOf('BOSS 原生筛选')).toBeLessThan(html.indexOf('本地筛选规则'))
  for (const label of [
    '工作地址',
    '匹配方式',
    '启用高德地图通勤筛选',
    '驾车距离',
    '驾车时间',
    '步行距离',
    '步行时间',
  ])
    expect(html).not.toContain(label)
  expect(html).toContain('公司名称排除关键词')
  expect(html).toContain('最大直线距离（公里）')
  expect(html).toContain('尚未同步到 BOSS')
})

test('keeps native filters out of task timing settings', () => {
  const html = renderToStaticMarkup(createElement(Settings))
  expect(html).toContain('投递与执行')
  expect(html).not.toContain('BOSS 原生筛选')
})

test('keeps common controls visible and all detailed timing controls collapsed', async () => {
  await render()
  const advanced = [...container.querySelectorAll('details')]
  expect(advanced).toHaveLength(3)
  expect(advanced.every((element) => !element.open)).toBe(true)
  const common = [...container.querySelectorAll('[data-slot="number-field-input"]')].filter(
    (input) => !input.closest('details'),
  )
  expect(common.map((input) => input.value)).toEqual(['120', '10'])
  expect(container.querySelectorAll('input[type="range"]')).toHaveLength(12)
  for (const label of ['关键词间隔', '批次休息', '滚动间隔', '详情采集间隔']) {
    const range = container.querySelector(`section[aria-label="${label}"]`)
    expect(range.querySelectorAll('[data-slot="number-field-input"]')).toHaveLength(0)
  }
  expect(container.textContent).not.toContain('秒 ·')
})

test('converts a single minute interval input back to seconds and syncs its slider', async () => {
  await render()
  const interval = container.querySelector('section[aria-label="翻页间隔（分钟）"]')
  expect(interval).toBeTruthy()
  interval.closest('details').open = true
  const input = interval.querySelector('[data-slot="number-field-input"]')
  await fill(input, '7.5')
  expect(Number(interval.querySelector('input[type="range"]').value)).toBe(7.5)
  await click(button('保存配置'))
  expect(state.config.delayDeliveryPageNext).toBe(450)
})

test('restores only the chosen group and keeps custom timings in other groups', async () => {
  state.config.delayDeliveryInterval = 17.3
  state.config.delayCollectionScrollMax = 27.4
  state.config.keywordRotationDailyLimit = 37
  await render()
  const rotation = container.querySelector('section[aria-label="关键词间隔"]').closest('details')
  rotation.open = true
  await click(button('恢复本组默认值', rotation))
  await click(button('保存配置'))
  expect(state.config.keywordRotationDailyLimit).toBe(10)
  expect(state.config.delayDeliveryInterval).toBe(17.3)
  expect(state.config.delayCollectionScrollMax).toBe(27.4)
})

test('preserves custom ranges beyond the usual slider scale during unrelated edits', async () => {
  state.config.delayKeywordRotationMin = 5000
  state.config.delayKeywordRotationMax = 20000
  await render()
  const interval = container.querySelector('section[aria-label="关键词间隔"]')
  expect(interval).toBeTruthy()
  const upper = interval.querySelectorAll('input[type="range"]')[1]
  expect(Number(upper.value)).toBe(20000)
  expect(Number(upper.max)).toBeGreaterThanOrEqual(20000)
  const common = [...container.querySelectorAll('[data-slot="number-field-input"]')].filter(
    (input) => !input.closest('details'),
  )
  await fill(common[1], '11')
  await click(button('保存配置'))
  expect(state.config.keywordRotationDailyLimit).toBe(11)
  expect(state.config.delayKeywordRotationMin).toBe(5000)
  expect(state.config.delayKeywordRotationMax).toBe(20000)
})

test('updates ranges with the keyboard and prevents thumbs crossing', async () => {
  await render()
  const interval = container.querySelector('section[aria-label="关键词间隔"]')
  interval.closest('details').open = true
  const [lower, upper] = interval.querySelectorAll('input[type="range"]')
  const key = (value) =>
    act(async () =>
      lower.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })),
    )
  await key('ArrowRight')
  expect(Number(lower.value)).toBeCloseTo(300.1)
  expect(Number(upper.value)).toBe(900)
  await key('End')
  await key('ArrowRight')
  expect(Number(lower.value)).toBe(900)
  await click(button('保存配置'))
  expect(state.config.delayKeywordRotationMin).toBe(900)
  expect(state.config.delayKeywordRotationMax).toBe(900)
})

test('disables timing controls and group resets while a task is running', async () => {
  state.runtime = { keywordRotationBusy: true }
  await render()
  const inputs = [
    ...container.querySelectorAll('input[type="range"], [data-slot="number-field-input"]'),
  ]
  expect(inputs.length).toBeGreaterThan(8)
  expect(inputs.every((input) => input.disabled)).toBe(true)
  const resets = [...container.querySelectorAll('button')].filter(
    (element) => element.textContent === '恢复本组默认值',
  )
  expect(resets).toHaveLength(3)
  expect(resets.every((element) => element.disabled)).toBe(true)
})
