// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it, mock } from 'bun:test'

import { ref } from 'vue'

import { handleExecutorMessage, isExecutorCommand } from '../../workbench/protocol'
import { createExecutorBridge } from './workbench'

let cacheClears = 0
mock.module('../../composables/useApplying', () => ({
  getCacheManager: () => ({
    clearCache: async () => {
      cacheClears++
    },
  }),
}))

function context() {
  return {
    collectionRun: ref(null),
    detailRun: ref(null),
    gatheringKind: ref('collection'),
    gatheringBusy: ref(false),
    keywordRotation: ref(null),
    keywordRotationKeywords: ref('AI'),
    keywordExtractionBusy: ref(false),
    keywordRotationBusy: ref(false),
    keywordRotationWaitSeconds: ref(0),
    keywordRotationSaving: ref(false),
    realtimeBusy: ref(false),
    autoCaptureEnabled: ref(false),
    savedAnalyzer: { busy: ref(false), run: ref(null) },
    workflow: null,
    currentJob: ref(null),
    jobList: ref([]),
    jobResultMaps: new Map(),
    _logs: ref([]),
    chatModel: { jobs: ref([]), states: new Map() },
    pendingMessages: ref(undefined),
    conf: { confInit: async () => {}, formData: { resumeText: '' } },
    resumes: { init: async () => {} },
    models: { initModel: async () => {} },
  }
}

describe('executor message boundary', () => {
  it.each([
    { type: 'constructor' },
    { type: 'analyze', limit: 0 },
    { type: 'analyze', limit: 1.2 },
    { type: 'setFunnel', jobId: 'a', stage: 'invalid' },
    { type: 'setProcessing', jobId: 'a', status: 'sent' },
    { type: 'setAutoCapture', enabled: 'true' },
    { type: 'selectJob', key: '' },
    { type: 'collect', method: 'sendMessage' },
    { type: 'saveKeywords', input: null },
  ])('rejects malformed or reflected commands: %j', (command) => {
    expect(isExecutorCommand(command)).toBe(false)
  })

  it('ignores unrelated runtime messages synchronously and rejects other senders', async () => {
    let calls = 0
    const bridge = { snapshot: async () => ++calls, command: async () => ++calls }
    const request = { type: 'boss-helper:executor', command: { type: 'collect' } }
    expect(handleExecutorMessage({ type: 'another-namespace' }, {}, 'own', bridge)).toBeUndefined()
    for (const sender of [{ id: 'other' }, { id: 'own', tab: { id: 1 } }, {}]) {
      expect(await handleExecutorMessage(request, sender, 'own', bridge)).toMatchObject({
        ok: false,
      })
    }
    expect(calls).toBe(0)
    expect(await handleExecutorMessage(request, { id: 'own' }, 'own', bridge)).toEqual({
      ok: true,
      data: 1,
    })
  })

  it('returns readable failures and does not forward invalid snapshot parameters', async () => {
    const bridge = {
      snapshot: async () => {
        throw new Error('not ready')
      },
      command: async () => {},
    }
    const send = (command) =>
      handleExecutorMessage({ type: 'boss-helper:executor', command }, { id: 'own' }, 'own', bridge)
    expect(await send({ type: 'snapshot' })).toEqual({ ok: false, error: 'not ready' })
    expect(await send({ type: 'snapshot', chatJobKey: 5 })).toMatchObject({ ok: false })
  })
})

describe('headless executor bridge', () => {
  it.each(['collectAnalyze', 'completeDetails'])(
    'rejects the removed %s task at both executor boundaries',
    async (type) => {
      const ctx = context()
      const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
      expect(isExecutorCommand({ type })).toBe(false)
      await expect(bridge.command({ type })).rejects.toThrow('Invalid executor command')
      expect(
        await handleExecutorMessage(
          { type: 'boss-helper:executor', command: { type } },
          { id: 'own' },
          'own',
          bridge,
        ),
      ).toEqual({ ok: false, error: 'Invalid executor command' })
    },
  )

  it('exposes the remaining keyword cooldown to both extension views', async () => {
    const ctx = context()
    ctx.keywordRotationBusy.value = true
    ctx.keywordRotationWaitSeconds.value = 45
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    expect(await bridge.snapshot()).toMatchObject({
      keywordRotationBusy: true,
      keywordRotationWaitSeconds: 45,
    })
  })

  it('clears the page cache singleton only when no business task is active', async () => {
    const ctx = context()
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    ctx.gatheringBusy.value = true
    await expect(bridge.command({ type: 'clearCache' })).rejects.toThrow()
    expect(cacheClears).toBe(0)
    ctx.gatheringBusy.value = false
    await bridge.command({ type: 'clearCache' })
    expect(cacheClears).toBe(1)
  })

  it('rejects reloading settings during active work and records mutation errors', async () => {
    const ctx = context()
    ctx.gatheringBusy.value = true
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    await expect(bridge.command({ type: 'reloadSettings' })).rejects.toThrow()
    ctx.gatheringBusy.value = false
    ctx.updateJobFunnelStage = async () => {
      throw new Error('write failed')
    }
    await expect(bridge.command({ type: 'setFunnel', jobId: 'a', stage: null })).rejects.toThrow(
      'write failed',
    )
    expect(await bridge.snapshot()).toMatchObject({ lastError: 'write failed' })
  })

  it('reports initialization errors and refuses commands until initialization succeeds', async () => {
    const state = { ready: false, error: 'storage failed', lastError: '' }
    const bridge = createExecutorBridge(context(), state)
    expect(await bridge.snapshot()).toMatchObject({ ready: false, error: 'storage failed' })
    await expect(bridge.command({ type: 'collect' })).rejects.toThrow('storage failed')
  })

  it('returns extracted keyword results and exposes explicit job opening and log clearing', async () => {
    const ctx = context()
    ctx.extractKeywordRotationFromResume = async () => ['AI products']
    let opened = ''
    ctx.onJobCardClick = async (key) => {
      opened = key
    }
    ctx._logs.value = [{ title: 'old' }]
    ctx.logs = {
      clear: () => {
        ctx._logs.value = []
      },
    }
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    expect(await bridge.command({ type: 'extractKeywords', input: 'resume' })).toEqual([
      'AI products',
    ])
    await bridge.command({ type: 'openJob', key: 'boss::a' })
    expect(opened).toBe('boss::a')
    await bridge.command({ type: 'clearLogs' })
    expect((await bridge.snapshot()).logs).toEqual([])
  })

  it('completes saved job details before single-job analysis uses its non-overwrite guard', async () => {
    const ctx = context()
    const events = []
    ctx.getJobLibrary = async () => [{ encryptJobId: 'a', detailStatus: 'pending' }]
    ctx.ensureSavedJobDetails = async (id) => {
      events.push(`detail:${id}`)
    }
    ctx.savedAnalyzer.analyzeOne = async (id) => {
      events.push(`analyze:${id}`)
    }
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    expect(await bridge.command({ type: 'analyzeOne', jobId: 'a' })).toEqual({ accepted: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['detail:a', 'analyze:a'])
  })

  it('acknowledges long work promptly, keeps it alive without a UI, and surfaces rejection', async () => {
    const ctx = context()
    let rejectWork
    ctx.collectOnly = () =>
      new Promise((_, reject) => {
        rejectWork = reject
      })
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    expect(await bridge.command({ type: 'collect' })).toEqual({ accepted: true })
    rejectWork(new Error('save failed'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await bridge.snapshot()).toMatchObject({ lastError: 'save failed' })
  })

  it('awaits mutation storage and selects chats without depending on a component', async () => {
    const ctx = context()
    let complete
    let settled = false
    ctx.updateJobFunnelStage = () =>
      new Promise((resolve) => {
        complete = resolve
      })
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    const change = bridge
      .command({ type: 'setFunnel', jobId: 'a', stage: 'interview' })
      .then(() => {
        settled = true
      })
    await Promise.resolve()
    expect(settled).toBe(false)
    complete(true)
    await change
    ctx.chatModel.jobs.value = ['boss::a']
    ctx.chatModel.states.set('boss::a', {
      messages: [{ id: 'a', uiRole: 'assistant', parts: [{ type: 'text', text: 'draft' }] }],
    })
    await bridge.command({ type: 'selectJob', key: 'boss::a' })
    expect(await bridge.snapshot()).toMatchObject({
      chatJobKey: 'boss::a',
      messages: [{ id: 'a' }],
    })
  })

  it('returns detached JSON data without model credentials, DOM or raw recruiter tokens', async () => {
    const ctx = context()
    ctx.models.api_key = 'secret'
    const circular = {}
    circular.self = circular
    ctx._logs.value = [
      {
        title: 'AI',
        state: 'info',
        state_name: 'AI',
        data: { el: circular, bossData: { token: 'secret' }, aiGreetingA: 'hello' },
      },
    ]
    const bridge = createExecutorBridge(ctx, { ready: true, error: '', lastError: '' })
    const result = await bridge.snapshot()
    expect(result.logs[0].data).toEqual({ aiGreetingA: 'hello' })
    expect(JSON.stringify(result)).not.toContain('secret')
    result.logs.length = 0
    expect(ctx._logs.value).toHaveLength(1)
    await expect(bridge.command({ type: 'constructor' })).rejects.toThrow()
  })
})
