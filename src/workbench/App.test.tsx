/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { defaultFormData } from '../composables/conf/info'
import * as scoring from '../composables/useApplying/scoring'
import * as jobs from '../entrypoints/boss/jobStore'
import { clearDiagnostics, diagnostic } from '../utils/diagnostics'

mock.module('#imports', () => ({ browser: { storage: { local: { remove: async () => {} } } } }))

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
const chatSelections = []
const deletions = []
const batchDeletions = []
let batchDeleteError = ''
const resumeSelections = []
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
}
mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
mock.module('@/entrypoints/boss/jobStore', () => jobs)
mock.module('@/composables/useApplying/scoring', () => scoring)
mock.module('@/composables/useModel', () => ({ isCompleteModel: () => false }))
mock.module('@/utils/jsonImportExport', () => ({ exportJson: async () => {} }))
mock.module('./Models', () => ({ Models: () => null }))
mock.module('./Settings', () => ({ Settings: () => null }))
mock.module('./Resumes', () => ({ Resumes: () => null }))
mock.module('@/message', () => ({
  counter: {
    fetchText: async () => {
      throw new Error('offline')
    },
  },
}))
mock.module('./store', () => ({
  saveConfig: async () => {},
  perform: async (work) => work(),
  command: async (value) => {
    commands.push(value)
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
  stopSavedAnalysis: async () => {},
}))
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { App } = await import('./App')
let root
let container
beforeEach(() => {
  clearDiagnostics()
  location.hash = 'tasks'
  calls.length = 0
  commands.length = 0
  chatSelections.length = 0
  deletions.length = 0
  batchDeletions.length = 0
  batchDeleteError = ''
  resumeSelections.length = 0
  state.resumes = { resumes: [], currentResumeId: null }
  state.connected = false
  state.connectionError = ''
  state.today = null
  state.records = []
  state.runtime = null
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
  await act(async () =>
    [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === '关闭')
      .click(),
  )

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

test('groups workbench navigation by responsibility and preserves existing routes', async () => {
  await render()
  const navigation = container.querySelector('[aria-label="工作台导航"]')
  expect(navigation).toBeTruthy()
  expect([...navigation.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual([
    '求职管理',
    '自动化配置',
    '运行排查',
  ])
  const links = [...navigation.querySelectorAll('a')]
  expect(links.map((link) => link.textContent)).toEqual([
    '岗位库',
    '简历与方向',
    '筛选规则',
    '模型与提示词',
    '任务设置',
    '运行日志',
  ])
  const routes = ['jobs', 'resumes', 'filters', 'models', 'settings', 'logs']
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

test('keeps live AI in a collapsed sidepanel section with current-task following', async () => {
  state.connected = true
  state.runtime = {
    results: [],
    logs: [],
    jobs: [
      { key: 'boss::one', jobName: '产品经理', brand: { name: '示例公司' } },
      { key: 'boss::two', jobName: '设计师', brand: { name: '另一公司' } },
    ],
    chatJobs: ['boss::one', 'boss::two'],
    chatJobKey: 'boss::one',
    currentJob: 'boss::one',
    messages: [
      {
        id: 'one',
        role: 'assistant',
        uiRole: 'greetings',
        parts: [
          { type: 'text', text: '岗位招呼语草稿' },
          { type: 'reasoning', text: '岗位推理内容' },
        ],
      },
    ],
  }
  await render()
  expect([...container.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).not.toContain(
    'AI 过程',
  )
  await render('sidepanel')
  const disclosure = [...container.querySelectorAll('button')].find(
    (el) => el.textContent === 'AI 过程',
  )
  expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
  await act(async () => disclosure.click())
  expect(container.textContent).toContain('岗位招呼语草稿')
  expect(container.textContent).toContain('招呼语生成')
  expect(container.querySelector('[aria-label="岗位对话"]')).toBeTruthy()
  expect(container.textContent).not.toContain('补充消息草稿')
  expect(chatSelections).toEqual(['boss::one'])
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((element) => element.textContent.includes('思考过程'))
      .click(),
  )
  expect(container.textContent).toContain('岗位推理内容')
  const following = container.querySelector('[aria-label="跟随当前任务"][role="switch"]')
  await act(async () => following.click())
  state.runtime.currentJob = 'boss::two'
  await render('sidepanel')
  expect(chatSelections).toEqual(['boss::one'])
  const selector = container.querySelector('[aria-label="岗位对话"]')
  await act(async () => (selector.querySelector('button') ?? selector).click())
  const option = [...document.querySelectorAll('[role="option"]')].find((element) =>
    element.textContent.includes('设计师 · 另一公司'),
  )
  expect(option).toBeTruthy()
  await act(async () => option.click())
  expect(chatSelections).toEqual(['boss::one', 'boss::two'])
  state.runtime.currentJob = 'boss::three'
  await render('sidepanel')
  expect(chatSelections).toEqual(['boss::one', 'boss::two'])
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
  await act(async () => button('停止轮换').click())
  expect(commands).toEqual([{ type: 'stopRotation' }])
  state.runtime.keywordRotationBusy = false
  state.runtime.gatheringBusy = false
  state.runtime.analysisBusy = false
  state.runtime.keywordRotation.status = 'stopped'
  await render('sidepanel')
  await act(async () => button('继续轮换').click())
  expect(commands).toEqual([{ type: 'stopRotation' }, { type: 'rotate' }])
  expect(container.textContent).not.toContain('待发送消息')
})
