// @ts-nocheck
import { beforeEach, expect, mock, test } from 'bun:test'

import {
  clearDiagnostics,
  diagnostic,
  getDiagnostics,
  hasDiagnosticStorageError,
} from '../utils/diagnostics'

const values = new Map()
let receive
let sendError = false
let writeError = false
let beforeRead
mock.module('#imports', () => ({
  browser: {
    runtime: {
      id: 'own',
      onMessage: {
        addListener: (fn) => {
          receive = fn
        },
      },
      sendMessage: async (message) => {
        if (sendError) throw new Error('background offline')
        return receive(message, { id: 'own' })
      },
    },
    storage: {
      local: {
        get: async (key) => {
          const result = { [key]: structuredClone(values.get(key)) }
          if (beforeRead) await beforeRead()
          return result
        },
        set: async (data) => {
          if (writeError) throw new Error('storage unavailable')
          for (const [key, value] of Object.entries(data)) values.set(key, structuredClone(value))
        },
        remove: async (key) => {
          values.delete(key)
        },
      },
    },
  },
}))
const {
  DIAGNOSTICS_KEY,
  clearSavedDiagnostics,
  installDiagnosticReceiver,
  loadDiagnostics,
  startExtensionDiagnostics,
} = await import('./diagnostics')
beforeEach(() => {
  values.clear()
  clearDiagnostics()
  sendError = false
  writeError = false
  beforeRead = undefined
  installDiagnosticReceiver()
})
const event = (index) => ({
  id: String(index),
  time: new Date(1700000000000 + index).toISOString(),
  source: 'content',
  operation: 'storage.save',
  level: 'error',
  error: 'disk full',
  context: {},
})
test('persists concurrent reports independently of the BOSS executor and caps retention', async () => {
  installDiagnosticReceiver()
  await Promise.all(
    Array.from({ length: 220 }, (_, i) =>
      receive(
        { type: 'boss-helper:diagnostic', event: event(i) },
        { id: 'own', tab: { id: 4 }, frameId: 0 },
      ),
    ),
  )
  const stored = values.get(DIAGNOSTICS_KEY)
  expect(stored).toHaveLength(200)
  expect(stored[0].id).toBe('20')
  expect(stored.at(-1).context).toMatchObject({ tabId: 4, frameId: 0 })
})
test('leaves unrelated protocols available and rejects foreign or malformed reports', async () => {
  expect(receive({ type: 'ping' }, {})).toBeUndefined()
  expect(
    await receive({ type: 'boss-helper:diagnostic', event: event(1) }, { id: 'foreign' }),
  ).toEqual({ ok: false })
  expect(
    await receive(
      { type: 'boss-helper:diagnostic', event: { ...event(1), operation: {} } },
      { id: 'own' },
    ),
  ).toEqual({ ok: false })
  expect(values.get(DIAGNOSTICS_KEY)).toBeUndefined()
})

test('orders clear with pending writes so deleted records cannot reappear', async () => {
  const saving = receive({ type: 'boss-helper:diagnostic', event: event(1) }, { id: 'own' })
  await Promise.all([saving, clearSavedDiagnostics()])
  expect(values.get(DIAGNOSTICS_KEY)).toBeUndefined()
  await receive({ type: 'boss-helper:diagnostic', event: event(2) }, { id: 'own' })
  expect(values.get(DIAGNOSTICS_KEY).map((entry) => entry.id)).toEqual(['2'])
})

test('keeps unsaved records visible and marks failure when the background is unavailable', async () => {
  startExtensionDiagnostics('workbench')
  sendError = true
  diagnostic('settings.save', { error: new Error('save failed') })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(hasDiagnosticStorageError()).toBe(true)
  expect(getDiagnostics()).toHaveLength(1)
  expect(values.get(DIAGNOSTICS_KEY)).toBeUndefined()
})

test('does not restore an old storage read after diagnostics have been cleared', async () => {
  values.set(DIAGNOSTICS_KEY, [event(1)])
  let resume
  beforeRead = () =>
    new Promise((resolve) => {
      resume = resolve
    })
  const loading = loadDiagnostics()
  await clearSavedDiagnostics()
  resume()
  await loading
  expect(getDiagnostics()).toHaveLength(0)
})

test('recovers the write queue after a persistence failure', async () => {
  writeError = true
  expect(await receive({ type: 'boss-helper:diagnostic', event: event(1) }, { id: 'own' })).toEqual(
    { ok: false },
  )
  writeError = false
  expect(await receive({ type: 'boss-helper:diagnostic', event: event(2) }, { id: 'own' })).toEqual(
    { ok: true },
  )
  expect(values.get(DIAGNOSTICS_KEY).map((entry) => entry.id)).toEqual(['2'])
})
