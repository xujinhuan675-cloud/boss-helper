// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { expect, test } from 'bun:test'

import { selectModel } from './selection'

test('prefers Decisions only for filtering and keeps a generative model for greetings and keywords', () => {
  const model = (key, decisions = false) => ({
    key,
    data: { api_key: 'offline', base_url: 'https://example.com/v1', model: key, decisions },
  })
  const chat = model('chat')
  const decisions = model('jev', true)
  expect(selectModel([decisions, chat])?.key).toBe('chat')
  expect(selectModel([chat, decisions], 'filtering')?.key).toBe('jev')
  expect(selectModel([decisions], 'filtering')?.key).toBe('jev')
  expect(selectModel([decisions])).toBeUndefined()
  expect(selectModel([{ key: 'incomplete' }, chat], 'filtering')?.key).toBe('chat')
})
