// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { createRenderer, h, nextTick, reactive, ref, shallowReactive } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { mergeJobRecords } from '../../entrypoints/boss/jobStore'

const componentPath = fileURLToPath(new URL('./BatchAnalysis.vue', import.meta.url))
const source = readFileSync(componentPath, 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'batch-analysis-test' })
const built = await Bun.build({
  entrypoints: [componentPath],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'offline-batch-analysis',
      setup(build) {
        build.onLoad({ filter: /BatchAnalysis\.vue$/ }, () => ({
          contents: script.content,
          loader: 'ts',
        }))
        build.onLoad({ filter: /\.vue$/ }, () => ({
          contents: 'export default { render: () => null }',
          loader: 'js',
        }))
        build.onResolve({ filter: /^@\/composables\/useHelper$/ }, () => ({
          path: 'helper',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/entrypoints\/boss\/savedAnalysis$/ }, () => ({
          path: 'eligibility',
          namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'helper'
              ? 'export const useHelper = () => globalThis.__batchAnalysisHelper'
              : `export const isSavedJobEligible = (record) =>
                  record.detailStatus === 'complete' &&
                  !!record.detail?.jobInfo?.postDescription?.trim() &&
                  record.analysisStatus !== 'ready' &&
                  record.reviewStatus === 'pending' && record.sendStatus === 'pending'`,
          loader: 'js',
        }))
      },
    },
  ],
})
if (!built.success) throw new Error(built.logs.join('\n'))
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', await built.outputs[0].text())(
  createRequire(import.meta.url),
  compiledModule,
  compiledModule.exports,
)
const Component = compiledModule.exports.default
Component.render = () => null

const renderer = createRenderer({
  createElement: () => ({ children: [] }),
  createText: (text) => ({ text }),
  createComment: (text) => ({ text }),
  insert(node, parent) {
    node.parent = parent
    parent.children.push(node)
  },
  remove(node) {
    node.parent.children = node.parent.children.filter((child) => child !== node)
  },
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  setElementText() {},
  setText() {},
  patchProp() {},
})

const model = (key: string, data = {}) => ({
  key,
  name: `Model ${key}`,
  data: {
    api_key: 'fixture-key',
    base_url: 'https://model.invalid',
    model: `fixture-${key}`,
    ...data,
  },
})
let root
let helper
let saved
let reads
let starts
let completed
let runAnalysis

function mount() {
  const vnode = h(Component, { onCompleted: () => completed++ })
  renderer.render(vnode, root)
  return vnode.component.setupState
}

async function settled() {
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  root = { children: [] }
  reads = 0
  starts = []
  completed = 0
  saved = mergeJobRecords(
    [],
    Array.from({ length: 40 }, (_, index) => ({
      encryptJobId: `job-${index}`,
      jobName: `Position ${index}`,
    })),
    'keyword',
    'batch',
  ).records
  for (const record of saved.slice(0, 34)) {
    record.detailStatus = 'complete'
    record.detail = { jobInfo: { postDescription: 'Saved complete JD' } }
  }
  runAnalysis = async () => ({ status: 'completed', total: 0, completed: 0, failed: 0, skipped: 0 })
  const forbidden = () => {
    throw new Error('the analysis panel must not access BOSS or send')
  }
  helper = shallowReactive({
    key: 'boss',
    conf: {
      formData: reactive({ aiFiltering: { model: 'filter' }, aiGreeting: { model: 'greeting' } }),
    },
    resumes: {
      currentResume: ref({ id: 'resume-test', name: '测试简历', content: '测试简历正文' }),
    },
    models: { modelData: ref([model('filter'), model('greeting'), model('manual')]) },
    workflowRunning: ref(false),
    gatheringBusy: ref(false),
    realtimeBusy: ref(false),
    hasPendingCollectionStorage: false,
    savedAnalyzer: {
      busy: ref(false),
      run: ref(null),
      async start(options) {
        starts.push(options)
        return await runAnalysis(options)
      },
      stop() {},
    },
    async getJobLibrary() {
      reads++
      return saved
    },
    onJobCardClick: forbidden,
    sendMessage: forbidden,
    collectOnly: forbidden,
    start: forbidden,
  })
  globalThis.__batchAnalysisHelper = helper
})

afterEach(() => {
  renderer.render(null, root)
  delete globalThis.__batchAnalysisHelper
})

describe('offline batch analysis panel', () => {
  it('compiles the analysis template', () => {
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: componentPath,
      id: 'batch-analysis-test',
    })
    expect(template.errors).toEqual([])
  })

  it('reads saved JD count on mounting and permits 34 eligible jobs with a configured model', async () => {
    const state = mount()
    await settled()
    expect(reads).toBe(1)
    expect(state.available).toBe(34)
    expect(state.modelKey).toBe('filter')
    expect(state.startDisabledReason).toBe('')
    expect(starts).toEqual([])
  })

  it('follows the first complete model after loading, reordering and deletion', async () => {
    helper.models.modelData.value = []
    const state = mount()
    await settled()
    expect(state.startDisabledReason).toMatch(/模型/)
    await state.start()
    expect(starts).toEqual([])
    helper.models.modelData.value = [model('greeting'), model('filter'), model('manual')]
    await settled()
    expect(state.modelKey).toBe('greeting')
    helper.models.modelData.value = [model('manual'), model('greeting'), model('filter')]
    await settled()
    expect(state.modelKey).toBe('manual')
    helper.models.modelData.value = [model('greeting'), model('filter')]
    await settled()
    expect(state.modelKey).toBe('greeting')
    helper.models.modelData.value = [model('greeting')]
    await settled()
    expect(state.modelKey).toBe('greeting')
    helper.models.modelData.value = []
    await settled()
    expect(state.selectedModel).toBeUndefined()
    expect(state.startDisabledReason).toMatch(/模型/)
    await state.start()
    expect(starts).toEqual([])
  })

  it('uses the first complete model while skipping incomplete configurations', async () => {
    helper.models.modelData.value = [
      model('filter', { api_key: '' }),
      model('greeting'),
      model('other'),
    ]
    const state = mount()
    await settled()
    expect(state.modelKey).toBe('greeting')
    helper.models.modelData.value[0].data.api_key = 'repaired-key'
    await settled()
    expect(state.modelKey).toBe('filter')
    helper.models.modelData.value = [model('other')]
    await settled()
    expect(state.modelKey).toBe('other')
    expect(state.startDisabledReason).toBe('')
  })

  it.each([
    { api_key: ' ' },
    { base_url: '' },
    { model: '' },
    { api_key: 123 },
    { base_url: {} },
    { model: false },
  ])('explains incomplete model configuration without starting a request: %j', async (data) => {
    helper.models.modelData.value = [model('incomplete', data)]
    const state = mount()
    await settled()
    expect(state.startDisabledReason).toMatch(/模型|配置|API|接口/)
    await state.start()
    expect(state.actionError).toMatch(/模型|配置|API|接口/)
    expect(starts).toEqual([])
  })

  it('explains a missing selected model without requesting analysis', async () => {
    const state = mount()
    await settled()
    helper.models.modelData.value = []
    await settled()
    expect(state.startDisabledReason).toMatch(/模型/)
    await state.start()
    expect(starts).toEqual([])
  })

  it.each([0, 1.5, Number.NaN])(
    'rejects invalid batch quantity %s before requesting analysis',
    async (limit) => {
      const state = mount()
      await settled()
      state.limit = limit
      expect(state.startDisabledReason).toMatch(/数量/)
      await state.start()
      expect(starts).toEqual([])
    },
  )

  it('disables analysis until the saved count read resolves', async () => {
    let release!: (records) => void
    helper.getJobLibrary = () => new Promise((resolve) => (release = resolve))
    const state = mount()
    await settled()
    try {
      expect(state.available).toBeNull()
      expect(state.startDisabledReason).toMatch(/读取|岗位/)
      await state.start()
      expect(starts).toEqual([])
    } finally {
      release(saved)
      await settled()
    }
    expect(state.available).toBe(34)
    expect(state.startDisabledReason).toBe('')
  })

  it('explains zero eligible JD records without requesting analysis', async () => {
    saved = []
    const state = mount()
    await settled()
    expect(state.available).toBe(0)
    expect(state.startDisabledReason).toMatch(/岗位|JD/)
    await state.start()
    expect(starts).toEqual([])
  })

  it('keeps read failures visible and blocks requests', async () => {
    helper.getJobLibrary = async () => {
      throw new Error('Storage unavailable')
    }
    const state = mount()
    await settled()
    expect(state.available).toBeNull()
    expect(state.startDisabledReason).toContain('Storage unavailable')
    await state.start()
    expect(state.actionError).toContain('Storage unavailable')
    expect(starts).toEqual([])
  })

  it.each(['analysis', 'collection', 'realtime', 'storage', 'workflow'])(
    'prevents analysis while %s work is active',
    async (kind) => {
      const state = mount()
      await settled()
      if (kind === 'analysis') helper.savedAnalyzer.busy.value = true
      if (kind === 'collection') helper.gatheringBusy.value = true
      if (kind === 'realtime') helper.realtimeBusy.value = true
      if (kind === 'storage') helper.hasPendingCollectionStorage = true
      if (kind === 'workflow') helper.workflowRunning.value = true
      expect(state.startDisabledReason).toMatch(/分析|采集|保存|投递|任务/)
      await state.start()
      expect(starts).toEqual([])
    },
  )

  it('passes the quantity without a model override, then refreshes and emits completed', async () => {
    const state = mount()
    await settled()
    state.limit = 7
    let release!: () => void
    const analysis = new Promise<void>((resolve) => (release = resolve))
    runAnalysis = async () => {
      await analysis
      for (const record of saved.slice(0, 7)) record.analysisStatus = 'ready'
      return { status: 'completed', total: 7, completed: 7, failed: 0, skipped: 0 }
    }
    const task = state.start()
    try {
      await settled()
      expect(starts).toEqual([{ limit: 7 }])
      expect(reads).toBe(1)
      expect(completed).toBe(0)
    } finally {
      release()
      await task
    }
    expect(reads).toBe(2)
    expect(state.available).toBe(27)
    expect(completed).toBe(1)
    expect(state.actionError).toBe('')
  })

  it.each([null, { id: 'empty', name: '空简历', content: '  ' }])(
    'requires a current nonempty resume even if legacy text remains: %j',
    async (resume) => {
      helper.resumes.currentResume.value = resume
      helper.conf.formData.resumeText = '旧配置简历'
      const state = mount()
      await settled()
      await state.start()
      expect(state.actionError).toContain('简历')
      expect(starts).toEqual([])
    },
  )
})
