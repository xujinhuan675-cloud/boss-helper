// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it } from 'bun:test'

import {
  completeKeyword,
  createKeywordRotationPlan,
  failKeyword,
  keywordRotationDateKey,
  markKeywordRunning,
  nextKeywordIndex,
  normalizeKeywordList,
  normalizeSearchUrl,
  parseJobKeywords,
  resetKeywordRotationPlan,
} from './keywordRotation'

describe('keyword rotation state', () => {
  it('uses the local calendar day for the daily quota', () => {
    expect(keywordRotationDateKey(new Date(2026, 9, 17, 0, 5))).toBe('2026-10-17')
    expect(keywordRotationDateKey(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
  })
  it('extracts editable job titles from plain and fenced AI JSON', () => {
    for (const text of [
      '{"keywords":["产品经理"," AI产品经理 ","产品经理",""]}',
      '```json\n{"keywords":["产品经理"," AI产品经理 ","产品经理",""]}\n```',
    ]) {
      expect(parseJobKeywords(text)).toEqual(['产品经理', 'AI产品经理'])
    }
  })

  it('rejects empty and malformed keyword responses', () => {
    for (const text of [
      '没有合适的岗位',
      '{}',
      '{"keywords":"产品经理"}',
      '{"keywords":[]}',
      '{"keywords":[" "]}',
      '{"keywords":["产品经理",123]}',
    ]) {
      expect(() => parseJobKeywords(text)).toThrow('岗位关键词')
    }
  })

  it('normalizes pasted keywords without changing order', () => {
    expect(normalizeKeywordList('产品经理\n AI产品经理\n产品经理\n')).toEqual([
      '产品经理',
      'AI产品经理',
    ])
  })

  it('keeps native search filters while replacing only the query', () => {
    expect(
      normalizeSearchUrl(
        'https://www.zhipin.com/web/geek/jobs?city=101020100&salary=405&query=AI&page=2#top',
      ),
    ).toBe('https://www.zhipin.com/web/geek/jobs?city=101020100&salary=405')
  })

  it('advances only after a keyword run completes', () => {
    const plan = createKeywordRotationPlan(['A', 'B'], {
      baseSearchUrl: 'https://www.zhipin.com/web/geek/jobs?city=1&salary=405&query=A',
      salary: '10-20K',
      city: '上海',
      now: '2026-10-16T00:00:00.000Z',
    })
    const running = markKeywordRunning(plan, 0, 'run-a', '2026-10-16T00:01:00.000Z')
    expect(nextKeywordIndex(running)).toBe(0)
    const completed = completeKeyword(running, 0, 'run-a', '2026-10-16T00:02:00.000Z')
    expect(completed.status).toBe('running')
    expect(completed.cursor).toBe(1)
    expect(nextKeywordIndex(completed)).toBe(1)
  })

  it('keeps the failed keyword as the retry cursor', () => {
    const plan = createKeywordRotationPlan(['A', 'B'], {
      baseSearchUrl: 'https://www.zhipin.com/web/geek/jobs?city=1',
      salary: '',
      city: '',
    })
    const failed = failKeyword(plan, 0, '需要登录')
    expect(failed.status).toBe('failed')
    expect(failed.cursor).toBe(0)
    expect(nextKeywordIndex(failed)).toBe(0)
  })

  it('resets a completed plan for a new rotation cycle', () => {
    const plan = createKeywordRotationPlan(['A'], {
      baseSearchUrl: 'https://www.zhipin.com/web/geek/jobs?city=1',
      salary: '',
      city: '',
    })
    const completed = completeKeyword(plan, 0, 'run-a')
    const reset = resetKeywordRotationPlan(completed)
    expect(reset.status).toBe('running')
    expect(reset.cursor).toBe(0)
    expect(reset.items[0].status).toBe('pending')
  })
})
