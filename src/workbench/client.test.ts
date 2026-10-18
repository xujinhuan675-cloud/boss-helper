// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, test } from 'bun:test'

import { clearDiagnostics, getDiagnostics } from '../utils/diagnostics'
import { requestExecutor } from './client'

describe('extension executor client', () => {
  test('records the selected tab and failed command without the command payload', async () => {
    clearDiagnostics()
    await expect(
      requestExecutor(
        async () => {
          throw new Error('no receiver')
        },
        42,
        { type: 'extractKeywords', input: 'private resume' },
      ),
    ).rejects.toThrow('no receiver')
    expect(getDiagnostics().at(-1)).toMatchObject({
      operation: 'executor.extractKeywords',
      context: { tabId: 42 },
      level: 'error',
    })
    expect(JSON.stringify(getDiagnostics())).not.toContain('private resume')
  })
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
