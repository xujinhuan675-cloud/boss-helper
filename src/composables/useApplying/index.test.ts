// @ts-nocheck
import { beforeEach, expect, mock, test } from 'bun:test'

import { computed, ref } from 'vue'

import { clearDiagnostics, getDiagnostics } from '../../utils/diagnostics'

mock.module('@/composables/usePipelineCache', () => ({ PipelineCacheManager: class {} }))
mock.module('./handles', () => ({ DependencyMissingError: class extends Error {} }))
const logger = { withContext: () => logger, error: () => {}, debug: () => {}, warn: () => {} }
Object.assign(globalThis, {
  computed,
  logger,
  jsonClone: (value) => JSON.parse(JSON.stringify(value)),
  alert: () => {},
})
const { useDeliveryWorkflow } = await import('./index')
beforeEach(clearDiagnostics)

const helper = () => ({
  jobList: ref([]),
  jobResultMaps: new Map(),
  statistics: { todayData: ref({ total: 0, success: 0, tasks: {} }) },
})
const task = (fn) => ({ id: 'delivery', deps: [], before: [], after: [], task: fn })

test('records a failed task build even when the workflow handles the exception', async () => {
  const workflow = await useDeliveryWorkflow(
    [
      task(() => {
        throw new Error('configuration missing')
      }),
    ],
    helper(),
  )
  await workflow.rebuild()
  expect(getDiagnostics()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: 'workflow.build',
        level: 'error',
        context: { phase: 'delivery' },
      }),
    ]),
  )
})

test('records the failed task without persisting its job or resume payload', async () => {
  const ctx = helper()
  const workflow = await useDeliveryWorkflow(
    [
      task(() => async () => {
        throw new Error('submission failed')
      }),
    ],
    ctx,
  )
  await workflow.rebuild()
  clearDiagnostics()
  await workflow.execute({
    jobData: { key: 'private-id', jobName: 'private-job' },
    rawData: { resume: 'private-resume' },
  })
  expect(ctx.jobResultMaps.get('private-id').status).toBe('error')
  expect(getDiagnostics()[0]).toMatchObject({
    operation: 'workflow.task',
    level: 'error',
    context: { phase: 'delivery' },
  })
  expect(JSON.stringify(getDiagnostics())).not.toMatch(/private-id|private-job|private-resume/)
})
