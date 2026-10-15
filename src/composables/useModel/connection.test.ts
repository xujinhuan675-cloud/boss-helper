// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it } from 'bun:test'

import { selectAvailableModel, testModelConnection } from './connection'

const config = {
  mode: 'openai',
  base_url: 'https://model-provider.example/v1/',
  api_key: 'offline-fixture-key',
  model: 'selected-model',
  advanced: { extra_headers: { 'X-Tenant': 'offline-tenant' }, extra_body: { prompt: 'ignored' } },
}

const urlText = (url: string | URL) => (url instanceof URL ? url.toString() : url)

function fixture(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('non-inference model connectivity', () => {
  it('only fetches the configured model list with credentials and no inference payload', async () => {
    const requests: Array<{ url: string; options: RequestInit }> = []
    const result = await testModelConnection(config, async (url, options) => {
      requests.push({ url: urlText(url), options })
      return fixture({ object: 'list', data: [{ id: 'selected-model' }, { id: 'another-model' }] })
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://model-provider.example/v1/models')
    expect(requests[0].options.method).toBe('GET')
    expect(requests[0].options.body).toBeUndefined()
    expect(requests[0].options.credentials).toBe('omit')
    expect(requests[0].options.referrerPolicy).toBe('no-referrer')
    expect(requests[0].options.redirect).toBe('error')
    const headers = new Headers(requests[0].options.headers)
    expect(headers.get('Authorization')).toBe('Bearer offline-fixture-key')
    expect(headers.get('X-Tenant')).toBe('offline-tenant')
    expect(result.status).toBe('connected')
    expect(result.selectedModelVisibility).toBe('visible')
    expect(result.modelCount).toBe(2)
    expect(result.models).toEqual(['selected-model', 'another-model'])
    expect(result.description).toContain('推理')
    expect(result.description).not.toContain(config.api_key)
  })

  it('preserves provider authorization overrides without modifying the configuration', async () => {
    const custom = {
      ...config,
      base_url: 'https://gateway.example/api/v3',
      advanced: { extra_headers: { authorization: 'Custom offline-auth' } },
    }
    let requested
    await testModelConnection(custom, async (url, options) => {
      requested = { url: urlText(url), headers: new Headers(options.headers) }
      return fixture({ data: [] })
    })
    expect(requested.url).toBe('https://gateway.example/api/v3/models')
    expect(requested.headers.get('authorization')).toBe('Custom offline-auth')
    expect(custom.advanced.extra_headers).toEqual({ authorization: 'Custom offline-auth' })
  })

  it('reports an accessible list separately from selected-model visibility', async () => {
    const result = await testModelConnection(config, async () =>
      fixture({ data: [{ id: 'other' }] }),
    )
    expect(result.status).toBe('connected')
    expect(result.selectedModelVisibility).toBe('not_listed')
    expect(result.modelCount).toBe(1)
    expect(result.models).toEqual(['other'])
    expect(result.description).toContain('未列出')
  })

  it('normalizes model IDs by trimming whitespace and removing duplicates or malformed entries', async () => {
    const result = await testModelConnection(config, async () =>
      fixture({
        data: [{ id: ' model-a ' }, { id: 'model-a' }, {}, null, { id: '  ' }, { id: 'model-b' }],
      }),
    )
    expect(result.status).toBe('connected')
    expect(result.models).toEqual(['model-a', 'model-b'])
    expect(result.modelCount).toBe(2)
  })

  it('keeps the selected model if listed and otherwise selects the first available model', async () => {
    expect(selectAvailableModel('model-b', ['model-a', 'model-b'])).toBe('model-b')
    expect(selectAvailableModel('custom-model', ['model-a', 'model-b'])).toBe('model-a')
    expect(selectAvailableModel('', ['model-a'])).toBe('model-a')
    expect(selectAvailableModel('custom-model', [])).toBe('custom-model')
  })

  it('accepts a valid empty model list and reports a missing selection', async () => {
    const result = await testModelConnection({ ...config, model: '' }, async () =>
      fixture({ data: [] }),
    )
    expect(result.status).toBe('connected')
    expect(result.selectedModelVisibility).toBe('not_selected')
    expect(result.modelCount).toBe(0)
  })

  it.each([401, 403])(
    'reports HTTP %s as an authentication failure without exposing response text',
    async (status) => {
      const result = await testModelConnection(config, async () =>
        fixture({ error: config.api_key }, status),
      )
      expect(result.status).toBe('auth_error')
      expect(result.httpStatus).toBe(status)
      expect(JSON.stringify(result)).not.toContain(config.api_key)
    },
  )

  it.each([404, 405, 501])(
    'does not mark unsupported list HTTP %s as connected or try inference',
    async (status) => {
      const requests: string[] = []
      const result = await testModelConnection(config, async (url) => {
        requests.push(urlText(url))
        return fixture({ error: 'Unsupported endpoint' }, status)
      })
      expect(result.status).toBe('unsupported')
      expect(requests).toEqual(['https://model-provider.example/v1/models'])
      expect(result.description).toContain('无法确认')
    },
  )

  it.each([429, 500, 502])(
    'reports HTTP %s separately from auth and unsupported endpoints',
    async (status) => {
      const result = await testModelConnection(config, async () => fixture({}, status))
      expect(result.status).toBe('http_error')
      expect(result.httpStatus).toBe(status)
    },
  )

  it.each([
    null,
    [],
    {},
    { data: null },
    { data: [{}] },
    { data: [{ id: '' }] },
    { data: [{ id: 42 }] },
  ])('rejects malformed successful model-list responses: %j', async (body) => {
    const result = await testModelConnection(config, async () => fixture(body))
    expect(result.status).toBe('invalid_response')
  })

  it('rejects HTML or invalid JSON returned with HTTP 200', async () => {
    const result = await testModelConnection(config, async () => new Response('<html>login</html>'))
    expect(result.status).toBe('invalid_response')
  })

  it('reports network or CORS failure without exposing the thrown error', async () => {
    const result = await testModelConnection(config, async () => {
      throw new Error(`Network failed ${config.api_key}`)
    })
    expect(result.status).toBe('network_error')
    expect(JSON.stringify(result)).not.toContain(config.api_key)
  })

  it('aborts a hanging metadata request after the connectivity timeout', async () => {
    let signal
    const result = await testModelConnection(
      config,
      async (_url, options) => {
        signal = options.signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
      5,
    )
    expect(result.status).toBe('network_error')
    expect(result.description).toContain('超时')
    expect(signal.aborted).toBe(true)
  })

  it('also classifies a timeout while reading the response as network failure', async () => {
    const result = await testModelConnection(
      config,
      async (_url, options) => {
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                once: true,
              })
            }),
        }
      },
      5,
    )
    expect(result.status).toBe('network_error')
    expect(result.description).toContain('超时')
  })

  it.each([
    '',
    'file:///fixture',
    'javascript:alert(1)',
    'https://user:password@model-provider.example/v1',
    'https://model-provider.example/v1?token=value',
  ])('rejects invalid base URL %s before making a request', async (base_url) => {
    let requests = 0
    const result = await testModelConnection({ ...config, base_url }, async () => {
      requests++
      return fixture({ data: [] })
    })
    expect(result.status).toBe('invalid_config')
    expect(requests).toBe(0)
  })

  it('rejects invalid custom header values as configuration errors', async () => {
    let requests = 0
    const result = await testModelConnection(
      { ...config, advanced: { extra_headers: { 'X-Fixture': { nested: true } } } },
      async () => {
        requests++
        return fixture({ data: [] })
      },
    )
    expect(result.status).toBe('invalid_config')
    expect(requests).toBe(0)
  })
})
