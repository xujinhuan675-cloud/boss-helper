/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { defaultFormData } from '../composables/conf/info'
import { getJobFunnel } from '../entrypoints/boss/jobStore'

const state = {
  loading: false,
  saving: false,
  connected: false,
  connectionError: '',
  records: [],
  config: defaultFormData,
  models: [],
  resumes: { resumes: [], currentResumeId: null },
  keywords: '产品经理',
  today: null,
  statistics: [],
  tabs: [],
  tabId: null,
  runtime: null,
}
mock.module('./useWorkbench', () => ({ useWorkbench: () => state }))
mock.module('@/entrypoints/boss/jobStore', () => ({ getJobFunnel }))
mock.module('./store', () => ({
  command: async () => {},
  perform: async (work) => work(),
  selectResume: async () => {},
  openTaskPanel: async () => {},
}))
// The production model module also boots Vue services outside the UI under test.
mock.module('@/composables/useModel', () => ({
  isCompleteModel: (model) => !!model?.data?.api_key,
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
})

beforeEach(() => {
  Object.assign(state, {
    connected: false,
    connectionError: '',
    runtime: null,
    tabs: [],
    tabId: null,
  })
})

describe('task panel responsibilities', () => {
  test('puts configuration links below live operations without a home or history view', () => {
    const html = render()
    expect(html).not.toContain('首页')
    expect(html).not.toContain('统计范围')
    expect(html).toContain('当前配置')
    expect(html).toContain('当前简历')
    expect(html).not.toContain('管理简历')
    expect(html).toContain('#models')
    expect(html).toContain('#filters')
    expect(html).toContain('#settings')
    expect(html).toContain('#logs')
    expect(html.indexOf('当前配置')).toBeGreaterThan(html.indexOf('最近运行'))
  })

  test('always keeps the page jobs section in the task panel when disconnected', () => {
    const html = render()
    expect(html).toContain('轮换采集并分析')
    expect(html).toContain('当前页面岗位')
    expect(html).toContain('尚未连接 BOSS 岗位页')
    expect(html).not.toContain('当前列表暂无岗位')
    expect(html).not.toContain('历史投递统计')
    expect(html).not.toContain('默认模型')
    expect(html).toContain('模型与提示词')
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

  test('renders a stateful toggle for the current configuration section', () => {
    const html = render()
    expect(html).toContain('收起当前配置')
    expect(html).toContain('当前简历')
    expect(html).toContain('aria-label="收起当前配置"')
  })
})
