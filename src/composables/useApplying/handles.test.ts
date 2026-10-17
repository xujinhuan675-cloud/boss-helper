// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it, mock } from 'bun:test'

import { renderTemplate } from '../../utils/ai'

mock.module('@/message', () => ({ counter: {} }))
mock.module('@/utils/ai', () => ({ renderTemplate }))
mock.module('../../entrypoints/boss/requests', () => ({
  sameCompanyKey: 'company',
  sameHrKey: 'hr',
}))
mock.module('./type', () => ({ defineTaskHandler: (id, task) => () => ({ id, task }) }))
const { TaskRegistry } = await import('./handles')

function result() {
  return {
    dimensions: [
      { key: 'responsibilities', score: 24, reason: '职责匹配' },
      { key: 'skills', score: 20, reason: '技能匹配' },
      { key: 'experience', score: 18, reason: '项目匹配' },
      { key: 'industry', score: 6, reason: '行业相关' },
      { key: 'preferences', score: 8, reason: '偏好匹配' },
    ],
    strengths: [],
    gaps: [],
    hardRequirements: [],
    uncertainties: [],
  }
}

describe('workflow matching gate', () => {
  it.each([
    'confirmed',
    'below threshold',
    'hard mismatch',
    'unknown requirement',
    'unknown dimension',
  ])('only continues verified matches: %s', async (kind) => {
    const value = result()
    if (kind === 'hard mismatch' || kind === 'unknown requirement') {
      value.hardRequirements = [
        {
          requirement: '必须硕士',
          status: kind === 'hard mismatch' ? 'unmet' : 'unknown',
          reason: '学历依据',
        },
      ]
    }
    if (kind === 'unknown dimension') value.dimensions[4].score = null
    const ctx = {
      helper: {
        conf: {
          formData: { aiFiltering: { enable: true, score: kind === 'below threshold' ? 80 : 0 } },
        },
        chatModel: { createAgent: () => true, chat: async () => ({ text: JSON.stringify(value) }) },
      },
    }
    const handler = new TaskRegistry().aiFiltering().task(ctx)
    const decision = await handler(ctx, {})
    if (kind === 'confirmed') expect(decision).toBeUndefined()
    else expect(decision.isSkip).toBe(true)
  })

  it('rejects invalid thresholds before creating an agent or requesting analysis', () => {
    const forbidden = () => {
      throw new Error('must not initialize model')
    }
    const ctx = {
      helper: {
        conf: { formData: { aiFiltering: { enable: true, score: -1 } } },
        chatModel: { createAgent: forbidden, chat: forbidden },
      },
    }
    expect(() => new TaskRegistry().aiFiltering().task(ctx)).toThrow('通过分数')
  })
})

describe('keyword exclusion filters', () => {
  it('does not filter when the keyword list is blank', () => {
    const ctx = { helper: { conf: { formData: { jobTitle: { value: [] } } } } }
    expect(new TaskRegistry().jobTitle().task(ctx)).toBeUndefined()
  })

  it.each([
    ['jobTitle', { jobName: 'Senior Engineer' }, 'engineer'],
    ['company', { brand: { name: 'Example Agency' } }, 'Agency'],
    ['jobContent', { jobDescription: 'Work at a staffing agency' }, 'agency'],
    ['hrPosition', { boss: { title: 'Recruiter' } }, 'Recruiter'],
  ])('excludes matching %s keywords without an enable switch', async (key, jobData, keyword) => {
    const ctx = { helper: { conf: { formData: { [key]: { value: [keyword] } } } } }
    const result = await new TaskRegistry()[key]().task(ctx)(ctx, { jobData })
    expect(result.isSkip).toBe(true)
    expect(result.reason).toContain('排除关键词')
  })
})
