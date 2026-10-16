/** @jsxImportSource react */
import {
  Accordion,
  Alert,
  Button,
  Input,
  Label,
  NumberField,
  Separator,
  Switch,
  TextArea,
  TextField,
} from '@heroui/react'
import {
  ArrowDown,
  ArrowUp,
  Download,
  ImagePlus,
  LocateFixed,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { defaultFormData } from '@/composables/conf/info'
import { counter } from '@/message'
import type { CustomGreetingItem, FormData, FormDataRange } from '@/types/formData'
import deepmerge, { isPlainObject, jsonClone } from '@/utils/deepmerge'
import { exportJson } from '@/utils/jsonImportExport'

import { act, ConfirmDialog, IconButton, SelectField } from './components'
import { validateConfig } from './settingsValidation'
import { command, reloadExecutorSettings, saveConfig, services } from './store'
import { useWorkbench } from './useWorkbench'

const filterLabels = {
  company: '公司名称',
  jobTitle: '岗位名称',
  jobContent: '岗位描述',
  hrPosition: 'HR 职位',
  jobAddress: '工作地址',
} as const
const toggleLabels = {
  activityFilter: '过滤不活跃招聘者',
  friendStatus: '过滤已经聊过的招聘者',
  bossGoldMedalHr: '过滤金牌面试官',
  sameCompanyFilter: '同公司去重',
  sameHrFilter: '同 HR 去重',
  goldHunterFilter: '过滤猎头',
  notification: '完成后发送通知',
  useCache: '使用筛选缓存',
  greetingVariable: '渲染招呼语变量',
} as const
const timingLabels = {
  delayDeliveryStarts: '投递启动延迟（秒）',
  delayDeliveryInterval: '逐岗投递间隔（秒）',
  delayDeliveryPageNext: '翻页间隔（秒）',
  delayMessageSending: '消息发送间隔（秒）',
  delayCollectionScrollMin: '采集滚动最短间隔（秒）',
  delayCollectionScrollMax: '采集滚动最长间隔（秒）',
  delayCollectionDetailMin: '详情采集最短间隔（秒）',
  delayCollectionDetailMax: '详情采集最长间隔（秒）',
} as const
const commuteLabels = {
  straightDistance: '直线距离（公里）',
  drivingDistance: '驾车距离（公里）',
  drivingDuration: '驾车时间（分钟）',
  walkingDistance: '步行距离（公里）',
  walkingDuration: '步行时间（分钟）',
} as const
const rotationTimingLabels = {
  delayKeywordRotationMin: '关键词最短冷却（秒）',
  delayKeywordRotationMax: '关键词最长冷却（秒）',
  delayKeywordRotationBatchMin: '批次最短休息（秒）',
  delayKeywordRotationBatchMax: '批次最长休息（秒）',
} as const
const millisecondsPerDay = 86400000

function NumericField({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
  min?: number
  max?: number
  step?: number
}) {
  return (
    <NumberField
      value={value}
      onChange={onChange}
      minValue={min}
      maxValue={max}
      step={step}
      isDisabled={disabled}
    >
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input />
        <NumberField.IncrementButton />
      </NumberField.Group>
    </NumberField>
  )
}

function RangeFields({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: FormDataRange
  onChange: (value: FormDataRange) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="field-grid">
        <NumericField
          label={`${label}下限`}
          value={value[0]}
          onChange={(number) => onChange([number, value[1], value[2]])}
          disabled={disabled}
        />
        <NumericField
          label={`${label}上限`}
          value={value[1]}
          onChange={(number) => onChange([value[0], number, value[2]])}
          disabled={disabled}
        />
      </div>
      <Switch
        isSelected={value[2]}
        onChange={(strict) => onChange([value[0], value[1], strict])}
        isDisabled={disabled}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>严格匹配</Label>
        </Switch.Content>
      </Switch>
    </div>
  )
}

function GreetingImage({
  image,
  index,
  disabled,
  onUpload,
}: {
  image: string
  index: number
  disabled: boolean
  onUpload: (file: File) => void
}) {
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    let url = ''
    setPreview('')
    setError('')
    if (image)
      void counter
        .getImage(image)
        .then((result) => {
          if (cancelled) return
          if (!result.success) {
            setError('图片不存在或已过期')
            return
          }
          url = URL.createObjectURL(
            new Blob([new Uint8Array(result.buffer)], { type: result.type }),
          )
          setPreview(url)
        })
        .catch(() => {
          if (!cancelled) setError('图片读取失败')
        })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [image])
  return (
    <div className="flex flex-col gap-2">
      {preview && (
        <img
          src={preview}
          alt={`招呼语图片 ${index + 1}`}
          className="max-h-48 max-w-full object-contain self-start"
        />
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <TextField isDisabled={disabled}>
        <Label>{image ? '更换图片' : '上传图片'}</Label>
        <Input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onUpload(file)
          }}
        />
      </TextField>
    </div>
  )
}

export function Settings() {
  const state = useWorkbench()
  const [draft, setDraft] = useState<Partial<FormData>>({})
  const draftPreset = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [presetName, setPresetName] = useState('')
  const [switchingPreset, setSwitchingPreset] = useState<string | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const runtime = state.runtime
  const config = { ...state.config, ...draft }
  const dirty = Object.keys(draft).length > 0
  const presetConflict = dirty && draftPreset.current !== state.preset
  const busy =
    state.loading ||
    state.saving ||
    !!(
      runtime?.gatheringBusy ||
      runtime?.analysisBusy ||
      runtime?.keywordRotationBusy ||
      runtime?.realtimeBusy ||
      runtime?.keywordExtractionBusy ||
      runtime?.keywordRotationSaving ||
      runtime?.workflow?.status === 'running'
    )

  function stageDraft(patch: Partial<FormData>, replace = false) {
    draftPreset.current ??= state.preset
    setDraft((current) => (replace ? patch : { ...current, ...patch }))
    setError('')
  }

  function change<K extends keyof FormData>(key: K, value: FormData[K]) {
    stageDraft({ [key]: value })
  }

  function discardDraft() {
    setDraft({})
    draftPreset.current = null
    setError('')
  }

  function assertDraftPreset() {
    if (
      draftPreset.current !== null &&
      draftPreset.current !== services.conf.formDataPreset.value
    ) {
      throw new Error('配置预设已变更，请先放弃草稿并重新加载当前预设')
    }
  }

  function preparedConfig() {
    assertDraftPreset()
    const next = jsonClone(config)
    for (const key of Object.keys(filterLabels) as (keyof typeof filterLabels)[])
      next[key].value = next[key].value.map((item) => item.trim()).filter(Boolean)
    if (next.record.model)
      next.record.model = next.record.model.map((item) => item.trim()).filter(Boolean)
    validateConfig(next)
    return next
  }

  async function save() {
    if (busy || !dirty) return
    setError('')
    try {
      const next = preparedConfig()
      const patch = Object.fromEntries(
        Object.keys(draft).map((key) => [key, next[key]]),
      ) as Partial<FormData>
      if (
        await act(() => {
          assertDraftPreset()
          return saveConfig(patch)
        }, '配置已保存')
      )
        discardDraft()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  async function importConfig(file: File) {
    if (busy) return
    setError('')
    try {
      const value: unknown = JSON.parse(await file.text())
      if (!isPlainObject(value)) throw new Error('配置文件必须为 JSON 对象')
      const imported = await services.conf.prepareConfig(value as Partial<FormData>)
      const next = deepmerge<FormData>(jsonClone(config), imported)
      validateConfig(next)
      stageDraft(next, true)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  async function switchPreset(value: string) {
    if (busy) return
    if (
      await act(async () => {
        await services.conf.switchPreset(value)
        await reloadExecutorSettings()
      }, '配置预设已切换')
    ) {
      discardDraft()
      setSwitchingPreset(null)
    }
  }

  async function createPreset() {
    if (busy || !presetName.trim()) return
    setError('')
    try {
      const next = preparedConfig()
      const name = presetName.trim()
      if (
        await act(async () => {
          assertDraftPreset()
          const before = jsonClone(services.conf.formData)
          Object.assign(services.conf.formData, next)
          try {
            await services.conf.createPreset(name)
          } catch (error) {
            Object.assign(services.conf.formData, before)
            throw error
          }
          await reloadExecutorSettings()
        }, '配置预设已创建')
      ) {
        discardDraft()
        setPresetName('')
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  async function geocode() {
    if (busy) return
    setError('')
    await act(async () => {
      if (!config.amap.key.trim() || !config.amap.origins.trim())
        throw new Error('请填写高德地图 Key 和起点地址')
      const url = new URL('https://restapi.amap.com/v3/geocode/geo')
      url.search = new URLSearchParams({
        key: config.amap.key,
        address: config.amap.origins,
        output: 'JSON',
      }).toString()
      const result = await counter.fetchText({
        url: url.toString(),
        data: { method: 'GET', credentials: 'omit', redirect: 'error' },
        timeout: 10000,
      })
      const value: unknown = JSON.parse(result.text)
      if (
        !isPlainObject(value) ||
        value.status !== '1' ||
        !Array.isArray(value.geocodes) ||
        !isPlainObject(value.geocodes[0]) ||
        typeof value.geocodes[0].location !== 'string'
      )
        throw new Error('未找到起点经纬度，请检查地址和地图 Key')
      change('amap', { ...config.amap, origins: value.geocodes[0].location })
    })
  }

  async function uploadImage(index: number, file: File) {
    if (busy || !Array.isArray(config.customGreeting.value)) return
    const items = config.customGreeting.value
    await act(async () => {
      if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
      const image = await counter.setImage({
        name: file.name,
        type: file.type,
        buffer: Array.from(new Uint8Array(await file.arrayBuffer())),
      })
      if (!image.success || !image.key) throw new Error('图片上传失败')
      change('customGreeting', {
        ...config.customGreeting,
        value: items.map((item, i): CustomGreetingItem =>
          i === index ? { type: 'image', image: image.key } : item,
        ),
      })
    }, '图片已上传，保存配置后生效')
  }

  function greetingItems(): CustomGreetingItem[] {
    return typeof config.customGreeting.value === 'string'
      ? [{ type: 'text', content: config.customGreeting.value }]
      : config.customGreeting.value
  }

  function updateGreeting(items: CustomGreetingItem[]) {
    change('customGreeting', { ...config.customGreeting, value: items })
  }

  function moveGreeting(index: number, delta: number) {
    const items = [...greetingItems()]
    const next = index + delta
    if (next < 0 || next >= items.length) return
    ;[items[index], items[next]] = [items[next]!, items[index]!]
    updateGreeting(items)
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">任务设置</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" isDisabled={busy || !dirty} onPress={discardDraft}>
            <RotateCcw size={16} />
            放弃修改
          </Button>
          <Button
            isDisabled={busy || !dirty || presetConflict}
            onPress={() => {
              void save()
            }}
          >
            <Save size={16} />
            保存配置
          </Button>
        </div>
      </div>
      {dirty && (
        <output className="text-sm text-warning" aria-live="polite">
          有尚未保存的配置修改
        </output>
      )}
      {presetConflict && (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>配置预设已变更</Alert.Title>
            <Alert.Description>草稿属于之前的预设。请放弃修改，再编辑当前预设。</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>配置未保存</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <div className="field-grid">
        <SelectField
          label="当前预设"
          value={state.preset}
          options={state.presets}
          disabled={busy}
          onChange={(value) => {
            if (value !== state.preset) {
              if (dirty) setSwitchingPreset(value)
              else void switchPreset(value)
            }
          }}
        />
        <div className="flex items-end gap-2">
          <TextField
            value={presetName}
            onChange={setPresetName}
            isDisabled={busy}
            className="min-w-0 flex-1"
          >
            <Label>新预设名称</Label>
            <Input />
          </TextField>
          <Button
            variant="secondary"
            isDisabled={busy || !presetName.trim() || presetConflict}
            onPress={() => {
              void createPreset()
            }}
          >
            <Plus size={16} />
            创建
          </Button>
        </div>
      </div>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={['filters']}>
        <Accordion.Item id="filters">
          <Accordion.Heading>
            <Accordion.Trigger>
              岗位筛选
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="flex flex-col gap-6">
              <div className="field-grid">
                {(Object.keys(filterLabels) as (keyof typeof filterLabels)[]).map((key) => (
                  <section key={key} className="flex flex-col gap-3" aria-label={filterLabels[key]}>
                    <Switch
                      isSelected={config[key].enable}
                      onChange={(enable) => change(key, { ...config[key], enable })}
                      isDisabled={busy}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Label>{filterLabels[key]}</Label>
                      </Switch.Content>
                    </Switch>
                    <SelectField
                      label={`${filterLabels[key]}匹配方式`}
                      value={config[key].include ? 'include' : 'exclude'}
                      options={[
                        { value: 'include', label: '包含任意关键词' },
                        ...(key === 'jobAddress'
                          ? []
                          : [{ value: 'exclude', label: '排除关键词' }]),
                      ]}
                      disabled={busy || key === 'jobAddress'}
                      onChange={(mode) =>
                        change(key, { ...config[key], include: mode === 'include' })
                      }
                    />
                    <TextField
                      value={config[key].value.join('\n')}
                      onChange={(value) =>
                        change(key, { ...config[key], value: value.split('\n') })
                      }
                      isDisabled={busy}
                    >
                      <Label>{filterLabels[key]}关键词（每行一项）</Label>
                      <TextArea rows={4} />
                    </TextField>
                  </section>
                ))}
              </div>
              <Separator />
              <Switch
                isSelected={config.salaryRange.enable}
                onChange={(enable) => change('salaryRange', { ...config.salaryRange, enable })}
                isDisabled={busy}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>薪资筛选</Label>
                </Switch.Content>
              </Switch>
              <RangeFields
                label="月薪（K）"
                value={config.salaryRange.value}
                disabled={busy}
                onChange={(value) => change('salaryRange', { ...config.salaryRange, value })}
              />
              <div>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => {
                    const [min, max, strict] = config.salaryRange.value
                    const monthly: FormDataRange = [
                      Math.round(min * 1000),
                      Math.round(max * 1000),
                      config.salaryRange.advancedValue.M[2],
                    ]
                    const daily: FormDataRange = [
                      Math.round(monthly[0] / 21.75),
                      Math.round(monthly[1] / 21.75),
                      config.salaryRange.advancedValue.D[2],
                    ]
                    change('salaryRange', {
                      ...config.salaryRange,
                      value: [min, max, strict],
                      advancedValue: {
                        M: monthly,
                        D: daily,
                        H: [
                          Math.round(daily[0] / 8),
                          Math.round(daily[1] / 8),
                          config.salaryRange.advancedValue.H[2],
                        ],
                      },
                    })
                  }}
                >
                  同步时薪、日薪与月薪
                </Button>
              </div>
              {(['H', 'D', 'M'] as const).map((unit) => (
                <RangeFields
                  key={unit}
                  label={{ H: '时薪（元）', D: '日薪（元）', M: '月薪（元）' }[unit]}
                  value={config.salaryRange.advancedValue[unit]}
                  disabled={busy}
                  onChange={(value) =>
                    change('salaryRange', {
                      ...config.salaryRange,
                      advancedValue: { ...config.salaryRange.advancedValue, [unit]: value },
                    })
                  }
                />
              ))}
              <Separator />
              <Switch
                isSelected={config.companySizeRange.enable}
                onChange={(enable) =>
                  change('companySizeRange', { ...config.companySizeRange, enable })
                }
                isDisabled={busy}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>公司规模筛选</Label>
                </Switch.Content>
              </Switch>
              <RangeFields
                label="公司人数"
                value={config.companySizeRange.value}
                disabled={busy}
                onChange={(value) =>
                  change('companySizeRange', { ...config.companySizeRange, value })
                }
              />
              <Separator />
              <div className="field-grid">
                {(
                  Object.keys(toggleLabels).filter(
                    (key) => !['greetingVariable', 'notification', 'useCache'].includes(key),
                  ) as (keyof typeof toggleLabels)[]
                ).map((key) => (
                  <Switch
                    key={key}
                    isSelected={config[key].value}
                    onChange={(value) => change(key, { ...config[key], value })}
                    isDisabled={busy}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>{toggleLabels[key]}</Label>
                    </Switch.Content>
                  </Switch>
                ))}
                <NumericField
                  label="同公司去重有效期（天，0 为永久）"
                  value={(config.sameCompanyFilter.expire ?? 0) / millisecondsPerDay}
                  disabled={busy}
                  onChange={(days) =>
                    change('sameCompanyFilter', {
                      ...config.sameCompanyFilter,
                      expire: days * millisecondsPerDay,
                    })
                  }
                />
                <NumericField
                  label="同 HR 去重有效期（天，0 为永久）"
                  value={(config.sameHrFilter.expire ?? 0) / millisecondsPerDay}
                  disabled={busy}
                  onChange={(days) =>
                    change('sameHrFilter', {
                      ...config.sameHrFilter,
                      expire: days * millisecondsPerDay,
                    })
                  }
                />
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id="greeting">
          <Accordion.Heading>
            <Accordion.Trigger>
              自定义招呼语
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="flex flex-col gap-4">
              <Switch
                isSelected={config.customGreeting.enable}
                onChange={(enable) =>
                  change('customGreeting', { ...config.customGreeting, enable })
                }
                isDisabled={busy}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>启用自定义招呼语</Label>
                </Switch.Content>
              </Switch>
              <Switch
                isSelected={config.greetingVariable.value}
                onChange={(value) =>
                  change('greetingVariable', { ...config.greetingVariable, value })
                }
                isDisabled={busy}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>渲染招呼语变量</Label>
                </Switch.Content>
              </Switch>
              {config.aiGreeting.enable && (
                <p className="text-sm text-muted">
                  当前 AI 招呼语已启用，自定义文字招呼语将由 AI 生成内容替代。
                </p>
              )}
              {typeof config.customGreeting.value === 'string' ? (
                <TextField
                  value={config.customGreeting.value}
                  onChange={(value) =>
                    change('customGreeting', { ...config.customGreeting, value })
                  }
                  isDisabled={busy}
                >
                  <Label>招呼语正文</Label>
                  <TextArea rows={6} />
                </TextField>
              ) : (
                config.customGreeting.value.map((item, index) => (
                  <section
                    key={index}
                    className="flex flex-col gap-3"
                    aria-label={`消息 ${index + 1}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        消息 {index + 1} · {item.type === 'image' ? '图片' : '文字'}
                      </h3>
                      <div className="flex gap-1">
                        <IconButton
                          label={`消息 ${index + 1} 上移`}
                          disabled={busy || index === 0}
                          onPress={() => moveGreeting(index, -1)}
                        >
                          <ArrowUp size={16} />
                        </IconButton>
                        <IconButton
                          label={`消息 ${index + 1} 下移`}
                          disabled={busy || index === greetingItems().length - 1}
                          onPress={() => moveGreeting(index, 1)}
                        >
                          <ArrowDown size={16} />
                        </IconButton>
                        <IconButton
                          label={`删除消息 ${index + 1}`}
                          disabled={busy}
                          onPress={() =>
                            updateGreeting(greetingItems().filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </div>
                    </div>
                    {item.type === 'text' ? (
                      <TextField
                        aria-label={`消息 ${index + 1} 文字`}
                        value={item.content}
                        isDisabled={busy}
                        onChange={(content) =>
                          updateGreeting(
                            greetingItems().map((message, i) =>
                              i === index ? { type: 'text', content } : message,
                            ),
                          )
                        }
                      >
                        <TextArea rows={4} />
                      </TextField>
                    ) : (
                      <GreetingImage
                        image={item.image}
                        index={index}
                        disabled={busy}
                        onUpload={(file) => {
                          void uploadImage(index, file)
                        }}
                      />
                    )}
                  </section>
                ))
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() =>
                    updateGreeting([...greetingItems(), { type: 'text', content: '' }])
                  }
                >
                  <Plus size={16} />
                  添加文字
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => updateGreeting([...greetingItems(), { type: 'image', image: '' }])}
                >
                  <ImagePlus size={16} />
                  添加图片
                </Button>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id="timing">
          <Accordion.Heading>
            <Accordion.Trigger>
              投递数量与执行间隔
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="field-grid">
              <NumericField
                label="单次投递上限"
                value={config.deliveryLimit.value}
                disabled={busy}
                max={155}
                onChange={(value) => change('deliveryLimit', { ...config.deliveryLimit, value })}
              />
              {(Object.keys(timingLabels) as (keyof typeof timingLabels)[]).map((key) => (
                <NumericField
                  key={key}
                  label={timingLabels[key]}
                  value={config[key]}
                  disabled={busy}
                  step={0.1}
                  onChange={(value) => change(key, value)}
                />
              ))}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id="rotation">
          <Accordion.Heading>
            <Accordion.Trigger>
              关键词轮换
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="field-grid">
              {(Object.keys(rotationTimingLabels) as (keyof typeof rotationTimingLabels)[]).map(
                (key) => (
                  <NumericField
                    key={key}
                    label={rotationTimingLabels[key]}
                    value={config[key]}
                    disabled={busy}
                    min={1}
                    max={86400}
                    onChange={(value) => change(key, value)}
                  />
                ),
              )}
              <NumericField
                label="每批关键词数"
                value={config.keywordRotationBatchSize}
                disabled={busy}
                min={1}
                max={100}
                onChange={(value) => change('keywordRotationBatchSize', value)}
              />
              <NumericField
                label="每日关键词上限"
                value={config.keywordRotationDailyLimit}
                disabled={busy}
                min={1}
                max={1000}
                onChange={(value) => change('keywordRotationDailyLimit', value)}
              />
              <Switch
                isSelected={config.keywordRotationAutoResume.value}
                onChange={(value) =>
                  change('keywordRotationAutoResume', {
                    ...config.keywordRotationAutoResume,
                    value,
                  })
                }
                isDisabled={busy}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>页面重新加载后自动继续轮换</Label>
                </Switch.Content>
              </Switch>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id="commute">
          <Accordion.Heading>
            <Accordion.Trigger>
              通勤与地图
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="flex flex-col gap-4">
              <Switch
                isSelected={config.amap.enable}
                onChange={(enable) => change('amap', { ...config.amap, enable })}
                isDisabled={busy}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>启用高德地图通勤筛选</Label>
                </Switch.Content>
              </Switch>
              <div className="field-grid">
                <TextField
                  value={config.amap.key}
                  onChange={(key) => change('amap', { ...config.amap, key })}
                  isDisabled={busy}
                >
                  <Label>高德 Web 服务 Key</Label>
                  <Input type="password" autoComplete="off" />
                </TextField>
                <div className="flex items-end gap-2">
                  <TextField
                    value={config.amap.origins}
                    onChange={(origins) => change('amap', { ...config.amap, origins })}
                    isDisabled={busy}
                    className="min-w-0 flex-1"
                  >
                    <Label>起点地址或经度,纬度</Label>
                    <Input />
                  </TextField>
                  <IconButton
                    label="查找起点经纬度"
                    disabled={busy}
                    onPress={() => {
                      void geocode()
                    }}
                  >
                    <LocateFixed size={16} />
                  </IconButton>
                </div>
                {(Object.keys(commuteLabels) as (keyof typeof commuteLabels)[]).map((key) => (
                  <NumericField
                    key={key}
                    label={commuteLabels[key]}
                    value={config.amap[key]}
                    disabled={busy}
                    step={0.1}
                    onChange={(value) => change('amap', { ...config.amap, [key]: value })}
                  />
                ))}
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id="data">
          <Accordion.Heading>
            <Accordion.Trigger>
              记录、缓存与配置文件
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="flex flex-col gap-4">
              <div className="field-grid">
                <Switch
                  isSelected={config.notification.value}
                  onChange={(value) => change('notification', { ...config.notification, value })}
                  isDisabled={busy}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Label>完成后发送通知</Label>
                  </Switch.Content>
                </Switch>
                <Switch
                  isSelected={config.useCache.value}
                  onChange={(value) => change('useCache', { ...config.useCache, value })}
                  isDisabled={busy}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Label>使用筛选缓存</Label>
                  </Switch.Content>
                </Switch>
                <Switch
                  isSelected={config.record.enable}
                  onChange={(enable) => change('record', { ...config.record, enable })}
                  isDisabled={busy}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Label>启用内容记录</Label>
                  </Switch.Content>
                </Switch>
                <TextField
                  value={(config.record.model ?? []).join('\n')}
                  onChange={(value) =>
                    change('record', { ...config.record, model: value.split('\n') })
                  }
                  isDisabled={busy}
                >
                  <Label>记录模型（每行一项）</Label>
                  <TextArea rows={3} />
                </TextField>
              </div>
              <Button
                variant="secondary"
                className="self-start"
                isDisabled={busy || !state.connected}
                onPress={() => setClearingCache(true)}
              >
                <Trash2 size={16} />
                清空筛选缓存
              </Button>
              <Separator />
              <TextField isDisabled={busy}>
                <Label>导入配置文件</Label>
                <Input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importConfig(file)
                  }}
                />
              </TextField>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => exportJson(jsonClone(state.config), '打招呼配置')}
                >
                  <Download size={16} />
                  导出已保存配置
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => {
                    const keys = [
                      'deliveryLimit',
                      'activityFilter',
                      'friendStatus',
                      'sameCompanyFilter',
                      'sameHrFilter',
                      'goldHunterFilter',
                      'notification',
                      'useCache',
                      ...Object.keys(timingLabels),
                      ...Object.keys(rotationTimingLabels),
                      'keywordRotationBatchSize',
                      'keywordRotationDailyLimit',
                      'keywordRotationAutoResume',
                    ] as const
                    const recommended = Object.fromEntries(
                      keys.map((key) => [key, jsonClone(defaultFormData[key])]),
                    )
                    stageDraft(recommended)
                  }}
                >
                  应用推荐配置
                </Button>
                <Button
                  variant="danger-soft"
                  isDisabled={busy}
                  onPress={() => {
                    stageDraft(jsonClone(defaultFormData), true)
                  }}
                >
                  <RotateCcw size={16} />
                  恢复默认配置
                </Button>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <ConfirmDialog
        open={switchingPreset !== null}
        title="切换配置预设"
        disabled={busy}
        confirmLabel="放弃修改并切换"
        onClose={() => setSwitchingPreset(null)}
        onConfirm={() => {
          if (switchingPreset) void switchPreset(switchingPreset)
        }}
      >
        <p>当前配置有未保存修改。切换预设将放弃这些修改。</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={clearingCache}
        title="清空筛选缓存"
        danger
        disabled={busy}
        confirmLabel="清空"
        onClose={() => setClearingCache(false)}
        onConfirm={() => {
          void act(() => command({ type: 'clearCache' }), '筛选缓存已清空').then((ok) => {
            if (ok) setClearingCache(false)
          })
        }}
      >
        <p>清空筛选结果缓存后，后续任务会重新筛选岗位。</p>
      </ConfirmDialog>
    </section>
  )
}
