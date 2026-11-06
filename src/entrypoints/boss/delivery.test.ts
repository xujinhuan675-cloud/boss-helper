// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { expect, it, mock } from 'bun:test'

import { computed, ref } from 'vue'

import { defaultFormData } from '../../composables/conf/info'
import { jsonClone } from '../../utils/deepmerge'

mock.module('@/message', () => ({ counter: {} }))
mock.module('@/composables/usePipelineCache', () => ({ PipelineCacheManager: class {} }))
mock.module('./requests', () => ({ sameCompanyKey: 'company', sameHrKey: 'hr' }))
const logger = { withContext: () => logger, error() {}, debug() {}, warn() {} }
Object.assign(globalThis, { computed, logger, jsonClone, alert() {} })
const handles = await import('../../composables/useApplying/handles')
const taskTypes = await import('../../composables/useApplying/type')
mock.module('@/composables/useApplying/handles', () => handles)
mock.module('@/composables/useApplying/type', () => taskTypes)
const { bossWorkflow } = await import('./delivery')

it.each(['ready', 'failed', 'empty', 'filtered'])(
  'only delivers after preparing a nonempty greeting: %s',
  async (scenario) => {
    const config = jsonClone(defaultFormData)
    config.sameHrFilter.value = false
    config.activityFilter.value = false
    config.aiGreeting.enable = false
    if (scenario === 'filtered') config.jobTitle.value = ['产品']
    const calls = []
    const helper = {
      conf: { formData: config },
      jobList: ref([]),
      jobResultMaps: new Map(),
      statistics: { todayData: ref({ total: 0, success: 0, tasks: {} }) },
      onJobCardClick: async () => calls.push('detail'),
      prepareDeliveryGreeting: async () => {
        calls.push('prepare')
        if (scenario === 'failed') throw new Error('生成失败')
        return scenario === 'empty' ? ' ' : '已保存的最终稿'
      },
      sendPreparedGreeting: async (_data, text) => calls.push(`send:${text}`),
    }
    const workflow = await bossWorkflow(helper)
    await workflow.rebuild()
    await workflow.execute({
      jobData: { key: 'boss::auto', jobName: '产品经理' },
      rawData: { jobitem: {} },
      state: {},
    })
    expect(calls).toEqual(
      scenario === 'filtered'
        ? []
        : scenario === 'ready'
          ? ['detail', 'prepare', 'send:已保存的最终稿']
          : ['detail', 'prepare'],
    )
    expect(helper.jobResultMaps.get('boss::auto').status).toBe(
      scenario === 'ready' ? 'success' : scenario === 'filtered' ? 'warn' : 'error',
    )
  },
)
