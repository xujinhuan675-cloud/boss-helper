import { reactiveComputed, useStorageAsync, watchThrottled } from '@vueuse/core'
import { reactive, ref, toRaw } from 'vue'

import { counter } from '@/message'
import { ExtStorage } from '@/message'
import type { ConfigLevel, FormData } from '@/types/formData'
import deepmerge, { isPlainObject, jsonClone } from '@/utils/deepmerge'
import { exportJson, importJson } from '@/utils/jsonImportExport'
import { logger } from '@/utils/logger'

import { diagnostic } from '../../utils/diagnostics'
import { MATCH_SCORING_VERSION } from '../useApplying/scoring'
import { defaultFormData } from './info'

export * from './info'

const formDataPresetKey = 'local:FormDataPrese'
const formDataPresetsKey = 'local:FormDataPreses'
const defaultPreset = { label: '默认配置', value: 'default' }

function isPreset(value: unknown): value is { label: string; value: string } {
  return (
    isPlainObject(value) &&
    typeof value.label === 'string' &&
    typeof value.value === 'string' &&
    !!value.value.trim()
  )
}

function removeRetiredRanges(config: Partial<FormData>) {
  delete config.salaryRange
  delete config.companySizeRange
}

function removeRetiredFilters(config: Partial<FormData>) {
  delete config.jobAddress
  for (const key of ['company', 'jobTitle', 'jobContent', 'hrPosition'] as const) {
    const filter = config[key]
    if (filter && isPlainObject(filter)) {
      delete filter.include
      delete filter.enable
    }
  }
  if (config.amap && isPlainObject(config.amap)) {
    const amap = config.amap as Record<string, unknown>
    if (amap.enable === false) amap.straightDistance = 0
    delete amap.enable
    delete amap.drivingDistance
    delete amap.drivingDuration
    delete amap.walkingDistance
    delete amap.walkingDuration
  }
}

export const appearanceConf = useStorageAsync(
  'appearance-conf',
  {
    hideHeader: false,
    changeIcon: false,
    dynamicTitle: false,
    changeBackground: false,
    blurCard: false,
    listSink: false,
    contentOffset: 25, // 0-25, 25则为关闭
    leftChat: false,
    chatBoxWidth: 600,
    defaultShowChatBox: false,
  },
  ExtStorage,
  { mergeDefaults: true },
)
const isLoading = ref(true)
const formData: FormData = reactive(jsonClone(defaultFormData))
const formDataPreset = ref('default')
const formDataPresets = ref([
  {
    label: '默认配置',
    value: 'default',
  },
])

const formDataKey = (preset = formDataPreset.value) => {
  if (preset !== 'default') {
    return `local:web-geek-job-FormData-${preset}`
  }
  return 'local:web-geek-job-FormData'
}

watchThrottled(
  formData,
  (v) => {
    logger.debug('formData改变', toRaw(v))
  },
  { throttle: 2000 },
)

const FROM_VERSION: [string, (from: Partial<FormData>) => Partial<FormData>][] = [
  [
    '20260521',
    (from) => {
      if (from.aiFiltering?.prompt) {
        if (typeof from.aiFiltering.prompt === 'string') {
          from.aiFiltering.prompt = [
            {
              role: 'user',
              content: from.aiFiltering.prompt,
            },
          ]
        }
      } else {
        from.aiFiltering = {
          ...defaultFormData.aiFiltering,
          ...from.aiFiltering,
          prompt: defaultFormData.aiFiltering.prompt,
        }
      }
      if (from.aiGreeting?.prompt) {
        if (typeof from.aiGreeting.prompt === 'string') {
          from.aiGreeting.prompt = [
            {
              role: 'user',
              content: from.aiGreeting.prompt,
            },
          ]
        }
      } else {
        from.aiGreeting = {
          ...defaultFormData.aiGreeting,
          ...from.aiGreeting,
          prompt: defaultFormData.aiGreeting.prompt,
        }
      }
      return from
    },
  ],
  [
    '20260718',
    (from) => {
      if (!('delay' in from) || typeof from.delay !== 'object') {
        return from
      }
      Object.entries(from.delay as Record<string, number>).forEach(([key, value]) => {
        // @ts-ignore
        from[`delay${key.charAt(0).toUpperCase() + key.slice(1)}`] = value
      })
      delete from['delay']
      return from
    },
  ],
  [
    '20261018',
    (from) => {
      if (from.delayCollectionDetailMin === 2 && from.delayCollectionDetailMax === 5) {
        from.delayCollectionDetailMin = defaultFormData.delayCollectionDetailMin
      }
      return from
    },
  ],
]

export const useConf = () => {
  const toast = useToast()

  async function formDataHandler(from: Partial<FormData>) {
    if (!isPlainObject(from)) throw new Error('配置格式异常；已保留原数据')
    if (
      from.aiFiltering &&
      (from.aiFiltering.scoringVersion !== MATCH_SCORING_VERSION ||
        'legacyScore' in from.aiFiltering)
    ) {
      from.aiFiltering = {
        ...jsonClone(defaultFormData.aiFiltering),
        enable: from.aiFiltering.enable ?? defaultFormData.aiFiltering.enable,
      }
    }
    try {
      for (const [version, fn] of FROM_VERSION) {
        if ((from.version ?? '20240401') >= version) continue
        from = fn(from)
        from.version = version
      }
    } catch (err) {
      diagnostic('config.migrate', { error: err })
      logger.error('用户配置初始化失败', err)
      toast.add({
        title: `用户配置初始化失败: ${String(err)}`,
        color: 'error',
      })
      throw err
    }
    for (const key of ['aiFiltering', 'aiGreeting', 'aiReply'] as const) {
      const prompt = from[key]
      if (isPlainObject(prompt)) Reflect.deleteProperty(prompt, 'model')
    }
    removeRetiredRanges(from)
    removeRetiredFilters(from)
    return from
  }

  async function init() {
    isLoading.value = true
    try {
      const rawFormDataPreset = await counter.storageGet<unknown>(formDataPresetKey, 'default')
      const rawFormDataPresets = await counter.storageGet<unknown>(formDataPresetsKey, [
        defaultPreset,
      ])
      const selectionValid = typeof rawFormDataPreset === 'string' && !!rawFormDataPreset.trim()
      const presetListValid =
        Array.isArray(rawFormDataPresets) && rawFormDataPresets.every(isPreset)
      const preset =
        typeof rawFormDataPreset === 'string' && rawFormDataPreset.trim()
          ? rawFormDataPreset
          : 'default'
      const presets = Array.isArray(rawFormDataPresets) ? rawFormDataPresets.filter(isPreset) : []
      const normalizedPresets = presets.length ? presets : [defaultPreset]
      const selectedPresetListed = normalizedPresets.some((item) => item.value === preset)
      if (!selectedPresetListed)
        normalizedPresets.push({
          label: preset === 'default' ? defaultPreset.label : '当前方案',
          value: preset,
        })
      const needsPresetMetadataRecovery =
        !selectionValid || !presetListValid || !selectedPresetListed
      if (needsPresetMetadataRecovery)
        diagnostic('config.preset.recover', {
          level: 'warning',
          context: {
            phase:
              !selectionValid && !presetListValid
                ? 'selection-and-list'
                : !selectionValid
                  ? 'selection'
                  : !presetListValid
                    ? 'list'
                    : 'selected-entry-missing',
            status: 'recovered',
            count: normalizedPresets.length,
          },
        })

      const storageKey = formDataKey(preset)
      const rawConfig = await counter.storageGet<unknown>(storageKey, {})
      if (!isPlainObject(rawConfig)) throw new Error('配置格式异常；已保留原数据')
      let from = rawConfig as Partial<FormData>
      const previousVersion = from.version
      const previousFiltering = JSON.stringify(from.aiFiltering)
      const hasRetiredRanges =
        'salaryRange' in from ||
        'companySizeRange' in from ||
        'jobAddress' in from ||
        ['company', 'jobTitle', 'jobContent', 'hrPosition'].some(
          (key) => isPlainObject(from[key]) && ('include' in from[key] || 'enable' in from[key]),
        ) ||
        (isPlainObject(from.amap) &&
          [
            'enable',
            'drivingDistance',
            'drivingDuration',
            'walkingDistance',
            'walkingDuration',
          ].some((key) => key in from.amap!))
      from = (await formDataHandler(from)) ?? from
      const data = deepmerge<FormData>(defaultFormData, from)
      if (
        from.version !== previousVersion ||
        JSON.stringify(from.aiFiltering) !== previousFiltering ||
        hasRetiredRanges
      )
        await counter.storageSet(storageKey, jsonClone(data))
      formDataPreset.value = preset
      formDataPresets.value = normalizedPresets
      removeRetiredRanges(formData)
      removeRetiredFilters(formData)
      Object.assign(formData, data)
    } catch (e) {
      diagnostic('config.load', { error: e })
      toast.add({
        title: `配置加载失败: ${String(e)}`,
        color: 'error',
      })
      logger.error('配置加载失败', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function confSaving() {
    try {
      removeRetiredRanges(formData)
      removeRetiredFilters(formData)
      await counter.storageSet(formDataKey(), jsonClone(formData))

      toast.add({
        title: '保存成功',
        color: 'success',
      })
      logger.debug('formData保存')
    } catch (error: any) {
      diagnostic('config.save', { error })
      toast.add({
        title: `保存失败: ${error.message}`,
        color: 'error',
      })
      throw error
    }
    // const helper = useHelper()
    // helper.workflow?.rebuild()
  }

  async function confReload() {
    const from = await formDataHandler(await counter.storageGet(formDataKey(), {}))
    const v = deepmerge<FormData>(defaultFormData, from)
    removeRetiredRanges(formData)
    removeRetiredFilters(formData)
    deepmerge(formData, v, { clone: false })
    formData.aiFiltering = v.aiFiltering
    logger.debug('formData已重置')
    toast.add({
      title: '重置成功',
      color: 'success',
    })
  }

  async function confExport() {
    const from = await formDataHandler(await counter.storageGet(formDataKey(), {}))
    const data = deepmerge<FormData>(defaultFormData, from)
    removeRetiredFilters(data)
    exportJson(data, '打招呼配置')
  }

  async function confImport() {
    let jsonData = await importJson<Partial<FormData>>()
    jsonData = (await formDataHandler(jsonData)) ?? jsonData
    removeRetiredRanges(formData)
    deepmerge(formData, jsonData, { clone: false })
    if (jsonData.aiFiltering) formData.aiFiltering = jsonClone(jsonData.aiFiltering)
    toast.add({
      title: '导入成功, 切记要手动保存哦',
      color: 'success',
    })
  }

  function confRecommend() {
    deepmerge(
      formData,
      [
        'deliveryLimit',
        'activityFilter',
        'friendStatus',
        'sameCompanyFilter',
        'sameHrFilter',
        'goldHunterFilter',
        'notification',
        'useCache',
        'delay',
      ].reduce(
        (result, key) => {
          result[key] = defaultFormData[key as keyof FormData]
          return result
        },
        {} as Record<string, any>,
      ),
    )
    logger.debug('formData推荐配置已应用')
    toast.add({
      title: '推荐配置已应用, 不会自动保存, 请手动保存或重载恢复',
      color: 'success',
    })
  }

  function confDelete() {
    deepmerge(formData, defaultFormData)
    logger.debug('formData已清空')
    toast.add({
      title: '配置清空成功, 不会自动保存, 请手动保存或重载恢复',
      color: 'success',
    })
  }

  const order: Record<ConfigLevel, number> = {
    beginner: 1,
    intermediate: 2,
    advanced: 3,
    expert: 4,
  }

  const configLevel = reactiveComputed(() => {
    const val = order[formData.configLevel]
    return {
      intermediate: order['intermediate'] <= val,
      advanced: order['advanced'] <= val,
      expert: order['expert'] <= val,
    }
  })

  async function createPreset(label: string) {
    isLoading.value = true
    try {
      const name = label.trim()
      if (!name) throw new Error('请填写方案名称')
      const value = crypto.randomUUID()
      const data = jsonClone(formData)
      removeRetiredRanges(data)
      removeRetiredFilters(data)
      const previous = await counter.storageGet<unknown>(formDataPresetsKey, [defaultPreset])
      if (!Array.isArray(previous) || !previous.every(isPreset))
        throw new Error('方案列表格式异常；已保留原数据')
      const presets = [...previous, { label: name, value }]
      await counter.storageSet(formDataKey(value), data)
      await counter.storageSet(formDataPresetsKey, presets)
      await counter.storageSet(formDataPresetKey, value)
      formDataPresets.value = presets
      formDataPreset.value = value
      Object.assign(formData, data)

      toast.add({
        title: '预设创建成功',
        color: 'success',
      })
    } catch (e) {
      toast.add({
        title: `预设创建失败: ${String(e)}`,
        color: 'error',
      })
      logger.error('预设创建失败', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function switchPreset(value: string) {
    isLoading.value = true
    try {
      const presets = await counter.storageGet<unknown>(formDataPresetsKey, [defaultPreset])
      if (
        value !== 'default' &&
        (!Array.isArray(presets) ||
          !presets.some((preset) => isPreset(preset) && preset.value === value))
      )
        throw new Error('求职方案不存在')
      await counter.storageSet(formDataPresetKey, value)
      await init()
    } catch (e) {
      toast.add({
        title: `预设切换失败: ${String(e)}`,
        color: 'error',
      })
      logger.error('预设切换失败', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function deletePreset(value: string) {
    if (value === 'default') throw new Error('默认方案不可删除')
    if (!formDataPresets.value.some((preset) => preset.value === value))
      throw new Error('求职方案不存在')
    if (formDataPreset.value === value) throw new Error('请先切换到其他方案再删除')
    isLoading.value = true
    try {
      const previous = await counter.storageGet(
        formDataPresetsKey,
        jsonClone(formDataPresets.value),
      )
      const remaining = formDataPresets.value.filter((preset) => preset.value !== value)
      await counter.storageSet(formDataPresetsKey, jsonClone(remaining))
      try {
        await counter.storageRm(formDataKey(value))
      } catch (error) {
        await counter.storageSet(formDataPresetsKey, previous)
        throw error
      }
      formDataPresets.value = remaining
    } finally {
      isLoading.value = false
    }
  }

  return {
    prepareConfig: formDataHandler,
    confInit: init,
    confSaving,
    confReload,
    confExport,
    confImport,
    confDelete,
    confRecommend,
    formDataKey,
    defaultFormData,
    formData,
    configLevel,
    formDataPreset,
    formDataPresets,
    createPreset,
    switchPreset,
    deletePreset,
    isLoading,
  }
}
