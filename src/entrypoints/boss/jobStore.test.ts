// @ts-nocheck
import { describe, expect, it } from 'bun:test'

import {
  assertJobLibrary,
  buildAnalysisHandoff,
  COLLECTION_SCROLL_SELECTORS,
  filterJobLibrary,
  getJobFunnel,
  getJobFunnelStage,
  isJobExcluded,
  mergeJobRecords,
  normalizeJobLibraryAnalysis,
  sortJobLibraryByMatch,
  stopCollectionRun,
} from './jobStore'
import type { BossZpJobItemData } from './types'

const item = (id: string): BossZpJobItemData =>
  ({
    encryptJobId: id,
    jobName: `岗位-${id}`,
    salaryDesc: '10-15K',
    jobLabels: [],
    skills: [],
  }) as unknown as BossZpJobItemData

describe('job library', () => {
  it('hides obsolete analysis from a detached view while retaining details, current results and delivery history', () => {
    const records = mergeJobRecords(
      [],
      [item('old'), item('current'), item('sent')],
      'AI',
      'batch',
    ).records
    for (const record of records)
      Object.assign(record, {
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: 'Saved JD' } },
        analysis: { rating: 200 },
        analysisStatus: 'ready',
        finalGreeting: 'Old draft',
        analysisFailureReason: 'Old failure',
        matchedAt: '2026-10-15T00:00:00Z',
        reviewStatus: 'approved',
        manualFunnelStage: 'interview',
        processingStatus: 'excluded',
      })
    records[1].analysis = { scoringVersion: 'current', rating: 76 }
    records[2].sendStatus = 'sent'
    const before = JSON.stringify(records)
    const normalized = normalizeJobLibraryAnalysis(records, 'current')
    expect(JSON.stringify(records)).toBe(before)
    expect(normalized[0]).toMatchObject({
      detail: { jobInfo: { postDescription: 'Saved JD' } },
      detailStatus: 'complete',
      analysisStatus: 'pending',
      reviewStatus: 'pending',
      sendStatus: 'pending',
      manualFunnelStage: 'interview',
      processingStatus: 'excluded',
    })
    for (const field of ['analysis', 'finalGreeting', 'analysisFailureReason', 'matchedAt']) {
      expect(normalized[0][field]).toBeUndefined()
    }
    expect(normalized[1]).toEqual(records[1])
    expect(normalized[2]).toMatchObject({
      analysisStatus: 'pending',
      reviewStatus: 'approved',
      sendStatus: 'sent',
    })
    normalized[0].detail.jobInfo.postDescription = 'Changed'
    expect(records[0].detail.jobInfo.postDescription).toBe('Saved JD')
  })

  it('reuses current records without initiating a cleanup for pending or current results', () => {
    const records = mergeJobRecords([], [item('pending'), item('current')], 'AI', 'batch').records
    records[1].analysis = { scoringVersion: 'current', rating: 76 }
    records[1].analysisStatus = 'ready'
    expect(normalizeJobLibraryAnalysis(records, 'current')).toBe(records)
    expect(normalizeJobLibraryAnalysis([], 'current')).toEqual([])
  })

  it('accepts existing saved records and missing optional display fields without changing them', () => {
    const records = mergeJobRecords([], [item('saved')], 'AI', 'batch').records
    records[0].detail = { jobInfo: { postDescription: 'Saved JD' } }
    records[0].analysis = { rating: 200 }
    const before = JSON.stringify(records)
    expect(() => assertJobLibrary(records)).not.toThrow()
    expect(() => assertJobLibrary([])).not.toThrow()
    expect(JSON.stringify(records)).toBe(before)
  })

  it.each([null, {}, [null], [{ encryptJobId: '' }]])(
    'rejects invalid storage without replacing it: %j',
    (records) => {
      const before = JSON.stringify(records)
      expect(() => assertJobLibrary(records)).toThrow('本地岗位库格式异常；已保留原数据')
      expect(JSON.stringify(records)).toBe(before)
    },
  )

  it.each([
    { sourceKeywords: [1] },
    { manualFunnelStage: 'unknown' },
    { finalGreeting: { text: 'broken' } },
    { failureReason: ['broken'] },
    { snapshot: { encryptJobId: 'broken', jobName: ['broken'] } },
    { detail: { jobInfo: { postDescription: { text: 'broken' } } } },
    { detail: { jobInfo: {}, bossInfo: { title: 1 } } },
  ])('rejects a partially damaged library without changing valid records: %j', (patch) => {
    const records = mergeJobRecords([], [item('valid'), item('broken')], 'AI', 'batch').records
    Object.assign(records[1], patch)
    const before = JSON.stringify(records)
    expect(() => assertJobLibrary(records)).toThrow('本地岗位库格式异常；已保留原数据')
    expect(JSON.stringify(records)).toBe(before)
  })

  const filterRecords = () => {
    const records = mergeJobRecords(
      [],
      [
        { ...item('a'), jobName: 'AI Product Manager', brandName: 'Acme Lab', bossName: 'Alice' },
        { ...item('b'), jobName: 'Engineer', brandName: 'Beta Corp', bossName: 'Bob' },
        { ...item('c'), jobName: 'Designer', brandName: 'Acme Studio', bossTitle: 'Recruiter' },
      ],
      'AI产品经理',
      'run-1',
      '2026-10-15T09:00:00.000Z',
    ).records
    records[0].detailStatus = 'complete'
    records[0].detail = {
      jobInfo: { jobName: 'Product Lead', postDescription: 'Build LLM workflows' },
      bossInfo: { name: 'Carol', title: 'Talent Partner', brandName: 'Acme Group' },
      brandComInfo: { brandName: 'Acme Technology' },
    }
    records[1].detailStatus = 'failed'
    records[1].sourceKeywords = ['产品经理']
    return records
  }

  it.each([
    ['product', ['a']],
    ['BETA', ['b']],
    ['alice', ['a']],
    ['recruiter', ['c']],
    ['CAROL', ['a']],
    ['talent partner', ['a']],
    ['llm', ['a']],
    ['technology', ['a']],
    ['missing', []],
  ])('searches saved title, company, HR and JD fields for %s', (search, ids) => {
    expect(
      filterJobLibrary(filterRecords(), { search }).map((record) => record.encryptJobId),
    ).toEqual(ids)
  })

  it('combines independent company, exact source keyword and detail status filters', () => {
    const records = filterRecords()
    expect(
      filterJobLibrary(records, {
        search: 'ai',
        company: 'ACME',
        sourceKeyword: 'AI产品经理',
        detailStatus: 'complete',
      }).map((record) => record.encryptJobId),
    ).toEqual(['a'])
    expect(filterJobLibrary(records, { search: 'bob', company: 'Acme' })).toEqual([])
    expect(filterJobLibrary(records, { company: 'Technology' })).toEqual([records[0]])
    expect(filterJobLibrary(records, { sourceKeyword: '产品经理' })).toEqual([records[1]])
    expect(filterJobLibrary(records, { sourceKeyword: 'ai产品经理' })).toEqual([])
    expect(filterJobLibrary(records, { detailStatus: 'failed' })).toEqual([records[1]])
    expect(filterJobLibrary(records, { detailStatus: 'pending' })).toEqual([records[2]])
  })

  it('keeps input data and ordering intact when filtering or clearing filters', () => {
    const records = filterRecords()
    const before = JSON.stringify(records)
    expect(filterJobLibrary(records)).toEqual(records)
    expect(
      filterJobLibrary(records, { search: '', company: '', sourceKeyword: '', detailStatus: '' }),
    ).toEqual(records)
    expect(filterJobLibrary(records, { company: 'acme' })).toEqual([records[0], records[2]])
    expect(JSON.stringify(records)).toBe(before)
    expect(filterJobLibrary([], { search: 'ai' })).toEqual([])
  })

  it('hides excluded jobs by default and can show only excluded or all jobs', () => {
    const records = filterRecords()
    records[1].processingStatus = 'excluded'

    expect(isJobExcluded(records[0])).toBe(false)
    expect(isJobExcluded(records[1])).toBe(true)
    expect(getJobFunnel(records).collected).toBe(2)
    expect(filterJobLibrary(records).map((record) => record.encryptJobId)).toEqual(['a', 'c'])
    expect(
      filterJobLibrary(records, { processingStatus: 'excluded' }).map(
        (record) => record.encryptJobId,
      ),
    ).toEqual(['b'])
    expect(
      filterJobLibrary(records, { processingStatus: 'all' }).map((record) => record.encryptJobId),
    ).toEqual(['a', 'b', 'c'])
  })

  it('sorts saved jobs by match rating descending and keeps unrated jobs last', () => {
    const records = mergeJobRecords(
      [],
      [item('low'), item('unrated'), item('high'), item('tie')],
      'AI产品经理',
      'run-1',
    ).records
    records[0].analysis = { rating: 12 }
    records[2].analysis = { rating: 88 }
    records[3].analysis = { rating: 88 }

    expect(sortJobLibraryByMatch(records).map((record) => record.encryptJobId)).toEqual([
      'high',
      'tie',
      'low',
      'unrated',
    ])
    expect(records.map((record) => record.encryptJobId)).toEqual(['low', 'unrated', 'high', 'tie'])
  })

  it('exposes BOSS list scroll candidates and stops a running collection immediately', () => {
    expect(COLLECTION_SCROLL_SELECTORS).toContain('.job-list-container')
    expect(COLLECTION_SCROLL_SELECTORS).toContain('.rec-job-list')
    expect(COLLECTION_SCROLL_SELECTORS).toContain('.recommend-result-inner')

    const stopped = stopCollectionRun(
      {
        id: 'run-1',
        keyword: 'AI产品经理',
        searchUrl: 'https://www.zhipin.com/web/geek/jobs',
        filterSnapshot: { salary: '10-15K', city: '上海' },
        startedAt: '2026-10-14T00:00:00.000Z',
        status: 'running',
        savedCount: 1,
        newCount: 1,
        duplicateCount: 0,
        lastScrollTop: 0,
        lastScrollHeight: 1000,
      },
      '2026-10-14T00:01:00.000Z',
    )

    expect(stopped).toMatchObject({
      status: 'stopped',
      endedAt: '2026-10-14T00:01:00.000Z',
    })
  })

  it('deduplicates by encryptJobId and preserves review/send state', () => {
    const first = mergeJobRecords(
      [],
      [item('a'), item('b')],
      'AI产品经理',
      'run-1',
      '2026-10-14T00:00:00.000Z',
    )
    first.records[0].reviewStatus = 'approved'
    first.records[0].sendStatus = 'queued'

    const second = mergeJobRecords(
      first.records,
      [item('a'), item('c')],
      '产品经理',
      'run-2',
      '2026-10-14T01:00:00.000Z',
    )

    expect(second.newCount).toBe(1)
    expect(second.duplicateCount).toBe(1)
    expect(second.records).toHaveLength(3)
    expect(second.records.find((record) => record.encryptJobId === 'a')).toMatchObject({
      reviewStatus: 'approved',
      sendStatus: 'queued',
      sourceKeywords: ['AI产品经理', '产品经理'],
    })
  })

  it('exports a stable analysis handoff without replacing review state', () => {
    const merged = mergeJobRecords(
      [],
      [item('a')],
      'AI产品经理',
      'run-1',
      '2026-10-14T00:00:00.000Z',
    )
    merged.records[0].analysis = { category: 'P' }
    merged.records[0].finalGreeting = '您好，我有 AI 产品经验。'
    const handoff = buildAnalysisHandoff(merged.records)

    expect(handoff[0]).toMatchObject({
      encryptJobId: 'a',
      jobUrl: 'https://www.zhipin.com/job_detail/a.html',
      analysis: { category: 'P' },
      finalGreeting: '您好，我有 AI 产品经验。',
      reviewStatus: 'pending',
      manualFunnelStage: undefined,
    })
  })

  it('derives cumulative funnel stages and keeps manual stages as overrides', () => {
    const records = mergeJobRecords(
      [],
      [
        { ...item('a'), contact: true },
        { ...item('b'), contact: false },
        { ...item('c'), contact: true },
      ],
      'AI产品经理',
      'run-1',
      '2026-10-15T12:00:00.000Z',
    ).records
    records[0].analysis = { passed: true }
    records[0].sendStatus = 'sent'
    records[1].manualFunnelStage = 'interview'
    records[2].manualFunnelStage = 'offer'

    expect(getJobFunnel(records, new Date('2026-10-15T12:00:00.000Z'))).toEqual({
      collected: 3,
      collectedToday: 3,
      matched: 3,
      matchedToday: 0,
      applied: 3,
      replied: 3,
      interview: 2,
      offer: 1,
    })
    expect(getJobFunnelStage(records[1])).toBe('interview')
    expect(filterJobLibrary(records, { funnelStage: 'interview' })).toHaveLength(2)
  })

  it('opens the same active jobs counted by the today-matched statistic', () => {
    const records = mergeJobRecords(
      [],
      ['yesterday', 'today', 'excluded', 'invalid', 'missing'].map(item),
      'AI',
      'run-1',
    ).records
    const now = new Date(2026, 9, 15, 12)
    records[0].matchedAt = '2026-10-14T23:59:59'
    records[1].matchedAt = '2026-10-15T00:00:00'
    records[2].matchedAt = '2026-10-15T10:00:00'
    records[2].processingStatus = 'excluded'
    records[3].matchedAt = 'invalid'
    const filtered = filterJobLibrary(records, { matchedToday: true }, now)
    expect(filtered.map((record) => record.encryptJobId)).toEqual(['today'])
    expect(filtered.length).toBe(getJobFunnel(records, now).matchedToday)
    expect(filterJobLibrary(records, { matchedToday: false }, now)).toHaveLength(4)
    expect(filterJobLibrary(records, { matchedToday: true, search: 'missing' }, now)).toEqual([])
  })

  it('counts only the stage transitions that happened today', () => {
    const records = mergeJobRecords(
      [],
      [item('yesterday'), item('today')],
      'AI',
      'run-1',
      '2026-10-14T12:00:00.000Z',
    ).records
    records[0].analysis = { passed: true }
    records[0].matchedAt = '2026-10-15T08:00:00.000Z'
    records[1].firstSeenAt = '2026-10-15T09:00:00.000Z'
    records[1].lastSeenAt = records[1].firstSeenAt
    records[1].analysis = { passed: true }
    records[1].matchedAt = '2026-10-15T09:30:00.000Z'

    expect(getJobFunnel(records, new Date('2026-10-15T12:00:00.000Z'))).toMatchObject({
      collected: 2,
      collectedToday: 1,
      matched: 2,
      matchedToday: 2,
    })
  })
})
