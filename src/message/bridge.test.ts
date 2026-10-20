// @ts-nocheck
import { expect, spyOn, test } from 'bun:test'

import { defineProxy } from 'comctx'

import { clearDiagnostics, getDiagnostics } from '../utils/diagnostics'
import { connectBridge } from './bridge'

test('an available provider completes a write while page timers are throttled', async () => {
  const nativeTimeout = globalThis.setTimeout
  const timers = spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) =>
    nativeTimeout(callback, Math.max(delay ?? 0, 150), ...args),
  )
  let writes = 0
  const callbacks = new Set()
  const adapter = {
    sendMessage: async (message) => {
      nativeTimeout(() => {
        for (const callback of [...callbacks]) callback(message)
      }, 0)
    },
    onMessage: (callback) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
  }
  const [provide, inject] = defineProxy(() => ({ save: () => ++writes }), {
    namespace: 'throttled',
    heartbeatTimeout: 100,
    heartbeatInterval: 20,
  })
  provide(adapter)
  const result = connectBridge(inject, adapter, 'content.background').save()
  try {
    await expect(result).resolves.toBe(1)
    expect(writes).toBe(1)
    expect(callbacks.size).toBe(1)
  } finally {
    timers.mockRestore()
    await result.catch(() => {})
  }
})

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

test('an unavailable provider still times out without sending a mutation or leaking listeners', async () => {
  const callbacks = new Set()
  const sent = []
  const [, inject] = defineProxy(() => ({}), {
    namespace: 'unavailable',
    heartbeatTimeout: 60,
    heartbeatInterval: 10,
  })
  const bridge = connectBridge(
    inject,
    {
      sendMessage: (message) => {
        sent.push(message.type)
      },
      onMessage: (callback) => {
        callbacks.add(callback)
        return () => callbacks.delete(callback)
      },
    },
    'content.background',
  )
  await expect(bridge.save()).rejects.toThrow('heartbeat check timeout')
  expect(sent).toContain('ping')
  expect(sent).not.toContain('apply')
  expect(callbacks.size).toBe(0)
  const count = sent.length
  await Bun.sleep(30)
  expect(sent.length).toBe(count)
})

test('a provider becoming ready can finish a slow mutation exactly once', async () => {
  let writes = 0
  const callbacks = new Set()
  const adapter = {
    sendMessage: (message) => {
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
        await Bun.sleep(100)
        return 'saved'
      },
    }),
    { namespace: 'starting', heartbeatTimeout: 60, heartbeatInterval: 10 },
  )
  const bridge = connectBridge(inject, adapter, 'content.background')
  const starting = setTimeout(() => provide(adapter), 15)
  try {
    await expect(bridge.save()).resolves.toBe('saved')
    expect(writes).toBe(1)
    expect(callbacks.size).toBe(1)
  } finally {
    clearTimeout(starting)
  }
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
