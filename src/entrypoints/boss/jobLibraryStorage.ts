import { MATCH_SCORING_VERSION } from '../../composables/useApplying/scoring'
import { jsonClone } from '../../utils/deepmerge'
import {
  assertJobLibrary,
  isFunnelStage,
  isJobExcluded,
  isProcessingStatus,
  JOB_LIBRARY_STORAGE_KEY,
  mergeJobRecords,
  normalizeJobLibraryAnalysis,
} from './jobStore'
import type { BossJobLibraryRecord, FunnelStage, ProcessingStatus } from './jobStore'
import type { BossZpJobItemData } from './types'

export type JobAnalysisPatch = Pick<BossJobLibraryRecord, 'analysisStatus'> &
  Partial<Pick<BossJobLibraryRecord, 'analysis' | 'finalGreeting' | 'analysisFailureReason'>>
export type JobLibraryMutation =
  | { type: 'normalize' }
  | {
      type: 'capture'
      items: BossZpJobItemData[]
      keyword: string
      batch: string
      newOnly?: boolean
    }
  | {
      type: 'detail'
      jobId: string
      patch: Pick<BossJobLibraryRecord, 'detailStatus'> &
        Partial<Pick<BossJobLibraryRecord, 'detail' | 'detailRetryCount' | 'failureReason'>>
    }
  | { type: 'analysis'; jobId: string; patch: JobAnalysisPatch }
  | { type: 'funnel'; jobId: string; stage: FunnelStage | null }
  | { type: 'processing'; jobId: string; status: ProcessingStatus }

type LibraryStorage = {
  getItem<T>(key: `local:${string}` | `session:${string}`): Promise<T | null>
  setItem<T>(key: `local:${string}` | `session:${string}`, value: T): Promise<void>
}
type AnalysisClaim = { jobId: string; token: string; expiresAt: number }
const CLAIMS_KEY = 'session:boss-helper:analysis-claims'

// All callers use the background instance, so reads and writes share one queue.
export class JobLibraryStorage {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private storage: LibraryStorage) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work)
    this.pending = result.catch(() => {})
    return result
  }

  update(mutation: JobLibraryMutation) {
    return this.enqueue(async () => {
      const stored = (await this.storage.getItem<unknown>(JOB_LIBRARY_STORAGE_KEY)) ?? []
      assertJobLibrary(stored)
      const normalized = normalizeJobLibraryAnalysis(stored, MATCH_SCORING_VERSION)
      let records = jsonClone(normalized)
      let updated = normalized !== stored
      let newCount = 0
      let duplicateCount = 0
      if (mutation.type === 'capture') {
        if (
          !Array.isArray(mutation.items) ||
          typeof mutation.keyword !== 'string' ||
          typeof mutation.batch !== 'string'
        )
          throw new Error('采集岗位格式异常；已保留原数据')
        const ids = new Set(records.map((record) => record.encryptJobId))
        const items = mutation.newOnly
          ? mutation.items.filter((item) => !ids.has(item.encryptJobId))
          : mutation.items
        const merged = mergeJobRecords(records, items, mutation.keyword, mutation.batch)
        records = merged.records
        newCount = merged.newCount
        duplicateCount = merged.duplicateCount
        updated ||= items.length > 0
      } else if (mutation.type !== 'normalize') {
        const record = records.find((item) => item.encryptJobId === mutation.jobId)
        if (!record) throw new Error('未找到已保存岗位')
        if (mutation.type === 'analysis') {
          const patch = mutation.patch
          if (
            !patch ||
            !['pending', 'ready', 'failed'].includes(patch.analysisStatus) ||
            (patch.analysis !== undefined &&
              (!patch.analysis ||
                typeof patch.analysis !== 'object' ||
                Array.isArray(patch.analysis))) ||
            (patch.finalGreeting !== undefined && typeof patch.finalGreeting !== 'string') ||
            (patch.analysisFailureReason !== undefined &&
              typeof patch.analysisFailureReason !== 'string')
          )
            throw new Error('分析结果格式异常；已保留原数据')
          if (
            record.reviewStatus !== 'pending' ||
            record.sendStatus !== 'pending' ||
            record.analysisStatus === 'ready' ||
            isJobExcluded(record)
          )
            return { records, updated: false, newCount, duplicateCount }
          record.analysisStatus = patch.analysisStatus
          if (patch.analysis !== undefined) record.analysis = jsonClone(patch.analysis)
          if (patch.analysis?.passed === true && !record.matchedAt)
            record.matchedAt = new Date().toISOString()
          if (patch.finalGreeting !== undefined) record.finalGreeting = patch.finalGreeting
          if (patch.analysisStatus === 'failed' && patch.analysisFailureReason !== undefined)
            record.analysisFailureReason = patch.analysisFailureReason
          else delete record.analysisFailureReason
        } else if (mutation.type === 'detail') {
          const patch = mutation.patch
          record.detailStatus = patch.detailStatus
          if (patch.detail !== undefined) record.detail = jsonClone(patch.detail)
          if (patch.detailRetryCount !== undefined) record.detailRetryCount = patch.detailRetryCount
          if (patch.failureReason !== undefined) record.failureReason = patch.failureReason
          else delete record.failureReason
        } else if (mutation.type === 'funnel') {
          if (mutation.stage !== null && !isFunnelStage(mutation.stage))
            throw new Error('漏斗阶段无效')
          if (mutation.stage === null) delete record.manualFunnelStage
          else record.manualFunnelStage = mutation.stage
        } else if (mutation.type === 'processing') {
          if (!isProcessingStatus(mutation.status)) throw new Error('Invalid job processing status')
          if (mutation.status === 'active') delete record.processingStatus
          else record.processingStatus = mutation.status
        } else throw new Error('未知岗位操作')
        updated = true
      }
      assertJobLibrary(records)
      if (updated) await this.storage.setItem(JOB_LIBRARY_STORAGE_KEY, jsonClone(records))
      return { records, updated, newCount, duplicateCount }
    })
  }

  claimAnalysis(jobId: string, token: string, duration: number) {
    return this.enqueue(async () => {
      if (!jobId?.trim() || !token?.trim() || !Number.isFinite(duration) || duration <= 0)
        throw new Error('岗位分析锁参数无效')
      const claims = ((await this.storage.getItem<AnalysisClaim[]>(CLAIMS_KEY)) ?? []).filter(
        (claim) => claim.expiresAt > Date.now(),
      )
      const existing = claims.find((claim) => claim.jobId === jobId)
      if (existing && existing.token !== token) return false
      if (existing) existing.expiresAt = Date.now() + duration
      else claims.push({ jobId, token, expiresAt: Date.now() + duration })
      await this.storage.setItem(CLAIMS_KEY, claims)
      return true
    })
  }

  releaseAnalysis(jobId: string, token: string) {
    return this.enqueue(async () => {
      const claims = (await this.storage.getItem<AnalysisClaim[]>(CLAIMS_KEY)) ?? []
      await this.storage.setItem(
        CLAIMS_KEY,
        claims.filter((claim) => claim.jobId !== jobId || claim.token !== token),
      )
    })
  }
}
