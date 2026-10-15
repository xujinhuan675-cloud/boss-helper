// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { computed, createRenderer, h, nextTick, ref } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const componentPath = fileURLToPath(new URL('./JobCard.vue', import.meta.url))
const source = await Bun.file(componentPath).text()
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'job-card-test' })
const built = await Bun.build({
  entrypoints: [componentPath],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'external-job-card',
      setup(build) {
        build.onLoad({ filter: /JobCard\.vue$/ }, () => ({
          contents: script.content,
          loader: 'ts',
        }))
        build.onResolve({ filter: /^@\/composables\/useHelper$/ }, () => ({
          path: 'helper',
          namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const useHelper = () => globalThis.__jobCardHelper',
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
let calls: string[]
let greeting = ''
let captured = false

function mount() {
  const vnode = h(Component, {
    job: {
      key: 'boss::job-1',
      jobName: '岗位',
      positionName: '岗位',
      jobDescription: '',
      experienceName: '',
      degreeName: '',
      salary: '',
      showSkills: [],
      jobLabels: [],
      skills: [],
      boss: { name: '', title: '', avatar: '', certificated: false },
      brand: { name: '', logo: '', scale: '', industry: '', introduce: '', labels: [] },
    },
    quickActions: true,
  })
  renderer.render(vnode, root)
  return vnode.component.setupState
}

beforeEach(() => {
  root = { children: [] }
  calls = []
  greeting = ''
  captured = false
  globalThis.__jobCardHelper = {
    key: 'boss',
    jobResultMaps: new Map(),
    savedAnalyzer: {
      busy: ref(false),
      analyzeOne: async (id) => {
        calls.push(`analyze:${id}`)
        greeting = '已生成招呼语'
        return { status: 'completed' }
      },
    },
    async getJobLibrary() {
      return captured
        ? [
            {
              encryptJobId: 'job-1',
              detailStatus: 'pending',
              finalGreeting: greeting,
            },
          ]
        : []
    },
    async captureJobSnapshot(key) {
      calls.push(`capture:${key}`)
      captured = true
      return { encryptJobId: 'job-1', detailStatus: 'pending' }
    },
    async ensureSavedJobDetails(id) {
      calls.push(`detail:${id}`)
      return {
        encryptJobId: 'job-1',
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: 'JD' } },
      }
    },
    async sendSavedGreeting(id) {
      calls.push(`send:${id}`)
    },
    openJobLibrary() {
      calls.push('open-library')
    },
    async onJobCardClick() {},
  }
  globalThis.navigator = { clipboard: { writeText: async (text) => calls.push(`copy:${text}`) } }
  globalThis.computed = computed
})

afterEach(() => {
  renderer.render(null, root)
  delete globalThis.__jobCardHelper
})

describe('external job card quick actions', () => {
  it('captures, analyzes, copies and sends one saved greeting', async () => {
    const state = mount()
    await state.analyzeJob()
    await nextTick()
    await state.copyGreeting()
    await state.sendGreeting()

    expect(calls).toEqual([
      'capture:boss::job-1',
      'detail:job-1',
      'analyze:job-1',
      'open-library',
      'copy:已生成招呼语',
      'send:job-1',
    ])
  })
})
