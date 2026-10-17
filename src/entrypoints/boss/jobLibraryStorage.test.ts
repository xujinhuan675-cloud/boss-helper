// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, expect, test } from 'bun:test'

import { MATCH_SCORING_VERSION } from '../../composables/useApplying/scoring'
import { JobLibraryStorage } from './jobLibraryStorage'
import { JOB_LIBRARY_STORAGE_KEY, mergeJobRecords } from './jobStore'

let data
let library
beforeEach(() => {
  data = new Map()
  library = new JobLibraryStorage({
    getItem: async (key) => structuredClone(data.get(key) ?? null),
    setItem: async (key, value) => {
      data.set(key, structuredClone(value))
    },
  })
  data.set(
    JOB_LIBRARY_STORAGE_KEY,
    mergeJobRecords([], [{ encryptJobId: 'one' }], '产品', 'batch').records,
  )
})
const analyze = () =>
  library.update({
    type: 'analysis',
    jobId: 'one',
    patch: {
      analysisStatus: 'ready',
      analysis: { scoringVersion: MATCH_SCORING_VERSION, passed: true },
      finalGreeting: '你好',
    },
  })

test('serializes overlapping collection, detail, analysis and local edits without losing fields', async () => {
  await Promise.all([
    library.update({
      type: 'capture',
      items: [{ encryptJobId: 'one' }, { encryptJobId: 'two' }],
      keyword: 'AI',
      batch: 'next',
    }),
    library.update({
      type: 'detail',
      jobId: 'one',
      patch: {
        detailStatus: 'complete',
        detailRetryCount: 0,
        detail: { jobInfo: { postDescription: '完整 JD' } },
      },
    }),
    analyze(),
    library.update({ type: 'funnel', jobId: 'one', stage: 'interview' }),
  ])
  const records = data.get(JOB_LIBRARY_STORAGE_KEY)
  expect(records).toHaveLength(2)
  expect(records[0]).toMatchObject({
    sourceKeywords: ['产品', 'AI'],
    detailStatus: 'complete',
    analysisStatus: 'ready',
    finalGreeting: '你好',
    manualFunnelStage: 'interview',
  })
  expect(records[0].matchedAt).toBeString()
})

test('checks the latest review, sending, exclusion and completed analysis before saving', async () => {
  for (const patch of [
    { reviewStatus: 'approved' },
    { sendStatus: 'sent' },
    { processingStatus: 'excluded' },
    { analysisStatus: 'ready', analysis: { scoringVersion: MATCH_SCORING_VERSION } },
  ]) {
    const [record] = mergeJobRecords([], [{ encryptJobId: 'one' }], '', 'batch').records
    Object.assign(record, patch)
    data.set(JOB_LIBRARY_STORAGE_KEY, [record])
    expect((await analyze()).updated).toBe(false)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual([record])
  }
})

test('preserves invalid storage and recovers the queue after a rejected mutation', async () => {
  data.set(JOB_LIBRARY_STORAGE_KEY, { broken: true })
  await expect(analyze()).rejects.toThrow('格式异常')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual({ broken: true })
  data.set(JOB_LIBRARY_STORAGE_KEY, [])
  await expect(library.update({ type: 'normalize' })).resolves.toMatchObject({ records: [] })
})

test('claims a job across clients, releases only its owner, and recovers abandoned claims', async () => {
  expect(await library.claimAnalysis('one', 'tab-a', 1000)).toBe(true)
  expect(await library.claimAnalysis('one', 'tab-a', 2000)).toBe(true)
  expect(await library.claimAnalysis('one', 'tab-b', 1000)).toBe(false)
  await library.releaseAnalysis('one', 'tab-b')
  expect(await library.claimAnalysis('one', 'tab-b', 1000)).toBe(false)
  await library.releaseAnalysis('one', 'tab-a')
  expect(await library.claimAnalysis('one', 'tab-b', 1000)).toBe(true)
  const key = [...data.keys()].find((key) => key.startsWith('session:'))
  data.get(key)[0].expiresAt = Date.now() - 1
  expect(await library.claimAnalysis('one', 'tab-c', 1000)).toBe(true)
})

test('propagates a failed disk write without reporting a saved result', async () => {
  const failing = new JobLibraryStorage({
    getItem: async () => structuredClone(data.get(JOB_LIBRARY_STORAGE_KEY)),
    setItem: async () => {
      throw new Error('disk full')
    },
  })
  await expect(
    failing.update({ type: 'analysis', jobId: 'one', patch: { analysisStatus: 'failed' } }),
  ).rejects.toThrow('disk full')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].analysisStatus).toBe('pending')
})
