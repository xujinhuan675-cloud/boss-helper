// @ts-nocheck
import { describe, expect, mock, spyOn, test } from 'bun:test'

let listener
const deliveries = []
const rules = []
let sendError = false
mock.module('#imports', () => ({
  storage: {},
  browser: {
    declarativeNetRequest: {
      updateSessionRules: async (value) => {
        rules.push(value)
      },
    },
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
const { BackgroundCounter, ProvideBackgroundAdapter, InjectBackgroundAdapter } =
  await import('./background')

test('uploads screenshot bytes from the extension background and returns OCR markdown', async () => {
  const requests = []
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    requests.push({ url: String(url), init })
    if (String(url).startsWith('data:')) return new Response(new Uint8Array([137, 80, 78, 71]))
    if (String(url).endsWith('/jobs')) return Response.json({ data: { jobId: 'test' } })
    if (String(url).endsWith('/jobs/test'))
      return Response.json({
        data: { state: 'done', resultUrl: { jsonUrl: 'https://ocr.test/result' } },
      })
    return new Response(
      JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: 'Job JD' } }] } }),
    )
  })
  try {
    const background = new BackgroundCounter()
    await expect(background.recognizeJobScreenshot('https://wrong.test/image', {})).rejects.toThrow(
      'screenshot',
    )
    expect(requests).toHaveLength(0)
    expect(
      await background.recognizeJobScreenshot('data:image/png;base64,iVBORw==', {
        enabled: true,
        token: 'test',
        model: 'test',
        baseUrl: ' https://paddleocr.aistudio-app.com/api/v2/ocr/ ',
        pollIntervalMs: 0,
      }),
    ).toMatchObject({ text: 'Job JD' })
    const file = requests[1].init.body.get('file')
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([137, 80, 78, 71])
    expect(requests[1].init.headers.Authorization).toBe('Bearer test')
    expect(rules.at(-1)).toEqual({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'origin', operation: 'remove' }],
          },
          condition: {
            urlFilter: '|https://paddleocr.aistudio-app.com/api/v2/ocr/jobs|',
            initiatorDomains: ['own'],
            requestMethods: ['post'],
            resourceTypes: ['xmlhttprequest'],
          },
        },
      ],
    })
  } finally {
    fetchMock.mockRestore()
  }
})

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
