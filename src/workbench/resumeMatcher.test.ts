// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { expect, test } from 'bun:test'

import * as resumeMatcher from './resumeMatcher'

const job = {
  key: 'boss::job-1',
  jobName: 'Product Manager',
  positionName: 'PM',
  jobDescription: 'Own roadmap and coordinate engineering.',
  brand: { name: 'Example Co' },
  salary: '20-30K',
  city: 'Shanghai',
  link: 'https://example.com/jobs/1',
}

test('builds a one-time Resume Matcher handoff from job details only', () => {
  expect(typeof resumeMatcher.buildResumeMatcherHandoff).toBe('function')
  if (!resumeMatcher.buildResumeMatcherHandoff) return
  const handoff = resumeMatcher.buildResumeMatcherHandoff(job, 'handoff-1', 123)

  expect(handoff).toEqual({
    type: 'boss-helper-resume-matcher-handoff',
    id: 'handoff-1',
    createdAt: 123,
    job: {
      title: 'Product Manager',
      company: 'Example Co',
      salary: '20-30K',
      city: 'Shanghai',
      link: 'https://example.com/jobs/1',
      description: 'Own roadmap and coordinate engineering.',
    },
  })
  expect(handoff).not.toHaveProperty('resume')
})

test('links to the Resume Matcher tailor page with only the handoff id in the URL', () => {
  expect(typeof resumeMatcher.buildResumeMatcherUrl).toBe('function')
  if (!resumeMatcher.buildResumeMatcherUrl) return
  const url = new URL(resumeMatcher.buildResumeMatcherUrl('handoff-1'))

  expect(url.origin).toBe('http://localhost:3000')
  expect(url.pathname).toBe('/tailor')
  expect(url.hash).toBe('#boss-helper-handoff=handoff-1')
})

test('requires a job description but does not require an OfferHunt resume', () => {
  expect(typeof resumeMatcher.getResumeTailoringInputError).toBe('function')
  if (!resumeMatcher.getResumeTailoringInputError) return
  expect(resumeMatcher.getResumeTailoringInputError({ jobDescription: 'JD' })).toBeNull()
  expect(resumeMatcher.getResumeTailoringInputError({ jobDescription: '  ' })).toBe(
    '当前岗位缺少 JD，请先在 BOSS 获取岗位详情',
  )
})
