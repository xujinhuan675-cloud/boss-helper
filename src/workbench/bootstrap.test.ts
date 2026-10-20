// @ts-nocheck
import { expect, mock, test } from 'bun:test'

let reloads = 0
let mounts = 0
let permissions = ['storage']
mock.module('#imports', () => ({
  browser: {
    runtime: {
      getManifest: () => ({ permissions }),
      reload: () => {
        reloads++
      },
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
  },
}))
mock.module('comctx', () => ({ defineProxy: () => [null, {}] }))
mock.module('@/message', () => ({ setCounter() {} }))
mock.module('@/message/background', () => ({ InjectBackgroundAdapter: class {} }))
mock.module('@/message/contentScript', () => ({ ContentCounter: class {} }))
mock.module('../message/bridge', () => ({ connectBridge: () => ({}) }))
mock.module('./mount', () => ({
  mountWorkbench: () => {
    mounts++
  },
}))
const { startWorkbench } = await import('./bootstrap')

test('reloads an unpacked Chrome upgrade once to activate the new native permission', async () => {
  const previous = import.meta.env.CHROME
  import.meta.env.CHROME = 'true'
  try {
    await startWorkbench('workbench')
    expect(reloads).toBe(1)
    expect(mounts).toBe(0)
    permissions = ['storage', 'nativeMessaging']
    await startWorkbench('workbench')
    expect(reloads).toBe(1)
    expect(mounts).toBe(1)
  } finally {
    if (previous === undefined) delete import.meta.env.CHROME
    else import.meta.env.CHROME = previous
  }
})
