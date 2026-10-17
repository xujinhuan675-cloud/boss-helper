/** @jsxImportSource react */
import { Alert, Button, ComboBox, Input, Label, ListBox, Select, TextField } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { counter } from '@/message'

import { nativeMultiFields, parseNativeSearchOptions } from '../entrypoints/boss/nativeSearch'
import type { NativeSearchFilters, NativeSearchOptions } from '../entrypoints/boss/nativeSearch'
import { SelectField } from './components'

export function NativeFilters({
  value,
  onChange,
  disabled,
  onRead,
  canRead,
}: {
  value: NativeSearchFilters
  onChange: (value: NativeSearchFilters) => void
  disabled: boolean
  onRead: () => void
  canRead: boolean
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">BOSS 原生筛选</h2>
        <Button variant="secondary" size="sm" isDisabled={disabled || !canRead} onPress={onRead}>
          <RefreshCw size={16} />
          读取 BOSS 当前筛选
        </Button>
      </div>
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
      <div className="job-filters">
        <TextField
          value={value.query}
          onChange={(query) => onChange({ ...value, query })}
          isDisabled={disabled}
        >
          <Label>职位关键词</Label>
          <Input maxLength={100} />
        </TextField>
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
        {(['jobType', 'salary'] as const).map((key) => (
          <SelectField
            key={key}
            label={key === 'jobType' ? '职位类型' : '薪资待遇'}
            value={value[key]}
            options={options?.[key] ?? []}
            placeholder="不限"
            disabled={locked}
            onChange={(selected) => onChange({ ...value, [key]: selected })}
          />
        ))}
        {(Object.keys(nativeMultiFields) as (keyof typeof nativeMultiFields)[]).map((key) => (
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
        ))}
      </div>
    </section>
  )
}
