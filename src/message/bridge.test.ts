// @ts-nocheck
import { expect, test } from 'bun:test'

import { defineProxy } from 'comctx'

import { clearDiagnostics, getDiagnostics } from '../utils/diagnostics'
import { connectBridge } from './bridge'

test('a transport rejection identifies the channel and method immediately', async () => {
  clearDiagnostics()
  const [, inject] = defineProxy(() => ({}), {
    namespace: 'background',
    heartbeatTimeout: 100,
    heartbeatInterval: 20,
  })
  const bridge = connectBridge(
    inject,
    {
      sendMessage: async () => {
        throw new Error('Extension context invalidated')
      },
      onMessage: () => () => {},
    },
    'content.background',
  )
  await expect(bridge.storageSet('private-key', 'private-value')).rejects.toThrow(
    'content.background.storageSet',
  )
  expect(getDiagnostics().at(-1)).toMatchObject({ operation: 'content.background.storageSet' })
  expect(JSON.stringify(getDiagnostics())).not.toContain('private-value')
  await Bun.sleep(120)
})

test('does not retry an accepted mutation when its result fails', async () => {
  let writes = 0
  const callbacks = new Set()
  const adapter = {
    sendMessage: async (message) => {
      for (const callback of [...callbacks]) callback(message)
    },
    onMessage: (callback) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
  }
  const [provide, inject] = defineProxy(
    () => ({
      save: async () => {
        writes++
        throw new Error('save failed')
      },
    }),
    { namespace: 'mutation' },
  )
  provide(adapter)
  const bridge = connectBridge(inject, adapter, 'boss.storage')
  await expect(bridge.save()).rejects.toThrow('save failed')
  expect(writes).toBe(1)
})
