// @ts-nocheck
import { afterEach, expect, mock, test } from 'bun:test'

import { clearDiagnostics, getDiagnostics } from './diagnostics'

mock.module('./index', () => ({ loader: () => () => {} }))
mock.module('@/message', () => ({ counter: {} }))
const { request } = await import('./request')
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  clearDiagnostics()
})

test('records HTTP failure status and endpoint without request or response payloads', async () => {
  globalThis.fetch = async () => new Response('private resume', { status: 401 })
  await expect(
    request({ url: 'https://example.test/api?token=secret', data: 'private body' }),
  ).rejects.toThrow('401')
  expect(getDiagnostics()[0]).toMatchObject({
    operation: 'network.direct',
    level: 'error',
    context: { endpoint: 'https://example.test', statusCode: 401 },
  })
  expect(JSON.stringify(getDiagnostics())).not.toMatch(/private|secret/)
})
