// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { createRenderer, h, nextTick, ref } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { mergeJobRecords } from '../entrypoints/boss/jobStore'

const componentPath = fileURLToPath(new URL('./JobLibrary.vue', import.meta.url))
const source = readFileSync(componentPath, 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'job-library-test' })
const built = await Bun.build({
  entrypoints: [componentPath],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'offline-job-library',
      setup(build) {
        build.onLoad({ filter: /JobLibrary\.vue$/ }, () => ({
          contents: script.content,
          loader: 'ts',
        }))
        build.onResolve({ filter: /^@\/composables\/useHelper$/ }, () => ({
          path: 'helper',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/components\/AI\/BatchAnalysis\.vue$/ }, () => ({
          path: 'batch-analysis',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/utils\/jsonImportExport$/ }, () => ({
          path: 'export',
          namespace: 'fixture',
        }))
        build.onResolve({ filter: /^@\/entrypoints\/boss\/jobStore$/ }, () => ({
          path: fileURLToPath(new URL('../entrypoints/boss/jobStore.ts', import.meta.url)),
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'helper'
              ? 'export const useHelper = () => globalThis.__jobLibraryHelper'
              : path === 'batch-analysis'
                ? 'export default { render: () => null }'
                : 'export const exportJson = (data, name) => globalThis.__jobLibraryDownloads.push({ data, name })',
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
let root
let reads
let saved

function mount(open = false) {
  const vnode = h(Component, { open })
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
  saved = mergeJobRecords(
    [],
    Array.from({ length: 45 }, (_, index) => ({
      encryptJobId: `job-${index}`,
      jobName: `Position ${index}`,
      brandName: 'Acme',
      bossName: 'HR',
    })),
    'keyword',
    'batch',
  ).records
  saved[30].detail = { jobInfo: { postDescription: 'Unique saved JD' } }
  saved[30].detailStatus = 'complete'
  saved[30].analysis = {
    retainedField: true,
    rating: 88,
    message: '分析建议',
    passed: true,
    res: { positive: [{ score: 1, reason: 'JD 完整' }], negative: [] },
  }
  saved[30].finalGreeting = '您好，想和您交流岗位细节。'
  saved[30].analysisFailureReason = undefined
  globalThis.__jobLibraryHelper = {
    key: 'boss',
    savedAnalyzer: {
      busy: ref(false),
      run: ref(null),
      analyzeOne: async (jobId) => {
        globalThis.__jobLibraryAnalyzeOne?.push(jobId)
        return { status: 'completed', total: 1, completed: 1, failed: 0, skipped: 0 }
      },
    },
    async getJobLibrary() {
      reads++
      return saved
    },
    async updateJobProcessingStatus(jobId, status) {
      const record = saved.find((item) => item.encryptJobId === jobId)
      if (status === 'active') delete record.processingStatus
      else record.processingStatus = status
    },
  }
  globalThis.__jobLibraryDownloads = []
  globalThis.__jobLibraryAnalyzeOne = []
  globalThis.__jobLibraryClipboard = []
})
afterEach(() => {
  renderer.render(null, root)
  delete globalThis.__jobLibraryHelper
  delete globalThis.__jobLibraryDownloads
  delete globalThis.__jobLibraryAnalyzeOne
  delete globalThis.__jobLibraryClipboard
})

describe('offline job library modal', () => {
  it('reads newly saved analysis and reranks open results without reopening the library', async () => {
    const state = mount(true)
    await settled()
    const analyzer = globalThis.__jobLibraryHelper.savedAnalyzer
    saved = structuredClone(saved)
    saved[5].analysis = { rating: 100, passed: true }
    saved[5].finalGreeting = '刚生成的草稿'
    analyzer.run.value = { completed: 1, failed: 0 }
    await settled()
    expect(state.pageRecords[0].encryptJobId).toBe('job-5')
    expect(state.pageRecords[0].finalGreeting).toBe('刚生成的草稿')
  })

  it('reads again when analysis is saved during a slow library refresh', async () => {
    const initial = structuredClone(saved)
    let release!: (records: unknown) => void
    globalThis.__jobLibraryHelper.getJobLibrary = async () => {
      reads++
      return reads === 1
        ? new Promise((resolve) => {
            release = resolve
          })
        : saved
    }
    const state = mount(true)
    await settled()
    saved[5].analysis = { rating: 100 }
    globalThis.__jobLibraryHelper.savedAnalyzer.run.value = { completed: 1, failed: 0 }
    await settled()
    release(initial)
    await settled()
    await settled()
    expect(state.pageRecords[0].encryptJobId).toBe('job-5')
  })

  it('compiles its template without raw HTML or remote image loads', () => {
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: componentPath,
      id: 'job-library-test',
    })
    expect(template.errors).toEqual([])
    expect(source).not.toContain('v-html')
    expect(source).not.toContain('<img')
    expect(source).not.toContain('JSON.stringify(selected.analysis')
    expect(source).not.toContain('分析失败原因')
  })

  it('reads only on opening or explicit refresh and paginates 20 saved jobs', async () => {
    mount()
    await settled()
    expect(reads).toBe(0)
    const state = mount(true)
    await settled()
    expect(reads).toBe(1)
    expect(state.pageRecords).toHaveLength(20)
    state.page = 3
    await settled()
    expect(state.pageRecords).toHaveLength(5)
    expect(state.selected.encryptJobId).toBe('job-40')
    expect(reads).toBe(1)
    await state.loadRecords()
    expect(reads).toBe(2)
  })

  it('hides excluded jobs by default and supports restoring them from the excluded view', async () => {
    saved[0].processingStatus = 'excluded'
    const state = mount(true)
    await settled()

    expect(state.filteredRecords.some((record) => record.encryptJobId === 'job-0')).toBe(false)
    state.processingStatus = 'excluded'
    await settled()
    expect(state.filteredRecords.map((record) => record.encryptJobId)).toEqual(['job-0'])

    state.selectedId = 'job-0'
    await state.updateProcessingStatus('active')
    expect(saved[0].processingStatus).toBeUndefined()
  })

  it('resets pagination for saved JD search and exports whole records with IDs', async () => {
    const state = mount(true)
    await settled()
    state.page = 3
    await settled()
    state.search = 'Unique saved JD'
    await settled()
    expect(state.page).toBe(1)
    expect(state.pageRecords.map((record) => record.encryptJobId)).toEqual(['job-30'])
    state.download(false)
    state.download(true)
    expect(globalThis.__jobLibraryDownloads[0].data).toHaveLength(45)
    expect(globalThis.__jobLibraryDownloads[1].data).toEqual([saved[30]])
    expect(globalThis.__jobLibraryDownloads[1].data[0].analysis).toMatchObject({
      retainedField: true,
      rating: 88,
      message: '分析建议',
    })
    expect(globalThis.__jobLibraryDownloads[1].data[0].finalGreeting).toContain('交流')
    expect(globalThis.__jobLibraryDownloads[1].data[0].key).toBe('boss::job-30')
    expect(reads).toBe(1)
  })

  it('clears stale records and blocks exports when local storage cannot be read', async () => {
    const state = mount(true)
    await settled()
    globalThis.__jobLibraryHelper.getJobLibrary = async () => {
      throw new Error('Storage unavailable')
    }
    await state.loadRecords()
    await settled()
    expect(state.records).toEqual([])
    expect(state.selected).toBeUndefined()
    expect(state.readError).toBe('Storage unavailable')
    expect(state.loading).toBe(false)
    state.download(false)
    state.download(true)
    expect(globalThis.__jobLibraryDownloads).toEqual([])
  })

  it('analyzes the selected complete job and copies its saved greeting without sending', async () => {
    const state = mount(true)
    await settled()
    state.selectedId = 'job-30'
    await settled()

    await state.analyzeSelected()
    expect(globalThis.__jobLibraryAnalyzeOne).toEqual(['job-30'])

    globalThis.navigator.clipboard = {
      writeText: async (text) => globalThis.__jobLibraryClipboard.push(text),
    }
    await state.copyGreeting()
    expect(globalThis.__jobLibraryClipboard).toEqual(['您好，想和您交流岗位细节。'])
  })

  it('requests live detail completion before analyzing an incomplete selected job', async () => {
    const state = mount(true)
    await settled()
    state.selectedId = 'job-0'
    const ensureCalls: string[] = []
    globalThis.__jobLibraryHelper.ensureSavedJobDetails = async (jobId) => {
      ensureCalls.push(jobId)
      saved[0].detailStatus = 'complete'
      saved[0].detail = { jobInfo: { postDescription: '补全后的 JD' } }
    }
    await state.analyzeSelected()
    expect(ensureCalls).toEqual(['job-0'])
    expect(globalThis.__jobLibraryAnalyzeOne).toEqual(['job-0'])
  })

  it('shows a direct error when the single-job analyzer rejects a protected record', async () => {
    const state = mount(true)
    await settled()
    state.selectedId = 'job-30'
    globalThis.__jobLibraryHelper.savedAnalyzer.analyzeOne = async () => {
      throw new Error('该岗位已分析、已审核或已进入发送流程，不能覆盖')
    }

    await state.analyzeSelected()

    expect(state.analysisActionError).toContain('不能覆盖')
    expect(state.analyzingJobId).toBe('')
  })
})
