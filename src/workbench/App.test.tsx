/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { defaultFormData } from '../composables/conf/info'
import * as scoring from '../composables/useApplying/scoring'
import * as jobs from '../entrypoints/boss/jobStore'

const require = createRequire(new URL('../../packages/devlog-ui/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://extension.example/workbench.html#tasks',
  pretendToBeVisual: true,
})
for (const key of [
  'window',
  'document',
  'location',
  'localStorage',
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
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.matchMedia = globalThis.matchMedia
dom.window.Element.prototype.getAnimations = () => []
const calls = []
const state = {
  loading: false,
  saving: false,
  connected: false,
  records: [],
  error: '',
  libraryError: '',
  connectionError: '',
  settingsWarning: '',
  runtime: null,
  tabs: [],
  tabId: null,
  config: defaultFormData,
  models: [],
  resumes: { resumes: [], currentResumeId: null },
  keywords: '产品经理',
  today: null,
  statistics: [],
  analysisRun: null,
  analysisBusy: false,
}
mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
mock.module('@/entrypoints/boss/jobStore', () => jobs)
mock.module('@/composables/useApplying/scoring', () => scoring)
mock.module('@/composables/useModel', () => ({ isCompleteModel: () => false }))
mock.module('@/utils/jsonImportExport', () => ({ exportJson: async () => {} }))
mock.module('./Models', () => ({ Models: () => null }))
mock.module('./Settings', () => ({ Settings: () => null }))
mock.module('./Resumes', () => ({ Resumes: () => null }))
mock.module('./Logs', () => ({ Logs: () => null }))
mock.module('./store', () => ({
  perform: async (work) => work(),
  command: async () => {},
  openBoss: async () => {},
  openWorkbench: async () => {},
  reconnectExecutor: async () => {},
  selectTab() {},
  selectResume: async () => {},
  refreshLibrary: async () => {},
  updateSavedJob: async () => {},
  startSavedAnalysis: async (options) => {
    calls.push(options)
  },
  stopSavedAnalysis: async () => {},
}))
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { App } = await import('./App')
let root
let container
beforeEach(() => {
  location.hash = 'tasks'
  calls.length = 0
  state.today = null
  state.records = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    root.unmount()
  })
  container.remove()
})
afterAll(() => dom.window.close())
const render = async (mode = 'workbench') =>
  act(async () => root.render(createElement(App, { mode })))

test('deletes the home and live toolbar, redirects old links to the offline job library', async () => {
  await render()
  expect(location.hash).toBe('#jobs')
  expect(container.textContent).not.toContain('首页')
  expect(container.querySelector('[aria-label="BOSS 岗位页"]')).toBeNull()
  expect(container.querySelector('header').textContent).not.toContain('未连接')
  const analyze = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '分析待处理岗位',
  )
  expect(analyze.disabled).toBe(false)
  await act(async () => analyze.click())
  expect(calls).toEqual([{ limit: Number.MAX_SAFE_INTEGER }])
})

test('keeps overall delivery history in Jobs, separate from the filtered list', async () => {
  const date = new Date().toLocaleDateString('en-CA')
  state.today = { date, total: 10, success: 7, repeat: 2, activityFilter: 1 }
  state.records = jobs.mergeJobRecords(
    [],
    [{ encryptJobId: 'excluded', jobName: '已排除岗位' }],
    'AI',
    'batch',
  ).records
  state.records[0].processingStatus = 'excluded'
  await render()
  expect(container.textContent).toContain('筛选结果 0')
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (element) => element.textContent === '投递统计',
  )
  await act(async () => tab.click())
  expect(container.querySelector('[aria-label="统计范围"]')).toBeTruthy()
  expect(container.querySelector('[aria-label="历史投递统计"]').textContent).toContain(date)
  expect(container.textContent).toContain('成功投递 7')
  expect(container.querySelector('[aria-label="岗位筛选"]')).toBeNull()
})

test('puts page selection, reconnect, jump and status in the sidebar header', async () => {
  await render('sidepanel')
  const header = container.querySelector('header')
  expect(header.querySelector('[aria-label="BOSS 岗位页"]')).toBeTruthy()
  expect(header.querySelector('[aria-label="重新连接"]')).toBeTruthy()
  expect(header.querySelector('[aria-label="打开 BOSS 岗位页"]')).toBeTruthy()
  expect(header.textContent).toContain('未连接')
  expect(container.querySelectorAll('[aria-label="BOSS 岗位页"]')).toHaveLength(1)
  expect(container.textContent.indexOf('当前配置')).toBeGreaterThan(
    container.textContent.indexOf('最近运行'),
  )
})

test('keeps the workbench navigation tabs renderable', async () => {
  await render()
  const navigation = container.querySelector('[aria-label="工作台导航"]')
  expect(navigation).toBeTruthy()
  const tabs = [...navigation.querySelectorAll('[role="tab"]')]
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    '岗位筛选',
    '简历',
    '模型与提示词',
    '岗位库',
    '任务设置',
    '运行日志',
  ])
  const routes = ['filters', 'resumes', 'models', 'jobs', 'settings', 'logs']
  for (const [index, tab] of tabs.entries()) {
    await act(async () => tab.click())
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(location.hash).toBe(`#${routes[index]}`)
  }
})
