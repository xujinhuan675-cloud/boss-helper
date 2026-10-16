// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it, mock } from 'bun:test'

import { parseGptJson } from '../../utils/ai'

mock.module('@/message', () => ({ counter: {} }))
mock.module('@/utils/ai', () => ({ parseGptJson }))
const { parseFiltering } = await import('./utils')
const { getFilteringDecision, formatFilteringMessage } = await import('./scoring')

function result() {
  return {
    dimensions: [
      { key: 'responsibilities', score: 24, reason: '职责与求职方向一致' },
      { key: 'skills', score: 20, reason: '具备核心技能' },
      { key: 'experience', score: 18, reason: '有相关项目经验' },
      { key: 'industry', score: 6, reason: '有相邻行业背景' },
      { key: 'preferences', score: 8, reason: '部分满足个人偏好' },
    ],
    strengths: ['核心技能匹配'],
    gaps: ['缺少直接行业经验'],
    hardRequirements: [],
    uncertainties: [],
  }
}

describe('fixed job matching rubric', () => {
  it('renders completed scores and keeps incomplete streaming text or errors readable', () => {
    expect(formatFilteringMessage(JSON.stringify(result()))).toContain('76/100')
    for (const content of [
      '',
      '{"dimensions":[',
      'Failed to fetch',
      '{"positive":[],"negative":[]}',
    ]) {
      expect(formatFilteringMessage(content)).toBe(content)
    }
  })

  it.each([
    [0, true],
    [70, true],
    [76, true],
    [77, false],
    [100, false],
  ])('compares the verified 76-point result with threshold %s', (threshold, passed) => {
    expect(getFilteringDecision(parseFiltering(JSON.stringify(result())), threshold)).toBe(passed)
  })

  it.each([
    [{ requirement: '必须硕士', status: 'met', reason: '简历明确为硕士' }, true],
    [{ requirement: '必须硕士', status: 'unmet', reason: '简历明确为本科' }, false],
    [{ requirement: '必须硕士', status: 'unknown', reason: '简历缺少学历' }, null],
  ])('applies hard requirements before comparing the score', (requirement, passed) => {
    const value = result()
    value.hardRequirements = [requirement]
    expect(getFilteringDecision(parseFiltering(JSON.stringify(value)), 70)).toBe(passed)
  })

  it.each([-1, 101, 70.5, null, '70'])('rejects an invalid threshold %s', (threshold) => {
    expect(() =>
      getFilteringDecision(parseFiltering(JSON.stringify(result())), threshold),
    ).toThrow()
  })

  it('sums five fixed dimensions to 76/100 without counting explanations or a model total', () => {
    const value = { ...result(), rating: 999, positive: [{ score: 1000, reason: '重复加分' }] }
    const parsed = parseFiltering(JSON.stringify(value))
    expect(parsed.rating).toBe(76)
    expect(parsed.maxScore).toBe(100)
    expect(parsed.scoringVersion).toBe('weighted-v1')
    expect(parsed.needsConfirmation).toBe(false)
    expect(parsed.message).toContain('76/100')
  })

  it('keeps unconfirmed dimensions distinct from confirmed mismatches', () => {
    const value = result()
    value.dimensions[4] = { key: 'preferences', score: null, reason: '岗位未说明工作制' }
    const parsed = parseFiltering(JSON.stringify(value))
    expect(parsed.rating).toBe(68)
    expect(parsed.res.dimensions[4].score).toBeNull()
    expect(parsed.needsConfirmation).toBe(true)
    expect(getFilteringDecision(parsed, 0)).toBeNull()
  })

  it.each(['unmet', 'unknown'])(
    'keeps hard requirement status %s separate from the score',
    (status) => {
      const value = result()
      value.hardRequirements = [{ requirement: '硕士学历', status, reason: '学历需核对' }]
      const parsed = parseFiltering(JSON.stringify(value))
      expect(parsed.rating).toBe(76)
      expect(parsed.hardRequirementFailed).toBe(status === 'unmet')
      expect(parsed.needsConfirmation).toBe(status === 'unknown')
    },
  )

  it.each([
    ['negative', -1],
    ['over maximum', 31],
    ['fractional', 24.5],
    ['string', '24'],
  ])('rejects a %s dimension score', (_name, score) => {
    const value = result()
    value.dimensions[0].score = score
    expect(() => parseFiltering(JSON.stringify(value))).toThrow()
  })

  it.each(['missing', 'duplicate', 'unknown', 'empty reason'])('rejects %s dimensions', (kind) => {
    const value = result()
    if (kind === 'missing') value.dimensions.pop()
    if (kind === 'duplicate') value.dimensions[4].key = 'skills'
    if (kind === 'unknown') value.dimensions[4].key = 'other'
    if (kind === 'empty reason') value.dimensions[4].reason = ' '
    expect(() => parseFiltering(JSON.stringify(value))).toThrow()
  })

  it('rejects incomplete JSON and the old unconstrained scoring response', () => {
    expect(() => parseFiltering(JSON.stringify(result()).slice(0, -1))).toThrow()
    expect(() => parseFiltering('{"positive":[],"negative":[]}')).toThrow()
  })

  it('accepts fenced JSON and normalizes dimension ordering', () => {
    const value = result()
    value.dimensions.reverse()
    const parsed = parseFiltering('```json\n' + JSON.stringify(value) + '\n```')
    expect(parsed.rating).toBe(76)
    expect(parsed.res.dimensions[0].key).toBe('responsibilities')
  })
})
