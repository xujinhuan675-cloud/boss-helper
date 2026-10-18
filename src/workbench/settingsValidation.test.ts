// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it } from 'bun:test'

import { defaultFormData } from '../composables/conf/info'
import { nativeSearchFromUrl } from '../entrypoints/boss/nativeSearch'
import { jsonClone } from '../utils/deepmerge'
import { validateConfig, validateModels } from './settingsValidation'

describe('workbench settings import boundaries', () => {
  it.each([
    { delayKeywordRotationMin: 0 },
    { delayKeywordRotationMax: 86401 },
    { delayKeywordRotationMin: 1000, delayKeywordRotationMax: 999 },
    { delayKeywordRotationBatchMin: NaN },
    { delayKeywordRotationBatchMax: 1 },
    { keywordRotationBatchSize: 1.5 },
    { keywordRotationBatchSize: 101 },
    { keywordRotationDailyLimit: 0 },
    { keywordRotationDailyLimit: 1001 },
    { keywordRotationAutoResume: { value: 'true' } },
  ])('rejects invalid rotation settings before saving: %j', (patch) => {
    const config = Object.assign(jsonClone(defaultFormData), patch)
    expect(() => validateConfig(config)).toThrow()
  })

  it('accepts existing configuration and preserves unknown model fields', () => {
    expect(() => validateConfig(jsonClone(defaultFormData))).not.toThrow()
    const models = [
      {
        key: 'draft',
        name: 'Draft',
        data: { mode: 'openai', api_key: '', advanced: { extra_body: { retained: true } } },
        retained: { source: 'original' },
      },
    ]
    validateModels(models)
    expect(models[0].retained).toEqual({ source: 'original' })
    expect(models[0].data.advanced.extra_body).toEqual({ retained: true })
  })

  it.each([
    null,
    {},
    [null],
    [{ key: '', name: 'Invalid' }],
    [{ key: 'bad', name: 3 }],
    [{ key: 'bad', name: 'Invalid', data: { api_key: 2 } }],
    [{ key: 'bad', name: 'Invalid', data: { advanced: [] } }],
    [
      { key: 'duplicate', name: 'One' },
      { key: 'duplicate', name: 'Two' },
    ],
  ])('rejects malformed model JSON without normalizing it: %j', (value) => {
    expect(() => validateModels(value)).toThrow()
  })

  it('rejects invalid native filters, timing and passing scores', () => {
    const config = jsonClone(defaultFormData)
    config.nativeSearch = nativeSearchFromUrl('https://www.zhipin.com/web/geek/jobs?salary=invalid')
    expect(() => validateConfig(config)).toThrow('原生筛选')
    config.nativeSearch = nativeSearchFromUrl('https://www.zhipin.com/web/geek/jobs?salary=405')
    config.delayCollectionDetailMin = 10
    expect(() => validateConfig(config)).toThrow('间隔')
    config.delayCollectionDetailMin = 1
    config.aiFiltering.score = 101
    expect(() => validateConfig(config)).toThrow('通过分数')
  })

  it('rejects corrupt prompt, filter and image data before storage', () => {
    const config = jsonClone(defaultFormData)
    config.aiGreeting.prompt = [{ role: 'invalid', content: '' }]
    expect(() => validateConfig(config)).toThrow('提示词')
    config.aiGreeting = jsonClone(defaultFormData.aiGreeting)
    config.company.value = [2]
    expect(() => validateConfig(config)).toThrow('筛选')
    config.company.value = []
    config.customGreeting.value = [{ type: 'image', image: '' }]
    expect(() => validateConfig(config)).toThrow('图片')
  })
})
