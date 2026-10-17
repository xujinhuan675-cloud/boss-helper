// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { afterEach, expect, test } from 'bun:test'

import { ref } from 'vue'

import { useHookVueData, useHookVueFn } from './useVue'

const originalDocument = globalThis.document
afterEach(() => {
  globalThis.document = originalDocument
})

test('finds job data on a later matching element and preserves updates in both directions', async () => {
  const page = { jobList: ['saved'] }
  const elements = [{}, { __vue__: { $parent: page } }]
  globalThis.document = {
    querySelector: () => elements[0],
    querySelectorAll: () => elements,
  }
  const data = ref([])
  const updates = []
  await useHookVueData('.page', 'jobList', data, (value) => updates.push(value))()
  expect(data.value).toEqual(['saved'])
  page.jobList = ['new']
  expect(data.value).toEqual(['new'])
  expect(page.jobList).toEqual(['new'])
  expect(updates).toEqual([['saved'], ['new']])
})

test('finds an available search method on a child component and keeps its receiver', async () => {
  const component = {
    query: 'AI',
    onSearch() {
      return this.query
    },
  }
  const elements = [{ __vue__: { $children: [component] } }]
  globalThis.document = {
    querySelector: () => elements[0],
    querySelectorAll: () => elements,
  }
  const search = await useHookVueFn('.page', ['searchJobAction', 'onSearch'])()
  expect(typeof search).toBe('function')
  expect(search()).toBe('AI')
})
