// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ref } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { parseGptJson } from '../../utils/ai'
import { jsonClone } from '../../utils/deepmerge'
import { mergeJobRecords } from './jobStore'

let respond: (role: string, data: any) => Promise<string>
let requests: Array<{ role: string; id: string }>
let agentConfigs: Array<{ name: string; config: any }>
let chatSnapshots: string[]
mock.module('@/message', () => ({ counter: {} }))
mock.module('@/utils/ai', () => ({ parseGptJson }))
mock.module('@/composables/useModel/chatModel', () => ({
  ChatModel: class {
    constructor(
      public host: any,
      resumeText?: string,
    ) {
      chatSnapshots.push(resumeText ?? '')
    }
    createAgent(config: any, name: string) {
      agentConfigs.push({ name, config: jsonClone(config) })
      return this.host.models.modelData.value.some((model: any) => model.key === config.model)
    }
    async chat(role: string, data: any, options: any) {
      expect(options.disableMessages).toBe(true)
      requests.push({ role, id: data.rawData.encryptJobId })
      return { text: await respond(role, data) }
    }
  },
}))
const { isSavedJobEligible, SavedJobAnalyzer } = await import('./savedAnalysis')

const filtering = JSON.stringify({
  positive: [{ score: 20, reason: '符合既有筛选标准' }],
  negative: [],
})
const forbidden = () => {
  throw new Error('must not access BOSS or send messages')
}

function fixture(count = 2) {
  const records = mergeJobRecords(
    [],
    Array.from({ length: count }, (_, index) => ({
      encryptJobId: String(index),
      jobName: `岗位${index}`,
      skills: [],
    })),
    'AI',
    'batch',
  ).records
  for (const record of records) {
    record.detailStatus = 'complete'
    record.detail = {
      jobInfo: {
        encryptId: record.encryptJobId,
        jobName: record.snapshot.jobName,
        postDescription: '完整岗位职责与要求',
      },
    }
  }
  const saves: any[] = []
  const host = {
    conf: {
      formData: {
        aiFiltering: {
          enable: false,
          model: 'original-filter',
          score: 10,
          prompt: [{ role: 'system', content: '真实筛选标准与简历摘要' }],
        },
        aiGreeting: {
          enable: false,
          model: 'original-greeting',
          prompt: [{ role: 'system', content: '真实招呼语标准与简历摘要' }],
        },
        resumeText: '',
      },
    },
    resumes: {
      currentResume: ref({
        id: 'resume-a',
        name: '主简历',
        content: '主简历正文 A',
      }),
    },
    models: {
      modelData: ref([
        {
          key: 'selected',
          name: '已配置模型',
          data: {
            model: 'test-model',
            api_key: 'fake-key',
            base_url: 'https://model.invalid',
            other: { timeout: 100 },
          },
        },
      ]),
    },
    gatheringBusy: ref(false),
    realtimeBusy: ref(false),
    workflow: { status: ref('idle') },
    hasPendingCollectionStorage: false,
    getJobLibrary: async () => jsonClone(records),
    getSavedJobData: (record: any) => ({
      jobData: {
        key: record.key,
        jobName: record.snapshot.jobName,
        jobDescription: record.detail.jobInfo.postDescription,
      },
      rawData: record,
      state: {},
    }),
    saveJobAnalysis: async (id: string, patch: any) => {
      const record = records.find((item: any) => item.encryptJobId === id)
      if (
        !record ||
        record.analysisStatus === 'ready' ||
        record.reviewStatus !== 'pending' ||
        record.sendStatus !== 'pending'
      )
        return false
      Object.assign(record, jsonClone(patch))
      saves.push({ id, patch: jsonClone(patch) })
      return true
    },
    onJobCardClick: forbidden,
    sendMessage: forbidden,
    collectOnly: forbidden,
    start: forbidden,
    chatModel: { createAgent: forbidden, chat: forbidden },
  }
  return { records, saves, host, analyzer: new SavedJobAnalyzer(host) }
}

beforeEach(() => {
  requests = []
  agentConfigs = []
  chatSnapshots = []
  respond = async (role) => (role === 'filtering' ? filtering : '已有提示词生成的招呼语')
})

describe('local batch analysis interface', () => {
  it.each([
    '../../components/AI/BatchAnalysis.vue',
    '../../components/Tabs/AI.vue',
    '../../components/CollectionControls.vue',
  ])('compiles the Vue script and template for %s', (relativePath) => {
    const componentPath = fileURLToPath(new URL(relativePath, import.meta.url))
    const { descriptor } = parse(readFileSync(componentPath, 'utf8'))
    const script = compileScript(descriptor, { id: componentPath })
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: componentPath,
      id: componentPath,
      compilerOptions: { bindingMetadata: script.bindings },
    })
    expect(template.errors).toEqual([])
  })
})

describe('saved job analysis', () => {
  it('skips excluded jobs in batch analysis', async () => {
    const { analyzer, records } = fixture(2)
    records[0].processingStatus = 'excluded'

    const run = await analyzer.start({ modelKey: 'selected', limit: 20 })

    expect(run).toMatchObject({ status: 'completed', total: 1, completed: 1, skipped: 0 })
    expect(requests.map((request) => request.id)).toEqual(['1', '1'])
    expect(records[0].analysisStatus).toBe('pending')
    expect(isSavedJobEligible(records[0])).toBe(false)
  })

  it('analyzes collected jobs immediately with one resume snapshot before the next collection step', async () => {
    const { analyzer, host, records } = fixture(2)
    const events: string[] = []
    host.collectOnly = async (_keyword, analyze) => {
      host.gatheringBusy.value = true
      host.gatheringKind = ref('collection')
      for (const record of records) {
        await analyze(record)
        events.push(`continue:${record.encryptJobId}`)
        host.resumes.currentResume.value = { id: 'other', name: 'Other', content: 'Other resume' }
      }
      host.gatheringBusy.value = false
      return { status: 'completed' }
    }
    host.waitForCollectionAnalysis = async () => true
    respond = async (role, data) => {
      events.push(`${role}:${data.rawData.encryptJobId}`)
      return role === 'filtering' ? filtering : '草稿'
    }
    const run = await analyzer.start({ modelKey: 'selected', collectNew: true })
    expect(run).toMatchObject({ status: 'completed', total: 2, completed: 2 })
    expect(events).toEqual([
      'filtering:0',
      'greetings:0',
      'continue:0',
      'filtering:1',
      'greetings:1',
      'continue:1',
    ])
    expect(chatSnapshots).toEqual(['主简历正文 A'])
    expect(records.map((record) => record.analysis.resumeId)).toEqual(['resume-a', 'resume-a'])
    expect(analyzer.collecting.value).toBe(false)
  })

  it('halts collection analysis before greeting when collection is restricted', async () => {
    const { analyzer, host, records } = fixture(2)
    let allowed = true
    host.waitForCollectionAnalysis = async () => allowed
    host.stopCollection = () => {}
    host.collectOnly = async (_keyword, analyze) => {
      host.gatheringKind = ref('collection')
      host.gatheringBusy.value = true
      await analyze(records[0])
      host.gatheringBusy.value = false
      return { status: 'restricted', error: '页面提示访问限制，已停止' }
    }
    respond = async () => {
      allowed = false
      return filtering
    }
    const run = await analyzer.start({ modelKey: 'selected', collectNew: true })
    expect(run.status).toBe('failed')
    expect(run.error).toContain('访问限制')
    expect(requests.map((request) => request.role)).toEqual(['filtering'])
    expect(records[0].analysis.rating).toBe(20)
    expect(records[1].analysisStatus).toBe('pending')
  })

  it('does not begin collection with invalid model or resume configuration', async () => {
    const { analyzer, host } = fixture()
    host.resumes.currentResume.value = null
    await expect(analyzer.start({ modelKey: 'selected', collectNew: true })).rejects.toThrow('简历')
    expect(requests).toEqual([])
  })

  it('processes twenty saved jobs serially and immediately saves analysis and greetings without sending', async () => {
    const { analyzer, records, saves } = fixture(25)
    respond = async (role, data) => {
      if (role === 'filtering' && data.rawData.encryptJobId !== '0')
        expect(saves).toHaveLength(Number(data.rawData.encryptJobId))
      return role === 'filtering' ? filtering : '招呼语草稿'
    }
    const run = await analyzer.start({ modelKey: 'selected', limit: 20 })
    expect(run).toMatchObject({ status: 'completed', total: 20, completed: 20, failed: 0 })
    expect(records.filter((record) => record.analysisStatus === 'ready')).toHaveLength(20)
    expect(records[0]).toMatchObject({
      analysis: { rating: 20, passed: true },
      finalGreeting: '招呼语草稿',
      reviewStatus: 'pending',
      sendStatus: 'pending',
    })
    expect(requests).toHaveLength(40)
    expect(analyzer.busy.value).toBe(false)
  })

  it('skips ready, reviewed, queued, incomplete and empty-JD records', async () => {
    const { analyzer, records } = fixture(6)
    records[0].analysisStatus = 'ready'
    records[1].reviewStatus = 'approved'
    records[2].sendStatus = 'queued'
    records[3].detailStatus = 'pending'
    records[4].detail.jobInfo.postDescription = '  '
    const run = await analyzer.start({ modelKey: 'selected', limit: 20 })
    expect(run.total).toBe(1)
    expect(requests.map((request) => request.id)).toEqual(['5', '5'])
  })

  it('uses the selected model for cloned prompts and does not mutate configuration', async () => {
    const { analyzer, host } = fixture(1)
    const before = JSON.stringify(host.conf)
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(agentConfigs.map((config) => config.config.model)).toEqual(['selected', 'selected'])
    expect(agentConfigs.map((config) => config.config.enable)).toEqual([true, true])
    expect(JSON.stringify(host.conf)).toBe(before)
  })

  it('fixes the current resume snapshot and records its metadata for the batch', async () => {
    const { analyzer, records, host } = fixture(2)
    let switched = false
    respond = async () => {
      if (!switched) {
        switched = true
        host.resumes.currentResume.value = {
          id: 'resume-b',
          name: '备用简历',
          content: '备用简历正文 B',
        }
      }
      return filtering
    }
    await analyzer.start({ modelKey: 'selected', limit: 2 })
    expect(chatSnapshots).toEqual(['主简历正文 A'])
    expect(records[0].analysis).toMatchObject({ resumeId: 'resume-a', resumeName: '主简历' })
    expect(records[1].analysis).toMatchObject({ resumeId: 'resume-a', resumeName: '主简历' })
  })

  it.each([{ api_key: 123 }, { base_url: {} }, { model: false }])(
    'rejects malformed stored model fields before requests or writes: %j',
    async (data) => {
      const { analyzer, host, records } = fixture(1)
      Object.assign(host.models.modelData.value[0].data, data)
      await expect(analyzer.start({ modelKey: 'selected', limit: 1 })).rejects.toThrow(/配置/)
      expect(requests).toEqual([])
      expect(records[0].analysisStatus).toBe('pending')
      expect(analyzer.busy.value).toBe(false)
    },
  )

  it('keeps below-threshold decisions ready without generating a greeting', async () => {
    const { analyzer, records } = fixture(1)
    respond = async () =>
      JSON.stringify({ positive: [], negative: [{ score: 5, reason: '不符合原规则' }] })
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(records[0]).toMatchObject({
      analysisStatus: 'ready',
      analysis: { rating: -5, passed: false },
    })
    expect(requests.map((request) => request.role)).toEqual(['filtering'])
  })

  it.each([
    '{"positive":[],"negative":[]',
    '{}',
    '{"positive":[{"score":"20","reason":"文字"}],"negative":[]}',
    '{"positive":[],"negative":[{"score":1e400,"reason":"文字"}]}',
  ])('rejects invalid model JSON %s without marking ready', async (text) => {
    const { analyzer, records } = fixture(1)
    respond = async () => text
    const run = await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(run.failed).toBe(1)
    expect(records[0].analysisStatus).toBe('failed')
    expect(records[0].analysisFailureReason).toBeTruthy()
    expect(records[0].finalGreeting).toBeUndefined()
  })

  it('marks the batch failed when the model bridge rejects with Failed to fetch', async () => {
    const { analyzer, records } = fixture(1)
    respond = async () => {
      throw new TypeError('Failed to fetch')
    }

    const run = await analyzer.start({ modelKey: 'selected', limit: 1 })

    expect(run).toMatchObject({ status: 'failed', failed: 1, error: 'Failed to fetch' })
    expect(records[0]).toMatchObject({
      analysisStatus: 'failed',
      analysisFailureReason: 'Failed to fetch',
    })
  })

  it('preserves partial filtering after a greeting failure and allows retry without rerunning ready jobs', async () => {
    const { analyzer, records } = fixture(1)
    respond = async (role) => {
      if (role === 'greetings') throw new Error('temporary model failure')
      return filtering
    }
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(records[0]).toMatchObject({
      analysisStatus: 'failed',
      analysis: { rating: 20 },
      analysisFailureReason: 'temporary model failure',
    })
    respond = async (role) => (role === 'filtering' ? filtering : '重试成功的草稿')
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(records[0]).toMatchObject({ analysisStatus: 'ready', finalGreeting: '重试成功的草稿' })
    const requestCount = requests.length
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(requests).toHaveLength(requestCount)
  })

  it('stops after the current filtering response and does not start greetings or another job', async () => {
    const { analyzer, records } = fixture(2)
    let release!: (text: string) => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    respond = async () => {
      started()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const pending = analyzer.start({ modelKey: 'selected', limit: 2 })
    await entered
    analyzer.stop()
    expect(analyzer.run.value.status).toBe('stopping')
    await expect(analyzer.start({ modelKey: 'selected', limit: 1 })).rejects.toThrow()
    release(filtering)
    const run = await pending
    expect(run).toMatchObject({ status: 'stopped', failed: 0, completed: 0, skipped: 1 })
    expect(records[0].analysis.rating).toBe(20)
    expect(records[0].analysisStatus).toBe('pending')
    expect(records[0].analysisFailureReason).toBeUndefined()
    expect(isSavedJobEligible(records[0])).toBe(true)
    expect(records[1].analysisStatus).toBe('pending')
    expect(requests.map((request) => request.role)).toEqual(['filtering'])
  })

  it('saves a valid in-flight greeting after stop and keeps the lock through its save', async () => {
    const { analyzer, records, host } = fixture(2)
    let release!: (text: string) => void
    let greeted!: () => void
    const entered = new Promise<void>((resolve) => {
      greeted = resolve
    })
    respond = async (role) => {
      if (role === 'filtering') return filtering
      greeted()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const save = host.saveJobAnalysis
    host.saveJobAnalysis = async (...args) => {
      expect(analyzer.busy.value).toBe(true)
      return save(...args)
    }
    const pending = analyzer.start({ modelKey: 'selected', limit: 2 })
    await entered
    analyzer.stop()
    release('停止时已完成的有效草稿')
    expect((await pending).status).toBe('stopped')
    expect(records[0]).toMatchObject({
      analysisStatus: 'ready',
      finalGreeting: '停止时已完成的有效草稿',
    })
    expect(requests).toHaveLength(2)
  })

  it('rechecks eligibility before greeting and before the next job', async () => {
    const { analyzer, records } = fixture(2)
    respond = async () => {
      records[0].reviewStatus = 'approved'
      records[1].analysisStatus = 'ready'
      return filtering
    }
    const run = await analyzer.start({ modelKey: 'selected', limit: 2 })
    expect(run.skipped).toBe(2)
    expect(requests).toHaveLength(1)
    expect(records[0].analysis).toBeUndefined()
  })

  it('stops the batch on an authentication failure after saving a visible failure', async () => {
    const { analyzer, records } = fixture(2)
    respond = async () => {
      throw Object.assign(new Error('model authorization failed'), { statusCode: 401 })
    }
    const run = await analyzer.start({ modelKey: 'selected', limit: 2 })
    expect(run).toMatchObject({ status: 'failed', failed: 1, error: 'model authorization failed' })
    expect(records[0].analysisStatus).toBe('failed')
    expect(records[1].analysisStatus).toBe('pending')
    expect(requests).toHaveLength(1)
  })

  it('stops the batch when the shared chat layer wraps a global model error as text', async () => {
    const { analyzer, records } = fixture(2)
    respond = async () => {
      throw new Error('请求错误 401: Unauthorized')
    }
    const run = await analyzer.start({ modelKey: 'selected', limit: 2 })
    expect(run.status).toBe('failed')
    expect(requests).toHaveLength(1)
    expect(records[0].analysisFailureReason).toContain('401')
  })

  it('does not repeat model requests after a storage write fails', async () => {
    const { analyzer, host } = fixture(2)
    host.saveJobAnalysis = async () => {
      throw new Error('保存超时')
    }
    const run = await analyzer.start({ modelKey: 'selected', limit: 2 })
    expect(run).toMatchObject({ status: 'failed', error: '保存超时' })
    expect(requests).toHaveLength(2)
    expect(analyzer.busy.value).toBe(false)
  })

  it('releases busy and reports an initial local read failure without model requests', async () => {
    const { analyzer, host } = fixture()
    host.getJobLibrary = async () => {
      throw new Error('本地读取失败')
    }
    const run = await analyzer.start({ modelKey: 'selected', limit: 2 })
    expect(run).toMatchObject({ status: 'failed', error: '本地读取失败' })
    expect(analyzer.busy.value).toBe(false)
    expect(requests).toEqual([])
  })

  it('rejects a missing current resume before any model request', async () => {
    const { analyzer, host } = fixture()
    host.resumes.currentResume.value = null
    await expect(analyzer.start({ modelKey: 'selected', limit: 2 })).rejects.toThrow('简历')
    expect(requests).toEqual([])
  })

  it.each([null, { id: 'empty', name: '空简历', content: '  ' }])(
    'does not analyze with legacy text when the current resume is absent or empty: %j',
    async (resume) => {
      const { analyzer, host } = fixture()
      host.resumes.currentResume.value = resume
      host.conf.formData.resumeText = '旧配置中保留的简历'
      await expect(analyzer.start({ modelKey: 'selected', limit: 1 })).rejects.toThrow('简历')
      expect(requests).toEqual([])
    },
  )

  it('uses the new selection for the next batch without rewriting saved analysis', async () => {
    const { analyzer, host, records } = fixture(2)
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    const history = jsonClone(records[0])
    host.resumes.currentResume.value = { id: 'resume-b', name: '备用简历', content: '正文 B' }
    await analyzer.start({ modelKey: 'selected', limit: 1 })
    expect(chatSnapshots).toEqual(['主简历正文 A', '正文 B'])
    expect(records[0]).toEqual(history)
    expect(records[1].analysis).toMatchObject({ resumeId: 'resume-b', resumeName: '备用简历' })
  })

  it.each(['gatheringBusy', 'realtimeBusy', 'hasPendingCollectionStorage', 'workflow'])(
    'refuses conflicting %s work before any model call',
    async (kind) => {
      const { analyzer, host } = fixture()
      if (kind === 'workflow') host.workflow.status.value = 'running'
      else if (kind === 'gatheringBusy' || kind === 'realtimeBusy') host[kind].value = true
      else host.hasPendingCollectionStorage = true
      await expect(analyzer.start({ modelKey: 'selected', limit: 20 })).rejects.toThrow()
      expect(requests).toEqual([])
    },
  )

  it('refuses unknown models and invalid batch sizes without touching records', async () => {
    const { analyzer, records } = fixture()
    await expect(analyzer.start({ modelKey: 'missing', limit: 20 })).rejects.toThrow()
    await expect(analyzer.start({ modelKey: 'selected', limit: 0 })).rejects.toThrow()
    expect(records.every((record) => record.analysisStatus === 'pending')).toBe(true)
    expect(requests).toEqual([])
  })

  it('analyzes only the requested saved job and keeps the current resume snapshot', async () => {
    const { analyzer, records } = fixture(3)

    const run = await analyzer.analyzeOne('1', 'selected')

    expect(run).toMatchObject({ status: 'completed', total: 1, completed: 1 })
    expect(requests.map((request) => request.id)).toEqual(['1', '1'])
    expect(records[0].analysisStatus).toBe('pending')
    expect(records[1]).toMatchObject({
      analysisStatus: 'ready',
      analysis: { resumeId: 'resume-a', resumeName: '主简历', rating: 20, passed: true },
      finalGreeting: '已有提示词生成的招呼语',
    })
    expect(records[2].analysisStatus).toBe('pending')
  })

  it('skips a single job without complete JD and does not call the model', async () => {
    const { analyzer, records } = fixture(1)
    records[0].detailStatus = 'pending'

    await expect(analyzer.analyzeOne(records[0].encryptJobId, 'selected')).rejects.toThrow('补全')
    expect(requests).toEqual([])
    expect(records[0].analysisStatus).toBe('pending')
  })

  it.each([
    { analysisStatus: 'ready' },
    { reviewStatus: 'approved' },
    { reviewStatus: 'rejected' },
    { sendStatus: 'queued' },
    { sendStatus: 'sent' },
    { sendStatus: 'unknown' },
  ])('refuses to overwrite a single job in protected state: %j', async (patch) => {
    const { analyzer, records, saves } = fixture(1)
    Object.assign(records[0], patch)

    await expect(analyzer.analyzeOne(records[0].encryptJobId, 'selected')).rejects.toThrow(
      '不能覆盖',
    )

    expect(requests).toEqual([])
    expect(saves).toEqual([])
  })

  it('reports a missing saved job instead of completing an empty single-job run', async () => {
    const { analyzer } = fixture(1)

    await expect(analyzer.analyzeOne('missing', 'selected')).rejects.toThrow('未找到')
    expect(requests).toEqual([])
  })
})
