// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { defineProxy } from 'comctx'
import { computed, reactive, ref, watchSyncEffect } from 'vue'

import { defaultFormData } from '../../composables/conf/info'
import { counter, initCounter } from '../../message'
import { ProvideContentScriptAdapter } from '../../message/contentScriptShare'
import { parseGptJson } from '../../utils/ai'
import deepmerge, { jsonClone } from '../../utils/deepmerge'
import { COLLECTION_RUN_STORAGE_KEY, JOB_LIBRARY_STORAGE_KEY, mergeJobRecords } from './jobStore'
import { KEYWORD_ROTATION_STORAGE_KEY } from './keywordRotation'
import type { BossZpJobItemData } from './types'

const conf = { formData: { salaryRange: { value: '10-15K' } } }
const wrapper = { insertBefore() {}, firstChild: null, querySelector: () => null }
let jobListHookCallback: ((value: BossZpJobItemData[]) => void) | undefined
let getRoot = async () => ({})
mock.module('@/composables/conf', () => ({ appearanceConf: ref({}), useConf: () => conf }))
mock.module('@/composables/useHelper', () => ({
  HelperContext: class {
    conf = conf
    currentJob = ref(null)
    _logs = ref([])
    jobResultMaps = new Map()
    chatModel = { jobs: ref([]), states: new Map() }
    pendingMessages = ref(undefined)
  },
}))
mock.module('@/composables/useApplying/type', () => ({
  createLazyObject: () => ({}),
  isInitialized: () => false,
}))
mock.module('@/composables/useVue', () => ({
  getRootVue: () => getRoot(),
  useHookVueData:
    (_selector: string, key: string, _target: unknown, callback?: unknown) => async () => {
      if (key === 'jobList' && typeof callback === 'function') {
        jobListHookCallback = callback as (value: BossZpJobItemData[]) => void
      }
    },
  useHookVueFn: () => async () => {},
}))
mock.module('@/message', () => ({ counter }))
let initializeBusiness = async () => {}
mock.module('@/index', () => ({ run: () => initializeBusiness() }))
let visualDelayCalls = 0
mock.module('@/utils', () => ({
  delay: async () => {
    visualDelayCalls++
  },
}))
mock.module('@/utils/deepmerge', () => ({ jsonClone }))
mock.module('@/utils/ai', () => ({ parseGptJson }))
mock.module('@/utils/logger', () => ({ logger: { debug() {}, error() {} } }))
mock.module('@/utils/elmGetter', () => ({
  default: {
    rm: async () => {},
    get: async (s: string) => (s === 'boss-helper-job' ? null : wrapper),
  },
}))
mock.module('./chat', () => ({
  GeekChatClientManager: class {
    async connect() {}
  },
}))
let createWorkflow: () => Promise<unknown> = async () => ({})
mock.module('./delivery', () => ({ bossWorkflow: () => createWorkflow() }))
let bossDataRequests: Array<{ securityId: string; encryptUserId: string }> = []
mock.module('./requests', () => ({
  uploadImage() {},
  getBossData: async (job: { securityId: string; encryptUserId: string }) => {
    bossDataRequests.push(job)
    return { data: { bossId: 42, securityId: job.securityId, bossSource: 7 } }
  },
}))
let modelRequests: string[] = []
const filteringResponse = JSON.stringify({
  dimensions: [
    { key: 'responsibilities', score: 24, reason: '职责匹配' },
    { key: 'skills', score: 20, reason: '技能匹配' },
    { key: 'experience', score: 18, reason: '项目匹配' },
    { key: 'industry', score: 6, reason: '行业相关' },
    { key: 'preferences', score: 8, reason: '偏好匹配' },
  ],
  strengths: ['技能匹配'],
  gaps: [],
  hardRequirements: [],
  uncertainties: [],
})
let modelRespond = async (role: string) => (role === 'filtering' ? filteringResponse : '招呼语草稿')
mock.module('@/composables/useModel/chatModel', () => ({
  ChatModel: class {
    createAgent() {
      return true
    }
    async chat(role, job) {
      modelRequests.push(`${role}:${job.rawData.encryptJobId}`)
      return { text: await modelRespond(role) }
    }
    async generate(role) {
      modelRequests.push(role)
      return modelRespond(role)
    }
  },
}))
Object.assign(globalThis, { reactive })
const { BossHelperCtx, runBoss } = await import('./runtime')

function context() {
  const ctx = new BossHelperCtx()
  // 时间边界另有回归；存储与列表测试不等待真实的操作间隔。
  Object.assign(ctx, { waitForGathering: async () => true })
  return ctx
}

const item = (id: string) => ({ encryptJobId: id, jobName: id }) as BossZpJobItemData
const data = new Map<string, unknown>()
let getStored: (key: string, fallback: unknown) => Promise<unknown>
let setStored: (key: string, value: unknown) => Promise<void>
let selectors = new Map<string, unknown>()
const root = {
  scrollTop: 0,
  scrollHeight: 2000,
  clientHeight: 800,
  scrollBy({ top }: { top: number }) {
    this.scrollTop = Math.min(1200, this.scrollTop + top)
  },
}

beforeEach(() => {
  data.clear()
  createWorkflow = async () => ({})
  getRoot = async () => ({})
  initializeBusiness = async () => {}
  visualDelayCalls = 0
  modelRequests = []
  bossDataRequests = []
  modelRespond = async (role) => (role === 'filtering' ? filteringResponse : '招呼语草稿')
  for (const key of Object.keys(conf.formData)) {
    if (key.startsWith('delayCollection')) delete conf.formData[key]
  }
  selectors = new Map()
  jobListHookCallback = undefined
  root.scrollTop = 0
  Object.assign(globalThis, {
    location: { href: 'https://www.zhipin.com/web/geek/jobs?query=AI' },
    document: {
      defaultView: globalThis,
      scrollingElement: root,
      documentElement: root,
      body: { scrollHeight: 2000, scrollTop: 0, innerText: '' },
      querySelector: (s: string) => selectors.get(s) ?? null,
      createElement: () => ({ remove() {} }),
    },
    window: { innerHeight: 800, scrollY: 0 },
    getComputedStyle: (el: { overflowY?: string }) => ({ overflowY: el.overflowY ?? 'visible' }),
  })
  getStored = async (key, fallback) => data.get(key) ?? fallback
  setStored = async (key, value) => {
    data.set(key, structuredClone(value))
  }
  const script = new EventTarget() as HTMLScriptElement
  const [provide] = defineProxy(
    () => ({
      storageGet: (key: string, fallback: unknown) => getStored(key, fallback),
      storageSet: (key: string, value: unknown) => setStored(key, value),
    }),
    { namespace: '__boss-helper-content__' },
  )
  provide(new ProvideContentScriptAdapter(script))
  initCounter(script)
})

describe('read-only saved job library', () => {
  it('keeps route readiness behind business initialization and the latest mount', async () => {
    const hooks = []
    getRoot = async () => ({ $router: { afterHooks: hooks } })
    createWorkflow = async () => ({ status: ref('idle'), current: ref(0), total: ref(0) })
    let initialized
    initializeBusiness = () =>
      new Promise((resolve) => {
        initialized = resolve
      })
    const original = BossHelperCtx.prototype.onMount
    let mounted
    BossHelperCtx.prototype.onMount = () =>
      new Promise((resolve) => {
        mounted = resolve
      })
    try {
      const script = new EventTarget()
      const [, injectExecutor] = defineProxy(() => ({}), { namespace: '__boss-helper-executor__' })
      const bridge = injectExecutor(new ProvideContentScriptAdapter(script))
      const starting = runBoss(script)
      for (let i = 0; i < 10 && !hooks.length; i++) await Promise.resolve()
      hooks[0]({ path: '/web/geek/jobs' })
      mounted()
      expect(await bridge.snapshot()).toMatchObject({ ready: false })
      initialized()
      await starting
      expect(await bridge.snapshot()).toMatchObject({ ready: true })
      hooks[0]({ path: '/web/geek/job-recommend' })
      const previous = mounted
      hooks[0]({ path: '/web/geek/jobs' })
      previous()
      expect(await bridge.snapshot()).toMatchObject({ ready: false })
      mounted()
      await Promise.resolve()
      expect(await bridge.snapshot()).toMatchObject({ ready: true })
    } finally {
      BossHelperCtx.prototype.onMount = original
    }
  })

  it('publishes headless readiness before the page is ready and retains initialization failures', async () => {
    let rejectRoot
    getRoot = () =>
      new Promise((_resolve, reject) => {
        rejectRoot = reject
      })
    const script = new EventTarget() as HTMLScriptElement
    const [, injectExecutor] = defineProxy(() => ({}), { namespace: '__boss-helper-executor__' })
    const bridge = injectExecutor(new ProvideContentScriptAdapter(script))
    const initializing = runBoss(script)
    expect(await bridge.snapshot()).toMatchObject({ ready: false, error: '' })
    rejectRoot(new Error('page unavailable'))
    await initializing
    expect(await bridge.snapshot()).toMatchObject({ ready: false, error: 'page unavailable' })
    await expect(bridge.command({ type: 'collect' })).rejects.toThrow('page unavailable')
  })

  it('clears obsolete analysis and drafts once while retaining jobs, details and delivery history', async () => {
    const records = mergeJobRecords(
      [],
      [item('old'), item('current'), item('sent')],
      'AI',
      'batch',
    ).records
    for (const record of records) {
      Object.assign(record, {
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: '保存的完整 JD' } },
        analysisStatus: 'ready',
        analysis: { rating: 200, res: { positive: [], negative: [] } },
        finalGreeting: '旧草稿',
        matchedAt: '2026-10-15T00:00:00Z',
        analysisFailureReason: '旧分析错误',
        reviewStatus: 'approved',
      })
    }
    records[1].analysis = { rating: 76, scoringVersion: 'weighted-v1', passed: true }
    records[2].sendStatus = 'sent'
    const currentBefore = jsonClone(records[1])
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    let writes = 0
    setStored = async (key, value) => {
      writes++
      data.set(key, jsonClone(value))
    }
    const ctx = context()
    const library = await ctx.getJobLibrary()
    expect(library).toHaveLength(3)
    expect(library[0]).toMatchObject({
      detailStatus: 'complete',
      detail: { jobInfo: { postDescription: '保存的完整 JD' } },
      analysisStatus: 'pending',
      reviewStatus: 'pending',
      sendStatus: 'pending',
      sourceKeywords: ['AI'],
      batches: ['batch'],
    })
    for (const field of ['analysis', 'finalGreeting', 'analysisFailureReason', 'matchedAt']) {
      expect(library[0][field]).toBeUndefined()
      expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0][field]).toBeUndefined()
    }
    expect(library[1]).toEqual(currentBefore)
    expect(library[2]).toMatchObject({
      sendStatus: 'sent',
      reviewStatus: 'approved',
      analysisStatus: 'pending',
    })
    expect(library[2].analysis).toBeUndefined()
    await ctx.getJobLibrary()
    expect(writes).toBe(1)
    expect(modelRequests).toEqual([])
  })

  it('preserves original data if obsolete-analysis cleanup cannot be saved and allows retry', async () => {
    const records = mergeJobRecords([], [item('old')], 'AI', 'batch').records
    Object.assign(records[0], {
      analysisStatus: 'ready',
      analysis: { rating: 200 },
      finalGreeting: '旧草稿',
    })
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const before = jsonClone(records)
    setStored = async () => {
      throw new Error('清理保存失败')
    }
    const ctx = context()
    await expect(ctx.getJobLibrary()).rejects.toThrow('清理保存失败')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual(before)
    setStored = async (key, value) => data.set(key, jsonClone(value))
    expect((await ctx.getJobLibrary())[0].analysisStatus).toBe('pending')
  })

  it('shares an obsolete-analysis cleanup between concurrent library reads', async () => {
    const records = mergeJobRecords([], [item('old')], 'AI', 'batch').records
    records[0].analysis = { rating: 200 }
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    let release
    let writing
    const started = new Promise((resolve) => {
      writing = resolve
    })
    const ack = new Promise((resolve) => {
      release = resolve
    })
    let writes = 0
    setStored = async (key, value) => {
      writes++
      writing()
      await ack
      data.set(key, jsonClone(value))
    }
    const ctx = context()
    const first = ctx.getJobLibrary()
    const second = ctx.getJobLibrary()
    try {
      await started
      expect(ctx.hasPendingCollectionStorage).toBe(true)
      expect(records[0].analysis.rating).toBe(200)
    } finally {
      release()
    }
    expect((await first)[0].analysis).toBeUndefined()
    expect((await second)[0].analysis).toBeUndefined()
    expect(writes).toBe(1)
    expect(ctx.hasPendingCollectionStorage).toBe(false)
  })

  it('reanalyzes an obsolete reviewed result from saved details under the current rubric', async () => {
    const records = mergeJobRecords([], [item('old')], 'AI', 'batch').records
    Object.assign(records[0], {
      detailStatus: 'complete',
      detail: { jobInfo: { postDescription: '已保存的完整 JD' } },
      analysisStatus: 'ready',
      analysis: { rating: 200 },
      reviewStatus: 'rejected',
      finalGreeting: '旧草稿',
    })
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const ctx = context()
    ctx.conf = {
      formData: jsonClone(defaultFormData),
    }
    ctx.conf.formData.aiFiltering.enable = true
    Object.assign(ctx, {
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'test', api_key: 'key', base_url: 'url' } },
        ]),
        getDefaultModelKey: () => 'active',
      },
      resumes: { currentResume: ref({ id: 'resume', name: '主简历', content: '完整简历' }) },
      onJobCardClick: () => {
        throw new Error('must use saved details')
      },
    })
    const run = await ctx.savedAnalyzer.analyzeOne('old')
    expect(run).toMatchObject({ status: 'completed', completed: 1 })
    const saved = (await ctx.getJobLibrary())[0]
    expect(saved.analysis).toMatchObject({
      scoringVersion: 'weighted-v1',
      rating: 76,
      passed: true,
    })
    expect(saved.reviewStatus).toBe('pending')
    expect(saved.finalGreeting).toBe('招呼语草稿')
    expect(modelRequests).toEqual(['filtering:old', 'greetings:old'])
  })

  it.each([
    null,
    { encryptJobId: '' },
    { encryptJobId: 1 },
    { snapshot: null },
    { snapshot: { encryptJobId: 'different' } },
    { sourceKeywords: 'AI' },
    { sourceKeywords: [1] },
    { batches: [null] },
    { detailStatus: 'unknown' },
    { analysisStatus: 'unknown' },
    { reviewStatus: 'unknown' },
    { sendStatus: 'unknown-state' },
    { processingStatus: 'unknown' },
    { detail: [] },
    { detail: {} },
    { detail: { jobInfo: [] } },
  ])('rejects malformed record fields without clearing saved data: %j', async (patch) => {
    const records = mergeJobRecords([], [item('saved')], 'AI', 'batch').records
    const malformed = [patch === null ? null : { ...records[0], ...patch }]
    data.set(JOB_LIBRARY_STORAGE_KEY, malformed)
    const before = JSON.stringify(malformed)
    setStored = async () => {
      throw new Error('must preserve malformed data')
    }
    await expect(context().getJobLibrary()).rejects.toThrow('本地岗位库格式异常')
    expect(JSON.stringify(data.get(JOB_LIBRARY_STORAGE_KEY))).toBe(before)
  })

  it('reads all 300 saved records with details and failures as detached JSON without BOSS or writes', async () => {
    const ctx = context()
    const records = mergeJobRecords(
      [],
      Array.from({ length: 300 }, (_, i) => ({ ...item(String(i)), skills: ['AI'] })),
      'AI产品经理',
      'saved-batch',
      '2026-10-14T00:00:00.000Z',
    ).records
    Object.assign(records[0], {
      detailStatus: 'complete',
      detail: { jobInfo: { postDescription: 'Saved JD' }, bossInfo: { name: 'Alice' } },
      analysis: { scoringVersion: 'weighted-v1', category: 'P', reasons: ['matches'] },
      reviewStatus: 'approved',
      sendStatus: 'sent',
      finalGreeting: 'Reviewed greeting',
      extraSavedField: { value: 'preserved' },
    })
    Object.assign(records[1], {
      detailStatus: 'failed',
      detailRetryCount: 2,
      failureReason: 'Saved failure',
    })
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const before = JSON.stringify(records)
    const reads: string[] = []
    getStored = async (key, fallback) => {
      reads.push(key)
      expect(fallback).toEqual([])
      return data.get(key) ?? fallback
    }
    const forbidden = () => {
      throw new Error('Reading the library must not access BOSS or write storage')
    }
    setStored = forbidden
    Object.assign(ctx, {
      onJobCardClick: forbidden,
      sendMessage: forbidden,
      detectCollectionIssue: forbidden,
      scrollDown: forbidden,
      _clickJobCardAction: forbidden,
    })
    const savedDocument = globalThis.document
    const savedLocation = globalThis.location
    Object.assign(globalThis, {
      document: new Proxy({}, { get: forbidden }),
      location: new Proxy({}, { get: forbidden }),
    })
    try {
      const saved = await ctx.getJobLibrary()
      expect(saved).toHaveLength(300)
      expect(saved[0]).toMatchObject({
        detail: { jobInfo: { postDescription: 'Saved JD' } },
        analysis: { category: 'P' },
        reviewStatus: 'approved',
        sendStatus: 'sent',
        finalGreeting: 'Reviewed greeting',
        extraSavedField: { value: 'preserved' },
      })
      expect(saved[1]).toMatchObject({
        detailStatus: 'failed',
        detailRetryCount: 2,
        failureReason: 'Saved failure',
      })
      expect(JSON.stringify(saved)).toBe(before)
      expect(reads).toEqual([JOB_LIBRARY_STORAGE_KEY])
      expect(saved).not.toBe(records)
      expect(saved[0].snapshot).not.toBe(records[0].snapshot)
      saved[0].snapshot.skills.push('changed')
      saved[0].detail.jobInfo.postDescription = 'changed'
      saved[0].sourceKeywords.push('changed')
      saved[0].analysis.reasons.push('changed')
      expect(JSON.stringify(data.get(JOB_LIBRARY_STORAGE_KEY))).toBe(before)
    } finally {
      Object.assign(globalThis, { document: savedDocument, location: savedLocation })
    }
  })

  it('returns an empty library when nothing has been saved', async () => {
    expect(await context().getJobLibrary()).toEqual([])
  })

  it('propagates storage failures and rejects malformed data without replacing it', async () => {
    const ctx = context()
    setStored = async () => {
      throw new Error('must not write')
    }
    getStored = async () => {
      throw new Error('storage unavailable')
    }
    await expect(ctx.getJobLibrary()).rejects.toThrow('storage unavailable')
    const malformed = { records: [] }
    data.set(JOB_LIBRARY_STORAGE_KEY, malformed)
    getStored = async () => malformed
    await expect(ctx.getJobLibrary()).rejects.toThrow('本地岗位库格式异常')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toBe(malformed)
  })

  it.each(['getJobLibrary', 'getAnalysisHandoff'])(
    'bounds a stalled %s read with the existing eight-second timeout',
    async (method) => {
      const ctx = context()
      let release!: (value: unknown) => void
      getStored = () => new Promise((resolve) => (release = resolve))
      const nativeTimeout = globalThis.setTimeout
      const timeouts: number[] = []
      let deadline: ReturnType<typeof setTimeout> | undefined
      globalThis.setTimeout = ((fn, ms, ...args) => {
        timeouts.push(ms)
        return nativeTimeout(fn, ms === 8000 ? 10 : ms, ...args)
      }) as typeof setTimeout
      try {
        await expect(
          Promise.race([
            ctx[method](),
            new Promise((_, reject) => {
              deadline = nativeTimeout(() => reject(new Error('read did not time out')), 50)
            }),
          ]),
        ).rejects.toThrow('读取本地岗位库超时')
        expect(timeouts).toContain(8000)
      } finally {
        clearTimeout(deadline)
        globalThis.setTimeout = nativeTimeout
        release?.([])
      }
    },
  )

  it('uses the saved-library reader for the existing analysis handoff', async () => {
    const ctx = context()
    const records = mergeJobRecords([], [item('saved')], 'AI', 'batch').records
    records[0].analysis = { category: 'P' }
    Object.assign(ctx, { getJobLibrary: async () => records })
    getStored = async () => {
      throw new Error('must use the shared reader')
    }
    expect(await ctx.getAnalysisHandoff()).toMatchObject([
      { encryptJobId: 'saved', job: { jobName: 'saved' }, analysis: { category: 'P' } },
    ])
  })

  it('persists and clears the excluded processing status', async () => {
    const ctx = context()
    data.set(JOB_LIBRARY_STORAGE_KEY, mergeJobRecords([], [item('saved')], 'AI', 'batch').records)

    await expect(ctx.updateJobProcessingStatus('saved', 'excluded')).resolves.toBe(true)
    expect((await ctx.getJobLibrary())[0].processingStatus).toBe('excluded')

    await expect(ctx.updateJobProcessingStatus('saved', 'active')).resolves.toBe(true)
    expect((await ctx.getJobLibrary())[0].processingStatus).toBeUndefined()
  })

  it('keeps a stopped collection locked until its pending save settles even after viewing the library', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    let release!: () => void
    let announce!: () => void
    const saving = new Promise<void>((resolve) => (announce = resolve))
    const pendingSave = new Promise<void>((resolve) => (release = resolve))
    setStored = async (key, value) => {
      if (key === JOB_LIBRARY_STORAGE_KEY) {
        announce()
        await pendingSave
      }
      data.set(key, jsonClone(value))
    }
    const nativeTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn, ms, ...args) =>
      nativeTimeout(fn, ms === 8000 ? 30 : ms, ...args)) as typeof setTimeout
    let task: Promise<unknown> | undefined
    try {
      task = ctx.collectOnly()
      await saving
      ctx.stopCollection()
      const stopped = await task
      expect(stopped).toMatchObject({ status: 'stopped', error: expect.stringContaining('超时') })
      expect(await ctx.getJobLibrary()).toEqual([])
      expect(await ctx.collectOnly()).toBe(stopped)
    } finally {
      globalThis.setTimeout = nativeTimeout
      release()
      await task
      await new Promise((resolve) => nativeTimeout(resolve, 0))
    }
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toMatchObject([{ encryptJobId: 'a' }])
  })
})

describe('collection with immediate analysis', () => {
  function pipelineContext() {
    const ctx = context()
    ctx.conf = {
      formData: {
        ...conf.formData,
        aiFiltering: {
          score: 70,
          scoringVersion: 'weighted-v1',
          prompt: [{ role: 'user', content: '筛选' }],
        },
        aiGreeting: { prompt: [{ role: 'user', content: '招呼语' }] },
      },
    }
    ctx.models = {
      getDefaultModelKey: () => 'model',
      modelData: ref([
        {
          key: 'model',
          name: 'Offline',
          data: { api_key: 'fake', base_url: 'https://model.invalid', model: 'offline' },
        },
      ]),
    }
    ctx.resumes = { currentResume: ref({ id: 'resume', name: 'Current', content: '完整简历' }) }
    const records = mergeJobRecords([], [item('pending')], 'AI', 'previous').records
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    ctx._jobList.value = [item('pending'), item('new')]
    for (const record of ctx._jobList.value)
      ctx.jobMaps.set(`boss::${record.encryptJobId}`, {
        rawData: { detail: { jobInfo: { postDescription: '完整 JD' } } },
      })
    ctx._pageHasMore.value = false
    Object.assign(ctx, {
      onJobCardClick: async () => {},
      waitForNewJobs: async () => false,
      scrollDown: () => {},
      getScrollState: () => ({ top: 1200, height: 2000, clientHeight: 800 }),
    })
    return ctx
  }

  it('prepares a newly captured card for analysis without starting competing background details', async () => {
    const ctx = pipelineContext()
    data.set(JOB_LIBRARY_STORAGE_KEY, [])
    ctx['mounted'] = true
    ctx.jobMaps.set('boss::single', {
      rawData: {
        jobitem: item('single'),
        detail: { jobInfo: { postDescription: '完整 JD' } },
      },
    })
    try {
      await ctx.captureJobSnapshot('boss::single')
      await ctx.ensureSavedJobDetails('single')
      const run = await ctx.savedAnalyzer.analyzeOne('single')
      expect(run).toMatchObject({ status: 'completed', completed: 1 })
      expect((await ctx.getJobLibrary())[0]).toMatchObject({
        analysisStatus: 'ready',
        analysis: { rating: 76, passed: true },
        finalGreeting: '招呼语草稿',
      })
    } finally {
      ctx['mounted'] = false
      await ctx['detailPromise']
    }
  })

  it('fills editable keywords from a resume draft without persisting or starting collection', async () => {
    const ctx = pipelineContext()
    modelRespond = async () => '{"keywords":["产品经理"," AI产品经理 ","产品经理"]}'
    await ctx.extractKeywordRotationFromResume('待保存的简历正文')
    expect(ctx.keywordRotationKeywords.value).toBe('产品经理\nAI产品经理')
    expect(ctx.keywordExtractionBusy.value).toBe(false)
    expect(ctx.keywordRotation.value).toBeNull()
    expect(data.has(KEYWORD_ROTATION_STORAGE_KEY)).toBe(false)
    expect(modelRequests).toEqual(['keywords'])
  })

  it('preserves edited keywords when the AI response is invalid and allows retry', async () => {
    const ctx = pipelineContext()
    ctx.keywordRotationKeywords.value = '金融产品经理'
    modelRespond = async () => '{"keywords":[]}'
    await expect(ctx.extractKeywordRotationFromResume()).rejects.toThrow('岗位关键词')
    expect(ctx.keywordRotationKeywords.value).toBe('金融产品经理')
    expect(ctx.keywordExtractionBusy.value).toBe(false)
    modelRespond = async () => '{"keywords":["数据产品经理"]}'
    await ctx.extractKeywordRotationFromResume()
    expect(ctx.keywordRotationKeywords.value).toBe('数据产品经理')
  })

  it('rejects empty resumes and incomplete models before requesting extraction', async () => {
    const ctx = pipelineContext()
    await expect(ctx.extractKeywordRotationFromResume(' ')).rejects.toThrow('简历')
    ctx.models.modelData.value[0].data.api_key = ''
    await expect(ctx.extractKeywordRotationFromResume('简历')).rejects.toThrow('模型')
    expect(modelRequests).toEqual([])
  })

  it('blocks duplicate extraction and releases the busy flag after a request fails', async () => {
    const ctx = pipelineContext()
    let reject
    modelRespond = () =>
      new Promise((_, fail) => {
        reject = fail
      })
    const pending = ctx.extractKeywordRotationFromResume()
    expect(ctx.keywordExtractionBusy.value).toBe(true)
    await expect(ctx.extractKeywordRotationFromResume()).rejects.toThrow('提取')
    await expect(ctx.saveKeywordRotationKeywords('产品经理')).rejects.toThrow('提取')
    await expect(ctx.startKeywordRotation()).rejects.toThrow('提取')
    reject(new Error('模型请求失败'))
    await expect(pending).rejects.toThrow('模型请求失败')
    expect(ctx.keywordExtractionBusy.value).toBe(false)
  })

  it('loads built-in keywords only when no saved rotation exists', async () => {
    const ctx = pipelineContext()
    await ctx.loadKeywordRotation()
    expect(ctx.keywordRotationKeywords.value).toContain('产品经理')
    await ctx.saveKeywordRotationKeywords('自定义岗位\nAI产品经理')
    ctx.keywordRotationKeywords.value = '临时修改'
    await ctx.loadKeywordRotation()
    expect(ctx.keywordRotationKeywords.value).toBe('自定义岗位\nAI产品经理')
  })

  it('waits for keyword persistence before allowing a rotation or another extraction', async () => {
    const ctx = pipelineContext()
    let release
    const ack = new Promise((resolve) => {
      release = resolve
    })
    setStored = async () => ack
    const task = ctx.saveKeywordRotationKeywords('数据产品经理')
    try {
      expect(ctx.keywordRotationSaving.value).toBe(true)
      await expect(ctx.startKeywordRotation()).rejects.toThrow('保存')
      await expect(ctx.extractKeywordRotationFromResume()).rejects.toThrow('保存')
      await expect(ctx.saveKeywordRotationKeywords('产品经理')).rejects.toThrow('保存')
    } finally {
      release()
      await task
    }
    expect(ctx.keywordRotationSaving.value).toBe(false)
  })

  it('resumes current pending jobs and persists score, greeting and resume identity before collection continues', async () => {
    const ctx = pipelineContext()
    Object.assign(ctx, {
      scrollDown: () => {
        expect(data.get(JOB_LIBRARY_STORAGE_KEY).map((record) => record.analysisStatus)).toEqual([
          'ready',
          'ready',
        ])
      },
    })
    const run = await ctx.savedAnalyzer.start({ collectNew: true })
    expect(run).toMatchObject({ status: 'completed', completed: 2, failed: 0 })
    expect(modelRequests).toEqual([
      'filtering:new',
      'greetings:new',
      'filtering:pending',
      'greetings:pending',
    ])
    expect(
      (await ctx.getJobLibrary()).map((record) => ({
        rating: record.analysis.rating,
        resumeId: record.analysis.resumeId,
        greeting: record.finalGreeting,
        review: record.reviewStatus,
        send: record.sendStatus,
      })),
    ).toEqual([
      {
        rating: 76,
        resumeId: 'resume',
        greeting: '招呼语草稿',
        review: 'pending',
        send: 'pending',
      },
      {
        rating: 76,
        resumeId: 'resume',
        greeting: '招呼语草稿',
        review: 'pending',
        send: 'pending',
      },
    ])
  })

  it('pauses between matching and greeting, then stops without a greeting, next job or scroll', async () => {
    const ctx = pipelineContext()
    const wait = BossHelperCtx.prototype['waitForGathering'].bind(ctx)
    Object.assign(ctx, { waitForGathering: (_ms, run) => wait(0, run) })
    let entered!: () => void
    const paused = new Promise<void>((resolve) => {
      entered = resolve
    })
    modelRespond = async () => {
      ctx.pauseGathering()
      entered()
      return filteringResponse
    }
    let scrolls = 0
    ctx.scrollDown = () => {
      scrolls++
    }
    const pending = ctx.savedAnalyzer.start({ collectNew: true })
    await paused
    expect(ctx.collectionRun.value.status).toBe('paused')
    expect(modelRequests).toEqual(['filtering:new'])
    ctx.stopGathering()
    const run = await pending
    expect(run.status).toBe('stopped')
    expect(modelRequests).toEqual(['filtering:new'])
    expect(scrolls).toBe(0)
    expect((await ctx.getJobLibrary())[1].analysis.rating).toBe(76)
    expect(ctx.savedAnalyzer.busy.value).toBe(false)
    expect(ctx.gatheringBusy.value).toBe(false)
  })

  it.each(['请完成安全验证', '登录过期，请先登录', '访问过于频繁'])(
    'halts the combined pipeline after matching exposes %s',
    async (message) => {
      const ctx = pipelineContext()
      const wait = BossHelperCtx.prototype['waitForGathering'].bind(ctx)
      Object.assign(ctx, { waitForGathering: (_ms, run) => wait(0, run) })
      modelRespond = async () => {
        document.body.innerText = message
        return filteringResponse
      }
      let scrolls = 0
      ctx.scrollDown = () => {
        scrolls++
      }
      const run = await ctx.savedAnalyzer.start({ collectNew: true })
      expect(run.status).toBe('failed')
      expect(modelRequests).toEqual(['filtering:new'])
      expect(scrolls).toBe(0)
      expect((await ctx.getJobLibrary())[1].analysis.rating).toBe(76)
      expect(ctx.savedAnalyzer.busy.value).toBe(false)
    },
  )

  function analysisContext() {
    const ctx = context()
    ctx.savedAnalyzer = { busy: ref(true), collecting: ref(true), stop() {} }
    const records = mergeJobRecords(
      [],
      [
        item('ready'),
        item('sent'),
        item('unknown'),
        item('reviewed'),
        item('contacted'),
        item('failed'),
      ],
      'AI',
      'old',
    ).records
    records[0].analysisStatus = 'ready'
    records[0].analysis = { scoringVersion: 'weighted-v1', rating: 90 }
    records[1].sendStatus = 'sent'
    records[2].sendStatus = 'unknown'
    records[3].reviewStatus = 'approved'
    records[4].snapshot.contact = true
    records[5].analysisStatus = 'failed'
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    ctx._jobList.value = [...records.map((record) => record.snapshot), item('new')]
    ctx.jobMaps.set('boss::new', {
      rawData: { detail: { jobInfo: { postDescription: '完整 JD' } } },
    })
    return { ctx, records }
  }

  it('saves full details and analyzes each unseen pending job before scrolling, once per run', async () => {
    const { ctx, records } = analysisContext()
    const events: string[] = []
    Object.assign(ctx, {
      onJobCardClick: async () => {
        events.push('detail')
      },
      waitForNewJobs: async () => false,
      scrollDown: () => {
        events.push('scroll')
      },
      getScrollState: () => ({ top: 1200, height: 2000, clientHeight: 800 }),
    })
    ctx._pageHasMore.value = false
    const run = await ctx.collectOnly('AI', async (record) => {
      const stored = (await ctx.getJobLibrary()).find(
        (item) => item.encryptJobId === record.encryptJobId,
      )
      expect(stored.detail.jobInfo.postDescription).toBe('完整 JD')
      events.push(`analyze:${record.encryptJobId}`)
      await ctx.saveJobAnalysis(record.encryptJobId, {
        analysisStatus: 'ready',
        analysis: { scoringVersion: 'weighted-v1', rating: 20 },
        finalGreeting: '草稿',
      })
    })
    expect(run.status).toBe('completed')
    expect(events.slice(0, 3)).toEqual(['detail', 'analyze:new', 'scroll'])
    expect(events.filter((event) => event.startsWith('analyze:'))).toEqual(['analyze:new'])
    expect(
      (await ctx.getJobLibrary()).slice(0, 6).map((record) => ({
        analysisStatus: record.analysisStatus,
        reviewStatus: record.reviewStatus,
        sendStatus: record.sendStatus,
      })),
    ).toEqual(
      records.map((record) => ({
        analysisStatus: record.analysisStatus,
        reviewStatus: record.reviewStatus,
        sendStatus: record.sendStatus,
      })),
    )
  })

  it('skips excluded jobs before detail completion and analysis during collection', async () => {
    const { ctx, records } = analysisContext()
    records[5].processingStatus = 'excluded'
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const events: string[] = []
    const detailKeys: string[] = []
    Object.assign(ctx, {
      onJobCardClick: async (key) => {
        detailKeys.push(key)
        events.push('detail')
      },
      waitForNewJobs: async () => false,
      scrollDown: () => {
        events.push('scroll')
      },
      getScrollState: () => ({ top: 1200, height: 2000, clientHeight: 800 }),
    })
    ctx._pageHasMore.value = false

    await ctx.collectOnly('AI', async (record) => {
      events.push(`analyze:${record.encryptJobId}`)
    })

    expect(detailKeys).toEqual(['boss::new'])
    expect(events.slice(0, 3)).toEqual(['detail', 'analyze:new', 'scroll'])
    expect(events.filter((event) => event.startsWith('analyze:'))).toEqual(['analyze:new'])
  })

  it('stops without analysis or further scrolling when a detail click triggers a restriction', async () => {
    const { ctx } = analysisContext()
    let analyses = 0
    let scrolls = 0
    Object.assign(ctx, {
      onJobCardClick: async (_key, shouldStop) => {
        document.body.innerText = '访问过于频繁'
        if (shouldStop()) throw new Error('详情补全已停止')
      },
      scrollDown: () => {
        scrolls++
      },
    })
    const run = await ctx.collectOnly('AI', async () => {
      analyses++
    })
    expect(run.status).toBe('restricted')
    expect(analyses).toBe(0)
    expect(scrolls).toBe(0)
    expect(ctx.gatheringBusy.value).toBe(false)
  })
})

describe('saved job analysis data boundary', () => {
  it('maps saved snapshots and details without opening cards or reading live job maps', () => {
    const ctx = context()
    const record = mergeJobRecords(
      [],
      [{ ...item('saved'), brandName: 'Acme', bossName: 'Alice', skills: ['AI'] }],
      'AI',
      'batch',
    ).records[0]
    record.detail = {
      jobInfo: {
        postDescription: 'Saved responsibilities',
        locationName: 'Shanghai',
        address: 'Saved address',
        longitude: 121,
        latitude: 31,
      },
      bossInfo: { bossOnline: true, certificated: true, activeTimeDesc: 'Saved activity' },
      brandComInfo: { activeTime: 1, labels: ['Saved label'], introduce: 'Saved intro' },
    }
    const before = JSON.stringify(record)
    const forbidden = () => {
      throw new Error('must only use the saved record')
    }
    Object.assign(ctx, { jobMaps: { get: forbidden }, onJobCardClick: forbidden })
    const mapped = ctx.getSavedJobData(record)
    expect(mapped).toMatchObject({
      rawData: record,
      state: {},
      jobData: {
        key: 'boss::saved',
        jobName: 'saved',
        jobDescription: 'Saved responsibilities',
        city: 'Shanghai',
        address: 'Saved address',
        addressCoords: [121, 31],
        activeTime: 1,
        activeTimeStr: 'Saved activity',
        boss: { name: 'Alice', isOnline: true, isCertificated: true },
        brand: { name: 'Acme', introduce: 'Saved intro', labels: ['Saved label'] },
      },
    })
    expect(mapped.rawData).toBe(record)
    expect(JSON.stringify(record)).toBe(before)
    delete record.detail
    expect(ctx.getSavedJobData(record).jobData.jobDescription).toBe('')
    record.detail = { jobInfo: { postDescription: 'Older saved JD' } }
    expect(ctx.getSavedJobData(record).jobData.jobDescription).toBe('Older saved JD')
  })

  it('applies the shared detail mapping to live cards while retaining their job-data object', async () => {
    const ctx = context()
    const record = mergeJobRecords([], [item('a')], 'AI', 'batch').records[0]
    const jobData = ctx.getSavedJobData(record).jobData
    const live = {
      jobData,
      rawData: { jobitem: { ...record.snapshot, lid: 'lid-a' }, detail: {} },
      state: {},
    }
    ctx.jobMaps.set('boss::a', live)
    ctx._jobDetail.value = {
      lid: 'lid-a',
      jobInfo: { postDescription: 'Live JD', locationName: 'Shanghai' },
      bossInfo: { bossOnline: true },
      brandComInfo: { introduce: 'Live company intro' },
    }
    await ctx.onJobCardClick('boss::a')
    expect(live.jobData).toBe(jobData)
    expect(jobData).toMatchObject({
      jobDescription: 'Live JD',
      city: 'Shanghai',
      boss: { isOnline: true },
      brand: { introduce: 'Live company intro' },
    })
  })

  it('completes one saved job from the current live card and preserves library state', async () => {
    const ctx = context()
    const record = mergeJobRecords([], [item('single')], 'AI', 'batch').records[0]
    data.set(JOB_LIBRARY_STORAGE_KEY, [record])
    const live = {
      jobData: ctx.getSavedJobData(record).jobData,
      rawData: { jobitem: { ...record.snapshot, lid: 'lid-single' }, detail: {} },
      state: {},
    }
    ctx.jobMaps.set(record.key, live)
    ctx._jobDetail.value = {
      lid: 'lid-single',
      jobInfo: { postDescription: '单岗完整 JD' },
    }

    const stored = await ctx.ensureSavedJobDetails(record.encryptJobId)

    expect(stored).toMatchObject({
      detailStatus: 'complete',
      detail: { jobInfo: { postDescription: '单岗完整 JD' } },
    })
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      detailStatus: 'complete',
      detail: { jobInfo: { postDescription: '单岗完整 JD' } },
    })
  })

  it('does not fabricate details for a saved job absent from the current live page', async () => {
    const ctx = context()
    const record = mergeJobRecords([], [item('missing-live')], 'AI', 'batch').records[0]
    data.set(JOB_LIBRARY_STORAGE_KEY, [record])

    await expect(ctx.ensureSavedJobDetails(record.encryptJobId)).rejects.toThrow('搜索页')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detailStatus).toBe('pending')
  })

  it('saves analysis against the latest library without replacing detail, audit or other jobs', async () => {
    const ctx = context()
    const records = mergeJobRecords([], [item('a'), item('b')], 'AI', 'batch').records
    Object.assign(records[0], {
      detail: { jobInfo: { postDescription: 'Latest saved JD' } },
      detailStatus: 'failed',
      failureReason: 'Detail failed',
      finalGreeting: 'Existing draft',
    })
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const other = JSON.stringify(records[1])
    expect(
      await ctx.saveJobAnalysis('a', {
        analysisStatus: 'ready',
        analysis: { category: 'P', reason: 'matches' },
        finalGreeting: 'New generated draft',
      }),
    ).toBe(true)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      analysisStatus: 'ready',
      analysis: { category: 'P', reason: 'matches' },
      finalGreeting: 'New generated draft',
      detail: { jobInfo: { postDescription: 'Latest saved JD' } },
      detailStatus: 'failed',
      failureReason: 'Detail failed',
      reviewStatus: 'pending',
      sendStatus: 'pending',
    })
    expect(JSON.stringify(data.get(JOB_LIBRARY_STORAGE_KEY)[1])).toBe(other)
  })

  it('records the first successful match time without overwriting it', async () => {
    const ctx = context()
    const records = mergeJobRecords([], [item('a')], 'AI', 'batch').records
    records[0].matchedAt = '2026-10-14T10:00:00.000Z'
    records[0].analysis = { scoringVersion: 'weighted-v1', passed: true }
    data.set(JOB_LIBRARY_STORAGE_KEY, records)

    await ctx.saveJobAnalysis('a', {
      analysisStatus: 'pending',
      analysis: { scoringVersion: 'weighted-v1', passed: true },
    })

    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].matchedAt).toBe('2026-10-14T10:00:00.000Z')
  })

  it.each([
    { analysisStatus: 'ready' },
    { reviewStatus: 'approved' },
    { reviewStatus: 'rejected' },
    { sendStatus: 'queued' },
    { sendStatus: 'sent' },
    { sendStatus: 'unknown' },
    { sendStatus: 'failed' },
  ])('does not overwrite completed analysis or audit/send state: %j', async (state) => {
    const ctx = context()
    const records = mergeJobRecords([], [item('a')], 'AI', 'batch').records
    Object.assign(records[0], state, {
      analysis: { scoringVersion: 'weighted-v1', category: 'Reviewed' },
      finalGreeting: 'Protected greeting',
    })
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const before = JSON.stringify(records)
    setStored = async () => {
      throw new Error('protected records must not be written')
    }
    expect(
      await ctx.saveJobAnalysis('a', {
        analysisStatus: 'ready',
        analysis: { category: 'Replacement' },
        finalGreeting: 'Replacement greeting',
      }),
    ).toBe(false)
    expect(JSON.stringify(data.get(JOB_LIBRARY_STORAGE_KEY))).toBe(before)
  })

  it('stores analysis failures separately and preserves detail failures and draft text', async () => {
    const ctx = context()
    const records = mergeJobRecords([], [item('a')], 'AI', 'batch').records
    records[0].failureReason = 'Detail unavailable'
    records[0].analysis = { scoringVersion: 'weighted-v1', passed: true }
    records[0].finalGreeting = 'Existing draft'
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    expect(
      await ctx.saveJobAnalysis('a', {
        analysisStatus: 'failed',
        analysisFailureReason: 'Model unavailable',
      }),
    ).toBe(true)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      analysisStatus: 'failed',
      analysisFailureReason: 'Model unavailable',
      failureReason: 'Detail unavailable',
      finalGreeting: 'Existing draft',
    })
    expect(
      await ctx.saveJobAnalysis('a', { analysisStatus: 'ready', analysis: { pass: true } }),
    ).toBe(true)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].analysisFailureReason).toBeUndefined()
  })

  it('keeps a stopped partial analysis retryable without recording a failure', async () => {
    const ctx = context()
    const records = mergeJobRecords([], [item('a')], 'AI', 'batch').records
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    expect(
      await ctx.saveJobAnalysis('a', {
        analysisStatus: 'pending',
        analysis: { rating: 20, passed: true },
      }),
    ).toBe(true)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      analysisStatus: 'pending',
      analysis: { rating: 20, passed: true },
    })
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].analysisFailureReason).toBeUndefined()
  })

  it('rejects unknown IDs, invalid patches and persistence failures without modifying saved records', async () => {
    const ctx = context()
    const records = mergeJobRecords([], [item('a')], 'AI', 'batch').records
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    const before = JSON.stringify(records)
    await expect(ctx.saveJobAnalysis('missing', { analysisStatus: 'ready' })).rejects.toThrow(
      '未找到',
    )
    await expect(ctx.saveJobAnalysis('a', { analysisStatus: 'other' })).rejects.toThrow(
      '分析结果格式异常',
    )
    await expect(
      ctx.saveJobAnalysis('a', { analysisStatus: 'ready', analysis: [] }),
    ).rejects.toThrow('分析结果格式异常')
    setStored = async () => {
      throw new Error('storage unavailable')
    }
    await expect(
      ctx.saveJobAnalysis('a', { analysisStatus: 'ready', analysis: { pass: true } }),
    ).rejects.toThrow('storage unavailable')
    expect(JSON.stringify(data.get(JOB_LIBRARY_STORAGE_KEY))).toBe(before)
  })

  it('blocks writes during collection and exposes only the pending-storage flag', async () => {
    const ctx = context()
    let reads = 0
    getStored = async () => {
      reads++
      return []
    }
    expect(ctx.hasPendingCollectionStorage).toBe(false)
    ctx.gatheringBusy.value = true
    await expect(ctx.saveJobAnalysis('a', { analysisStatus: 'ready' })).rejects.toThrow('已有任务')
    ctx.gatheringBusy.value = false
    ctx['collectionStoragePending'] = new Promise(() => {})
    expect(ctx.hasPendingCollectionStorage).toBe(true)
    await expect(ctx.saveJobAnalysis('a', { analysisStatus: 'ready' })).rejects.toThrow('已有任务')
    expect(reads).toBe(0)
  })

  it('keeps late analysis saves locked after a timeout so collection cannot overwrite them', async () => {
    const ctx = context()
    data.set(JOB_LIBRARY_STORAGE_KEY, mergeJobRecords([], [item('a')], 'AI', 'batch').records)
    let release!: () => void
    const pendingSave = new Promise<void>((resolve) => (release = resolve))
    let saveStarted!: () => void
    const saving = new Promise<void>((resolve) => (saveStarted = resolve))
    setStored = async (key, value) => {
      saveStarted()
      await pendingSave
      data.set(key, jsonClone(value))
    }
    const nativeTimeout = globalThis.setTimeout
    let expire!: () => void
    globalThis.setTimeout = ((fn, ms, ...args) => {
      if (ms === 8000) expire = () => fn(...args)
      return nativeTimeout(fn, ms, ...args)
    }) as typeof setTimeout
    try {
      const timedOut = ctx
        .saveJobAnalysis('a', { analysisStatus: 'ready', analysis: { pass: true } })
        .then(
          () => null,
          (error) => error,
        )
      await saving
      expire()
      expect(await timedOut).toBeInstanceOf(Error)
      expect((await timedOut).message).toContain('保存岗位分析超时')
      expect(ctx.hasPendingCollectionStorage).toBe(true)
      await expect(ctx.collectOnly()).rejects.toThrow('已有任务')
      await expect(ctx.saveJobAnalysis('a', { analysisStatus: 'failed' })).rejects.toThrow(
        '已有任务',
      )
    } finally {
      globalThis.setTimeout = nativeTimeout
      release()
      await new Promise((resolve) => nativeTimeout(resolve, 0))
    }
    expect(ctx.hasPendingCollectionStorage).toBe(false)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      analysisStatus: 'ready',
      analysis: { pass: true },
    })
  })

  it.each(['start', 'collectOnly', 'completeCollectedDetails'])(
    'blocks %s while saved analysis is active before any live work',
    async (method) => {
      const ctx = context()
      ctx.savedAnalyzer = { busy: ref(true) }
      let reads = 0
      getStored = async () => {
        reads++
        return []
      }
      await expect(ctx[method]()).rejects.toThrow('请先停止本地岗位分析')
      expect(reads).toBe(0)
      expect(ctx.collectionRun.value).toBeNull()
      expect(ctx.detailRun.value).toBeNull()
    },
  )
})

describe('realtime workflow startup lock', () => {
  it('blocks collection, details and duplicate starts while workflow initialization is pending', async () => {
    const ctx = context()
    let release!: (workflow: unknown) => void
    const initialization = new Promise((resolve) => (release = resolve))
    createWorkflow = () => initialization
    const task = ctx.start()
    try {
      expect(ctx.realtimeBusy.value).toBe(true)
      await expect(ctx.collectOnly()).rejects.toThrow('已有任务')
      await expect(ctx.completeCollectedDetails()).rejects.toThrow('已有任务')
      await expect(ctx.start()).rejects.toThrow('已有任务')
      expect(ctx.collectionRun.value).toBeNull()
      expect(ctx.detailRun.value).toBeNull()
    } finally {
      release({ status: ref('pending'), executeAll: async () => {} })
      await task
    }
    expect(ctx.realtimeBusy.value).toBe(false)
  })

  it('keeps the realtime lock through execution and releases it on completion', async () => {
    const ctx = context()
    let release!: () => void
    const execution = new Promise<void>((resolve) => (release = resolve))
    ctx.workflow = { status: ref('pending'), executeAll: () => execution }
    const task = ctx.start()
    try {
      expect(ctx.realtimeBusy.value).toBe(true)
    } finally {
      release()
      await task
    }
    expect(ctx.realtimeBusy.value).toBe(false)
  })

  it.each(['initialization', 'execution'])(
    'releases the realtime lock after %s fails',
    async (phase) => {
      const ctx = context()
      const fail = async () => {
        throw new Error(`${phase} failed`)
      }
      if (phase === 'initialization') createWorkflow = fail
      else ctx.workflow = { status: ref('pending'), executeAll: fail }
      await expect(ctx.start()).rejects.toThrow(`${phase} failed`)
      expect(ctx.realtimeBusy.value).toBe(false)
    },
  )

  it('rejects realtime startup while a previous storage save is still pending', async () => {
    const ctx = context()
    ctx['collectionStoragePending'] = new Promise(() => {})
    let initialized = false
    createWorkflow = async () => {
      initialized = true
      return { status: ref('pending'), executeAll: async () => {} }
    }
    await expect(ctx.start()).rejects.toThrow('已有任务')
    expect(initialized).toBe(false)
    expect(ctx.realtimeBusy.value).toBe(false)
  })
})

it('captures only unseen job snapshots without fetching details', async () => {
  const ctx = context()
  data.set(JOB_LIBRARY_STORAGE_KEY, mergeJobRecords([], [item('old')], 'AI', 'old-batch').records)

  const added = await ctx.captureNewJobs([item('old'), item('new')], 'AI')

  expect(added).toBe(1)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(2)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[1]).toMatchObject({
    encryptJobId: 'new',
    detailStatus: 'pending',
    analysisStatus: 'pending',
  })
})

it('starts background detail completion from passive job-list updates without capturing when disabled', async () => {
  const ctx = context()
  let scheduled = 0
  ctx.scheduleBackgroundDetailCompletion = () => {
    scheduled++
  }

  await ctx._initJobList()
  expect(jobListHookCallback).toBeDefined()
  jobListHookCallback?.([item('visible')])

  expect(scheduled).toBe(1)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toBeUndefined()
})

it('captures passive job-list updates when auto capture is enabled', async () => {
  const ctx = context()
  ctx.autoCaptureEnabled.value = true

  await ctx._initJobList()
  expect(jobListHookCallback).toBeDefined()
  jobListHookCallback?.([item('visible')])
  await ctx['jobCapturePromise']

  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toMatchObject([
    { encryptJobId: 'visible', detailStatus: 'pending' },
  ])
})

it('sends a saved greeting through the existing BOSS chat sender', async () => {
  const ctx = context()
  const record = mergeJobRecords([], [item('new')], 'AI', 'batch').records[0]
  record.detailStatus = 'complete'
  record.detail = { jobInfo: { postDescription: 'JD' }, bossInfo: { bossSource: 7 } }
  record.finalGreeting = '您好，想和您沟通岗位细节。'
  record.analysis = { scoringVersion: 'weighted-v1', passed: true }
  data.set(JOB_LIBRARY_STORAGE_KEY, [record])
  ctx.jobMaps.set('boss::new', {
    jobData: { key: 'boss::new' },
    rawData: {
      jobitem: { ...item('new'), securityId: 'security', encryptBossId: 'boss' },
      detail: record.detail,
    },
    state: {},
  })
  Object.defineProperty(ctx, 'uid', { value: 'user' })
  let sent = ''
  ctx.sendMessage = async (_data, message) => {
    sent = message
  }

  await ctx.sendSavedGreeting('new')

  expect(sent).toBe(record.finalGreeting)
  expect(bossDataRequests).toEqual([{ securityId: 'security', encryptUserId: 'user' }])
})

describe('collection runtime with the existing storage bridge', () => {
  it('passes serializable snapshots and run records to storage before scrolling the first 15 jobs', async () => {
    const ctx = context()
    ctx._jobList.value = Array.from({ length: 15 }, (_, i) => ({
      ...item(String(i)),
      skills: ['AI'],
      gps: { longitude: 121, latitude: 31 },
    }))
    let scrolls = 0
    Object.assign(ctx, {
      scrollDown() {
        scrolls++
        expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(15)
        expect(data.get(COLLECTION_RUN_STORAGE_KEY)).toMatchObject([{ savedCount: 15 }])
      },
      waitForNewJobs: async () => {
        ctx.stopCollection()
        return false
      },
    })
    const run = await ctx.collectOnly()
    expect(run.error).toBeUndefined()
    expect(run.status).toBe('stopped')
    expect(run.savedCount).toBe(15)
    expect(scrolls).toBe(1)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].snapshot).toMatchObject({
      encryptJobId: '0',
      skills: ['AI'],
      gps: { longitude: 121, latitude: 31 },
    })
  })

  it('notifies running counters and saves each batch before scrolling', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    const count = computed(() => ctx.collectionRun.value?.newCount ?? 0)
    const seen: number[] = []
    const stopWatch = watchSyncEffect(() => {
      seen.push(count.value)
    })
    let runningCount = -1
    Object.assign(ctx, {
      scrollDown() {
        expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(1)
        expect(data.get(COLLECTION_RUN_STORAGE_KEY)).toHaveLength(1)
      },
      waitForNewJobs: async () => {
        runningCount = count.value
        ctx.stopCollection()
        return false
      },
    })
    const run = await ctx.collectOnly()
    stopWatch()
    expect(runningCount).toBe(1)
    expect(seen).toContain(1)
    expect(run.status).toBe('stopped')
    expect(data.get(COLLECTION_RUN_STORAGE_KEY)).toMatchObject([{ status: 'stopped', newCount: 1 }])
  })

  it('initializes collection data even when the realtime pagination hook fails', async () => {
    const ctx = context()
    const calls: string[] = []
    Object.assign(ctx, {
      _initJobList: async () => {
        calls.push('list')
        ctx._jobList.value = [item('a')]
      },
      _initPage: async () => {},
      _initPageChange: async () => {
        calls.push('pagination')
        throw new Error('unsupported pagination')
      },
    })
    await expect(ctx.onMount('/web/geek/jobs')).rejects.toThrow('unsupported pagination')
    expect(calls).toEqual(['list', 'pagination'])
    expect(ctx._jobList.value).toHaveLength(1)
  })

  it('mounts headlessly and hooks each route once even with concurrent mount requests', async () => {
    const ctx = context()
    const calls: string[] = []
    Object.assign(ctx, {
      _initJobList: async () => {
        calls.push('list')
      },
      _initPage: async () => {},
      _initPageChange: async () => {},
      _initJobDetail: async () => {
        calls.push('detail')
      },
      _initClickJobCardAction: async () => {
        calls.push('click')
      },
      initNetConf() {},
      scheduleBackgroundDetailCompletion() {},
      loadKeywordRotation: async () => {
        calls.push('rotation')
      },
    })
    document.createElement = () => {
      throw new Error('visible UI must not mount')
    }
    await Promise.all([ctx.onMount('/web/geek/jobs'), ctx.onMount('/web/geek/jobs')])
    await ctx.onMount('/web/geek/jobs')
    expect(calls).toEqual(['list', 'detail', 'click', 'rotation'])
    await ctx.onMount('/web/geek/job-recommend')
    expect(calls).toEqual(['list', 'detail', 'click', 'rotation', 'list', 'detail', 'click'])
    ctx._initPageChange = async () => {
      throw new Error('route unavailable')
    }
    await expect(ctx.onMount('/web/geek/chat')).rejects.toThrow('route unavailable')
    ctx._initPageChange = async () => {}
    await ctx.onMount('/web/geek/job-recommend')
    expect(calls.filter((call) => call === 'list')).toHaveLength(4)
  })

  it('finds a scrolling ancestor of the list instead of an unrelated document root', () => {
    const ctx = context()
    const parent = {
      scrollTop: 0,
      scrollHeight: 1500,
      clientHeight: 500,
      overflowY: 'auto',
      parentElement: null,
    }
    selectors.set('.job-list-container', {
      scrollHeight: 1500,
      clientHeight: 1500,
      overflowY: 'visible',
      parentElement: parent,
    })
    expect(ctx['getScrollTarget']()).toBe(parent)
  })

  it('does not treat the first idle bottom as completion while more jobs can load', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    root.scrollTop = 1200
    let rounds = 0
    Object.assign(ctx, {
      waitForNewJobs: async () => {
        rounds++
        if (rounds === 2) {
          ctx._jobList.value = [item('b')]
          return true
        }
        if (rounds === 3) ctx.stopCollection()
        return false
      },
    })
    const run = await ctx.collectOnly()
    expect(run.status).toBe('stopped')
    expect(run.newCount).toBe(2)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(2)
  })

  it('releases the run lock after persistence fails so a later retry can start', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    setStored = async () => {
      throw new Error('storage unavailable')
    }
    const failed = await ctx.collectOnly()
    expect(failed.status).toBe('unknown_error')
    expect(failed.error).toContain('storage unavailable')
    setStored = async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    }
    Object.assign(ctx, {
      waitForNewJobs: async () => {
        ctx.stopCollection()
        return false
      },
    })
    const retried = await ctx.collectOnly()
    expect(retried.id).not.toBe(failed.id)
    expect(retried.savedCount).toBe(1)
  })

  it('reports a stalled storage response and prevents another run until it settles', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    let release!: (value: unknown) => void
    getStored = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const nativeTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn, ms, ...args) =>
      nativeTimeout(fn, ms === 8000 ? 10 : ms, ...args)) as typeof setTimeout
    try {
      const failed = await ctx.collectOnly()
      expect(failed.status).toBe('unknown_error')
      expect(failed.error).toContain('超时')
      expect(ctx.collectionRun.value?.visibleCount).toBe(1)
      expect(await ctx.collectOnly()).toBe(failed)
      release([])
      await new Promise((resolve) => nativeTimeout(resolve, 0))
      getStored = async (key, fallback) => data.get(key) ?? fallback
      Object.assign(ctx, {
        waitForNewJobs: async () => {
          ctx.stopCollection()
          return false
        },
      })
      expect((await ctx.collectOnly()).id).not.toBe(failed.id)
    } finally {
      globalThis.setTimeout = nativeTimeout
      release?.([])
    }
  })

  it('stops during a pending save without scrolling and can restart after acknowledgement', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    let release!: () => void
    let announce!: () => void
    const saving = new Promise<void>((resolve) => {
      announce = resolve
    })
    setStored = async (key, value) => {
      if (key === JOB_LIBRARY_STORAGE_KEY) {
        announce()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      data.set(key, JSON.parse(JSON.stringify(value)))
    }
    let scrolls = 0
    Object.assign(ctx, {
      scrollDown: () => {
        scrolls++
      },
    })
    const task = ctx.collectOnly()
    await saving
    ctx.stopCollection()
    expect(ctx.collectionRunning.value).toBe(false)
    release()
    expect((await task).status).toBe('stopped')
    expect(scrolls).toBe(0)
    setStored = async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    }
    Object.assign(ctx, {
      waitForNewJobs: async () => {
        ctx.stopCollection()
        return false
      },
    })
    const retry = await ctx.collectOnly()
    expect(retry.id).not.toBe((await task).id)
    expect(retry.savedCount).toBe(1)
    expect(retry.newCount).toBe(0)
    expect(scrolls).toBe(1)
  })

  it.each(['append', 'virtual'])(
    'collects over 300 jobs from a %s list without sending',
    async (mode) => {
      const ctx = context()
      ctx._jobList.value = Array.from({ length: 200 }, (_, i) => item(String(i)))
      let rounds = 0
      Object.assign(ctx, {
        start: () => {
          throw new Error('must not deliver')
        },
        sendMessage: () => {
          throw new Error('must not send')
        },
        scrollDown() {},
        waitForNewJobs: async () => {
          if (++rounds === 1) {
            const next = Array.from({ length: 150 }, (_, i) => item(String(200 + i)))
            ctx._jobList.value = mode === 'append' ? [...ctx._jobList.value, ...next] : next
            return true
          }
          ctx.stopCollection()
          return false
        },
      })
      const run = await ctx.collectOnly()
      expect(run.newCount).toBe(350)
      expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(350)
    },
  )

  it.each([
    ['captcha', '请完成安全验证'],
    ['login_required', '登录过期，请先登录'],
    ['network_error', '网络异常'],
  ])('records %s without scrolling or reporting completion', async (status, text) => {
    const ctx = context()
    document.body.innerText = text
    Object.assign(ctx, {
      scrollDown: () => {
        throw new Error('must not scroll')
      },
    })
    expect((await ctx.collectOnly()).status).toBe(status)
  })

  it('only reports completion after idle retries and a confirmed no-more signal', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    ctx._pageHasMore.value = false
    root.scrollTop = 1200
    let rounds = 0
    Object.assign(ctx, {
      waitForNewJobs: async () => {
        rounds++
        return false
      },
    })
    expect((await ctx.collectOnly()).status).toBe('completed')
    expect(rounds).toBe(3)
  })

  it('reports an unreadable list without calling it an empty completed search', async () => {
    const ctx = context()
    Object.assign(ctx, {
      waitForNewJobs: async () => false,
      scrollDown: () => {
        throw new Error('must not scroll')
      },
    })
    const run = await ctx.collectOnly()
    expect(run.status).toBe('unknown_error')
    expect(run.error).toContain('未读取到岗位列表')
    expect(run.savedCount).toBe(0)
  })
})

describe('collection pacing, controls and persistence', () => {
  it('merges new interval defaults into old presets and preserves saved custom settings', () => {
    const old = deepmerge(defaultFormData, { delayDeliveryInterval: 20 })
    expect(old.delayCollectionScrollMin).toBe(1)
    expect(old.delayCollectionDetailMax).toBe(5)
    expect(old.delayDeliveryInterval).toBe(20)
    const saved = structuredClone({ delayCollectionDetailMin: 0.5, delayCollectionDetailMax: 1.5 })
    const restored = deepmerge(defaultFormData, saved)
    expect(restored.delayCollectionDetailMin).toBe(0.5)
    expect(restored.delayCollectionDetailMax).toBe(1.5)
  })
  it('uses custom fractional intervals and rejects invalid or reversed ranges', () => {
    const ctx = context()
    conf.formData.delayCollectionScrollMin = 0.5
    conf.formData.delayCollectionScrollMax = 0.5
    conf.formData.delayCollectionDetailMin = 1.5
    conf.formData.delayCollectionDetailMax = 1.5
    expect(ctx['collectionDelay']('Scroll')).toBe(500)
    expect(ctx['collectionDelay']('Detail')).toBe(1500)
    for (const [min, max] of [
      [0, 2],
      [3, 1],
      [NaN, 3],
      [1, Infinity],
      [1, 4000],
    ]) {
      conf.formData.delayCollectionScrollMin = min
      conf.formData.delayCollectionScrollMax = max
      expect(() => ctx['collectionDelay']('Scroll')).toThrow('采集间隔')
    }
  })

  it('keeps malformed saved data intact and reports a read error', async () => {
    data.set(JOB_LIBRARY_STORAGE_KEY, { unexpected: true })
    const ctx = context()
    await ctx.refreshJobLibrarySummary()
    expect(ctx.jobLibraryError.value).toContain('格式异常')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual({ unexpected: true })
  })
  it('reads all 300 saved jobs in a fresh page context without resetting them', async () => {
    data.set(
      JOB_LIBRARY_STORAGE_KEY,
      mergeJobRecords(
        [],
        Array.from({ length: 300 }, (_, i) => item(String(i))),
        'AI',
        'old',
      ).records,
    )
    const fresh = context()
    await fresh.refreshJobLibrarySummary()
    expect(fresh.jobLibrarySummary.value).toMatchObject({ total: 300, pending: 300 })
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(300)
    expect(fresh.collectionRun.value).toBeNull()
  })

  it('uses the configured interval before scrolling, even if new jobs are already available', async () => {
    const ctx = context()
    ctx._jobList.value = [item('a')]
    const waits: number[] = []
    Object.assign(ctx, {
      waitForGathering: async (ms: number) => {
        waits.push(ms)
        return true
      },
      scrollDown() {},
      waitForNewJobs: async () => {
        ctx.stopCollection()
        return true
      },
    })
    await ctx.collectOnly()
    expect(waits.some((ms) => ms >= 1000 && ms <= 2000)).toBe(true)
  })

  it('does not restart the visual loader while polling for new jobs', async () => {
    const ctx = context()
    await ctx['waitForNewJobs'](new Set(), 1)
    expect(visualDelayCalls).toBe(0)
  })

  it('uses varying scroll distances within a partial viewport', () => {
    const ctx = context()
    const random = Math.random
    try {
      Math.random = () => 0
      ctx['scrollDown'](root)
      const first = root.scrollTop
      root.scrollTop = 0
      Math.random = () => 0.99
      ctx['scrollDown'](root)
      expect(first).toBeGreaterThanOrEqual(360)
      expect(root.scrollTop).toBeLessThanOrEqual(600)
      expect(first).not.toBe(root.scrollTop)
    } finally {
      Math.random = random
    }
  })

  it('pauses after saving and resumes the same run before any scroll', async () => {
    const ctx = new BossHelperCtx()
    ctx._jobList.value = [item('a')]
    let announce!: () => void
    const paused = new Promise<void>((resolve) => {
      announce = resolve
    })
    setStored = async (key, value) => {
      data.set(key, structuredClone(value))
      if (key === JOB_LIBRARY_STORAGE_KEY) {
        ctx.pauseGathering()
        announce()
      }
    }
    let scrolls = 0
    const wait = ctx['waitForGathering'].bind(ctx)
    Object.assign(ctx, {
      waitForGathering: (_ms: number, run) => wait(0, run),
      scrollDown() {
        scrolls++
        ctx.stopCollection()
      },
    })
    const task = ctx.collectOnly()
    await paused
    const id = ctx.collectionRun.value.id
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ctx.collectionRun.value.status).toBe('paused')
    expect(scrolls).toBe(0)
    ctx.resumeGathering()
    expect((await task).id).toBe(id)
    expect(scrolls).toBe(1)
  })

  it('rejects resume after the search conditions change', async () => {
    const ctx = new BossHelperCtx()
    ctx._jobList.value = [item('a')]
    Object.assign(ctx, {
      scrollDown() {
        throw new Error('must not scroll')
      },
    })
    setStored = async (key, value) => {
      data.set(key, structuredClone(value))
      if (key === JOB_LIBRARY_STORAGE_KEY) {
        ctx.pauseGathering()
        location.href = 'https://www.zhipin.com/web/geek/jobs?query=other'
        ctx.resumeGathering()
      }
    }
    const result = await ctx.collectOnly()
    expect(result.status).toBe('unknown_error')
    expect(result.error).toContain('搜索条件')
  })
})

describe('slow collected detail batches', () => {
  it('cancels the existing detail poll after a click without leaking an interval', async () => {
    const ctx = context()
    ctx.jobMaps.set('boss::a', { rawData: { jobitem: { ...item('a'), lid: 'lid-a' }, detail: {} } })
    let clicked = false
    Object.assign(ctx, {
      _clickJobCardAction() {
        clicked = true
      },
    })
    await expect(ctx.onJobCardClick('boss::a', () => clicked)).rejects.toThrow('已停止')
    expect(clicked).toBe(true)
  })
  function detailContext(count = 6) {
    const ctx = context()
    const records = mergeJobRecords(
      [],
      Array.from({ length: count }, (_, i) => item(String(i))),
      'AI',
      'old',
    ).records
    data.set(JOB_LIBRARY_STORAGE_KEY, records)
    for (const record of records)
      ctx.jobMaps.set(record.key, {
        rawData: {
          detail: { lid: record.encryptJobId, jobInfo: { postDescription: 'Saved JD' } },
          jobitem: record.snapshot,
        },
      })
    return ctx
  }

  it('waits before every detail including the first, limits the batch to 5 and keeps latest review/send state', async () => {
    const ctx = detailContext()
    const waits: number[] = []
    const clicks: string[] = []
    Object.assign(ctx, {
      waitForGathering: async (ms: number) => {
        if (ms) waits.push(ms)
        return true
      },
      onJobCardClick: async (key: string) => {
        expect(waits.length).toBe(clicks.length + 1)
        clicks.push(key)
        const records = data.get(JOB_LIBRARY_STORAGE_KEY)
        records[0].reviewStatus = 'approved'
        records[0].sendStatus = 'sent'
        records[0].finalGreeting = 'approved text'
        records[0].analysis = { scoringVersion: 'weighted-v1', passed: true }
      },
    })
    const task = ctx.completeCollectedDetails()
    const other = ctx.completeCollectedDetails()
    const result = await task
    await other
    expect(result.completed).toBe(5)
    expect(clicks).toHaveLength(5)
    expect(waits.every((ms) => ms >= 2000 && ms <= 5000)).toBe(true)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      reviewStatus: 'approved',
      sendStatus: 'sent',
      finalGreeting: 'approved text',
      detailStatus: 'complete',
    })
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[5].detailStatus).toBe('pending')
    expect(ctx.gatheringBusy.value).toBe(false)
  })

  it('stops during a paused pre-click wait without starting any detail request', async () => {
    const ctx = detailContext(1)
    const wait = BossHelperCtx.prototype['waitForGathering'].bind(ctx)
    let announce!: () => void
    const paused = new Promise<void>((resolve) => {
      announce = resolve
    })
    Object.assign(ctx, {
      waitForGathering: (ms, run) => {
        if (ms) {
          ctx.pauseGathering()
          announce()
        }
        return wait(0, run)
      },
      onJobCardClick: async () => {
        throw new Error('must not click')
      },
    })
    const task = ctx.completeCollectedDetails()
    await paused
    ctx.stopGathering()
    await task
    expect(ctx.detailRun.value.status).toBe('stopped')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detailStatus).toBe('pending')
  })

  it.each(['请完成安全验证', '操作过于频繁', '登录过期，请先登录'])(
    'stops the whole detail batch on %s before clicking',
    async (text) => {
      const ctx = detailContext(1)
      document.body.innerText = text
      Object.assign(ctx, {
        onJobCardClick: async () => {
          throw new Error('must not click')
        },
      })
      await ctx.completeCollectedDetails()
      expect(ctx.detailRun.value.status).not.toBe('completed')
      expect(ctx.detailRun.value.status).not.toBe('running')
      expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detailStatus).toBe('pending')
    },
  )

  it('persists unavailable jobs as retryable without changing approval or send records', async () => {
    const ctx = detailContext(1)
    ctx.jobMaps.clear()
    const result = await ctx.completeCollectedDetails()
    expect(result.failed).toBe(1)
    expect(result.retryable).toBe(1)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
      detailStatus: 'failed',
      reviewStatus: 'pending',
      sendStatus: 'pending',
    })
  })

  it('continues available jobs before unavailable retry records', async () => {
    const ctx = detailContext(6)
    for (let i = 0; i < 5; i++) ctx.jobMaps.delete(`boss::${i}`)
    const clicks: string[] = []
    Object.assign(ctx, {
      onJobCardClick: async (key) => {
        clicks.push(key)
      },
    })
    await ctx.completeCollectedDetails()
    expect(clicks).toEqual(['boss::5'])
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[5].detailStatus).toBe('complete')
  })

  it('background detail batches only process jobs still present on the current page', async () => {
    const ctx = detailContext(2)
    ctx.jobMaps.delete('boss::1')
    const clicks: string[] = []
    Object.assign(ctx, { onJobCardClick: async (key) => clicks.push(key) })

    const result = await ctx.completeCollectedDetails({ availableOnly: true })

    expect(result.completed).toBe(1)
    expect(clicks).toEqual(['boss::0'])
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[1].detailStatus).toBe('pending')
  })

  it('stops the remaining batch if the page becomes restricted during a detail click', async () => {
    const ctx = detailContext(2)
    const clicks: string[] = []
    Object.assign(ctx, {
      onJobCardClick: async (key, shouldStop) => {
        clicks.push(key)
        document.body.innerText = '访问过于频繁'
        if (shouldStop()) throw new Error('详情补全已停止')
      },
    })
    await ctx.completeCollectedDetails()
    expect(clicks).toEqual(['boss::0'])
    expect(ctx.detailRun.value.status).toBe('restricted')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detailStatus).toBe('failed')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[1].detailStatus).toBe('pending')
  })

  it('does not leave a last-record pause orphaned when the batch finishes saving', async () => {
    const ctx = detailContext(1)
    let announce!: () => void
    const paused = new Promise<void>((resolve) => {
      announce = resolve
    })
    const wait = BossHelperCtx.prototype['waitForGathering'].bind(ctx)
    Object.assign(ctx, {
      onJobCardClick: async () => {},
      waitForGathering: (ms, run) => wait(0, run),
    })
    setStored = async (key, value) => {
      data.set(key, structuredClone(value))
      if (key === JOB_LIBRARY_STORAGE_KEY) {
        ctx.pauseGathering()
        announce()
      }
    }
    const task = ctx.completeCollectedDetails()
    await paused
    expect(ctx.gatheringBusy.value).toBe(true)
    expect(ctx.detailRun.value.status).toBe('paused')
    ctx.resumeGathering()
    expect((await task).status).toBe('completed')
    expect(ctx.gatheringBusy.value).toBe(false)
  })

  it('runs each keyword in order and persists a completed rotation', async () => {
    const ctx = context()
    const analyzed: string[] = []
    ctx.rootVue = {
      $router: {
        push: async ({ query }) => {
          const url = new URL(location.href)
          url.search = new URLSearchParams(query).toString()
          location.href = url.toString()
        },
      },
    }
    Object.assign(ctx, {
      savedAnalyzer: {
        start: async () => {
          analyzed.push(new URL(location.href).searchParams.get('query') ?? '')
          return { status: 'completed' }
        },
      },
    })

    const result = await ctx.startKeywordRotation('产品经理\nAI产品经理\n产品经理')

    expect(analyzed).toEqual(['产品经理', 'AI产品经理'])
    expect(result.status).toBe('completed')
    expect(result.cursor).toBe(2)
    expect(data.get(KEYWORD_ROTATION_STORAGE_KEY)).toMatchObject({
      status: 'completed',
      items: [
        { keyword: '产品经理', status: 'completed' },
        { keyword: 'AI产品经理', status: 'completed' },
      ],
    })
  })

  it('keeps the failed keyword as the rotation cursor', async () => {
    const ctx = context()
    ctx.rootVue = {
      $router: {
        push: async ({ query }) => {
          const url = new URL(location.href)
          url.search = new URLSearchParams(query).toString()
          location.href = url.toString()
        },
      },
    }
    Object.assign(ctx, {
      savedAnalyzer: {
        start: async () => ({ status: 'failed', error: '模型请求失败' }),
      },
    })

    const result = await ctx.startKeywordRotation('产品经理\nAI产品经理')

    expect(result.status).toBe('failed')
    expect(result.cursor).toBe(0)
    expect(result.items[0]).toMatchObject({ keyword: '产品经理', status: 'failed' })
    expect(result.items[1]).toMatchObject({ keyword: 'AI产品经理', status: 'pending' })
  })
})
