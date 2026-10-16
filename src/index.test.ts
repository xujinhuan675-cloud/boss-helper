// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { expect, it } from 'bun:test'

import { run } from './index'

it('initializes all business data before mounting without touching browser UI', async () => {
  const calls = []
  const ctx = {
    conf: { formData: { resumeText: 'legacy resume' }, confInit: async () => calls.push('config') },
    resumes: { init: async (text) => calls.push(text) },
    models: { initModel: async () => calls.push('models') },
    statistics: { updateStatistics: async () => calls.push('statistics') },
    onMount: async () => calls.push('mount'),
  }
  await run(ctx)
  expect(calls).toEqual(['config', 'legacy resume', 'models', 'statistics', 'mount'])
})
