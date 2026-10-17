import type { ModelConf } from '@/composables/useModel'
import type { FormData } from '@/types/formData'

import { validateMatchThreshold } from '../composables/useApplying/scoring'
import { isNativeSearchFilters } from '../entrypoints/boss/nativeSearch'
import { isPlainObject } from '../utils/deepmerge'

export function validateModels(value: unknown): asserts value is ModelConf[] {
  const keys = new Set<string>()
  if (
    !Array.isArray(value) ||
    value.some((model) => {
      if (
        !isPlainObject(model) ||
        typeof model.key !== 'string' ||
        !model.key.trim() ||
        typeof model.name !== 'string' ||
        keys.has(model.key)
      )
        return true
      keys.add(model.key)
      if (model.data === undefined) return false
      const data = model.data
      return (
        !isPlainObject(data) ||
        ['mode', 'avatar', 'api_key', 'base_url', 'model'].some(
          (field) => data[field] !== undefined && typeof data[field] !== 'string',
        ) ||
        ['advanced', 'other'].some(
          (field) => data[field] !== undefined && !isPlainObject(data[field]),
        ) ||
        (data.responses !== undefined && typeof data.responses !== 'boolean')
      )
    })
  )
    throw new Error('模型配置格式无效，原有配置已保留')
}

export function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${label}不是有效的 JSON`)
  }
  if (!isPlainObject(value)) throw new Error(`${label}必须为 JSON 对象`)
  return value
}

export function validateConfig(config: FormData) {
  if (config.nativeSearch !== null && !isNativeSearchFilters(config.nativeSearch))
    throw new Error('BOSS 原生筛选配置格式无效')
  for (const key of ['company', 'jobTitle', 'jobContent', 'hrPosition'] as const) {
    const filter = config[key]
    if (
      !isPlainObject(filter) ||
      !Array.isArray(filter.value) ||
      !filter.value.every((item) => typeof item === 'string') ||
      !Array.isArray(filter.options) ||
      !filter.options.every((item) => typeof item === 'string')
    )
      throw new Error(`${key} 筛选配置格式无效`)
  }
  for (const key of [
    'greetingVariable',
    'activityFilter',
    'friendStatus',
    'bossGoldMedalHr',
    'sameCompanyFilter',
    'sameHrFilter',
    'goldHunterFilter',
    'notification',
    'useCache',
    'keywordRotationAutoResume',
  ] as const) {
    if (!isPlainObject(config[key]) || typeof config[key].value !== 'boolean')
      throw new Error(`${key} 配置格式无效`)
  }
  for (const key of ['sameCompanyFilter', 'sameHrFilter'] as const) {
    const expire = config[key].expire
    if (expire !== undefined && (!Number.isFinite(expire) || expire < 0))
      throw new Error('去重有效期应为非负数')
  }
  if (
    !isPlainObject(config.deliveryLimit) ||
    !Number.isInteger(config.deliveryLimit.value) ||
    config.deliveryLimit.value < 1 ||
    config.deliveryLimit.value > 155
  )
    throw new Error('投递数量应为 1～155 的整数')
  for (const key of [
    'delayDeliveryStarts',
    'delayDeliveryInterval',
    'delayDeliveryPageNext',
    'delayMessageSending',
    'delayCollectionScrollMin',
    'delayCollectionScrollMax',
    'delayCollectionDetailMin',
    'delayCollectionDetailMax',
  ] as const) {
    if (typeof config[key] !== 'number' || !Number.isFinite(config[key]) || config[key] < 0)
      throw new Error('间隔应为非负数')
  }
  if (
    config.delayCollectionScrollMin > config.delayCollectionScrollMax ||
    config.delayCollectionDetailMin > config.delayCollectionDetailMax
  )
    throw new Error('采集间隔上限不能小于下限')
  for (const [min, max] of [
    [config.delayKeywordRotationMin, config.delayKeywordRotationMax],
    [config.delayKeywordRotationBatchMin, config.delayKeywordRotationBatchMax],
  ] as const) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min || max > 86400)
      throw new Error('轮换间隔必须在 1～86400 秒内，最长间隔不能小于最短间隔')
  }
  if (
    !Number.isSafeInteger(config.keywordRotationBatchSize) ||
    config.keywordRotationBatchSize < 1 ||
    config.keywordRotationBatchSize > 100
  )
    throw new Error('每批关键词数必须是 1～100 的整数')
  if (
    !Number.isSafeInteger(config.keywordRotationDailyLimit) ||
    config.keywordRotationDailyLimit < 1 ||
    config.keywordRotationDailyLimit > 1000
  )
    throw new Error('每日关键词上限必须是 1～1000 的整数')
  for (const key of ['aiFiltering', 'aiGreeting', 'aiReply'] as const) {
    const ai = config[key]
    if (
      !isPlainObject(ai) ||
      typeof ai.enable !== 'boolean' ||
      !Array.isArray(ai.prompt) ||
      !ai.prompt.every(
        (item) =>
          isPlainObject(item) &&
          ['system', 'user', 'assistant'].includes(item.role) &&
          typeof item.content === 'string',
      )
    )
      throw new Error('AI 提示词配置格式无效')
  }
  validateMatchThreshold(config.aiFiltering.score)
  const greeting = config.customGreeting
  if (
    !isPlainObject(greeting) ||
    typeof greeting.enable !== 'boolean' ||
    !(
      typeof greeting.value === 'string' ||
      (Array.isArray(greeting.value) &&
        greeting.value.every(
          (item) =>
            isPlainObject(item) &&
            ((item.type === 'text' && typeof item.content === 'string') ||
              (item.type === 'image' && typeof item.image === 'string' && !!item.image.trim())),
        ))
    )
  )
    throw new Error('自定义招呼语格式无效，请补全图片或移除空图片消息')
  if (
    !isPlainObject(config.amap) ||
    typeof config.amap.key !== 'string' ||
    typeof config.amap.origins !== 'string' ||
    typeof config.amap.straightDistance !== 'number' ||
    !Number.isFinite(config.amap.straightDistance) ||
    config.amap.straightDistance < 0
  )
    throw new Error('通勤配置格式无效')
  if (
    !isPlainObject(config.record) ||
    typeof config.record.enable !== 'boolean' ||
    (config.record.model !== undefined &&
      (!Array.isArray(config.record.model) ||
        !config.record.model.every((item) => typeof item === 'string')))
  )
    throw new Error('内容记录配置格式无效')
  if (
    typeof config.resumeText !== 'string' ||
    typeof config.version !== 'string' ||
    !['beginner', 'intermediate', 'advanced', 'expert'].includes(config.configLevel)
  )
    throw new Error('配置格式无效')
}
