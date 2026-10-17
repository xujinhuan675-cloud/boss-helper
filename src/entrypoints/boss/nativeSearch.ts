import { isPlainObject } from '../../utils/deepmerge'

export const nativeMultiFields = {
  experience: '工作经验',
  degree: '学历要求',
  stage: '融资阶段',
  scale: '公司规模',
  industry: '公司行业',
} as const

export type NativeSearchFilters = {
  query: string
  city: string
  jobType: string
  salary: string
} & Record<keyof typeof nativeMultiFields, string[]>
export type NativeSearchOption = { value: string; label: string }
export type NativeSearchOptions = Record<
  Exclude<keyof NativeSearchFilters, 'query'>,
  NativeSearchOption[]
>

const fields = ['query', 'city', 'jobType', 'salary', ...Object.keys(nativeMultiFields)] as const
const code = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value)

export function isNativeSearchFilters(value: unknown): value is NativeSearchFilters {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === fields.length &&
    typeof value.query === 'string' &&
    value.query.length <= 100 &&
    ['city', 'jobType', 'salary'].every((key) => value[key] === '' || code(value[key])) &&
    Object.keys(nativeMultiFields).every(
      (key) =>
        Array.isArray(value[key]) &&
        value[key].length <= (key === 'industry' ? 3 : 10) &&
        new Set(value[key]).size === value[key].length &&
        value[key].every(code),
    )
  )
}

export function nativeSearchFromUrl(href: string): NativeSearchFilters {
  const params = new URL(href).searchParams
  const value = (key: string) => (params.get(key) === '0' ? '' : (params.get(key) ?? ''))
  return {
    query: params.get('query') ?? '',
    city: value('city'),
    jobType: value('jobType'),
    salary: value('salary'),
    ...Object.fromEntries(
      Object.keys(nativeMultiFields).map((key) => [
        key,
        [...new Set(value(key).split(',').filter(Boolean))],
      ]),
    ),
  } as NativeSearchFilters
}

export function buildNativeSearchUrl(href: string, filters: NativeSearchFilters): URL {
  if (!isNativeSearchFilters(filters)) throw new Error('BOSS 原生筛选配置格式无效')
  const url = new URL(href)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.zhipin.com' ||
    !/^\/web\/geek\/(jobs|job-recommend)\/?$/.test(url.pathname)
  )
    throw new Error('请先打开 BOSS 职位搜索页')
  if ((url.searchParams.get('city') ?? '') !== filters.city) {
    for (const key of [
      'areaBusiness',
      'businessDistrict',
      'multiBusinessDistrict',
      'multiSubway',
      'subwayLine',
      'subwayStation',
    ])
      url.searchParams.delete(key)
  }
  url.pathname = '/web/geek/jobs'
  for (const key of fields) {
    const value = filters[key as keyof NativeSearchFilters]
    const text = Array.isArray(value) ? value.join(',') : value.trim()
    if (text) url.searchParams.set(key, text)
    else url.searchParams.delete(key)
  }
  url.searchParams.delete('page')
  url.hash = ''
  return url
}

export function parseNativeSearchOptions(value: unknown): NativeSearchOption[]
export function parseNativeSearchOptions<K extends string>(
  value: unknown,
  fields: readonly K[],
): Record<K, NativeSearchOption[]>
export function parseNativeSearchOptions(
  value: unknown,
  fields?: readonly string[],
): NativeSearchOption[] | Record<string, NativeSearchOption[]> {
  const fail = () => {
    throw new Error('BOSS 原生筛选选项加载失败，请稍后重试')
  }
  if (!isPlainObject(value) || value.code !== 0) return fail()
  function options(nodes: unknown, depth = Infinity): NativeSearchOption[] {
    if (!Array.isArray(nodes) || !nodes.length) return fail()
    return nodes.flatMap((node) => {
      if (
        !isPlainObject(node) ||
        typeof node.code !== 'number' ||
        !Number.isSafeInteger(node.code) ||
        node.code < 0 ||
        typeof node.name !== 'string' ||
        !node.name.trim()
      )
        return fail()
      if (depth > 0 && Array.isArray(node.subLevelModelList) && node.subLevelModelList.length)
        return options(node.subLevelModelList, depth - 1)
      return [{ value: node.code === 0 ? '' : String(node.code), label: node.name }]
    })
  }
  if (!fields) return options(value.zpData)
  if (!isPlainObject(value.zpData)) return fail()
  const data = value.zpData
  return Object.fromEntries(
    fields.map((key) => [key, options(data[key], key === 'cityList' ? 1 : Infinity)]),
  )
}
