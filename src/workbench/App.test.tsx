/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { defaultFormData } from '../composables/conf/info'
import * as scoring from '../composables/useApplying/scoring'
import * as jobs from '../entrypoints/boss/jobStore'
import { clearDiagnostics, diagnostic } from '../utils/diagnostics'
import * as resumeMatcher from './resumeMatcher'

let mirrorStatus
const mirrorCalls = []
void mock.module('#imports', () => ({
  browser: {
    runtime: {
      sendMessage: async (message) => {
        mirrorCalls.push(message)
        return {
          ok: true,
          path: 'C:/OfferHunt/diagnostics/latest.json',
          exportedAt: '2026-10-18T00:00:00Z',
        }
      },
    },
    storage: {
      local: { remove: async () => {}, get: async (key) => ({ [key]: mirrorStatus }) },
      onChanged: { addListener() {}, removeListener() {} },
    },
  },
}))

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
const commands = []
let commandError = ''
const chatSelections = []
const deletions = []
const batchDeletions = []
const greetingGenerations = []
let batchDeleteError = ''
const resumeSelections = []
const imports = []
const csvExports = []
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
  preset: 'default',
  analysisRun: null,
  analysisBusy: false,
  historyDetailRun: null,
}
void mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
void mock.module('@/entrypoints/boss/jobStore', () => jobs)
void mock.module('@/composables/useApplying/scoring', () => scoring)
void mock.module('@/composables/useModel', () => ({ isCompleteModel: () => false }))
void mock.module('@/utils/jsonImportExport', () => ({ exportJson: async () => {} }))
void mock.module('@/utils/csvExport', () => ({ exportCsv: (...args) => csvExports.push(args) }))
void mock.module('./Models', () => ({ Models: () => null }))
void mock.module('./Settings', () => ({ Settings: () => null }))
void mock.module('./Resumes', () => ({ Resumes: () => null }))
void mock.module('@/message', () => ({
  counter: {
    fetchText: async () => {
      throw new Error('offline')
    },
  },
}))
void mock.module('./store', () => ({
  saveConfig: async () => {},
  perform: async (work) => work(),
  command: async (value) => {
    commands.push(value)
    if (commandError) throw new Error(commandError)
  },
  selectChat: (key) => {
    chatSelections.push(key)
  },
  openBoss: async () => {},
  openWorkbench: async () => {},
  reconnectExecutor: async () => {},
  selectTab() {},
  selectResume: async (id) => {
    resumeSelections.push(id)
  },
  refreshLibrary: async () => {},
  updateSavedJob: async () => {},
  importSavedJobs: async (records) => {
    imports.push(records)
    return { newCount: records.length - 1, duplicateCount: 1 }
  },
  deleteSavedJob: async (jobId) => {
    deletions.push(jobId)
  },
  deleteSavedJobs: async (jobIds) => {
    if (batchDeleteError) throw new Error(batchDeleteError)
    batchDeletions.push(jobIds)
    state.records = state.records.filter((record) => !jobIds.includes(record.encryptJobId))
  },
  startSavedAnalysis: async (options) => {
    calls.push(options)
  },
  generateSavedGreeting: async (jobId) => {
    greetingGenerations.push(jobId)
  },
  stopSavedAnalysis: async () => {},
}))
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { App } = await import('./App')
let root
let container
beforeEach(() => {
  commandError = ''
  clearDiagnostics()
  mirrorStatus = { ok: false, error: 'Host not found' }
  mirrorCalls.length = 0
  location.hash = 'tasks'
  calls.length = 0
  commands.length = 0
  chatSelections.length = 0
  deletions.length = 0
  batchDeletions.length = 0
  greetingGenerations.length = 0
  batchDeleteError = ''
  resumeSelections.length = 0
  imports.length = 0
  csvExports.length = 0
  state.resumes = { resumes: [], currentResumeId: null }
  state.connected = false
  state.activeDetail = null
  state.connectionError = ''
  state.today = null
  state.records = []
  state.runtime = null
  state.historyDetailRun = null
  state.analysisBusy = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
const originalWindowOpen = window.open
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    root.unmount()
  })
  Object.defineProperty(window, 'open', { configurable: true, value: originalWindowOpen })
  container.remove()
})
afterAll(() => dom.window.close())
const render = async (mode = 'workbench') =>
  act(async () => root.render(createElement(App, { mode })))

test('exposes machine log access and installation when disconnected, then shows verified sync status', async () => {
  location.hash = 'logs'
  await render()
  expect(container.textContent).toContain('AI 诊断日志访问')
  expect(container.textContent).toContain('npm run diagnostics:install')
  expect(container.textContent).toContain('npm run diagnostics:read')
  expect(container.textContent).toContain('Host not found')
  expect(container.textContent).not.toContain('已同步')
  await act(async () => container.querySelector('[aria-label="同步诊断到本机"]').click())
  expect(mirrorCalls).toEqual([{ type: 'boss-helper:diagnostic-sync' }])
  expect(container.textContent).toContain('已同步')
  expect(container.textContent).toContain('C:/OfferHunt/diagnostics/latest.json')
})

test('keeps communication diagnostics visible and exportable with no connected BOSS tab', async () => {
  location.hash = 'logs'
  diagnostic('content.background.storageGet', {
    error: new Error('Extension context invalidated'),
    context: { tabId: 42 },
  })
  await render()
  expect(container.textContent).toContain('content.background.storageGet')
  expect(container.textContent).toContain('Extension context invalidated')
  expect(container.querySelector('[aria-label="导出诊断"]').disabled).toBe(false)
  expect(container.textContent).toContain('42')
  expect(container.textContent.indexOf('清空')).toBeLessThan(
    container.textContent.indexOf('日志级别'),
  )
  expect(container.textContent).not.toContain('AI 对话')
  expect(container.textContent).not.toContain('补充消息草稿')
  expect(container.querySelector('[role="tab"]')).toBeNull()
})

test('shows per-job AI messages and collapsed reasoning inside workbench logs', async () => {
  location.hash = 'logs'
  state.connected = true
  state.runtime = {
    jobs: [
      { key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } },
      { key: 'boss::two', jobName: '设计师', brand: { name: '另一公司' } },
    ],
    logs: [{ title: '分析完成', state: 'success', state_name: '成功', message: '已保存分析结果' }],
    chatJobs: ['boss::one', 'boss::two'],
    chatJobKey: 'boss::one',
    messages: [
      {
        id: 'input',
        role: 'user',
        uiRole: 'user',
        parts: [{ type: 'text', text: '请分析该岗位' }],
      },
      {
        id: 'reply',
        role: 'assistant',
        uiRole: 'greetings',
        parts: [
          { type: 'reasoning', text: '结合产品经历匹配岗位要求' },
          { type: 'text', text: '您好，我有三年产品经验。' },
        ],
      },
    ],
  }
  await render()
  const process = container.querySelector('[aria-label="AI 过程"]')
  expect(process).toBeTruthy()
  expect(process.open).toBe(false)
  await act(async () => process.querySelector('summary').click())
  expect(process.open).toBe(true)
  expect(process.textContent).toContain('请分析该岗位')
  expect(process.textContent).toContain('您好，我有三年产品经验。')
  const reasoning = process.querySelector('details')
  expect(reasoning.open).toBe(false)
  await act(async () => reasoning.querySelector('summary').click())
  expect(reasoning.open).toBe(true)
  expect(reasoning.textContent).toContain('结合产品经历匹配岗位要求')
  await act(async () => container.querySelector('[aria-label="岗位对话"]').click())
  await act(async () =>
    [...document.querySelectorAll('[role="option"]')]
      .find((option) => option.textContent.includes('设计师'))
      .click(),
  )
  expect(chatSelections).toEqual(['boss::two'])
  state.runtime.chatJobKey = 'boss::two'
  state.runtime.messages = [
    {
      id: 'two',
      role: 'assistant',
      uiRole: 'filtering',
      parts: [{ type: 'text', text: '设计匹配结果' }],
    },
  ]
  await render()
  expect(process.textContent).toContain('设计匹配结果')
  expect(process.textContent).not.toContain('您好，我有三年产品经验。')
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('分析完成'))
      .click(),
  )
  expect(container.textContent).toContain('已保存分析结果')
})

test('keeps AI messages out of the sidebar even when a conversation is available', async () => {
  state.connected = true
  state.runtime = {
    jobs: [{ key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } }],
    results: [],
    logs: [],
    chatJobs: ['boss::one'],
    chatJobKey: 'boss::one',
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        uiRole: 'greetings',
        parts: [{ type: 'text', text: '模型过程内容' }],
      },
    ],
  }
  await render('sidepanel')
  expect(container.querySelector('[aria-label="AI 过程"]')).toBeNull()
  expect(container.querySelector('[aria-label="岗位对话"]')).toBeNull()
  expect(container.textContent).not.toContain('模型过程内容')
})

test('deletes the home and live toolbar, redirects old links to the offline job library', async () => {
  await render()
  expect(location.hash).toBe('#jobs')
  expect(container.textContent).not.toContain('首页')
  expect(container.querySelector('[aria-label="BOSS 岗位页"]')).toBeNull()
  expect(container.querySelector('[aria-label="连接 BOSS 岗位页"]')).toBeNull()
  expect(container.querySelector('header').textContent).not.toContain('未连接')
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('更多'))
      .click(),
  )
  const analyze = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === '分析',
  )
  expect(analyze.getAttribute('aria-disabled')).not.toBe('true')
  await act(async () => analyze.click())
  expect(calls).toEqual([{ limit: Number.MAX_SAFE_INTEGER }])
})

test('keeps the job list toolbar focused and moves low-frequency actions into menus', async () => {
  await render()
  const toolbar = container.querySelector('[role="group"][aria-label="岗位库操作"]')
  expect(toolbar).toBeTruthy()
  expect(toolbar.textContent).not.toContain('批处理')
  expect(toolbar.textContent).toContain('更多')
  expect(toolbar.textContent).not.toContain('补全历史岗位')
  expect(toolbar.textContent).not.toContain('分析待处理岗位')
  expect(toolbar.textContent).not.toContain('导出筛选结果')
  const filterButton = [...toolbar.querySelectorAll('button')].find(
    (button) => button.textContent === '筛选',
  )
  const moreButton = [...toolbar.querySelectorAll('button')].find((button) =>
    button.textContent.includes('更多'),
  )
  expect(filterButton.closest('[role="group"]')).toBe(toolbar)
  expect(moreButton.closest('[role="group"]')).toBe(toolbar)
  await act(async () => moreButton.click())
  expect(document.body.textContent).toContain('补全')
  expect(document.body.textContent).toContain('分析')
  expect(document.body.textContent).toContain('导入')
  expect(document.body.textContent).toContain('刷新')
  expect(document.body.textContent).not.toContain('导出')
  const filter = container.querySelector('[aria-label="岗位筛选"]')
  expect(filter).toBeNull()
  await act(async () => filterButton.click())
  expect(document.body.querySelector('[aria-label="岗位筛选"]')).toBeTruthy()
  expect(document.body.textContent).toContain('导出')
})

test('exports filtered jobs as spreadsheet columns from the filter popover', async () => {
  state.records = jobs.mergeJobRecords(
    [],
    [
      {
        encryptJobId: 'job-1',
        jobName: '产品经理',
        brandName: '示例公司',
        salaryDesc: '20-30K',
        cityName: '上海',
        areaDistrict: '浦东新区',
      },
    ],
    'AI',
    'batch-1',
  ).records
  Object.assign(state.records[0], {
    analysis: { rating: 82 },
    manualFunnelStage: 'interview',
    firstSeenAt: '2026-01-02T03:04:05.000Z',
  })
  await render()
  const filterButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '筛选',
  )
  await act(async () => filterButton.click())
  const exportButton = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === '导出',
  )
  await act(async () => exportButton.click())

  expect(csvExports).toHaveLength(1)
  expect(csvExports[0][0]).toEqual([
    '岗位名称',
    '公司',
    '薪资',
    '地点',
    '匹配度',
    '跟进阶段',
    '采集时间',
    '岗位链接',
  ])
  expect(csvExports[0][1][0]).toEqual([
    '产品经理',
    '示例公司',
    '20-30K',
    '上海 · 浦东新区',
    '82/100',
    '面试中',
    expect.any(String),
    'https://www.zhipin.com/job_detail/job-1.html',
  ])
  expect(csvExports[0][2]).toBe('OfferHunt-job-library-filtered')
})

test('starts history completion and exposes resume and pause without requiring saved JD', async () => {
  location.hash = 'jobs'
  state.connected = true
  state.records = jobs.mergeJobRecords(
    [],
    [{ encryptJobId: 'old', jobName: 'Old' }],
    '',
    '',
  ).records
  await render()
  const openMore = () =>
    act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent.includes('更多'))
        .click(),
    )
  const chooseMoreAction = (label) =>
    act(async () =>
      [...document.body.querySelectorAll('[role="menuitem"]')]
        .find((item) => item.textContent === label)
        .click(),
    )
  await openMore()
  expect(document.body.textContent).toContain('补全')
  await chooseMoreAction('补全')
  expect(commands.at(-1)).toEqual({ type: 'completeHistory' })
  state.historyDetailRun = {
    id: 'run',
    jobIds: ['old'],
    total: 1,
    cursor: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    status: 'stopped',
    owner: '',
    expiresAt: 0,
  }
  await render()
  await openMore()
  await chooseMoreAction('继续补全')
  expect(commands.at(-1)).toEqual({ type: 'resumeHistory' })
  state.runtime = {
    gatheringBusy: true,
    historyDetailRun: { ...state.historyDetailRun, status: 'running' },
  }
  await render()
  await openMore()
  await chooseMoreAction('暂停补全')
  expect(commands.at(-1)).toEqual({ type: 'pauseGathering' })
  state.runtime.historyDetailRun.status = 'paused'
  await render()
  await openMore()
  await chooseMoreAction('继续')
  expect(commands.at(-1)).toEqual({ type: 'resumeGathering' })
  await openMore()
  await chooseMoreAction('停止补全')
  expect(commands.at(-1)).toEqual({ type: 'stopGathering' })
  state.runtime = null
  state.connected = false
  await render()
  await openMore()
  expect(
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent === '继续补全')
      .getAttribute('aria-disabled'),
  ).toBe('true')
  expect(document.body.textContent).not.toContain('重连')
  expect(container.querySelector('[aria-label="连接 BOSS 岗位页"]')).toBeNull()
  state.connected = true
  state.runtime = {
    gatheringBusy: true,
    detailRun: { status: 'running' },
    historyDetailRun: { ...state.historyDetailRun, status: 'completed' },
  }
  await render()
  await openMore()
  expect(
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent === '继续补全')
      .getAttribute('aria-disabled'),
  ).toBe('true')
  expect(
    [...document.body.querySelectorAll('[role="menuitem"]')].some(
      (item) => item.textContent === '暂停补全',
    ),
  ).toBe(false)
})

test('starts and resumes history completion from the sidebar with task and lease guards', async () => {
  state.connected = true
  const button = (label) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)
  await render('sidepanel')
  expect(button('补全历史岗位')?.disabled).toBe(false)
  await act(async () => button('补全历史岗位').click())
  expect(commands.at(-1)).toEqual({ type: 'completeHistory' })
  state.historyDetailRun = {
    id: 'history',
    jobIds: ['old'],
    cursor: 0,
    total: 1,
    completed: 0,
    failed: 0,
    skipped: 0,
    status: 'stopped',
    owner: '',
    expiresAt: 0,
  }
  await render('sidepanel')
  await act(async () => button('继续历史补全').click())
  expect(commands.at(-1)).toEqual({ type: 'resumeHistory' })
  state.historyDetailRun.owner = 'another-page'
  state.historyDetailRun.expiresAt = Date.now() + 90_000
  await render('sidepanel')
  expect(button('继续历史补全').disabled).toBe(true)
  state.historyDetailRun.owner = ''
  state.runtime = {
    jobs: [],
    logs: [],
    results: [],
    gatheringKind: 'detail',
    gatheringBusy: true,
    detailRun: { ...state.historyDetailRun, status: 'running' },
  }
  await render('sidepanel')
  expect(button('继续历史补全').disabled).toBe(true)
  await act(async () => button('暂停').click())
  expect(commands.at(-1)).toEqual({ type: 'pauseGathering' })
  state.runtime.detailRun.status = 'paused'
  await render('sidepanel')
  await act(async () => button('继续').click())
  expect(commands.at(-1)).toEqual({ type: 'resumeGathering' })
  await act(async () => button('停止补全').click())
  expect(commands.at(-1)).toEqual({ type: 'stopGathering' })
  state.runtime = null
  state.connected = false
  await render('sidepanel')
  expect(button('继续历史补全').disabled).toBe(true)
  state.connected = true
  state.analysisBusy = true
  await render('sidepanel')
  expect(button('继续历史补全').disabled).toBe(true)
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

test('imports historical JSON and reports duplicates and omitted exceptional descriptions', async () => {
  await render()
  const input = container.querySelector('[aria-label="导入历史岗位 JSON"]')
  const row = {
    name: '历史产品经理',
    'job-name href': 'https://www.zhipin.com/job_detail/history-one.html',
    'job-sec-text': '负责产品需求分析与项目交付。',
  }
  Object.defineProperty(input, 'files', {
    value: [
      {
        name: 'merged.json',
        text: async () =>
          JSON.stringify([
            row,
            { ...row, 'job-name href': 'https://www.zhipin.com/job_detail/history-two.html' },
            {
              ...row,
              'job-name href': 'https://www.zhipin.com/job_detail/exception.html',
              'job-sec-text': '负责处理账户异常等常见问题。',
            },
          ]),
      },
    ],
  })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(imports).toHaveLength(1)
  expect(imports[0].map((record) => record.encryptJobId)).toEqual(['history-one', 'history-two'])
  expect(container.textContent).toContain('导入完成：新增 1 条，跳过已有 1 条，剔除异常 1 条')
})

test('opens saved jobs by row click and deletes after confirmation', async () => {
  state.records = jobs.mergeJobRecords(
    [],
    [{ encryptJobId: 'saved-job', jobName: '待删除岗位' }],
    'AI',
    'batch',
  ).records
  await render()

  const row = container.querySelector('[data-slot="table-row"]')
  expect(row).toBeTruthy()
  await act(async () => row.click())
  expect(document.body.querySelector('[aria-label="岗位详情内容"]')).toBeTruthy()
  await act(async () => document.body.querySelector('[role="dialog"] button').click())

  const deleteButton = container.querySelector('[aria-label="删除岗位 待删除岗位"]')
  expect(deleteButton).toBeTruthy()
  expect(deleteButton.querySelector('svg')).toBeTruthy()
  await act(async () => deleteButton.click())
  expect(document.body.textContent).toContain('确认删除岗位')
  expect(document.body.querySelector('[aria-label="岗位详情内容"]')).toBeNull()

  const confirm = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === '删除',
  )
  await act(async () => confirm.click())
  expect(deletions).toEqual(['saved-job'])
})

test('shows only the active tab actions in the saved-job detail modal footer', async () => {
  const [record] = jobs.mergeJobRecords(
    [],
    [{ encryptJobId: 'saved-job', jobName: '可分析岗位' }],
    'AI',
    'batch',
  ).records
  Object.assign(record, {
    detailStatus: 'complete',
    detail: {
      jobInfo: { encryptId: 'saved-job', postDescription: '已保存的岗位职责详情' },
    },
    finalGreeting: '你好，我对这个岗位很感兴趣。',
  })
  state.records = [record]
  state.connected = true
  await render()
  await act(async () => container.querySelector('[data-slot="table-row"]').click())

  const dialog = document.body.querySelector('[role="dialog"]')
  const actionLabels = () =>
    [...dialog.querySelectorAll('button')]
      .map((button) => button.textContent.trim())
      .filter((label) => ['分析此岗位', '复制', '生成招呼语', '发送招呼语'].includes(label))
  const tab = (label) =>
    [...dialog.querySelectorAll('[role="tab"]')].find((button) =>
      button.textContent.includes(label),
    )

  expect(actionLabels()).toEqual([])
  await act(async () => tab('AI 分析').click())
  expect(actionLabels()).toEqual(['分析此岗位'])
  await act(async () => tab('招呼语').click())
  expect(actionLabels()).toEqual(['复制', '生成招呼语', '发送招呼语'])
  const footer = dialog.lastElementChild
  expect(footer.textContent).not.toContain('分析此岗位')
  for (const label of ['复制', '生成招呼语', '发送招呼语']) {
    const button = [...footer.querySelectorAll('button')].find((item) => item.textContent === label)
    expect(button).toBeTruthy()
    expect(button.closest('[role="tabpanel"]')).toBeNull()
  }
  expect(footer.textContent).not.toContain('关闭')
  await act(async () =>
    [...footer.querySelectorAll('button')]
      .find((button) => button.textContent === '生成招呼语')
      .click(),
  )
  expect(greetingGenerations).toEqual(['saved-job'])
})

test('opens Resume Matcher with the selected job and sends no resume content', async () => {
  const [record] = jobs.mergeJobRecords(
    [],
    [{ encryptJobId: 'tailor-job', jobName: '前端工程师', brandName: '示例公司' }],
    'AI',
    'batch',
  ).records
  Object.assign(record, {
    detailStatus: 'complete',
    detail: {
      jobInfo: {
        encryptId: 'tailor-job',
        jobName: '前端工程师',
        postDescription: '负责前端架构与组件建设',
      },
    },
  })
  state.records = [record]
  const sentMessages = []
  const matcherTab = { postMessage: (...args) => sentMessages.push(args) }
  const openedUrls = []
  Object.defineProperty(window, 'open', {
    configurable: true,
    value: (url) => {
      openedUrls.push(url)
      return matcherTab
    },
  })
  await render()
  await act(async () => container.querySelector('[data-slot="table-row"]').click())
  const dialog = document.body.querySelector('[role="dialog"]')
  const tailorTab = [...dialog.querySelectorAll('[role="tab"]')].find((tab) =>
    tab.textContent.includes('定制简历'),
  )
  await act(async () => tailorTab.click())
  expect(openedUrls).toHaveLength(0)
  expect(dialog.textContent).toContain('前端工程师')
  expect(dialog.textContent).not.toContain('负责前端架构与组件建设')
  expect([...dialog.querySelectorAll('dt')].some((item) => item.textContent.trim() === 'JD')).toBe(
    false,
  )
  const matcherLink = [...dialog.querySelectorAll('a')].find((link) =>
    link.textContent.includes('在 Resume Matcher 中定制'),
  )
  expect(matcherLink).toBeTruthy()
  if (!matcherLink) return
  await act(async () => matcherLink.click())
  const handoffId = new URL(openedUrls[0]).hash.split('=')[1]
  expect(openedUrls).toEqual([resumeMatcher.buildResumeMatcherUrl(handoffId)])
  const ready = new dom.window.Event('message')
  Object.defineProperties(ready, {
    origin: { value: 'http://localhost:3000' },
    source: { value: matcherTab },
    data: { value: { type: 'boss-helper-resume-matcher-ready', id: handoffId } },
  })
  window.dispatchEvent(ready)
  expect(sentMessages).toHaveLength(1)
  expect(sentMessages[0][1]).toBe('http://localhost:3000')
  expect(sentMessages[0][0]).toMatchObject({
    type: 'boss-helper-resume-matcher-handoff',
    id: handoffId,
    job: {
      title: '前端工程师',
      company: '示例公司',
      description: '负责前端架构与组件建设',
    },
  })
  expect(sentMessages[0][0]).not.toHaveProperty('resume')
})

test('does not require an OfferHunt master resume to open Resume Matcher', async () => {
  const [record] = jobs.mergeJobRecords(
    [],
    [{ encryptJobId: 'missing-resume-job', jobName: '待定制岗位' }],
    'AI',
    'batch',
  ).records
  Object.assign(record, {
    detailStatus: 'complete',
    detail: {
      jobInfo: {
        encryptId: 'missing-resume-job',
        postDescription: '岗位 JD',
      },
    },
  })
  state.records = [record]
  await render()
  await act(async () => container.querySelector('[data-slot="table-row"]').click())
  const dialog = document.body.querySelector('[role="dialog"]')
  await act(async () =>
    [...dialog.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.textContent.includes('定制简历'))
      .click(),
  )
  expect(dialog.querySelector('[role="alert"]')).toBeNull()
  expect(
    [...dialog.querySelectorAll('a')].some((link) =>
      link.textContent.includes('在 Resume Matcher 中定制'),
    ),
  ).toBe(true)
})

test('shows the approved job columns and sorts by first collection time by default', async () => {
  state.records = jobs.mergeJobRecords(
    [],
    [
      {
        encryptJobId: 'z',
        jobName: 'Z岗位',
        brandName: 'A公司',
        salaryDesc: '20-30K',
        cityName: '上海',
        areaDistrict: '浦东新区',
      },
      { encryptJobId: 'a', jobName: 'A岗位', brandName: 'Z公司' },
      { encryptJobId: 'm', jobName: 'M岗位', brandName: 'M公司' },
    ],
    'AI',
    'batch',
  ).records
  state.records[0].analysis = { rating: 90 }
  state.records[0].manualFunnelStage = 'offer'
  state.records[0].detailStatus = 'complete'
  state.records[0].firstSeenAt = '2026-10-15T10:00:00+08:00'
  state.records[0].lastSeenAt = '2026-10-18T10:00:00+08:00'
  state.records[1].analysis = { rating: 40 }
  state.records[1].firstSeenAt = '2026-10-17T10:00:00+08:00'
  state.records[2].manualFunnelStage = 'interview'
  state.records[2].detailStatus = 'failed'
  state.records[2].firstSeenAt = '2026-10-16T10:00:00+08:00'
  await render()

  const order = () =>
    [...container.querySelectorAll('[data-slot="table-row"]')].map(
      (row) =>
        row.querySelectorAll('[data-slot="table-cell"]')[1].querySelector('.font-medium')
          .textContent,
    )
  const sort = async (name) => {
    const header = [...container.querySelectorAll('[role="columnheader"]')].find(
      (item) => item.textContent === name,
    )
    expect(header.querySelector('[data-slot="table-sortable-column-header"]')).toBeTruthy()
    await act(async () => header.click())
    return header
  }

  expect(
    [...container.querySelectorAll('[role="columnheader"]')].map((header) => header.textContent),
  ).toEqual(['', '岗位', '公司', '薪资', '地点', '匹配度', '跟进阶段', '采集时间', '操作'])
  expect(order()).toEqual(['A岗位', 'M岗位', 'Z岗位'])
  expect((await sort('采集时间')).getAttribute('aria-sort')).toBe('ascending')
  expect(order()).toEqual(['Z岗位', 'M岗位', 'A岗位'])
  await sort('采集时间')
  expect(order()).toEqual(['A岗位', 'M岗位', 'Z岗位'])
  const row = [...container.querySelectorAll('[data-slot="table-row"]')].find((item) =>
    item.textContent.includes('Z岗位'),
  )
  const cells = row.querySelectorAll('[data-slot="table-cell"]')
  expect(cells[1].textContent).toBe('Z岗位')
  expect(cells[3].textContent).toBe('20-30K')
  expect(cells[4].textContent).toBe('上海 · 浦东新区')
  expect(cells[7].querySelector('time').getAttribute('datetime')).toBe('2026-10-15T10:00:00+08:00')
  expect(container.textContent).toContain('详情补全失败')
  expect((await sort('匹配度')).getAttribute('aria-sort')).toBe('ascending')
  expect(order()).toEqual(['A岗位', 'Z岗位', 'M岗位'])
  await sort('匹配度')
  expect(order()).toEqual(['Z岗位', 'A岗位', 'M岗位'])
  await sort('岗位')
  expect(order()).toEqual(['A岗位', 'M岗位', 'Z岗位'])
  await sort('公司')
  expect(order()).toEqual(['Z岗位', 'M岗位', 'A岗位'])
  await sort('跟进阶段')
  expect(order()).toEqual(['A岗位', 'M岗位', 'Z岗位'])
})

test('normalizes salary ranges, yearly pay and extra salary months for sorting, leaving incomparable pay last', async () => {
  const salaries = [
    ['year', '24-36万/年'],
    ['low', '8-12K'],
    ['extra', '18-25K·14薪'],
    ['fixed', '25000元/月'],
    ['decimal', '1.5-2万/月'],
    ['negotiable', '面议'],
    ['day', '200-300元/天'],
    ['hour', '100-150元/时'],
    ['invalid', '30-20K'],
  ]
  state.records = jobs.mergeJobRecords(
    [],
    salaries.map(([id, salaryDesc]) => ({
      encryptJobId: id,
      jobName: id,
      salaryDesc,
    })),
    'AI',
    'batch',
  ).records
  const original = structuredClone(state.records)
  await render()
  const header = [...container.querySelectorAll('[role="columnheader"]')].find(
    (item) => item.textContent === '薪资',
  )
  const order = () =>
    [...container.querySelectorAll('[data-slot="table-row"]')].map(
      (row) =>
        row.querySelectorAll('[data-slot="table-cell"]')[1].querySelector('.font-medium')
          .textContent,
    )
  await act(async () => header.click())
  expect(order()).toEqual([
    'low',
    'decimal',
    'year',
    'extra',
    'fixed',
    'negotiable',
    'day',
    'hour',
    'invalid',
  ])
  await act(async () => header.click())
  expect(order()).toEqual([
    'fixed',
    'extra',
    'year',
    'decimal',
    'low',
    'negotiable',
    'day',
    'hour',
    'invalid',
  ])
  expect(state.records).toEqual(original)
})

test('keeps missing collection dates last in both directions and shows missing values without invalid dates', async () => {
  state.records = jobs.mergeJobRecords(
    [],
    [
      { encryptJobId: 'invalid', jobName: 'invalid' },
      { encryptJobId: 'old', jobName: 'old' },
      { encryptJobId: 'new', jobName: 'new' },
      { encryptJobId: 'missing', jobName: 'missing' },
    ],
    'AI',
    'batch',
  ).records
  state.records[0].firstSeenAt = 'invalid'
  state.records[1].firstSeenAt = '2026-10-15T10:00:00+08:00'
  state.records[2].firstSeenAt = '2026-10-16T10:00:00+08:00'
  delete state.records[3].firstSeenAt
  await render()
  const order = () =>
    [...container.querySelectorAll('[data-slot="table-row"]')].map(
      (row) =>
        row.querySelectorAll('[data-slot="table-cell"]')[1].querySelector('.font-medium')
          .textContent,
    )
  expect(order()).toEqual(['new', 'old', 'invalid', 'missing'])
  const header = [...container.querySelectorAll('[role="columnheader"]')].find(
    (item) => item.textContent === '采集时间',
  )
  await act(async () => header.click())
  expect(order()).toEqual(['old', 'new', 'invalid', 'missing'])
  const cells = [...container.querySelectorAll('[data-slot="table-row"]')]
    .at(-1)
    .querySelectorAll('[data-slot="table-cell"]')
  expect(cells[3].textContent).toBe('未记录')
  expect(cells[4].textContent).toBe('未记录')
  expect(cells[7].textContent).toBe('未记录')
  expect(container.textContent).not.toContain('Invalid Date')
})

test('selects jobs across pages and batch deletes only the chosen jobs after confirmation', async () => {
  state.records = jobs.mergeJobRecords(
    [],
    Array.from({ length: 21 }, (_, i) => ({ encryptJobId: String(i), jobName: `岗位${i}` })),
    'AI',
    'batch',
  ).records
  await render()
  const checkbox = (label) => container.querySelector(`[aria-label="${label}"][type="checkbox"]`)
  const clickCheckboxControl = async (label) =>
    act(async () => {
      const control = checkbox(label)
        .closest('label')
        .querySelector('[data-slot="checkbox-control"]')
      for (const type of ['mousedown', 'mouseup', 'click'])
        control.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 }))
    })
  const button = (text) =>
    [...document.body.querySelectorAll('button')].find((item) => item.textContent === text)
  const waitForSelectionClear = async () => {
    for (let attempt = 0; attempt < 20 && container.textContent.includes('已选 '); attempt++)
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  }

  await act(async () => checkbox('选择岗位 岗位0').click())
  expect(document.body.querySelector('[data-slot="modal-dialog"]')).toBeNull()
  expect(container.textContent).toContain('已选 1')
  expect(checkbox('选择当前页岗位').indeterminate).toBe(true)
  await clickCheckboxControl('选择当前页岗位')
  expect(container.textContent).toContain('已选 20')
  expect(checkbox('选择当前页岗位').checked).toBe(true)
  await clickCheckboxControl('选择当前页岗位')
  expect(container.textContent).not.toContain('已选 ')
  await clickCheckboxControl('选择岗位 岗位0')
  expect(document.body.querySelector('[data-slot="modal-dialog"]')).toBeNull()
  await act(async () => button('下一页').click())
  await act(async () => checkbox('选择当前页岗位').click())
  expect(container.textContent).toContain('已选 2')
  await act(async () => button('上一页').click())
  expect(checkbox('选择岗位 岗位0').checked).toBe(true)
  await act(async () => button('删除已选 (2)').click())
  expect(document.body.textContent).toContain('确认批量删除岗位')
  expect(batchDeletions).toEqual([])
  await act(async () => button('取消').click())
  expect(container.textContent).toContain('已选 2')
  await act(async () => button('删除已选 (2)').click())
  await act(async () => button('删除').click())
  await waitForSelectionClear()

  expect(batchDeletions).toEqual([['0', '20']])
  expect(state.records).toHaveLength(19)
  expect(container.textContent).not.toContain('已选 ')
  expect(checkbox('选择岗位 岗位0')).toBeNull()
  expect(checkbox('选择岗位 岗位1')).toBeTruthy()
})

test('keeps checked jobs after failed deletion and clears selections filtered out of the list', async () => {
  state.records = jobs.mergeJobRecords(
    [],
    [
      { encryptJobId: 'one', jobName: '甲岗位' },
      { encryptJobId: 'two', jobName: '乙岗位' },
    ],
    'AI',
    'batch',
  ).records
  await render()
  const button = (text) =>
    [...document.body.querySelectorAll('button')].find((item) => item.textContent === text)
  await act(async () =>
    container.querySelector('[aria-label="选择岗位 甲岗位"][type="checkbox"]').click(),
  )
  await act(async () => button('删除已选 (1)').click())
  batchDeleteError = 'disk full'
  await act(async () => button('删除').click())
  expect(batchDeletions).toEqual([])
  expect(state.records).toHaveLength(2)
  expect(container.querySelector('[aria-label="选择岗位 甲岗位"][type="checkbox"]').checked).toBe(
    true,
  )
  await act(async () => button('取消').click())
  state.records = [state.records[1]]
  await render()
  expect(container.textContent).not.toContain('已选 ')
  expect(button('删除已选 (1)')).toBeUndefined()
})

test('puts page selection, reconnect, jump and status in the sidebar header', async () => {
  state.connectionError = '连接失败'
  await render('sidepanel')
  const header = container.querySelector('header')
  expect(header.querySelector('.sidepanel-header-controls')).toBeTruthy()
  expect(header.querySelector('[aria-label="BOSS 岗位页"]')).toBeTruthy()
  expect(header.querySelector('.sidepanel-tab-select')).toBeTruthy()
  expect(header.querySelector('[aria-label="重新连接"]')).toBeTruthy()
  expect(header.querySelector('[aria-label="打开 BOSS 岗位页以连接"]')).toBeTruthy()
  expect(header.querySelector('[aria-label="查看连接与运行提示"]')).toBeNull()
  expect(header.querySelector('.connection-status-dot')).toBeTruthy()
  expect(header.textContent).toContain('未连接')
  expect(container.querySelectorAll('[aria-label="BOSS 岗位页"]')).toHaveLength(1)
  expect(container.textContent.indexOf('筛选')).toBeLessThan(
    container.textContent.indexOf('任务操作'),
  )
  state.connected = true
  await render('sidepanel')
  expect(container.querySelector('[aria-label="打开已连接的 BOSS 岗位页"]')).toBeTruthy()
  expect(container.querySelector('.connection-status-dot')).toBeNull()
  expect(header.textContent).toContain('已连接')
})

test('shows an active readable detail page separately from an executor connection', async () => {
  state.activeDetail = {
    jobInfo: { encryptId: 'one', postDescription: 'Complete job description' },
  }
  await render('sidepanel')
  const header = container.querySelector('header')
  expect(header.textContent).toContain('详情可读取')
  expect(header.textContent).not.toContain('未连接')
  expect(header.querySelector('[aria-label="打开 BOSS 岗位页以连接"]')).toBeTruthy()
})

test('opens Resume Matcher from the current-page job card with only its JD', async () => {
  state.connected = true
  state.runtime = {
    jobs: [
      {
        key: 'boss::page-job',
        jobName: '产品经理',
        positionName: 'PM',
        jobDescription: '负责产品规划与跨团队协作',
        brand: { name: '示例公司', link: '', scale: '' },
        salary: '20-30K',
        city: '上海',
      },
    ],
    results: [],
    logs: [],
  }
  const messages = []
  const matcherTab = { postMessage: (...args) => messages.push(args) }
  const openedUrls = []
  Object.defineProperty(window, 'open', {
    configurable: true,
    value: (url) => {
      openedUrls.push(url)
      return matcherTab
    },
  })
  await render('sidepanel')
  const link = container.querySelector('[aria-label="在 Resume Matcher 中定制简历"]')
  expect(link).toBeTruthy()
  await act(async () => link.click())
  expect(openedUrls).toHaveLength(1)
  const handoffId = new URL(openedUrls[0]).hash.split('=')[1]
  const ready = new dom.window.Event('message')
  Object.defineProperties(ready, {
    origin: { value: 'http://localhost:3000' },
    source: { value: matcherTab },
    data: { value: { type: 'boss-helper-resume-matcher-ready', id: handoffId } },
  })
  window.dispatchEvent(ready)
  expect(messages).toHaveLength(1)
  expect(messages[0][0].job).toMatchObject({
    title: '产品经理',
    company: '示例公司',
    description: '负责产品规划与跨团队协作',
  })
  expect(messages[0][0]).not.toHaveProperty('resume')
})

test('moves pinned current page jobs to the top of the sidebar task panel', async () => {
  state.connected = true
  state.runtime = {
    jobs: ['one', 'two', 'three', 'four'].map((id) => ({
      key: `boss::${id}`,
      jobName: `岗位 ${id}`,
      salary: '20-30K',
      brand: { name: '示例公司' },
    })),
    results: [],
    logs: [],
  }
  await render('sidepanel')
  const section = container.querySelector('.page-jobs-section')
  const taskPanel = section.parentElement
  const list = section.querySelector('[aria-label="当前页面岗位"]')
  const pin = section.querySelector('[aria-label="置顶当前页面岗位"]')
  const scrollCalls = []
  section.scrollIntoView = (options) => scrollCalls.push(options)

  expect(section.classList.contains('page-jobs-section-pinned')).toBe(false)
  expect(list.classList.contains('page-jobs-list-pinned')).toBe(false)
  expect(list.classList.contains('max-h-80')).toBe(true)
  expect(list.querySelectorAll(':scope > li')).toHaveLength(4)
  expect(taskPanel.firstElementChild === section).toBe(false)
  expect(pin.getAttribute('aria-pressed')).toBe('false')
  await act(async () => pin.click())
  expect(section.classList.contains('page-jobs-section-pinned')).toBe(true)
  expect(section.classList.contains('flex')).toBe(true)
  expect(section.classList.contains('flex-col')).toBe(true)
  expect(list.classList.contains('page-jobs-list-pinned')).toBe(true)
  expect(list.classList.contains('min-h-0')).toBe(true)
  expect(list.classList.contains('flex-1')).toBe(true)
  expect(list.classList.contains('max-h-80')).toBe(false)
  expect(list.querySelectorAll(':scope > li')).toHaveLength(4)
  expect(taskPanel.firstElementChild === section).toBe(true)
  expect(taskPanel.classList.contains('page-jobs-only')).toBe(true)
  expect(container.querySelector('[aria-label="取消置顶当前页面岗位"]')).toBeTruthy()
  expect(scrollCalls).toEqual([{ behavior: 'smooth', block: 'start' }])

  await act(async () => container.querySelector('[aria-label="取消置顶当前页面岗位"]').click())
  expect(section.classList.contains('page-jobs-section-pinned')).toBe(false)
  expect(taskPanel.firstElementChild === section).toBe(false)
  expect(taskPanel.classList.contains('page-jobs-only')).toBe(false)

  location.hash = 'jobs'
  await render('workbench')
  expect(container.querySelector('[aria-label="置顶当前页面岗位"]')).toBeNull()
})

test('keeps sidebar sections separated by headings without horizontal divider lines', async () => {
  await render('sidepanel')
  const tasks = container.querySelector('[aria-label="岗位统计入口"]')?.closest('section')
  expect(tasks).toBeTruthy()
  expect(!!tasks.querySelector('.border-t, .border-b')).toBe(false)
})

test('opens resume choices from the single configuration row and preserves the selected id', async () => {
  state.resumes = {
    currentResumeId: null,
    resumes: [{ id: 'resume-main', name: '主简历', content: '简历正文' }],
  }
  await render('sidepanel')
  const select = container.querySelector('[aria-label="当前简历"]')
  const trigger = select.querySelector('button') ?? select
  expect(trigger.textContent).toContain('当前简历')
  expect(document.querySelector('[role="option"]')).toBeNull()
  await act(async () => trigger.click())
  const option = [...document.querySelectorAll('[role="option"]')].find((item) =>
    item.textContent.includes('主简历'),
  )
  expect(option).toBeTruthy()
  await act(async () => option.click())
  expect(resumeSelections).toEqual(['resume-main'])
  state.resumes.currentResumeId = 'resume-main'
  await render('sidepanel')
  expect(trigger.textContent).toContain('主简历')
  await act(async () => trigger.click())
  await act(async () =>
    [...document.querySelectorAll('[role="option"]')]
      .find((item) => item.textContent.includes('不使用简历'))
      .click(),
  )
  expect(resumeSelections).toEqual(['resume-main', null])
})

test('groups workbench navigation and exposes the job-plan workspace', async () => {
  await render()
  const navigation = container.querySelector('[aria-label="工作台导航"]')
  expect(navigation).toBeTruthy()
  expect([...navigation.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual([
    '求职管理',
    '共享资源',
    '运行排查',
  ])
  const links = [...navigation.querySelectorAll('a')]
  expect(links.map((link) => link.textContent)).toEqual([
    '岗位库',
    '求职方案',
    '简历库',
    '模型与提示词',
    '运行日志',
  ])
  const routes = ['jobs', 'plans', 'resumes', 'models', 'logs']
  for (const [index, link] of links.entries()) {
    expect(link.getAttribute('href')).toBe(`#${routes[index]}`)
    await act(async () => {
      const routed =
        location.hash === link.getAttribute('href')
          ? Promise.resolve()
          : new Promise((resolve) => {
              const onRoute = (event) => {
                if (new URL(event.newURL).hash !== link.getAttribute('href')) return
                window.removeEventListener('hashchange', onRoute)
                resolve()
              }
              window.addEventListener('hashchange', onRoute)
            })
      link.click()
      await routed
    })
    expect(location.hash).toBe(`#${routes[index]}`)
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  }
})

test('keeps legacy filter and task-settings links working by routing them to job plans', async () => {
  for (const legacyRoute of ['filters', 'settings']) {
    location.hash = legacyRoute
    await render()
    expect(location.hash).toBe('#plans')
  }
})

test('keeps the viewed job visible inside its own list without resetting manual scrolling', async () => {
  state.connected = true
  state.runtime = {
    jobs: Array.from({ length: 6 }, (_, index) => ({
      key: `boss::${index}`,
      jobName: `岗位 ${index}`,
      brand: { name: '示例公司' },
    })),
    results: [],
    logs: [],
    viewedJobKey: null,
  }
  await render('sidepanel')
  const list = container.querySelector('ul[aria-label="当前页面岗位"]')
  list.getBoundingClientRect = () => ({ top: 100, bottom: 400 })
  Array.from(list.children).forEach((row, index) => {
    row.getBoundingClientRect = () => ({
      top: 100 + index * 100 - list.scrollTop,
      bottom: 200 + index * 100 - list.scrollTop,
    })
  })
  container.scrollTop = 50
  state.runtime.viewedJobKey = 'boss::5'
  await render('sidepanel')
  expect(list.querySelector('[aria-current="true"]').textContent).toContain('岗位 5')
  expect(list.scrollTop).toBe(300)
  state.runtime.viewedJobKey = 'boss::2'
  await render('sidepanel')
  expect(list.scrollTop).toBe(200)
  state.runtime.viewedJobKey = 'boss::3'
  await render('sidepanel')
  expect(list.scrollTop).toBe(200)
  list.scrollTop = 50
  await render('sidepanel')
  expect(list.scrollTop).toBe(50)
  state.runtime.viewedJobKey = 'boss::missing'
  await render('sidepanel')
  expect(list.scrollTop).toBe(50)
  expect(container.scrollTop).toBe(50)
})

test('marks saved jobs and disables duplicate saves even when their details are pending', async () => {
  state.connected = true
  state.runtime = {
    jobs: [{ key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } }],
    results: [],
    logs: [],
  }
  state.records = [
    { encryptJobId: 'one', detailStatus: 'pending', snapshot: { jobName: '产品经理' } },
  ]
  await render('sidepanel')
  const list = container.querySelector('[aria-label="当前页面岗位"]')
  expect(list.textContent).toContain('已入库')
  expect(list.textContent).toContain('待补详情')
  const save = list.querySelector('[aria-label="保存岗位"]')
  expect(save.disabled).toBe(true)
  await act(async () => save.click())
  expect(commands).toEqual([])
  state.records[0].detailStatus = 'complete'
  state.records[0].detail = { jobInfo: { encryptId: 'one', postDescription: '完整岗位职责' } }
  await render('sidepanel')
  expect(list.textContent).toContain('已入库')
  expect(list.textContent).not.toContain('待补详情')
  expect(list.querySelector('[aria-label="保存岗位"]').disabled).toBe(true)
  state.records[0].processingStatus = 'excluded'
  await render('sidepanel')
  expect(list.textContent).toContain('已排除')
  expect(list.textContent).not.toContain('已入库')
  expect(list.querySelector('[aria-label="保存岗位"]').disabled).toBe(true)
})

test('keeps greeting actions and sends only after confirmation', async () => {
  state.connected = true
  state.runtime = {
    jobs: [{ key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } }],
    results: [],
    logs: [],
    jobActions: {},
  }
  state.records = [
    {
      encryptJobId: 'one',
      key: 'boss::one',
      snapshot: { jobName: '产品经理' },
      analysisStatus: 'ready',
      analysis: { passed: true, res: { strengths: ['熟悉产品规划'] } },
      finalGreeting: '您好，我有相关产品经历。',
      reviewStatus: 'pending',
      sendStatus: 'pending',
    },
  ]
  state.resumes = {
    currentResumeId: 'resume',
    resumes: [{ id: 'resume', name: '测试简历', content: '完整简历' }],
  }
  const copied = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value) => copied.push(value) },
  })
  await render('sidepanel')
  const list = container.querySelector('[aria-label="当前页面岗位"]')
  await act(async () => list.querySelector('[aria-label="分析岗位"]').click())
  expect(list.textContent).toContain('达到筛选线')
  expect(list.textContent).toContain('熟悉产品规划')
  expect(commands).toEqual([])
  await act(async () => list.querySelector('[aria-label="查看招呼语"]').click())
  expect(list.textContent).toContain('您好，我有相关产品经历。')
  const greetingActions = list.querySelector('[aria-label="复制招呼语"]').parentElement
  expect(greetingActions.classList.contains('justify-end')).toBe(true)
  expect(list.querySelector('[aria-label="重新生成招呼语"] svg.lucide-refresh-cw')).not.toBeNull()
  await act(async () => list.querySelector('[aria-label="复制招呼语"]').click())
  expect(copied).toEqual(['您好，我有相关产品经历。'])
  expect(commands).toEqual([])
  await act(async () => list.querySelector('[aria-label="重新生成招呼语"]').click())
  expect(commands).toEqual([{ type: 'generateGreeting', jobId: 'one' }])
  await act(async () => list.querySelector('[aria-label="发送招呼语"]').click())
  expect(commands).toEqual([{ type: 'generateGreeting', jobId: 'one' }])
  await act(async () =>
    [...document.querySelectorAll('[role="dialog"] button')]
      .find((button) => button.textContent === '发送')
      .click(),
  )
  expect(commands).toEqual([
    { type: 'generateGreeting', jobId: 'one' },
    { type: 'sendGreeting', jobId: 'one', greeting: '您好，我有相关产品经历。' },
  ])
})

test('shows card validation and asynchronous errors next to the clicked job', async () => {
  state.connected = true
  state.runtime = {
    jobs: [{ key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } }],
    results: [],
    logs: [],
    jobActions: {},
  }
  await render('sidepanel')
  const list = container.querySelector('[aria-label="当前页面岗位"]')
  await act(async () => list.querySelector('[aria-label="分析岗位"]').click())
  expect(list.textContent).toContain('简历')
  expect(list.querySelector('[role="alert"]')).toBeTruthy()
  expect(commands).toEqual([])
  state.resumes = { currentResumeId: 'resume', resumes: [{ id: 'resume', content: '完整简历' }] }
  await render('sidepanel')
  await act(async () => list.querySelector('[aria-label="生成招呼语"]').click())
  expect(commands).toEqual([{ type: 'generateGreeting', jobId: 'one' }])
  state.runtime.jobActions.one = { type: 'generateGreeting', status: 'running' }
  await render('sidepanel')
  expect(list.textContent).toContain('生成招呼语中')
  expect(list.querySelector('[aria-label="生成招呼语"]').disabled).toBe(true)
  state.runtime.jobActions.one = {
    type: 'generateGreeting',
    status: 'failed',
    error: '模型超时，请重试',
  }
  await render('sidepanel')
  expect(list.querySelector('[role="alert"]').textContent).toContain('模型超时')
  commandError = '连接已失效'
  await act(async () => list.querySelector('[aria-label="分析岗位"]').click())
  expect(list.querySelector('[role="alert"]').textContent).toContain('连接已失效')
})

test('collapses batch starts and removes the manual current-page action', async () => {
  state.connected = true
  state.runtime = {
    jobs: [
      {
        key: 'boss::loaded',
        jobName: '已加载岗位',
        brand: { name: '示例公司' },
        salary: '20-30K',
      },
    ],
    results: [],
    logs: [],
  }
  await render('sidepanel')
  expect(container.textContent).not.toContain('AI 过程')
  expect(container.textContent).not.toContain('最近运行')
  const trigger = container.querySelector('[aria-label="批量任务"]')
  expect(trigger?.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[aria-label="当前简历"]').closest('[hidden]')).toBeNull()
  expect(container.querySelector('[role="switch"]').closest('[hidden]')).toBeNull()
  await act(async () => trigger.click())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const collect = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '只采集',
  )
  expect(collect.closest('[hidden]')).toBeNull()
  await act(async () => collect.click())
  const capturePage = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '采集当前页',
  )
  expect(capturePage).toBeUndefined()
  expect(commands).toEqual([{ type: 'collect' }])
})

test('exposes active batch stops, progress and errors outside the collapsed actions', async () => {
  state.connected = true
  state.runtime = {
    results: [],
    logs: [],
    jobs: [
      { key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } },
      { key: 'boss::two', jobName: '设计师', brand: { name: '另一公司' } },
    ],
    currentJob: 'boss::one',
    gatheringBusy: true,
    gatheringKind: 'collection',
    collectionRun: { status: 'running', error: '采集连接中断' },
    analysisBusy: true,
    analysisRun: { status: 'running', total: 3, completed: 1, failed: 0, skipped: 0 },
  }
  await render('sidepanel')
  const button = (label) =>
    [...container.querySelectorAll('button')].find((element) => element.textContent === label)
  expect(container.querySelector('[aria-label="批量任务"]')?.getAttribute('aria-expanded')).toBe(
    'false',
  )
  for (const label of ['暂停', '停止采集', '停止分析']) {
    expect(button(label)?.closest('[hidden]')).toBeNull()
    expect(button(label)?.disabled).toBe(false)
  }
  expect(container.querySelector('[role="alert"]').textContent).toBe('采集连接中断')
  expect(container.querySelector('[role="alert"]').closest('[hidden]')).toBeNull()
  expect(container.querySelector('[role="progressbar"]').closest('[hidden]')).toBeNull()
  await act(async () => button('停止采集').click())
  await act(async () => button('停止分析').click())
  expect(commands).toEqual([{ type: 'stopGathering' }, { type: 'stopAnalysis' }])
  state.runtime.gatheringBusy = false
  state.runtime.analysisBusy = false
  state.runtime.workflow = { status: 'running', current: 1, total: 3 }
  await render('sidepanel')
  expect(button('停止投递')?.closest('[hidden]')).toBeNull()
  expect(button('停止投递')?.disabled).toBe(false)
  await act(async () => button('停止投递').click())
  expect(commands.at(-1)).toEqual({ type: 'stopDelivery' })
})

test('keeps pending recruiter-message editing in the live sidepanel', async () => {
  state.connected = true
  state.runtime = { jobs: [], logs: [], pendingMessage: '原待发送消息' }
  await render('sidepanel')
  const disclosure = [...container.querySelectorAll('button')].find((element) =>
    element.textContent.includes('待发送消息'),
  )
  expect(disclosure).toBeTruthy()
  await act(async () => disclosure.click())
  const field = container.querySelector('textarea')
  expect(field.value).toBe('原待发送消息')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
      field,
      '修改后的消息',
    )
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((element) => element.textContent === '保存草稿')
      .click(),
  )
  expect(commands).toEqual([{ type: 'setPendingMessage', value: '修改后的消息' }])
  state.runtime.pendingMessage = ''
  await render('sidepanel')
  expect(container.textContent).not.toContain('待发送消息')
})

test('uses one rotation action for start, stop and resume', async () => {
  state.connected = true
  state.runtime = {
    jobs: [],
    results: [],
    logs: [],
    keywordRotationBusy: true,
    gatheringBusy: true,
    gatheringKind: 'collection',
    collectionRun: { status: 'running' },
    analysisBusy: true,
    analysisRun: { status: 'running', total: 3, completed: 1, failed: 0, skipped: 0 },
    keywordRotation: { status: 'running', items: [{ keyword: '产品经理' }], cursor: 0 },
  }
  await render('sidepanel')
  const button = (text) =>
    [...container.querySelectorAll('button')].find((el) => el.textContent === text)
  expect(button('轮换采集并分析')).toBeUndefined()
  expect(button('停止采集')).toBeUndefined()
  expect(button('停止分析')).toBeUndefined()
  expect(button('停止轮换').disabled).toBe(false)
  expect(button('停止轮换').closest('[hidden]')).toBeNull()
  await act(async () => button('停止轮换').click())
  expect(commands).toEqual([{ type: 'stopRotation' }])
  state.runtime.keywordRotationBusy = false
  state.runtime.gatheringBusy = false
  state.runtime.analysisBusy = false
  state.runtime.keywordRotation.status = 'stopped'
  await render('sidepanel')
  await act(async () => container.querySelector('[aria-label="批量任务"]').click())
  await act(async () => button('继续轮换').click())
  expect(commands).toEqual([{ type: 'stopRotation' }, { type: 'rotate' }])
  expect(container.textContent).not.toContain('待发送消息')
})
