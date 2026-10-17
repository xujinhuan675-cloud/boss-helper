/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'

import { nativeSearchFromUrl } from '../entrypoints/boss/nativeSearch'

const require = createRequire(new URL('../../packages/devlog-ui/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://extension.example/',
  pretendToBeVisual: true,
})
for (const key of [
  'window',
  'document',
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

let fail = false
mock.module('@/message', () => ({
  counter: {
    fetchText: async ({ url }) => {
      if (fail) throw new Error('offline')
      let zpData
      if (url.includes('condition')) {
        zpData = Object.fromEntries(
          ['salary', 'jobType', 'experience', 'degree', 'stage', 'scale'].map((key) => [
            `${key}List`,
            [
              { code: 0, name: '不限' },
              { code: 101, name: '选项一' },
              { code: 102, name: '选项二' },
            ],
          ]),
        )
      } else if (url.includes('industry')) {
        zpData = [1, 2, 3, 4].map((code) => ({ code, name: `行业${code}` }))
      } else {
        zpData = {
          cityList: [
            {
              code: 101000000,
              name: '北京',
              subLevelModelList: [{ code: 101010100, name: '北京市' }],
            },
          ],
          hotCityList: [{ code: 100010000, name: '全国' }],
        }
      }
      return { text: JSON.stringify({ code: 0, zpData }) }
    },
  },
}))
mock.module('./store', () => ({ perform: async (work) => work() }))

const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { NativeFilters } = await import('./NativeFilters')
let root, container, value

function Form() {
  const [current, setCurrent] = useState(
    nativeSearchFromUrl('https://www.zhipin.com/web/geek/jobs'),
  )
  value = current
  return createElement(NativeFilters, {
    value: current,
    onChange: setCurrent,
    disabled: false,
    canRead: false,
    onRead() {},
  })
}
async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click())
}
async function open(label) {
  const field = document.querySelector(`[aria-label="${label}"]`)
  await click((field.closest('[data-slot="combo-box"]') ?? field).querySelector('button') ?? field)
}
const option = (text) =>
  [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === text)
beforeEach(async () => {
  fail = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
afterAll(() => dom.window.close())
async function render() {
  await act(async () => root.render(createElement(Form)))
  await act(async () => new Promise(requestAnimationFrame))
}

test('selects multiple native codes and clears them with unrestricted', async () => {
  await render()
  await open('工作经验')
  await click(option('选项一'))
  await click(option('选项二'))
  expect(value.experience).toEqual(['101', '102'])
  await click(option('不限'))
  expect(value.experience).toEqual([])
  await click(option('选项二'))
  expect(value.experience).toEqual(['102'])
})

test('limits industries to three while allowing deselection and unrestricted', async () => {
  await render()
  await open('公司行业')
  for (const text of ['行业1', '行业2', '行业3', '行业4']) await click(option(text))
  expect(value.industry).toEqual(['1', '2', '3'])
  expect(option('行业4').getAttribute('aria-disabled')).toBe('true')
  await click(option('行业2'))
  await click(option('行业4'))
  expect(value.industry).toEqual(['1', '3', '4'])
  await click(option('不限'))
  expect(value.industry).toEqual([])
})

test('clears a single native salary and city selection', async () => {
  await render()
  await open('薪资待遇')
  await click(option('选项一'))
  expect(value.salary).toBe('101')
  await open('薪资待遇')
  await click(option('不限'))
  expect(value.salary).toBe('')
  await open('工作城市')
  await click(option('北京市'))
  expect(value.city).toBe('101010100')
  await open('工作城市')
  await click(option('不限'))
  expect(value.city).toBe('')
})

test('retries failed metadata loading without changing filters', async () => {
  fail = true
  await render()
  expect(container.textContent).toContain('筛选选项加载失败')
  fail = false
  await click([...container.querySelectorAll('button')].find((el) => el.textContent === '重试'))
  expect(container.textContent).not.toContain('筛选选项加载失败')
  await open('工作经验')
  await click(option('选项一'))
  expect(value.experience).toEqual(['101'])
})
