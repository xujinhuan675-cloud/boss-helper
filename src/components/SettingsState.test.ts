// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { createRenderer, h, nextTick, ref } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

const components = {}
for (const name of ['Alert', 'Tabs/ResumeManager', 'CollectionControls']) {
  const componentPath = fileURLToPath(new URL(`./${name}.vue`, import.meta.url))
  const { descriptor } = parse(readFileSync(componentPath, 'utf8'))
  const script = compileScript(descriptor, { id: name })
  const built = await Bun.build({
    entrypoints: [componentPath],
    format: 'cjs',
    target: 'node',
    external: ['vue'],
    plugins: [
      {
        name: 'offline-settings',
        setup(build) {
          build.onLoad({ filter: /\.vue$/ }, () => ({ contents: script.content, loader: 'ts' }))
          build.onResolve({ filter: /^@\/message$/ }, () => ({
            path: 'storage',
            namespace: 'fixture',
          }))
          build.onResolve({ filter: /^@\/composables\/useHelper$/ }, () => ({
            path: 'helper',
            namespace: 'fixture',
          }))
          build.onResolve({ filter: /^@\/components\/JobLibrary\.vue$/ }, () => ({
            path: 'job-library',
            namespace: 'fixture',
          }))
          build.onResolve({ filter: /^@\/composables\/useResume$/ }, () => ({
            path: fileURLToPath(new URL('../composables/useResume.ts', import.meta.url)),
          }))
          build.onResolve({ filter: /^@\/utils\/deepmerge$/ }, () => ({
            path: fileURLToPath(new URL('../utils/deepmerge.ts', import.meta.url)),
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'job-library'
                ? 'export default { render: () => null }'
                : path === 'storage'
                  ? 'export const counter = { storageGet: (...args) => globalThis.__settingsFixture.get(...args), storageSet: (...args) => globalThis.__settingsFixture.set(...args) }'
                  : 'export const useHelper = () => globalThis.__resumeHelper',
            loader: 'js',
          }))
        },
      },
    ],
  })
  if (!built.success) throw new Error(built.logs.join('\n'))
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', await built.outputs[0].text())(
    createRequire(import.meta.url),
    compiled,
    compiled.exports,
  )
  components[name] = { component: compiled.exports.default, descriptor, componentPath }
  components[name].component.render = () => null
}

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
let saved
beforeEach(() => {
  root = { children: [] }
  saved = {}
  globalThis.__settingsFixture = {
    get: async (key, fallback) => structuredClone(saved[key] ?? fallback),
    set: async (key, value) => {
      saved[key] = structuredClone(value)
    },
  }
  globalThis.__resumeHelper = {
    key: 'boss',
    savedAnalyzer: { busy: ref(false) },
    keywordRotationKeywords: ref('产品经理'),
    keywordRotationBusy: ref(false),
    keywordRotation: ref(null),
    keywordRotationWaitSeconds: ref(0),
    keywordRotationSaving: ref(false),
    keywordExtractionBusy: ref(false),
    extractKeywordRotationFromResume: async (text) => {
      const keywords = [`岗位：${text}`]
      globalThis.__resumeHelper.keywordRotationKeywords.value = keywords.join('\n')
      return keywords
    },
  }
})
afterEach(() => {
  renderer.render(null, root)
  delete globalThis.__settingsFixture
  delete globalThis.__resumeHelper
})
function mount(name, props = {}) {
  const vnode = h(components[name].component, props)
  renderer.render(vnode, root)
  return vnode.component.setupState
}
async function resumeState() {
  const state = mount('Tabs/ResumeManager')
  await state.store.init()
  return state
}

describe('offline settings interactions', () => {
  it('continues the editable rotation through the existing start action', async () => {
    const calls = []
    Object.assign(globalThis.__resumeHelper, {
      jobLibraryFunnelStage: ref(null),
      jobLibrarySelectedId: ref(''),
      jobLibraryOpen: ref(false),
      refreshJobLibrarySummary: async () => {},
      keywordRotation: ref({ status: 'paused', cursor: 1 }),
      startKeywordRotation: async (keywords) => {
        calls.push(keywords)
        return { status: 'paused', error: '已达到每日关键词上限' }
      },
    })
    const state = mount('CollectionControls')
    await state.startKeywordRotation()
    expect(calls).toEqual(['产品经理'])
    expect(state.actionError).toBe('')
    expect(state.keywordRotation.status).toBe('paused')
  })

  it('keeps collection-only independent of keywords, resume and model configuration', async () => {
    const calls = []
    Object.assign(globalThis.__resumeHelper, {
      jobLibraryFunnelStage: ref(null),
      jobLibrarySelectedId: ref(''),
      jobLibraryOpen: ref(false),
      refreshJobLibrarySummary: async () => {},
      collectOnly: async (...args) => {
        calls.push(args)
        return { status: 'completed' }
      },
    })
    globalThis.__resumeHelper.keywordRotationKeywords.value = ''
    const state = mount('CollectionControls')
    await state.startCollection()
    expect(calls).toEqual([[]])
    expect(state.actionError).toBe('')
    globalThis.__resumeHelper.collectOnly = async () => {
      throw new Error('保存失败')
    }
    await state.startCollection()
    expect(state.actionError).toBe('保存失败')
    globalThis.__resumeHelper.collectOnly = async () => ({
      status: 'restricted',
      error: '访问受限',
    })
    await state.startCollection()
    expect(state.actionError).toBe('访问受限')
    const template = components.CollectionControls.descriptor.template.content
    expect(template).toMatch(/@click="void startCollection\(\)"[\s\S]*?>\s*只采集\s*<\/UButton>/)
    expect(template).toContain('轮换采集并分析')
  })

  it('extracts from the unsaved resume draft and leaves the results editable', async () => {
    const state = await resumeState()
    await state.store.createResume('旧简历', '旧正文')
    state.content = '新粘贴的简历'
    await state.extractKeywords()
    expect(state.keywordInput).toBe('岗位：新粘贴的简历')
    state.keywordInput = '自定义岗位\n外部粘贴的岗位'
    expect(globalThis.__resumeHelper.keywordRotationKeywords.value).toBe(
      '自定义岗位\n外部粘贴的岗位',
    )
    expect(state.store.currentResume.value.content).toBe('旧正文')
  })

  it('uses the selected resume when the editor is blank but rejects a cleared edit', async () => {
    const state = await resumeState()
    const resume = await state.store.createResume('当前简历', '当前正文')
    await state.extractKeywords()
    expect(state.keywordInput).toBe('岗位：当前正文')
    state.editResume(resume)
    state.content = ''
    globalThis.__resumeHelper.extractKeywordRotationFromResume = async (text) => {
      if (!text.trim()) throw new Error('请先粘贴简历正文')
    }
    await state.extractKeywords()
    expect(state.keywordError).toBe('请先粘贴简历正文')
    expect(state.keywordInput).toBe('岗位：当前正文')
  })

  it('blocks keyword edits while extraction is pending and preserves them on failure', async () => {
    const state = await resumeState()
    globalThis.__resumeHelper.keywordExtractionBusy.value = true
    expect(state.keywordDisabled).toBe(true)
    globalThis.__resumeHelper.keywordExtractionBusy.value = false
    globalThis.__resumeHelper.extractKeywordRotationFromResume = async () => {
      throw new Error('模型连接失败')
    }
    await state.extractKeywords()
    expect(state.keywordInput).toBe('产品经理')
    expect(state.keywordError).toBe('模型连接失败')
  })

  it('keeps explicit close=false and inherited alert appearance props', () => {
    const state = mount('Alert', {
      id: 'disabled',
      close: false,
      title: '提示正文',
      color: 'warning',
    })
    expect(state.closeProp).toBe(false)
    expect(state.icon).toBe('solar:shield-warning-outline')
    expect(state.props.title).toBe('提示正文')
    expect(state.props.color).toBe('warning')
  })

  it('compiles the settings and collection control templates', () => {
    for (const { descriptor, componentPath } of Object.values(components)) {
      expect(
        compileTemplate({
          source: descriptor.template.content,
          filename: componentPath,
          id: 'settings',
        }).errors,
      ).toEqual([])
    }
  })

  it('keeps the resume draft and old library when a save fails', async () => {
    const state = await resumeState()
    const old = await state.store.createResume('已保存', '旧正文')
    state.editResume(old)
    state.name = '未保存修改'
    state.content = '新正文'
    globalThis.__settingsFixture.set = async () => {
      throw new Error('保存失败')
    }
    await state.saveResume()
    expect(state.name).toBe('未保存修改')
    expect(state.content).toBe('新正文')
    expect(state.store.resumes.value).toEqual([old])
    expect(state.actionError).toBe('保存失败')
  })

  it('blocks duplicate saves and editor changes while persistence is pending', async () => {
    const state = await resumeState()
    const old = await state.store.createResume('已保存', '旧正文')
    state.name = '新简历'
    state.content = '新正文'
    let release
    const ack = new Promise((resolve) => {
      release = resolve
    })
    let writes = 0
    globalThis.__settingsFixture.set = async () => {
      writes++
      await ack
    }
    const task = state.saveResume()
    const duplicate = state.saveResume()
    const copying = state.copyResume(old)
    const selecting = state.selectResume(old.id)
    try {
      state.editResume(old)
      state.resetEditor()
      state.requestDelete(old)
      expect(writes).toBe(1)
      expect(state.name).toBe('新简历')
      expect(state.content).toBe('新正文')
      expect(state.store.resumes.value).toEqual([old])
    } finally {
      release()
      await Promise.all([task, duplicate, copying, selecting])
    }
    expect(state.saving).toBe(false)
    expect(state.store.resumes.value).toHaveLength(2)
  })

  it('asks before deleting the last current resume and explicitly enters no-resume state', async () => {
    const state = await resumeState()
    const old = await state.store.createResume('唯一简历', '正文')
    state.requestDelete(old)
    expect(state.deleteOpen).toBe(true)
    expect(state.store.resumes.value).toEqual([old])
    await state.confirmDelete()
    expect(state.store.resumes.value).toEqual([])
    expect(state.store.currentResumeId.value).toBeNull()
  })

  it('closes an alert immediately while its persistent write is pending', async () => {
    const state = mount('Alert', { id: 'pending' })
    await nextTick()
    let release
    const ack = new Promise((resolve) => {
      release = resolve
    })
    globalThis.__settingsFixture.set = async () => ack
    const task = state.handleOpenChange(false)
    try {
      expect(state.isVisible).toBe(false)
    } finally {
      release()
      await task
    }
  })

  it('does not reopen a closed alert when its initial read arrives late', async () => {
    let release
    globalThis.__settingsFixture.get = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const state = mount('Alert', { id: 'late' })
    await state.handleOpenChange(false)
    release(false)
    await nextTick()
    expect(state.isVisible).toBe(false)
  })

  it('keeps alerts closed when storage fails and reads a persisted dismissal on remount', async () => {
    const state = mount('Alert', { id: 'saved' })
    await nextTick()
    await state.handleOpenChange(false)
    renderer.render(null, root)
    const refreshed = mount('Alert', { id: 'saved' })
    await nextTick()
    expect(refreshed.isVisible).toBe(false)
    globalThis.__settingsFixture.set = async () => {
      throw new Error('保存失败')
    }
    await refreshed.handleOpenChange(false)
    expect(refreshed.isVisible).toBe(false)
  })
})
