/** @jsxImportSource react */
import {
  Accordion,
  Alert,
  Button,
  Chip,
  Input,
  Label,
  NumberField,
  Radio,
  RadioGroup,
  Separator,
  Slider,
  Switch,
  Table,
  TextArea,
  TextField,
} from '@heroui/react'
import { LocateFixed, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { defaultFormData } from '@/composables/conf/info'
import { counter } from '@/message'
import type { FormData } from '@/types/formData'
import { isPlainObject, jsonClone } from '@/utils/deepmerge'

import { act, ConfirmDialog, IconButton, SelectField } from './components'
import {
  command,
  createPlan,
  deletePlan,
  perform,
  saveConfig,
  selectResume,
  switchPlan,
} from './store'
import { useWorkbench } from './useWorkbench'

const filterLabels = {
  company: '公司名称',
  jobTitle: '岗位名称',
  jobContent: '岗位描述',
  hrPosition: 'HR 职位',
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
const deliveryTimingKeys = [
  'delayDeliveryStarts',
  'delayDeliveryInterval',
  'delayDeliveryPageNext',
  'delayMessageSending',
] as const
const collectionTimingKeys = [
  'delayCollectionScrollMin',
  'delayCollectionScrollMax',
  'delayCollectionDetailMin',
  'delayCollectionDetailMax',
  'collectionMaxRuntimeMinutes',
] as const
const rotationKeys = [
  'delayKeywordRotationMin',
  'delayKeywordRotationMax',
  'delayKeywordRotationBatchMin',
  'delayKeywordRotationBatchMax',
  'keywordRotationBatchSize',
  'keywordRotationDailyLimit',
  'keywordRotationAutoResume',
] as const
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

function TimeRange({
  label,
  value,
  onChange,
  disabled,
  minutes = false,
  scaleMax,
  min = 0,
}: {
  label: string
  value: [number, number]
  onChange: (value: [number, number]) => void
  disabled: boolean
  minutes?: boolean
  scaleMax: number
  min?: number
}) {
  const unit = minutes ? '分钟' : '秒'
  const divisor = minutes ? 60 : 1
  const displayed = value.map((seconds) => seconds / divisor)
  const [sliderMax, setSliderMax] = useState(Math.max(scaleMax, value[1]))
  const limit = Math.max(sliderMax, value[1])
  return (
    <section aria-label={label} className="min-w-0 space-y-3">
      <Slider
        aria-label={label}
        value={value}
        minValue={min}
        maxValue={limit}
        step={0.1}
        formatOptions={{ style: 'unit', unit: 'second' }}
        isDisabled={disabled}
        onChange={(next) => {
          setSliderMax(limit)
          onChange(next as [number, number])
        }}
        className="w-full"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>{label}</Label>
          <Slider.Output>
            {displayed.map((number) => Number(number.toFixed(2))).join('～')} {unit}
          </Slider.Output>
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb index={0} aria-label={`${label}最短`} />
          <Slider.Thumb index={1} aria-label={`${label}最长`} />
        </Slider.Track>
      </Slider>
    </section>
  )
}

function TimeInterval({
  label,
  value,
  onChange,
  disabled,
  scaleMax,
  step = 0.1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
  scaleMax: number
  step?: number
}) {
  const [sliderMax, setSliderMax] = useState(Math.max(scaleMax, value))
  const limit = Math.max(sliderMax, value)
  function update(next: number) {
    if (!Number.isFinite(next)) return
    setSliderMax(limit)
    onChange(next)
  }
  return (
    <section
      aria-label={label}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_72px] items-end gap-3"
    >
      <Slider
        aria-label={label}
        value={value}
        minValue={0}
        maxValue={limit}
        step={step}
        isDisabled={disabled}
        onChange={(next) => update(next as number)}
        className="min-w-0 grid-rows-[auto_1.5rem]"
      >
        <Label>{label}</Label>
        <Slider.Track className="self-center">
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      <NumberField
        aria-label={label}
        value={value}
        minValue={0}
        step={step}
        formatOptions={{ maximumFractionDigits: 6 }}
        isDisabled={disabled}
        onChange={update}
        className="min-w-0"
      >
        <NumberField.Group className="h-6 min-w-0">
          <NumberField.Input className="h-full w-full min-w-0 px-2 py-0 text-center leading-none" />
        </NumberField.Group>
      </NumberField>
    </section>
  )
}

export function Settings({ page = 'settings' }: { page?: 'settings' | 'filters' | 'plan' }) {
  const filters = page === 'filters'
  const plan = page === 'plan'
  const showFilters = filters || plan
  const state = useWorkbench()
  const [draft, setDraft] = useState<Partial<FormData>>({})
  const draftRef = useRef<Partial<FormData>>({})
  const draftPreset = useRef<string | null>(null)
  const saveTask = useRef<Promise<boolean> | null>(null)
  const [error, setError] = useState('')
  const [presetName, setPresetName] = useState('')
  const [creatingPreset, setCreatingPreset] = useState(false)
  const [deletingPreset, setDeletingPreset] = useState<{ label: string; value: string } | null>(
    null,
  )
  const [clearingCache, setClearingCache] = useState(false)
  const runtime = state.runtime
  const config = { ...state.config, ...draft }
  const detailCapacity = Math.floor(
    (config.collectionMaxRuntimeMinutes * 60) /
      ((config.delayCollectionDetailMin + config.delayCollectionDetailMax) / 2),
  )
  const dirty = Object.keys(draft).length > 0
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

  function stageDraft(patch: Partial<FormData>) {
    draftPreset.current ??= state.preset
    draftRef.current = { ...draftRef.current, ...patch }
    setDraft(draftRef.current)
    setError('')
  }

  function change<K extends keyof FormData>(key: K, value: FormData[K]) {
    stageDraft({ [key]: value })
  }

  function restoreGroup(keys: readonly (keyof FormData)[]) {
    stageDraft(Object.fromEntries(keys.map((key) => [key, jsonClone(defaultFormData[key])])))
  }

  const save = useCallback((): Promise<boolean> => {
    if (saveTask.current) return saveTask.current
    saveTask.current = (async () => {
      while (Object.keys(draftRef.current).length) {
        const pending = draftRef.current
        const preset = draftPreset.current!
        const patch = jsonClone(pending)
        for (const key of Object.keys(filterLabels) as (keyof typeof filterLabels)[]) {
          const filter = patch[key]
          if (filter) filter.value = filter.value.map((item) => item.trim()).filter(Boolean)
        }
        if (patch.record?.model)
          patch.record.model = patch.record.model.map((item) => item.trim()).filter(Boolean)
        try {
          await perform(() => saveConfig(patch, preset))
        } catch (error) {
          setError(`自动保存失败：${error instanceof Error ? error.message : String(error)}`)
          return false
        }
        if (draftRef.current === pending) {
          draftRef.current = {}
          draftPreset.current = null
          setDraft({})
        }
      }
      setError('')
      return true
    })().finally(() => {
      saveTask.current = null
    })
    return saveTask.current
  }, [])

  useEffect(() => {
    if (!dirty || busy || error) return
    const timer = setTimeout(() => {
      void save()
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, dirty, busy, error, save])

  useEffect(
    () => () => {
      void save()
    },
    [save],
  )

  async function switchPreset(value: string) {
    if (busy || value === state.preset || !(await save())) return
    await act(() => switchPlan(value))
  }

  async function removePreset() {
    if (busy || !deletingPreset) return
    if (!(await save())) return
    if (await act(() => deletePlan(deletingPreset.value), '求职方案已删除')) {
      setDeletingPreset(null)
    }
  }

  async function createPreset() {
    if (busy || !presetName.trim()) return
    if (!(await save())) return
    if (await act(() => createPlan(presetName.trim()), '求职方案已创建')) {
      setPresetName('')
      setCreatingPreset(false)
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

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {filters ? '筛选规则' : plan ? '求职方案' : '任务设置'}
          </h1>
          {plan && (
            <p className="text-sm text-muted">
              当前使用：{state.presets.find((preset) => preset.value === state.preset)?.label}
            </p>
          )}
        </div>
        {plan && (
          <Button
            isDisabled={busy}
            onPress={() => {
              setPresetName('')
              setCreatingPreset(true)
            }}
          >
            <Plus size={16} />
            新建方案
          </Button>
        )}
      </div>
      {dirty && !error && (
        <output className="text-sm text-warning" aria-live="polite">
          正在保存…
        </output>
      )}
      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>操作未完成</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {plan && (
        <section className="flex flex-col gap-3" aria-label="求职方案">
          <div className="field-grid">
            <SelectField
              label="当前简历"
              value={state.resumes.currentResumeId ?? '__none__'}
              disabled={busy}
              options={[
                { value: '__none__', label: '不使用简历' },
                ...state.resumes.resumes.map((resume) => ({
                  value: resume.id,
                  label: resume.name,
                })),
              ]}
              onChange={(id) => {
                void act(() => selectResume(id === '__none__' ? null : id), '方案简历已更新')
              }}
            />
          </div>
          <RadioGroup
            aria-label="当前求职方案"
            value={state.preset}
            isDisabled={busy}
            onChange={(value) => {
              void switchPreset(value)
            }}
          >
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="求职方案列表">
                  <Table.Header>
                    <Table.Column isRowHeader>求职方案</Table.Column>
                    <Table.Column className="text-right">管理</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {state.presets.map((preset) => (
                      <Table.Row key={preset.value} id={preset.value}>
                        <Table.Cell>
                          <div className="flex items-center gap-3">
                            <Radio value={preset.value}>
                              <Radio.Content aria-label={`使用 ${preset.label}`}>
                                <Radio.Control>
                                  <Radio.Indicator />
                                </Radio.Control>
                              </Radio.Content>
                            </Radio>
                            <span className="break-words">{preset.label}</span>
                            {preset.value === state.preset && (
                              <Chip size="sm" className="ml-2">
                                当前使用
                              </Chip>
                            )}
                          </div>
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              label={`删除 ${preset.label}`}
                              disabled={busy || preset.value === 'default'}
                              onPress={() => setDeletingPreset(preset)}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </RadioGroup>
          {creatingPreset && (
            <>
              <Separator />
              <section className="flex flex-col gap-4" aria-label="新建方案">
                <h2 className="text-lg font-semibold">新建方案</h2>
                <TextField value={presetName} onChange={setPresetName} isDisabled={busy}>
                  <Label>方案名称</Label>
                  <Input />
                </TextField>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => setCreatingPreset(false)}
                  >
                    取消编辑
                  </Button>
                  <Button
                    isDisabled={busy || !presetName.trim()}
                    onPress={() => {
                      void createPreset()
                    }}
                  >
                    <Save size={16} />
                    保存方案
                  </Button>
                </div>
              </section>
            </>
          )}
        </section>
      )}
      <Accordion
        allowsMultipleExpanded
        defaultExpandedKeys={filters ? [] : ['timing', 'rotation', 'collection']}
      >
        {showFilters && (
          <Accordion.Item id="filters">
            <Accordion.Heading>
              <Accordion.Trigger>
                本地筛选规则
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="flex flex-col gap-6">
                <div className="field-grid">
                  {(Object.keys(filterLabels) as (keyof typeof filterLabels)[]).map((key) => (
                    <section
                      key={key}
                      className="flex flex-col gap-3"
                      aria-label={filterLabels[key]}
                    >
                      <TextField
                        value={config[key].value.join('\n')}
                        onChange={(value) =>
                          change(key, { ...config[key], value: value.split('\n') })
                        }
                        isDisabled={busy}
                      >
                        <Label>{filterLabels[key]}排除关键词</Label>
                        <TextArea rows={3} />
                      </TextField>
                    </section>
                  ))}
                </div>
                <Separator />
                <div className="field-grid">
                  {(
                    Object.keys(toggleLabels).filter(
                      (key) => !['notification', 'useCache'].includes(key),
                    ) as (keyof typeof toggleLabels)[]
                  ).map((key) => (
                    <Switch
                      className="switch-row"
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
        )}
        {!filters && (
          <Accordion.Item id="timing">
            <Accordion.Heading>
              <Accordion.Trigger>
                投递与执行
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="space-y-4">
                <div className="max-w-sm">
                  <NumericField
                    label="单次投递上限"
                    value={config.deliveryLimit.value}
                    disabled={busy}
                    max={155}
                    min={1}
                    onChange={(value) =>
                      change('deliveryLimit', { ...config.deliveryLimit, value })
                    }
                  />
                </div>
                <div className="space-y-4">
                  <div className="field-grid">
                    {deliveryTimingKeys.map((key) => (
                      <TimeInterval
                        key={key}
                        label={
                          key === 'delayDeliveryPageNext' ? '翻页间隔（分钟）' : timingLabels[key]
                        }
                        value={key === 'delayDeliveryPageNext' ? config[key] / 60 : config[key]}
                        disabled={busy}
                        scaleMax={key === 'delayDeliveryPageNext' ? 10 : 60}
                        step={key === 'delayDeliveryPageNext' ? 1 / 60 : 0.1}
                        onChange={(value) =>
                          change(
                            key,
                            key === 'delayDeliveryPageNext' ? Math.round(value * 600) / 10 : value,
                          )
                        }
                      />
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => restoreGroup(['deliveryLimit', ...deliveryTimingKeys])}
                    >
                      <RotateCcw size={14} />
                      恢复本组默认值
                    </Button>
                  </div>
                </div>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        )}
        {!filters && (
          <Accordion.Item id="rotation">
            <Accordion.Heading>
              <Accordion.Trigger>
                关键词轮换
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="space-y-4">
                <div className="field-grid">
                  <NumericField
                    label="每日关键词上限"
                    value={config.keywordRotationDailyLimit}
                    disabled={busy}
                    min={1}
                    max={1000}
                    onChange={(value) => change('keywordRotationDailyLimit', value)}
                  />
                  <Switch
                    className="switch-row"
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
                </div>
                <div className="space-y-4">
                  <div className="field-grid">
                    <TimeRange
                      label="关键词间隔"
                      minutes
                      scaleMax={3600}
                      min={1}
                      value={[config.delayKeywordRotationMin, config.delayKeywordRotationMax]}
                      disabled={busy}
                      onChange={([delayKeywordRotationMin, delayKeywordRotationMax]) =>
                        stageDraft({ delayKeywordRotationMin, delayKeywordRotationMax })
                      }
                    />
                    <TimeRange
                      label="批次休息"
                      minutes
                      scaleMax={7200}
                      min={1}
                      value={[
                        config.delayKeywordRotationBatchMin,
                        config.delayKeywordRotationBatchMax,
                      ]}
                      disabled={busy}
                      onChange={([delayKeywordRotationBatchMin, delayKeywordRotationBatchMax]) =>
                        stageDraft({ delayKeywordRotationBatchMin, delayKeywordRotationBatchMax })
                      }
                    />
                    <NumericField
                      label="每批关键词数"
                      value={config.keywordRotationBatchSize}
                      disabled={busy}
                      min={1}
                      max={100}
                      onChange={(value) => change('keywordRotationBatchSize', value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => restoreGroup(rotationKeys)}
                    >
                      <RotateCcw size={14} />
                      恢复本组默认值
                    </Button>
                  </div>
                </div>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        )}
        {!filters && (
          <Accordion.Item id="collection">
            <Accordion.Heading>
              <Accordion.Trigger>
                采集与运行上限
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="space-y-4">
                <div className="space-y-4">
                  <div className="field-grid">
                    <NumericField
                      label="单次运行上限（分钟）"
                      value={config.collectionMaxRuntimeMinutes}
                      min={1}
                      max={1440}
                      disabled={busy}
                      onChange={(value) => change('collectionMaxRuntimeMinutes', value)}
                    />
                    <TimeRange
                      label="滚动间隔"
                      scaleMax={10}
                      value={[config.delayCollectionScrollMin, config.delayCollectionScrollMax]}
                      disabled={busy}
                      onChange={([delayCollectionScrollMin, delayCollectionScrollMax]) =>
                        stageDraft({ delayCollectionScrollMin, delayCollectionScrollMax })
                      }
                    />
                    <TimeRange
                      label="详情采集间隔"
                      scaleMax={30}
                      value={[config.delayCollectionDetailMin, config.delayCollectionDetailMax]}
                      disabled={busy}
                      onChange={([delayCollectionDetailMin, delayCollectionDetailMax]) =>
                        stageDraft({ delayCollectionDetailMin, delayCollectionDetailMax })
                      }
                    />
                  </div>
                  <div className="text-sm">
                    <output aria-label="理论详情数量" aria-live="polite">
                      理论估算：约{' '}
                      {Number.isFinite(detailCapacity) && detailCapacity >= 0
                        ? detailCapacity.toLocaleString('zh-CN')
                        : '-'}{' '}
                      条详情 / 次
                    </output>
                    <p className="text-muted">
                      按平均详情间隔计算，未扣除页面加载、滚动、失败和轮换休息。
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => restoreGroup(collectionTimingKeys)}
                    >
                      <RotateCcw size={14} />
                      恢复本组默认值
                    </Button>
                  </div>
                </div>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        )}
        {showFilters && (
          <Accordion.Item id="commute">
            <Accordion.Heading>
              <Accordion.Trigger>
                通勤与地图
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="flex flex-col gap-4">
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
                  <NumericField
                    label="最大直线距离（公里）"
                    value={config.amap.straightDistance}
                    disabled={busy}
                    step={0.1}
                    onChange={(straightDistance) =>
                      change('amap', { ...config.amap, straightDistance })
                    }
                  />
                </div>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        )}
        {!filters && (
          <Accordion.Item id="data">
            <Accordion.Heading>
              <Accordion.Trigger>
                通知、记录与缓存
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="flex flex-col gap-4">
                <div className="field-grid">
                  <Switch
                    className="switch-row"
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
                    className="switch-row"
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
                    className="switch-row"
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
                  className="self-end"
                  isDisabled={busy || !state.connected}
                  onPress={() => setClearingCache(true)}
                >
                  <Trash2 size={16} />
                  清空筛选缓存
                </Button>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
      <ConfirmDialog
        open={!!deletingPreset}
        title="删除求职方案"
        danger
        confirmLabel="删除"
        disabled={busy}
        onClose={() => setDeletingPreset(null)}
        onConfirm={() => {
          void removePreset()
        }}
      >
        <p>确定删除“{deletingPreset?.label}”及其配置？共享简历和岗位记录会保留。</p>
        {deletingPreset?.value === state.preset && <p>删除后使用默认方案。</p>}
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
