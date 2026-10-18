// @ts-nocheck
import { expect, test } from 'bun:test'

import { ExtStorage, setCounter } from './index'

test('configuration reads reject when the content storage bridge fails', async () => {
  setCounter({
    storageGet: async () => {
      throw new Error('storage unavailable')
    },
  })
  const outcome = await Promise.race([
    ExtStorage.getItem('config').then(
      () => 'resolved',
      (error) => error.message,
    ),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 350)),
  ])
  expect(outcome).toBe('storage unavailable')
})
