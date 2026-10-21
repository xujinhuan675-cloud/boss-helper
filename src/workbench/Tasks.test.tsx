/** @jsxImportSource react */
// @ts-nocheck
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { defaultFormData } from '../composables/conf/info'
import { getJobFunnel } from '../entrypoints/boss/jobStore'

const require = createRequire(new URL('../../packages/devlog-ui/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const dom = new JSDOM()
afterAll(() => dom.window.close())

const state = {
  loading: false,
  saving: false,
  connected: false,
  connectionError: '',
  records: [],
  config: defaultFormData,
  preset: 'default',
  models: [],
  resumes: { resumes: [], currentResumeId: null },
  keywords: '产品经理',
  today: null,
  statistics: [],
  tabs: [],
  tabId: null,
  activeDetailJobId: null,
  runtime: null,
}
await mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
await mock.module('@/entrypoints/boss/jobStore', () => ({ getJobFunnel }))
await mock.module('./store', () => ({
  saveConfig: async () => {},
  command: async () => {},
  startSavedAnalysis: async () => {},
  generateSavedGreeting: async () => {},
  perform: async (work) => work(),
  selectResume: async () => {},
  openTaskPanel: async () => {},
  selectChat: () => {},
}))
await mock.module('@/message', () => ({
  counter: {
    fetchText: async () => {
      throw new Error('offline')
    },
  },
}))
await mock.module('@/composables/useApplying/scoring', () => ({
  formatFilteringMessage: (message) => message,
}))
const { Tasks } = await import('./Tasks')
const render = () => renderToStaticMarkup(createElement(Tasks))
const snapshot = () => ({
  ready: true,
  error: '',
  jobs: [],
  results: [],
  logs: [],
  workflow: null,
  viewedJobKey: null,
})

beforeEach(() => {
  Object.assign(state, {
    connected: false,
    connectionError: '',
    runtime: null,
    models: [],
    records: [],
    today: null,
    statistics: [],
    tabs: [],
    tabId: null,
    activeDetailJobId: null,
    activeDetail: null,
  })
})

describe('task panel responsibilities', () => {
  test('shows URL phase, failed count and remaining missing details without another action group', () => {
    state.connected = true
    state.records = [
      {
        encryptJobId: 'one',
        detailStatus: 'complete',
        detail: { jobInfo: { encryptId: 'one', postDescription: 'Complete JD' } },
        snapshot: {},
      },
      { encryptJobId: 'two', detailStatus: 'failed', snapshot: {} },
      { encryptJobId: 'three', detailStatus: 'pending', snapshot: {} },
    ]
    state.runtime = {
      ...snapshot(),
      gatheringKind: 'detail',
      gatheringBusy: true,
      detailRun: {
        status: 'running',
        completed: 1,
        failed: 1,
        total: 3,
        retryable: 1,
        phase: '正在通过 URL 获取详情',
      },
    }
    const text = new JSDOM(render()).window.document.body.textContent
    expect(text).toContain('正在通过 URL 获取详情')
    expect(text).toContain('成功 1')
    expect(text).toContain('失败 1')
    expect(text).toContain('待补全 2')
  })
  test('pairs three cumulative statistics with their own daily increases', () => {
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const old = yesterday.toISOString()
    const current = now.toISOString()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    state.records = ['collected', 'matched', 'applied', 'excluded'].map((id) => ({
      encryptJobId: id,
      key: `boss::${id}`,
      snapshot: { contact: false },
      sourceKeywords: [],
      batches: [],
      firstSeenAt: id === 'matched' ? current : old,
      lastSeenAt: current,
      matchedAt: id === 'matched' ? current : undefined,
      detailStatus: 'pending',
      analysisStatus: 'pending',
      reviewStatus: 'pending',
      sendStatus: id === 'applied' ? 'sent' : 'pending',
      analysis: { passed: id === 'matched' },
      processingStatus: id === 'excluded' ? 'excluded' : 'active',
    }))
    state.today = { date, success: 2, total: 4, repeat: 0, activityFilter: 0, tasks: {} }
    dom.window.document.body.innerHTML = render()
    const statistics = dom.window.document.querySelector('nav[aria-label="岗位统计入口"]')
    const links = [...statistics.querySelectorAll('a')]
    expect(links).toHaveLength(3)
    for (const [index, label, total, increase, query] of [
      [0, '已采集', 3, 1, ''],
      [1, '已匹配', 2, 1, '?stage=matched'],
      [2, '已投递', 1, 2, '?stage=applied'],
    ]) {
      const link = links[index]
      expect(link.getAttribute('aria-label')).toBe(`查看${label}岗位，共 ${total} 个`)
      expect(link.getAttribute('href')).toBe(`./workbench.html${query}#jobs`)
      const chip = link.querySelector('[data-slot="chip"]')
      expect(chip?.getAttribute('aria-label')).toBe(`今日${label.slice(1)} ${increase} 个`)
      expect(chip?.textContent).toBe(String(increase))
    }
  })

  test('hides zero daily delivery for an older stored day and keeps reset available', () => {
    state.today = {
      date: '2000-01-01',
      success: 9,
      total: 9,
      repeat: 0,
      activityFilter: 0,
      tasks: {},
    }
    state.connected = true
    state.runtime = { ...snapshot(), workflow: { status: 'stop', current: 3, total: 10 } }
    dom.window.document.body.innerHTML = render()
    expect(dom.window.document.querySelector('[aria-label="今日投递 0 个"]')).toBeNull()
    expect(
      dom.window.document.querySelectorAll('nav[aria-label="岗位统计入口"] [data-slot="chip"]'),
    ).toHaveLength(0)
    const actions = dom.window.document.body.textContent
      .split('任务操作')[1]
      .split('当前页面岗位')[0]
    expect(actions).not.toContain('今日投递')
    expect(actions).not.toContain('本页')
    expect(actions).toContain('重置进度')
  })

  test('puts immediate filters before live operations without duplicate configuration navigation', () => {
    const html = render()
    expect(html).not.toContain('首页')
    expect(html).not.toContain('统计范围')
    expect(html).toContain('筛选')
    expect(html).toContain('当前简历')
    expect(html).not.toContain('管理简历')
    expect(html).not.toContain('#models')
    expect(html).not.toContain('#filters')
    expect(html).not.toContain('#settings')
    expect(html.indexOf('筛选')).toBeLessThan(html.indexOf('任务操作'))
  })

  test('always keeps the page jobs section in the task panel when disconnected', () => {
    const html = render()
    expect(html).toContain('轮换采集并分析')
    expect(html).toContain('当前页面岗位')
    expect(html).toContain('连接 BOSS 标签页后查看')
    expect(html).not.toContain('当前列表暂无岗位')
    expect(html).not.toContain('待命')
    expect(html).not.toContain('历史投递统计')
    expect(html).not.toContain('默认模型')
    expect(html).not.toContain('模型：')
    expect(html).not.toContain('>未连接<')
  })

  test('distinguishes waiting for the executor from an empty connected list', () => {
    Object.assign(state, { tabId: 1, tabs: [{ id: 1 }], runtime: snapshot() })
    state.runtime.ready = false
    expect(render()).toContain('正在连接岗位页')
    state.connected = true
    state.runtime.ready = true
    expect(render()).toContain('当前列表暂无岗位')
  })

  test('shows page job actions and stop controls in the task panel', () => {
    Object.assign(state, { connected: true, runtime: snapshot() })
    state.runtime.jobs = [
      { key: 'boss::one', jobName: '产品经理', salary: '20-30K', brand: { name: '示例公司' } },
    ]
    state.runtime.workflow = { status: 'running', current: 1, total: 3 }
    const panel = render()
    expect(panel).toContain('示例公司')
    expect(panel).toContain('保存岗位')
    expect(panel).toContain('分析岗位')
    expect(render()).toContain('停止投递')
  })

  test('shows the active detail job card even when there is no search-page executor', () => {
    state.activeDetailJobId = 'detail-job'
    state.records = [
      {
        encryptJobId: 'detail-job',
        key: 'boss::detail-job',
        snapshot: {
          encryptJobId: 'detail-job',
          jobName: '当前详情岗位',
          salaryDesc: '20-30K',
          brandName: '详情公司',
        },
        sourceKeywords: ['手动详情页'],
        batches: ['manual-detail'],
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        detailStatus: 'complete',
        analysisStatus: 'pending',
        reviewStatus: 'pending',
        sendStatus: 'pending',
        detailRetryCount: 0,
        detail: {
          jobInfo: {
            encryptId: 'detail-job',
            jobName: '当前详情岗位',
            postDescription: '负责产品规划、需求分析与跨团队项目交付。',
          },
        },
      },
    ]

    dom.window.document.body.innerHTML = render()

    const row = dom.window.document.querySelector('ul[aria-label="当前页面岗位"] li')
    expect(row?.textContent).toContain('当前详情岗位')
    expect(row?.querySelector('button[aria-label="分析岗位"]')?.disabled).toBe(false)
    expect(row?.textContent).toContain('正在浏览')
  })

  test('shows an unsaved detail preview with save and analysis actions without a saved badge', () => {
    state.activeDetailJobId = 'preview'
    state.activeDetail = {
      jobInfo: {
        encryptId: 'preview',
        jobName: '预览岗位',
        salaryDesc: '20-30K',
        postDescription: '负责产品规划、需求分析与跨团队项目交付。',
      },
      brandComInfo: { brandName: '预览公司' },
    }
    dom.window.document.body.innerHTML = render()
    const row = dom.window.document.querySelector('ul[aria-label="当前页面岗位"] li')
    expect(row?.textContent).toContain('预览岗位')
    expect(row?.textContent).toContain('预览公司')
    expect(row?.textContent).not.toContain('已入库')
    for (const label of ['保存岗位', '分析岗位', '生成招呼语'])
      expect(row?.querySelector(`button[aria-label="${label}"]`)?.disabled).toBe(false)
  })

  test('keeps the BOSS share action before the independent detail URL', () => {
    Object.assign(state, { connected: true, runtime: snapshot() })
    state.runtime.jobs = [
      {
        key: 'boss::one',
        jobName: '产品经理',
        salary: '20-30K',
        brand: { name: '示例公司' },
        link: 'https://www.zhipin.com/web/geek/jobs?jobId=one',
      },
    ]
    dom.window.document.body.innerHTML = render()
    const row = dom.window.document.querySelector('ul[aria-label="当前页面岗位"] li')
    const openActions = [
      ...row.querySelectorAll('[aria-label="在 BOSS 打开岗位"], [aria-label="打开岗位详情页"]'),
    ]
    expect(openActions.map((action) => action.getAttribute('aria-label'))).toEqual([
      '在 BOSS 打开岗位',
      '打开岗位详情页',
    ])
    const link = row.querySelector('a[aria-label="打开岗位详情页"]')
    expect(link.getAttribute('href')).toBe('https://www.zhipin.com/job_detail/one.html')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.textContent).toBe('')
    expect(link.querySelector('svg.lucide-file-text')).not.toBeNull()
    expect(link.classList.contains('button--icon-only')).toBe(true)
    const summary = row.querySelector('button[aria-label="在 BOSS 打开岗位"]')
    expect(summary.querySelector('svg.lucide-external-link')).not.toBeNull()
  })

  test('marks only the viewed job next to its save and analyze actions', () => {
    Object.assign(state, { connected: true, runtime: snapshot() })
    state.runtime.currentJob = 'boss::one'
    state.runtime.jobs = ['one', 'two'].map((id) => ({
      key: `boss::${id}`,
      jobName: `岗位 ${id}`,
      salary: '20-30K',
      brand: { name: '示例公司' },
    }))
    for (const key of [null, 'boss::two', 'boss::one', 'boss::missing', null]) {
      state.runtime.viewedJobKey = key
      dom.window.document.body.innerHTML = render()
      const list = dom.window.document.querySelector('ul[aria-label="当前页面岗位"]')
      const rows = list.querySelectorAll('[aria-current="true"]')
      const expected = state.runtime.jobs.find((job) => job.key === key)
      expect(rows).toHaveLength(expected ? 1 : 0)
      if (expected) {
        expect(rows[0].textContent).toContain(expected.jobName)
        expect(rows[0].textContent).toContain('正在浏览')
        expect(rows[0].querySelector('[aria-label="保存岗位"]')).not.toBeNull()
        expect(rows[0].querySelector('[aria-label="分析岗位"]')).not.toBeNull()
      } else expect(list.textContent).not.toContain('正在浏览')
    }
  })

  test('marks stored page jobs even when details are pending and disables duplicate saves', () => {
    Object.assign(state, { connected: true, runtime: snapshot() })
    state.runtime.jobs = ['pending', 'complete', 'new'].map((id) => ({
      key: `boss::${id}`,
      jobName: `岗位 ${id}`,
      salary: '20-30K',
      brand: { name: '示例公司' },
    }))
    state.records = [
      { encryptJobId: 'pending', detailStatus: 'pending', snapshot: {} },
      {
        encryptJobId: 'complete',
        detailStatus: 'complete',
        snapshot: {},
        detail: { jobInfo: { encryptId: 'complete', postDescription: 'Full JD' } },
      },
    ]
    dom.window.document.body.innerHTML = render()
    const rows = dom.window.document.querySelectorAll('ul[aria-label="当前页面岗位"] > li')
    expect(rows[0].textContent).toContain('已入库')
    expect(rows[0].textContent).toContain('待补详情')
    expect(rows[1].textContent).toContain('已入库')
    expect(rows[1].textContent).not.toContain('待补详情')
    expect(rows[2].textContent).not.toContain('已入库')
    expect([...rows].every((row) => !row.textContent.includes('待处理'))).toBe(true)
    expect(rows[0].querySelector('button[aria-label="保存岗位"]')?.disabled).toBe(true)
    expect(rows[2].querySelector('button[aria-label="保存岗位"]')?.disabled).toBe(false)
    state.runtime.results = [
      ['boss::pending', { status: 'ai', msg: '正在分析' }],
      ['boss::complete', { status: 'error', msg: '任务失败' }],
    ]
    dom.window.document.body.innerHTML = render()
    const updatedRows = dom.window.document.querySelectorAll('ul[aria-label="当前页面岗位"] > li')
    expect(updatedRows[0].textContent).toContain('分析中')
    expect(updatedRows[1].textContent).toContain('失败')
    expect(updatedRows[2].textContent).not.toContain('待处理')
    state.records = []
    dom.window.document.body.innerHTML = render()
    expect(
      dom.window.document.querySelector('ul[aria-label="当前页面岗位"]').textContent,
    ).not.toContain('已入库')
  })

  test('shows the current rotation keyword without a duplicate switch', () => {
    Object.assign(state, { connected: true, runtime: snapshot() })
    state.runtime.keywordRotation = {
      version: 1,
      status: 'idle',
      items: [{ keyword: '融化点', enabled: true, status: 'pending' }],
      cursor: 0,
      baseSearchUrl: 'https://www.zhipin.com/web/geek/jobs',
      filterSnapshot: { salary: '', city: '' },
      updatedAt: new Date().toISOString(),
    }
    const html = render()
    expect(html).toContain('当前关键词：融化点')
    dom.window.document.body.innerHTML = html
    expect(
      [...dom.window.document.querySelectorAll('[role="switch"]')].map(
        (input) => input.closest('label').textContent,
      ),
    ).toEqual(['浏览时自动采集岗位'])
  })

  test('keeps configuration quick choices beside task controls', () => {
    const html = render()
    expect(html).not.toContain('收起当前配置')
    expect(html).toContain('当前简历')
    expect(html.indexOf('当前简历')).toBeLessThan(html.indexOf('轮换采集并分析'))
  })

  test('keeps the sidebar focused on page actions instead of duplicate history surfaces', () => {
    state.connected = true
    state.runtime = {
      ...snapshot(),
      logs: [{ state: 'success', state_name: '成功', title: '采集完成' }],
    }
    const html = render()
    expect(html).not.toContain('AI 过程')
    expect(html).not.toContain('最近运行')
    expect(html).not.toContain('采集完成')
    expect(html).toContain('批量任务')
  })
})
