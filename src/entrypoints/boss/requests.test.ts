// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, expect, test, mock } from 'bun:test'

import * as errors from '../../composables/useApplying/deliverError'

mock.module('@/composables/useApplying/deliverError', () => errors)
mock.module('@/utils/file', () => ({ calculateFileMD5() {} }))
mock.module('@/utils/logger', () => ({ logger: { error() {} } }))

globalThis.useToast = () => ({ add() {} })
const { getJobDetail } = await import('./requests')
let requested
beforeEach(() => {
  requested = []
  globalThis.window = { Cookie: { get: () => 'test-token' } }
  globalThis.fetch = async (url, init) => {
    requested.push({ url, init })
    return new Response(JSON.stringify({ code: 0, message: '', zpData: {} }), {
      headers: { 'content-type': 'application/json' },
    })
  }
})

test('uses the saved lid and session token for a single detail read', async () => {
  expect((await getJobDetail({ securityId: 'sec', lid: 'saved-lid' })).code).toBe(0)
  expect(new URL(requested[0].url).searchParams.get('lid')).toBe('saved-lid')
  expect(requested[0].init.headers.Zp_token).toBe('test-token')
  expect(requested[0].init.credentials).toBe('same-origin')
  expect(requested).toHaveLength(1)
})

test.each([401, 403, 429, 503])(
  'rejects HTTP %s before treating the body as detail data',
  async (status) => {
    globalThis.fetch = async () =>
      new Response('{}', { status, headers: { 'content-type': 'application/json' } })
    await expect(getJobDetail({ securityId: 'sec', lid: 'lid' })).rejects.toThrow(String(status))
  },
)

test('stops for a login redirect and rejects HTML or malformed envelopes', async () => {
  globalThis.fetch = async () => ({
    url: 'https://www.zhipin.com/web/user/?redirect=jobs',
    ok: true,
    headers: new Headers(),
    json: async () => ({}),
  })
  await expect(getJobDetail({ securityId: 'sec', lid: 'lid' })).rejects.toThrow('登录')
  globalThis.fetch = async () =>
    new Response('<html>安全验证</html>', { headers: { 'content-type': 'text/html' } })
  await expect(getJobDetail({ securityId: 'sec', lid: 'lid' })).rejects.toThrow('验证')
  globalThis.fetch = async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } })
  await expect(getJobDetail({ securityId: 'sec', lid: 'lid' })).rejects.toThrow('格式')
})

test('requires login and identifiers before sending any request', async () => {
  window.Cookie = undefined
  await expect(getJobDetail({ securityId: 'sec', lid: 'lid' })).rejects.toThrow('登录')
  window.Cookie = { get: () => 'token' }
  await expect(getJobDetail({ securityId: '', lid: '' })).rejects.toThrow('标识')
  expect(requested).toHaveLength(0)
})

test('classifies an interrupted response body as a network stop', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    url: '',
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => {
      throw new DOMException('body aborted', 'AbortError')
    },
  })
  await expect(getJobDetail({ securityId: 'sec', lid: 'lid' })).rejects.toThrow('网络异常')
})
