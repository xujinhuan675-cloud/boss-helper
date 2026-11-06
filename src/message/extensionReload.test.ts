// @ts-nocheck
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

let permissions = ['nativeMessaging']
let receive, disconnect
const sent = []
const reload = mock(() => {})
const disconnectPort = mock(() => {})
const connectNative = mock(() => ({
  disconnect: disconnectPort,
  postMessage: (message) => sent.push(message),
  onMessage: { addListener: (listener) => (receive = listener) },
  onDisconnect: { addListener: (listener) => (disconnect = listener) },
}))
mock.module('#imports', () => ({
  browser: {
    runtime: {
      getManifest: () => ({ permissions, version: 'test' }),
      connectNative,
      reload,
    },
  },
}))
const { installExtensionReload } = await import('./extensionReload')
beforeEach(() => {
  permissions = ['nativeMessaging']
  sent.length = 0
  connectNative.mockClear()
  reload.mockClear()
  disconnectPort.mockClear()
})
afterEach(() => mock.restore())

test('release builds without nativeMessaging do not connect', () => {
  permissions = []
  installExtensionReload()
  expect(connectNative).not.toHaveBeenCalled()
})

test('only the native reload command restarts the extension', () => {
  installExtensionReload()
  expect(connectNative).toHaveBeenCalledWith('cc.offerhunt.diagnostics')
  expect(sent[0].type).toBe('reload:watch')
  receive({ type: 'reload:ready' })
  receive({ type: 'unknown' })
  expect(reload).not.toHaveBeenCalled()
  receive({ type: 'reload' })
  expect(reload).toHaveBeenCalledTimes(1)
  receive({ ok: false })
  expect(disconnectPort).toHaveBeenCalledTimes(1)
})

test('native reconnect preserves boot identity; a new extension boot changes it', () => {
  let retry
  spyOn(globalThis, 'setTimeout').mockImplementation((callback, ms) => {
    expect(ms).toBe(5000)
    retry = callback
    return 1
  })
  installExtensionReload()
  disconnect()
  retry()
  expect(sent[1].bootId).toBe(sent[0].bootId)
  installExtensionReload()
  expect(sent[2].bootId).not.toBe(sent[0].bootId)
})
