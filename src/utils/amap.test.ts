import { afterEach, expect, it, mock } from 'bun:test'

const conf = { formData: { amap: { origins: '1,2', key: 'key' } } }
await mock.module('@/composables/conf', () => ({ useConf: () => conf }))

const { amapDistance } = await import('./amap')
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

it('requests only straight-line distance', async () => {
  const urls: URL[] = []
  globalThis.fetch = (async (input) => {
    urls.push(new URL(input instanceof Request ? input.url : input))
    return new Response(
      JSON.stringify({ status: '1', results: [{ distance: '1200', duration: '300' }] }),
    )
  }) as typeof fetch

  const result = await amapDistance('3,4')

  expect(urls).toHaveLength(1)
  expect(urls[0]?.searchParams.get('type')).toBe('0')
  expect(result.straight.distance).toBe(1200)
})
