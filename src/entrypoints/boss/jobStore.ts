import type { BossZpDetailData, BossZpJobItemData } from './types'

export const JOB_LIBRARY_STORAGE_KEY = 'local:boss-helper:job-library:v1'
export const COLLECTION_RUN_STORAGE_KEY = 'local:boss-helper:collection-runs:v1'
export const COLLECTION_SCROLL_SELECTORS = [
  '.job-list-container',
  '.rec-job-list',
  '.job-list-wrapper',
  '.recommend-result-inner',
  '.job-recommend-result',
  '.page-jobs-main',
] as const

export type DetailStatus = 'pending' | 'complete' | 'failed'
export type AnalysisStatus = 'pending' | 'ready' | 'failed'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type SendStatus = 'pending' | 'queued' | 'sent' | 'unknown' | 'failed'
export type ProcessingStatus = 'active' | 'excluded'
export type ProcessingStatusFilter = ProcessingStatus | 'all'
export const FUNNEL_STAGES = [
  'collected',
  'matched',
  'applied',
  'replied',
  'interview',
  'offer',
] as const
export type FunnelStage = (typeof FUNNEL_STAGES)[number]

export type BossJobLibraryRecord = {
  encryptJobId: string
  key: string
  snapshot: BossZpJobItemData
  sourceKeywords: string[]
  batches: string[]
  firstSeenAt: string
  lastSeenAt: string
  detailStatus: DetailStatus
  analysisStatus: AnalysisStatus
  reviewStatus: ReviewStatus
  sendStatus: SendStatus
  detail?: BossZpDetailData
  analysis?: Record<string, unknown>
  analysisFailureReason?: string
  finalGreeting?: string
  matchedAt?: string
  detailRetryCount: number
  failureReason?: string
  manualFunnelStage?: FunnelStage
  processingStatus?: ProcessingStatus
}

export type CollectionEndReason =
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'login_required'
  | 'captcha'
  | 'restricted'
  | 'network_error'
  | 'unknown_error'

export type CollectionRun = {
  id: string
  keyword: string
  searchUrl: string
  filterSnapshot: { salary: string; city: string }
  startedAt: string
  endedAt?: string
  status: CollectionEndReason
  savedCount: number
  newCount: number
  duplicateCount: number
  lastScrollTop: number
  lastScrollHeight: number
  visibleCount?: number
  phase?: string
  waitSeconds?: number
  error?: string
}

export type DetailRun = {
  status: CollectionEndReason
  completed: number
  failed: number
  retryable: number
  total: number
  currentJob?: string
  phase?: string
  waitSeconds?: number
  error?: string
}

export type CollectionMergeResult = {
  records: BossJobLibraryRecord[]
  newCount: number
  duplicateCount: number
}

export type JobFunnel = {
  collected: number
  collectedToday: number
  matched: number
  matchedToday: number
  applied: number
  replied: number
  interview: number
  offer: number
}

const funnelStageRank = new Map(FUNNEL_STAGES.map((stage, index) => [stage, index]))

export function isSameLocalDay(value: string | undefined, now: Date): boolean {
  if (!value) return false
  const date = new Date(value)
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === 'string' && FUNNEL_STAGES.includes(value as FunnelStage)
}

export function isJobExcluded(record: BossJobLibraryRecord): boolean {
  return record.processingStatus === 'excluded'
}

export function isProcessingStatus(value: unknown): value is ProcessingStatus {
  return value === 'active' || value === 'excluded'
}

export function getJobFunnelStage(record: BossJobLibraryRecord): FunnelStage {
  const manualStage = record.manualFunnelStage as string | undefined
  if (isFunnelStage(manualStage)) return manualStage
  if (record.snapshot.contact === true) return 'replied'
  if (record.sendStatus === 'sent') return 'applied'
  if (record.reviewStatus === 'approved' || record.analysis?.passed === true) return 'matched'
  return 'collected'
}

export function getJobFunnel(records: BossJobLibraryRecord[], now = new Date()): JobFunnel {
  const activeRecords = records.filter((record) => !isJobExcluded(record))
  const ranks = activeRecords.map((record) => funnelStageRank.get(getJobFunnelStage(record)) ?? 0)
  return {
    collected: ranks.length,
    collectedToday: activeRecords.filter((record) => isSameLocalDay(record.firstSeenAt, now))
      .length,
    matched: ranks.filter((rank) => rank >= 1).length,
    matchedToday: activeRecords.filter((record) => isSameLocalDay(record.matchedAt, now)).length,
    applied: ranks.filter((rank) => rank >= 2).length,
    replied: ranks.filter((rank) => rank >= 3).length,
    interview: ranks.filter((rank) => rank >= 4).length,
    offer: ranks.filter((rank) => rank >= 5).length,
  }
}

const nowIso = () => new Date().toISOString()

export function createCollectionRun(input: {
  keyword: string
  searchUrl: string
  salary?: string
  city?: string
  now?: string
}): CollectionRun {
  const now = input.now ?? nowIso()
  return {
    id: `collect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    keyword: input.keyword,
    searchUrl: input.searchUrl,
    filterSnapshot: { salary: input.salary ?? '', city: input.city ?? '' },
    startedAt: now,
    status: 'running',
    savedCount: 0,
    newCount: 0,
    duplicateCount: 0,
    lastScrollTop: 0,
    lastScrollHeight: 0,
  }
}

function createRecord(item: BossZpJobItemData, keyword: string, batchId: string, at: string) {
  return {
    encryptJobId: item.encryptJobId,
    key: `boss::${item.encryptJobId}`,
    snapshot: item,
    sourceKeywords: keyword ? [keyword] : [],
    batches: [batchId],
    firstSeenAt: at,
    lastSeenAt: at,
    detailStatus: 'pending' as const,
    analysisStatus: 'pending' as const,
    reviewStatus: 'pending' as const,
    sendStatus: 'pending' as const,
    detailRetryCount: 0,
  }
}

export function mergeJobRecords(
  current: BossJobLibraryRecord[],
  items: BossZpJobItemData[],
  keyword: string,
  batchId: string,
  at = nowIso(),
): CollectionMergeResult {
  const byId = new Map(current.map((record) => [record.encryptJobId, record]))
  let newCount = 0
  let duplicateCount = 0

  for (const item of items) {
    if (!item.encryptJobId) continue
    const existing = byId.get(item.encryptJobId)
    if (!existing) {
      byId.set(item.encryptJobId, createRecord(item, keyword, batchId, at))
      newCount++
      continue
    }
    duplicateCount++
    existing.snapshot = item
    existing.lastSeenAt = at
    if (keyword && !existing.sourceKeywords.includes(keyword)) existing.sourceKeywords.push(keyword)
    if (!existing.batches.includes(batchId)) existing.batches.push(batchId)
  }

  return { records: [...byId.values()], newCount, duplicateCount }
}

export function updateCollectionRun(
  run: CollectionRun,
  patch: Partial<CollectionRun>,
): CollectionRun {
  return { ...run, ...patch }
}

export function stopCollectionRun(run: CollectionRun, at = nowIso()): CollectionRun {
  return { ...run, status: 'stopped', endedAt: run.endedAt ?? at }
}

export function filterJobLibrary(
  records: BossJobLibraryRecord[],
  filters: {
    search?: string
    company?: string
    sourceKeyword?: string
    detailStatus?: DetailStatus | ''
    funnelStage?: FunnelStage | ''
    processingStatus?: ProcessingStatusFilter
  } = {},
): BossJobLibraryRecord[] {
  const search = filters.search?.toLowerCase() ?? ''
  const company = filters.company?.toLowerCase() ?? ''
  const processingStatus = filters.processingStatus ?? 'active'
  return records.filter((record) => {
    const companies = [
      record.snapshot.brandName,
      record.detail?.brandComInfo?.brandName,
      record.detail?.bossInfo?.brandName,
    ]
    const searchable = [
      record.snapshot.jobName,
      ...companies,
      record.snapshot.bossName,
      record.snapshot.bossTitle,
      record.detail?.jobInfo?.jobName,
      record.detail?.jobInfo?.positionName,
      record.detail?.bossInfo?.name,
      record.detail?.bossInfo?.title,
      record.detail?.jobInfo?.postDescription,
    ]
    return (
      (processingStatus === 'all' ||
        (processingStatus === 'excluded' ? isJobExcluded(record) : !isJobExcluded(record))) &&
      (!search || searchable.some((value) => value?.toLowerCase().includes(search))) &&
      (!company || companies.some((value) => value?.toLowerCase().includes(company))) &&
      (!filters.sourceKeyword || record.sourceKeywords.includes(filters.sourceKeyword)) &&
      (!filters.detailStatus || record.detailStatus === filters.detailStatus) &&
      (!filters.funnelStage ||
        (funnelStageRank.get(getJobFunnelStage(record)) ?? 0) >=
          (funnelStageRank.get(filters.funnelStage) ?? 0))
    )
  })
}

export function sortJobLibraryByMatch(records: BossJobLibraryRecord[]): BossJobLibraryRecord[] {
  return [...records].sort((a, b) => {
    const aRating =
      typeof a.analysis?.rating === 'number' && Number.isFinite(a.analysis.rating)
        ? a.analysis.rating
        : null
    const bRating =
      typeof b.analysis?.rating === 'number' && Number.isFinite(b.analysis.rating)
        ? b.analysis.rating
        : null
    if (aRating === null && bRating === null) return 0
    if (aRating === null) return 1
    if (bRating === null) return -1
    return bRating - aRating
  })
}

export function buildAnalysisHandoff(records: BossJobLibraryRecord[]) {
  return records.map((record) => ({
    encryptJobId: record.encryptJobId,
    jobUrl: `https://www.zhipin.com/job_detail/${record.encryptJobId}.html`,
    sourceKeywords: record.sourceKeywords,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    detailStatus: record.detailStatus,
    analysisStatus: record.analysisStatus,
    reviewStatus: record.reviewStatus,
    sendStatus: record.sendStatus,
    processingStatus: record.processingStatus,
    manualFunnelStage: record.manualFunnelStage,
    matchedAt: record.matchedAt,
    job: record.snapshot,
    detail: record.detail,
    analysis: record.analysis,
    finalGreeting: record.finalGreeting,
  }))
}
