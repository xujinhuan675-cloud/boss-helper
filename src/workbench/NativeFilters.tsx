/** @jsxImportSource react */
import { Alert, Button, ComboBox, Disclosure, Input, Label, ListBox, Select } from '@heroui/react'
import { RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { counter } from '@/message'

import { normalizeKeywordList } from '../entrypoints/boss/keywordRotation'
import {
  nativeMultiFields,
  nativeSearchFromUrl,
  parseNativeSearchOptions,
} from '../entrypoints/boss/nativeSearch'
import type { NativeSearchFilters, NativeSearchOptions } from '../entrypoints/boss/nativeSearch'
import { act, IconButton, SelectField } from './components'
import { saveConfig } from './store'
import { useWorkbench } from './useWorkbench'

export function SearchFilters({ disabled }: { disabled: boolean }) {
  const state = useWorkbench()
  const [draft, setDraft] = useState<{ value: NativeSearchFilters; preset: string } | null>(null)
  const selectedUrl = state.runtime?.url || state.tabs.find((tab) => tab.id === state.tabId)?.url
  const keywords = normalizeKeywordList(state.keywords)
  const rotation = state.runtime?.keywordRotation
  const currentKeyword = state.runtime?.keywordRotationBusy
    ? rotation?.items[rotation.cursor]?.keyword
    : undefined
  const saved =
    state.config.nativeSearch ??
    nativeSearchFromUrl(selectedUrl || 'https://www.zhipin.com/web/geek/jobs')
  const value = {
    ...(draft?.value ?? saved),
    query:
      currentKeyword ??
      draft?.value.query ??
      (keywords.includes(saved.query) ? saved.query : (keywords[0] ?? saved.query)),
  }
  const conflict = !!draft && draft.preset !== state.preset
  const change = (value: NativeSearchFilters) =>
    setDraft({ value, preset: draft?.preset ?? state.preset })
  return (
    <NativeFilters
      value={value}
      keywords={keywords}
      onChange={change}
      disabled={disabled || conflict}
    >
      {conflict && (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>配置预设已变更</Alert.Title>
            <Alert.Description>请放弃筛选修改，再编辑当前预设。</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {state.settingsWarning && (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>配置同步提示</Alert.Title>
            <Alert.Description>{state.settingsWarning}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <div className="flex items-center justify-end gap-2">
        <IconButton
          label="读取 BOSS 当前筛选"
          disabled={disabled || conflict || !state.connected || !selectedUrl}
          onPress={() => {
            if (selectedUrl) change(nativeSearchFromUrl(selectedUrl))
          }}
        >
          <RefreshCw size={16} />
        </IconButton>
        <IconButton
          label="放弃筛选修改"
          disabled={disabled || !draft}
          onPress={() => setDraft(null)}
        >
          <RotateCcw size={16} />
        </IconButton>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={disabled || conflict}
          onPress={() => {
            void act(() => saveConfig({ nativeSearch: value }, draft?.preset ?? state.preset)).then(
              (ok) => {
                if (ok) setDraft(null)
              },
            )
          }}
        >
          <Save size={16} />
          {state.connected ? '应用到 BOSS' : '保存筛选'}
        </Button>
      </div>
    </NativeFilters>
  )
}

export function NativeFilters({
  value,
  onChange,
  disabled,
  keywords,
  children,
}: {
  value: NativeSearchFilters
  onChange: (value: NativeSearchFilters) => void
  disabled: boolean
  keywords: string[]
  children?: ReactNode
}) {
  const [options, setOptions] = useState<NativeSearchOptions | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError('')
    async function load() {
      const fetch = async (path: string) => {
        const result = await counter.fetchText({
          url: `https://www.zhipin.com/wapi/${path}.json`,
          data: { method: 'GET', credentials: 'omit', redirect: 'error' },
          timeout: 10000,
        })
        return JSON.parse(result.text) as unknown
      }
      const [conditions, industries, cities] = await Promise.all([
        fetch('zpgeek/search/job/condition'),
        fetch('zpCommon/data/industry'),
        fetch('zpCommon/data/city'),
      ])
      const fields = ['salary', 'jobType', 'experience', 'degree', 'stage', 'scale'] as const
      const parsed = parseNativeSearchOptions(
        conditions,
        fields.map((key) => `${key}List`),
      )
      const city = parseNativeSearchOptions(cities, ['cityList', 'hotCityList'])
      const next = {
        ...Object.fromEntries(fields.map((key) => [key, parsed[`${key}List`]])),
        industry: parseNativeSearchOptions(industries),
        city: [
          ...new Map(
            [...city.hotCityList, ...city.cityList].map((item) => [item.value, item]),
          ).values(),
        ],
      } as NativeSearchOptions
      if (!cancelled) setOptions(next)
    }
    void load().catch((error) => {
      if (!cancelled) setError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const locked = disabled || !options
  return (
    <section className="flex flex-col gap-4" aria-label="BOSS 原生筛选">
      <Disclosure className="space-y-4">
        {() => (
          <>
            <Disclosure.Heading level={2}>
              <Disclosure.Trigger className="flex w-full items-center justify-between py-0 text-base">
                <span className="font-semibold">筛选</span>
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            {error ? (
              <Alert status="warning">
                <Alert.Content>
                  <Alert.Title>筛选选项加载失败</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
                <Button variant="secondary" size="sm" onPress={() => setAttempt(attempt + 1)}>
                  <RefreshCw size={16} />
                  重试
                </Button>
              </Alert>
            ) : (
              !options && (
                <output className="text-sm text-muted" aria-live="polite">
                  正在加载 BOSS 筛选选项…
                </output>
              )
            )}
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="col-span-2 min-w-0">
                <SelectField
                  label="职位关键词"
                  value={value.query}
                  onChange={(query) => onChange({ ...value, query })}
                  disabled={disabled}
                  placeholder="暂无轮换关键词"
                  options={[...new Set([...keywords, value.query].filter(Boolean))].map(
                    (keyword) => ({ value: keyword, label: keyword }),
                  )}
                />
              </div>
              <ComboBox
                aria-label="工作城市"
                value={value.city || null}
                onChange={(key) => onChange({ ...value, city: String(key ?? '') })}
                isDisabled={locked}
                fullWidth
                className="min-w-0"
              >
                <Label>工作城市</Label>
                <ComboBox.InputGroup>
                  <Input placeholder="不限" className="min-w-0 flex-1" />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    {[{ value: '', label: '不限' }, ...(options?.city ?? [])].map((item) => (
                      <ListBox.Item key={item.value} id={item.value} textValue={item.label}>
                        {item.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>
              <SelectField
                label="薪资待遇"
                value={value.salary}
                options={options?.salary ?? []}
                placeholder="不限"
                disabled={locked}
                onChange={(salary) => onChange({ ...value, salary })}
              />
            </div>
            <Disclosure.Content>
              <Disclosure.Body className="space-y-3">
                <div className="grid grid-cols-2 items-end gap-3">
                  <SelectField
                    label="职位类型"
                    value={value.jobType}
                    options={options?.jobType ?? []}
                    placeholder="不限"
                    disabled={locked}
                    onChange={(jobType) => onChange({ ...value, jobType })}
                  />
                  {(Object.keys(nativeMultiFields) as (keyof typeof nativeMultiFields)[]).map(
                    (key) => (
                      <Select
                        key={key}
                        aria-label={nativeMultiFields[key]}
                        selectionMode="multiple"
                        value={value[key].length ? value[key] : ['all']}
                        onChange={(keys) =>
                          onChange({
                            ...value,
                            [key]:
                              keys.includes('all') && value[key].length
                                ? []
                                : keys.map(String).filter((key) => key !== 'all'),
                          })
                        }
                        disabledKeys={
                          key === 'industry' && value[key].length >= 3
                            ? options?.[key]
                                .filter((item) => item.value && !value[key].includes(item.value))
                                .map((item) => item.value)
                            : []
                        }
                        isDisabled={locked}
                        fullWidth
                        className="min-w-0"
                      >
                        <Label>
                          {nativeMultiFields[key]}
                          {key === 'industry' ? '（最多 3 项）' : ''}
                        </Label>
                        <Select.Trigger>
                          <Select.Value className="truncate" />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {[
                              { value: 'all', label: '不限' },
                              ...(options?.[key].filter((item) => item.value) ?? []),
                            ].map((item) => (
                              <ListBox.Item key={item.value} id={item.value} textValue={item.label}>
                                <span className="min-w-0 break-words">{item.label}</span>
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    ),
                  )}
                </div>
                {children}
              </Disclosure.Body>
            </Disclosure.Content>
          </>
        )}
      </Disclosure>
    </section>
  )
}
