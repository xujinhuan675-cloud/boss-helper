// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test'

let listener
const deliveries = []
let sendError = false
mock.module('#imports', () => ({
  storage: {},
  browser: {
    runtime: {
      id: 'own',
      onMessage: {
        addListener: (fn) => {
          listener = fn
        },
        removeListener() {},
      },
      sendMessage: async () => {
        if (sendError) throw new Error('Extension context invalidated')
      },
    },
    tabs: {
      query: async () => [],
      sendMessage: async (...args) => {
        deliveries.push(args)
      },
    },
  },
}))
const { ProvideBackgroundAdapter, InjectBackgroundAdapter } = await import('./background')

describe('background reply routing', () => {
  test('returns to the sending tab and frame after its URL has changed', async () => {
    const adapter = new ProvideBackgroundAdapter()
    let request
    adapter.onMessage((message) => {
      request = message
    })
    listener(
      { sender: { name: 'content' }, meta: { url: 'https://www.zhipin.com/old' } },
      { id: 'own', tab: { id: 42 }, frameId: 0 },
    )
    await adapter.sendMessage({ ...request, type: 'pong' }, [])
    expect(deliveries.at(-1)).toEqual([42, { ...request, type: 'pong' }, { frameId: 0 }])
  })

  test('does not broadcast content replies when a sender tab is missing', async () => {
    const adapter = new ProvideBackgroundAdapter()
    await expect(adapter.sendMessage({ meta: { injector: 'content' } }, [])).rejects.toThrow('tab')
  })

  test('propagates an actual send failure instead of discarding the promise', async () => {
    const previous = globalThis.document
    globalThis.document = { location: { href: 'https://www.zhipin.com/' } }
    sendError = true
    try {
      await expect(
        new InjectBackgroundAdapter().sendMessage({ type: 'apply' }, []),
      ).rejects.toThrow('Extension context invalidated')
    } finally {
      sendError = false
      globalThis.document = previous
    }
  })
})
