// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, expect, test } from 'bun:test'

import { MATCH_SCORING_VERSION } from '../../composables/useApplying/scoring'
import { JobLibraryStorage } from './jobLibraryStorage'
import { JOB_LIBRARY_STORAGE_KEY, mergeJobRecords } from './jobStore'

let data
let library
let writes
beforeEach(() => {
  data = new Map()
  writes = 0
  library = new JobLibraryStorage({
    getItem: async (key) => structuredClone(data.get(key) ?? null),
    setItem: async (key, value) => {
      writes++
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

test('retains a standalone greeting through normalization and later library mutations', async () => {
  await library.update({ type: 'greeting', jobId: 'one', greeting: '独立招呼语' })
  await library.update({ type: 'normalize' })
  await library.update({ type: 'funnel', jobId: 'one', stage: 'collected' })
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].finalGreeting).toBe('独立招呼语')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].analysis).toBeUndefined()
})

test('imports missing jobs without replacing existing records or their statuses', async () => {
  const existing = data.get(JOB_LIBRARY_STORAGE_KEY)[0]
  existing.reviewStatus = 'approved'
  existing.analysisStatus = 'ready'
  existing.analysis = { scoringVersion: MATCH_SCORING_VERSION, rating: 88 }
  const imported = mergeJobRecords(
    [],
    [{ encryptJobId: 'one' }, { encryptJobId: 'two' }],
    '历史导入',
    'merged',
  ).records

  const result = await library.update({ type: 'import', records: imported })

  expect(result).toMatchObject({ newCount: 1, duplicateCount: 1, updated: true })
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(2)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toMatchObject({
    encryptJobId: 'one',
    reviewStatus: 'approved',
    analysisStatus: 'ready',
    analysis: { rating: 88 },
  })
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[1].encryptJobId).toBe('two')
})

test('queues a send only once and only for the draft the user confirmed', async () => {
  await library.update({ type: 'greeting', jobId: 'one', greeting: '新草稿' })
  await expect(
    library.update({ type: 'send', jobId: 'one', status: 'queued', greeting: '旧草稿' }),
  ).rejects.toThrow('确认')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].sendStatus).toBe('pending')
  const queue = () =>
    library.update({ type: 'send', jobId: 'one', status: 'queued', greeting: '新草稿' })
  expect((await queue()).updated).toBe(true)
  expect((await queue()).updated).toBe(false)
  await library.update({ type: 'send', jobId: 'one', status: 'unknown' })
  expect((await queue()).updated).toBe(false)
})

test('saves a greeting for an analyzed job without overwriting analysis or protected states', async () => {
  await analyze()
  const before = structuredClone(data.get(JOB_LIBRARY_STORAGE_KEY)[0].analysis)
  expect(
    (await library.update({ type: 'greeting', jobId: 'one', greeting: '新草稿' })).updated,
  ).toBe(true)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].analysis).toEqual(before)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].finalGreeting).toBe('新草稿')
  await expect(library.update({ type: 'greeting', jobId: 'one', greeting: '  ' })).rejects.toThrow()
  for (const patch of [
    { processingStatus: 'excluded' },
    { reviewStatus: 'approved' },
    { sendStatus: 'queued' },
  ]) {
    Object.assign(data.get(JOB_LIBRARY_STORAGE_KEY)[0], patch)
    expect(
      (await library.update({ type: 'greeting', jobId: 'one', greeting: '禁止覆盖' })).updated,
    ).toBe(false)
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].finalGreeting).toBe('新草稿')
    Object.assign(data.get(JOB_LIBRARY_STORAGE_KEY)[0], {
      processingStatus: 'active',
      reviewStatus: 'pending',
      sendStatus: 'pending',
    })
  }
})

test('detail writes reject mismatched identities and previews without modifying the library', async () => {
  const before = structuredClone(data.get(JOB_LIBRARY_STORAGE_KEY))
  for (const jobInfo of [
    { encryptId: 'other', postDescription: 'Wrong JD' },
    { encryptId: 'one', postDescription: '登录查看完整内容' },
    { encryptId: 'one', postDescription: '' },
  ]) {
    await expect(
      library.update({
        type: 'detail',
        jobId: 'one',
        patch: { detailStatus: 'complete', detail: { jobInfo } },
      }),
    ).rejects.toThrow()
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual(before)
  }
})

test('late failure cannot downgrade a complete detail or resurrect an excluded job', async () => {
  const record = data.get(JOB_LIBRARY_STORAGE_KEY)[0]
  record.detailStatus = 'complete'
  record.detail = { jobInfo: { encryptId: 'one', postDescription: 'Complete existing JD' } }
  record.reviewStatus = 'approved'
  record.sendStatus = 'sent'
  expect(
    (
      await library.update({
        type: 'detail',
        jobId: 'one',
        patch: { detailStatus: 'failed', failureReason: 'timeout' },
      })
    ).updated,
  ).toBe(false)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0]).toEqual(record)
  await library.update({ type: 'processing', jobId: 'one', status: 'excluded' })
  expect(
    (
      await library.update({
        type: 'detail',
        jobId: 'one',
        patch: {
          detailStatus: 'complete',
          detail: { jobInfo: { encryptId: 'one', postDescription: 'New JD' } },
        },
      })
    ).updated,
  ).toBe(false)
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].processingStatus).toBe('excluded')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detail.jobInfo.postDescription).toBe(
    'Complete existing JD',
  )
})

test('history completion fixes candidate IDs, excludes complete/excluded jobs and has one owner', async () => {
  const records = mergeJobRecords(
    [],
    ['one', 'two', 'done', 'excluded'].map((encryptJobId) => ({ encryptJobId })),
    '',
    '',
  ).records
  records[2].detailStatus = 'complete'
  records[2].detail = { jobInfo: { postDescription: 'JD' } }
  records[3].processingStatus = 'excluded'
  data.set(JOB_LIBRARY_STORAGE_KEY, records)
  const run = await library.historyDetails({ type: 'start', token: 'a' })
  expect(run.jobIds).toEqual(['one', 'two'])
  expect(run.cursor).toBe(0)
  await expect(library.historyDetails({ type: 'resume', token: 'b' })).rejects.toThrow('另一页面')
  await library.historyDetails({ type: 'finish', token: 'a', status: 'stopped' })
  const resumed = await library.historyDetails({ type: 'resume', token: 'b' })
  expect(resumed.id).toBe(run.id)
  expect(resumed.cursor).toBe(0)
})

test('history checkpoint requires a confirmed detail save and rejects a displaced writer', async () => {
  await library.historyDetails({ type: 'start', token: 'a' })
  await expect(
    library.historyDetails({ type: 'advance', token: 'a', jobId: 'one', result: 'completed' }),
  ).rejects.toThrow('保存')
  const patch = {
    detailStatus: 'complete',
    detail: { jobInfo: { encryptId: 'one', postDescription: 'JD' } },
  }
  await library.update({ type: 'detail', jobId: 'one', patch, historyToken: 'a' })
  const run = await library.historyDetails({
    type: 'advance',
    token: 'a',
    jobId: 'one',
    result: 'completed',
  })
  expect(run).toMatchObject({ cursor: 1, completed: 1 })
  await library.historyDetails({ type: 'finish', token: 'a', status: 'completed' })
  await expect(
    library.update({ type: 'detail', jobId: 'one', patch, historyToken: 'a' }),
  ).rejects.toThrow('所有权')
})

test('history lease can be recovered after page loss without allowing late writes', async () => {
  const run = await library.historyDetails({ type: 'start', token: 'a' })
  const now = Date.now
  Date.now = () => now() + 120_000
  try {
    const resumed = await library.historyDetails({ type: 'resume', token: 'b' })
    expect(resumed.id).toBe(run.id)
    await expect(library.historyDetails({ type: 'renew', token: 'a' })).rejects.toThrow('所有权')
    expect((await library.historyDetails({ type: 'read' })).owner).toBe('b')
  } finally {
    Date.now = now
  }
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
        detail: { jobInfo: { encryptId: 'one', postDescription: '完整 JD' } },
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

test('deletes one saved job and leaves the other records intact', async () => {
  data.set(
    JOB_LIBRARY_STORAGE_KEY,
    mergeJobRecords([], [{ encryptJobId: 'one' }, { encryptJobId: 'two' }], '产品', 'batch')
      .records,
  )

  const result = await library.update({ type: 'delete', jobId: 'one' })

  expect(result.updated).toBe(true)
  expect(result.records.map((record) => record.encryptJobId)).toEqual(['two'])
  expect(data.get(JOB_LIBRARY_STORAGE_KEY).map((record) => record.encryptJobId)).toEqual(['two'])
})

test('deletes multiple saved jobs in one storage update', async () => {
  data.set(
    JOB_LIBRARY_STORAGE_KEY,
    mergeJobRecords(
      [],
      [{ encryptJobId: 'one' }, { encryptJobId: 'two' }, { encryptJobId: 'three' }],
      '产品',
      'batch',
    ).records,
  )

  const result = await library.update({ type: 'deleteMany', jobIds: ['one', 'three'] })

  expect(result.updated).toBe(true)
  expect(result.records.map((record) => record.encryptJobId)).toEqual(['two'])
  expect(data.get(JOB_LIBRARY_STORAGE_KEY).map((record) => record.encryptJobId)).toEqual(['two'])
  expect(writes).toBe(1)
})

test('rejects malformed bulk deletions without writing and keeps storage unchanged on write failure', async () => {
  const original = structuredClone(data.get(JOB_LIBRARY_STORAGE_KEY))
  for (const jobIds of [[], ['one', ''], ['one', null], 'one']) {
    await expect(library.update({ type: 'deleteMany', jobIds })).rejects.toThrow('缺少岗位 ID')
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual(original)
  }
  expect(writes).toBe(0)
  const failing = new JobLibraryStorage({
    getItem: async () => structuredClone(data.get(JOB_LIBRARY_STORAGE_KEY)),
    setItem: async () => {
      throw new Error('disk full')
    },
  })
  await expect(failing.update({ type: 'deleteMany', jobIds: ['one'] })).rejects.toThrow('disk full')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual(original)
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
