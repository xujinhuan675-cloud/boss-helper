import { parseGptJson } from '../../utils/ai'

export const KEYWORD_ROTATION_STORAGE_KEY = 'local:boss-helper:keyword-rotation:v1'

export const DEFAULT_JOB_KEYWORDS = [
  '产品经理',
  'AI产品经理',
  'B端产品经理',
  'C端产品经理',
  '数据产品经理',
  '金融产品经理',
  'SaaS产品经理',
  '平台产品经理',
  '商业化产品经理',
  '产品运营',
]

export type KeywordRotationItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type KeywordRotationStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'

export type KeywordRotationItem = {
  keyword: string
  enabled: boolean
  status: KeywordRotationItemStatus
  lastRunId?: string
  error?: string
  startedAt?: string
  completedAt?: string
}

export type KeywordRotationPlan = {
  version: 1
  status: KeywordRotationStatus
  items: KeywordRotationItem[]
  cursor: number
  baseSearchUrl: string
  filterSnapshot: { salary: string; city: string }
  currentRunId?: string
  error?: string
  updatedAt: string
}

export function normalizeKeywordList(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : input.split(/\r?\n/)
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function parseJobKeywords(text: string): string[] {
  const result = parseGptJson<{ keywords: unknown }>(text)
  if (
    !Array.isArray(result?.keywords) ||
    result.keywords.some((value) => typeof value !== 'string')
  )
    throw new Error('AI 返回的岗位关键词格式无效，请重试')
  const keywords = normalizeKeywordList(result.keywords)
  if (!keywords.length) throw new Error('AI 未提取到岗位关键词，请补充简历后重试')
  return keywords
}

export function normalizeSearchUrl(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('query')
  url.searchParams.delete('page')
  url.hash = ''
  return url.toString()
}

export function createKeywordRotationPlan(
  keywords: string | string[],
  input: {
    baseSearchUrl: string
    salary: string
    city: string
    now?: string
  },
): KeywordRotationPlan {
  const now = input.now ?? new Date().toISOString()
  const normalized = normalizeKeywordList(keywords)
  return {
    version: 1,
    status: normalized.length ? 'running' : 'idle',
    items: normalized.map((keyword) => ({ keyword, enabled: true, status: 'pending' })),
    cursor: 0,
    baseSearchUrl: normalizeSearchUrl(input.baseSearchUrl),
    filterSnapshot: { salary: input.salary, city: input.city },
    updatedAt: now,
  }
}

export function resetKeywordRotationPlan(
  plan: KeywordRotationPlan,
  now = new Date().toISOString(),
): KeywordRotationPlan {
  return {
    ...plan,
    status: plan.items.some((item) => item.enabled) ? 'running' : 'idle',
    items: plan.items.map((item) => ({
      keyword: item.keyword,
      enabled: item.enabled,
      status: item.enabled ? 'pending' : 'skipped',
    })),
    cursor: 0,
    currentRunId: undefined,
    error: undefined,
    updatedAt: now,
  }
}

export function nextKeywordIndex(plan: KeywordRotationPlan): number {
  for (let index = Math.max(0, plan.cursor); index < plan.items.length; index++) {
    const item = plan.items[index]
    if (item.enabled && ['pending', 'running', 'failed'].includes(item.status)) return index
  }
  return -1
}

export function markKeywordRunning(
  plan: KeywordRotationPlan,
  index: number,
  runId: string | undefined,
  now = new Date().toISOString(),
): KeywordRotationPlan {
  const item = plan.items[index]
  if (!item || !item.enabled) throw new Error('关键词不存在或已停用')
  return {
    ...plan,
    status: 'running',
    cursor: index,
    currentRunId: runId,
    error: undefined,
    updatedAt: now,
    items: plan.items.map((entry, entryIndex) =>
      entryIndex === index
        ? { ...entry, status: 'running', error: undefined, startedAt: now, lastRunId: runId }
        : entry,
    ),
  }
}

export function completeKeyword(
  plan: KeywordRotationPlan,
  index: number,
  runId: string | undefined,
  now = new Date().toISOString(),
): KeywordRotationPlan {
  if (!plan.items[index]) throw new Error('关键词不存在')
  const items = plan.items.map((entry, entryIndex) =>
    entryIndex === index
      ? { ...entry, status: 'completed' as const, completedAt: now, lastRunId: runId }
      : entry,
  )
  const next = items.findIndex((entry, entryIndex) => entryIndex > index && entry.enabled)
  return {
    ...plan,
    status: next === -1 ? 'completed' : 'running',
    cursor: next === -1 ? items.length : next,
    currentRunId: undefined,
    error: undefined,
    updatedAt: now,
    items,
  }
}

export function failKeyword(
  plan: KeywordRotationPlan,
  index: number,
  error: string,
  now = new Date().toISOString(),
): KeywordRotationPlan {
  if (!plan.items[index]) throw new Error('关键词不存在')
  return {
    ...plan,
    status: 'failed',
    cursor: index,
    error,
    currentRunId: undefined,
    updatedAt: now,
    items: plan.items.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, status: 'failed' as const, error } : entry,
    ),
  }
}

export function isKeywordRotationPlan(value: unknown): value is KeywordRotationPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Partial<KeywordRotationPlan>
  return (
    plan.version === 1 &&
    typeof plan.status === 'string' &&
    Array.isArray(plan.items) &&
    plan.items.every(
      (item) =>
        !!item &&
        typeof item.keyword === 'string' &&
        typeof item.enabled === 'boolean' &&
        typeof item.status === 'string',
    ) &&
    Number.isSafeInteger(plan.cursor) &&
    typeof plan.baseSearchUrl === 'string' &&
    !!plan.filterSnapshot &&
    typeof plan.filterSnapshot.salary === 'string' &&
    typeof plan.filterSnapshot.city === 'string' &&
    typeof plan.updatedAt === 'string'
  )
}
