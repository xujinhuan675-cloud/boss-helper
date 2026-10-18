// @ts-nocheck
import { beforeEach, expect, test } from 'bun:test'

import {
  clearDiagnostics,
  configureDiagnostics,
  diagnostic,
  getDiagnostics,
  hydrateDiagnostics,
  traceDiagnostic,
} from './diagnostics'

beforeEach(() => {
  configureDiagnostics('workbench')
  clearDiagnostics()
})

test('keeps bounded metadata and removes credentials and request payloads', () => {
  diagnostic('network.request', {
    error: new Error(
      'Failed https://user:pass@example.com/v1?key=secret Authorization: Bearer sk-test-secret',
    ),
    context: {
      endpoint: 'https://user:pass@example.com/v1?token=secret',
      statusCode: 401,
      body: 'resume',
      api_key: 'secret',
    },
  })
  const record = getDiagnostics()[0]
  expect(record.context).toEqual({ endpoint: 'https://example.com', statusCode: 401 })
  expect(record.error).toContain('Failed')
  expect(JSON.stringify(record)).not.toMatch(/secret|user:pass|resume/)
})

test('does not persist an API error response or an echoed prompt', () => {
  diagnostic('model.request', {
    error: Object.assign(new Error('private resume text'), { statusCode: 401 }),
  })
  expect(getDiagnostics()[0].error).toContain('401')
  expect(JSON.stringify(getDiagnostics())).not.toContain('private resume')
})

test('does not copy model parsing errors or serialized HTTP response bodies', () => {
  diagnostic('model.generate.filtering', {
    error: new SyntaxError('invalid JSON: private resume text'),
  })
  diagnostic('boss.content.request', { error: new Error('状态码: 401: private resume text') })
  expect(JSON.stringify(getDiagnostics())).not.toContain('private resume')
  expect(getDiagnostics()[0].error).toContain('SyntaxError')
  expect(getDiagnostics()[1].error).toContain('401')
})

test('keeps model-origin and parsing error payloads out of outer workflow diagnostics', () => {
  const failure = new Error('echoed private resume text')
  diagnostic('model.chat.filtering', { error: failure })
  diagnostic('workflow.task', { error: failure })
  diagnostic('workflow.task', { error: new SyntaxError('private resume JSON') })
  diagnostic('rotation.finish', { error: failure.message })
  expect(JSON.stringify(getDiagnostics())).not.toContain('private resume')
  expect(failure.message).toContain('private resume')
})

test('preserves a failed operation and its duration without swallowing rejection', async () => {
  const error = new Error('disk full')
  await expect(
    traceDiagnostic('config.save', async () => {
      throw error
    }),
  ).rejects.toBe(error)
  expect(getDiagnostics()[0]).toMatchObject({
    operation: 'config.save',
    level: 'error',
    error: 'disk full',
  })
  expect(getDiagnostics()[0].durationMs).toBeGreaterThanOrEqual(0)
})

test('storage/sink failure cannot change an operation result', async () => {
  configureDiagnostics('boss', () => {
    throw new Error('diagnostics offline')
  })
  expect(await traceDiagnostic('collect', async () => 7)).toBe(7)
  diagnostic('collect', { error: new Error('failed') })
  expect(getDiagnostics().at(-1).source).toBe('boss')
})

test('caps records and deduplicates hydration without sending it back to the sink', () => {
  let published = 0
  configureDiagnostics('content', () => {
    published++
  })
  for (let i = 0; i < 230; i++) diagnostic('poll', { error: new Error(`failure ${i}`) })
  const saved = getDiagnostics()
  expect(saved.length).toBeLessThanOrEqual(200)
  hydrateDiagnostics(saved)
  expect(getDiagnostics()).toHaveLength(saved.length)
  expect(published).toBe(230)
})
