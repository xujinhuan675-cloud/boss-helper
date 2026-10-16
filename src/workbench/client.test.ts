// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, test } from 'bun:test'

import { requestExecutor } from './client'

describe('extension executor client', () => {
  test('does not mistake an old content script response for a connected executor', async () => {
    await expect(requestExecutor(async () => undefined, 3, { type: 'snapshot' })).rejects.toThrow(
      '刷新',
    )
  })

  test('surfaces a rejected operation instead of reporting success', async () => {
    await expect(
      requestExecutor(async () => ({ ok: false, error: '保存失败' }), 3, { type: 'collect' }),
    ).rejects.toThrow('保存失败')
  })

  test('sends the selected tab and exact allowlisted command without broadcast', async () => {
    const calls: unknown[] = []
    const data = await requestExecutor(
      async (id, message) => {
        calls.push([id, message])
        return { ok: true, data: 'saved' }
      },
      42,
      { type: 'saveKeywords', input: '产品经理' },
    )
    expect(data).toBe('saved')
    expect(calls).toEqual([
      [42, { type: 'boss-helper:executor', command: { type: 'saveKeywords', input: '产品经理' } }],
    ])
  })
})
