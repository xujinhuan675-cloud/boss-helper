import { MATCH_SCORING_VERSION } from '../../composables/useApplying/scoring'
import { jsonClone } from '../../utils/deepmerge'
import type { DetailAccessSession } from './detailAccess'
import {
  assertHistoryDetailRun,
  HISTORY_DETAIL_LEASE_MS,
  HISTORY_DETAIL_STORAGE_KEY,
} from './historyDetails'
import type { HistoryDetailCommand, HistoryDetailRun } from './historyDetails'
import { DETAIL_ACCESS_KEY, assertCompleteJobDetail, hasCompleteJobDetail } from './jobDetails'
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
  | { type: 'import'; records: BossJobLibraryRecord[] }
  | {
      type: 'detail'
      jobId: string
      historyToken?: string
      patch: Pick<BossJobLibraryRecord, 'detailStatus'> &
        Partial<Pick<BossJobLibraryRecord, 'detail' | 'detailRetryCount' | 'failureReason'>>
    }
  | { type: 'analysis'; jobId: string; patch: JobAnalysisPatch }
  | { type: 'greeting'; jobId: string; greeting: string }
  | { type: 'send'; jobId: string; status: 'queued'; greeting: string }
  | { type: 'send'; jobId: string; status: 'sent' | 'unknown' }
  | { type: 'funnel'; jobId: string; stage: FunnelStage | null }
  | { type: 'processing'; jobId: string; status: ProcessingStatus }
  | { type: 'delete'; jobId: string }
  | { type: 'deleteMany'; jobIds: string[] }

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
      } else if (mutation.type === 'import') {
        assertJobLibrary(mutation.records)
        const ids = new Set(records.map((record) => record.encryptJobId))
        for (const record of mutation.records) {
          if (ids.has(record.encryptJobId)) {
            duplicateCount++
            continue
          }
          ids.add(record.encryptJobId)
          records.push(jsonClone(record))
          newCount++
        }
        updated ||= newCount > 0
      } else if (mutation.type === 'delete') {
        if (typeof mutation.jobId !== 'string' || !mutation.jobId.trim())
          throw new Error('缺少岗位 ID')
        const index = records.findIndex((record) => record.encryptJobId === mutation.jobId)
        if (index < 0) throw new Error('未找到已保存岗位')
        records.splice(index, 1)
        updated = true
      } else if (mutation.type === 'deleteMany') {
        if (
          !Array.isArray(mutation.jobIds) ||
          !mutation.jobIds.length ||
          mutation.jobIds.some((jobId) => typeof jobId !== 'string' || !jobId.trim())
        )
          throw new Error('缺少岗位 ID')
        const ids = new Set(mutation.jobIds)
        const next = records.filter((record) => !ids.has(record.encryptJobId))
        if (next.length === records.length) throw new Error('未找到已保存岗位')
        records = next
        updated = true
      } else if (mutation.type !== 'normalize') {
        const record = records.find((item) => item.encryptJobId === mutation.jobId)
        if (!record) throw new Error('未找到已保存岗位')
        if (mutation.type === 'send') {
          if (!['queued', 'sent', 'unknown'].includes(mutation.status))
            throw new Error('发送状态无效')
          if (
            mutation.status === 'queued' &&
            (typeof mutation.greeting !== 'string' ||
              !mutation.greeting.trim() ||
              mutation.greeting.trim() !== record.finalGreeting?.trim())
          )
            throw new Error('招呼语已更新，请重新确认后发送')
          if (
            isJobExcluded(record) ||
            (mutation.status === 'queued'
              ? record.sendStatus !== 'pending' || !record.finalGreeting?.trim()
              : record.sendStatus !== 'queued')
          )
            return { records, updated: false, newCount, duplicateCount }
          record.sendStatus = mutation.status
        } else if (mutation.type === 'greeting') {
          if (typeof mutation.greeting !== 'string' || !mutation.greeting.trim())
            throw new Error('招呼语不能为空')
          if (
            isJobExcluded(record) ||
            record.reviewStatus !== 'pending' ||
            record.sendStatus !== 'pending'
          )
            return { records, updated: false, newCount, duplicateCount }
          record.finalGreeting = mutation.greeting.trim()
        } else if (mutation.type === 'analysis') {
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
          const history = await this.readHistoryDetails()
          if (mutation.historyToken !== undefined)
            this.assertHistoryOwner(history, mutation.historyToken)
          else if (history?.owner && history.expiresAt > Date.now())
            throw new Error('历史详情补全正在另一页面运行')
          const patch = mutation.patch
          if (isJobExcluded(record) || hasCompleteJobDetail(record))
            return { records, updated: false, newCount, duplicateCount }
          if (patch.detailStatus === 'complete')
            assertCompleteJobDetail(patch.detail, mutation.jobId)
          else if (patch.detail !== undefined) throw new Error('不完整详情不能覆盖岗位正文')
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

  private async readHistoryDetails() {
    const run = await this.storage.getItem<unknown>(HISTORY_DETAIL_STORAGE_KEY)
    assertHistoryDetailRun(run)
    return run
  }

  private assertHistoryOwner(
    run: HistoryDetailRun | null,
    token: string,
  ): asserts run is HistoryDetailRun {
    if (!token?.trim() || !run || run.owner !== token || run.expiresAt <= Date.now())
      throw new Error('历史补全任务所有权已失效，请重新继续')
  }

  historyDetails(command: HistoryDetailCommand): Promise<HistoryDetailRun | null> {
    return this.enqueue(async () => {
      let run = await this.readHistoryDetails()
      if (command.type === 'read') return run
      if (typeof command.token !== 'string' || !command.token.trim())
        throw new Error('缺少历史补全所有者')
      if (command.type === 'start' || command.type === 'resume') {
        const access = await this.storage.getItem<DetailAccessSession>(DETAIL_ACCESS_KEY)
        if (
          access &&
          access.expiresAt > Date.now() &&
          access.deadline > Date.now() &&
          access.token !== command.token
        )
          throw new Error('已有详情任务正在另一页面运行')
        if (run?.owner && run.expiresAt > Date.now())
          throw new Error('历史补全正在另一页面运行，请等待原页面停止或 90 秒后继续')
        if (command.type === 'start') {
          if (run && run.cursor < run.total) throw new Error('历史补全尚未结束，请继续已有任务')
          const records = (await this.storage.getItem<unknown>(JOB_LIBRARY_STORAGE_KEY)) ?? []
          assertJobLibrary(records)
          const jobIds = records
            .filter((r) => !isJobExcluded(r) && !hasCompleteJobDetail(r))
            .map((r) => r.encryptJobId)
          run = {
            id: crypto.randomUUID(),
            jobIds,
            cursor: 0,
            skipped: 0,
            completed: 0,
            failed: 0,
            retryable: 0,
            total: jobIds.length,
            status: 'running',
            owner: '',
            expiresAt: 0,
          }
        }
        if (!run) throw new Error('没有可继续的历史补全任务')
        run = {
          ...run,
          status: 'running',
          owner: command.token,
          expiresAt: Date.now() + HISTORY_DETAIL_LEASE_MS,
          error: undefined,
        }
      } else {
        this.assertHistoryOwner(run, command.token)
        run = { ...run }
        if (command.type === 'advance') {
          if (
            run.jobIds[run.cursor] !== command.jobId ||
            !['completed', 'failed', 'skipped'].includes(command.result)
          )
            throw new Error('历史补全断点不匹配')
          if (command.result !== 'skipped') {
            const records = await this.storage.getItem<unknown>(JOB_LIBRARY_STORAGE_KEY)
            assertJobLibrary(records)
            const record = records.find((r) => r.encryptJobId === command.jobId)
            if (
              !record ||
              record.detailStatus !== (command.result === 'completed' ? 'complete' : 'failed') ||
              (command.result === 'completed' && !record.detail?.jobInfo?.postDescription?.trim())
            )
              throw new Error('详情保存尚未确认，保留当前断点')
          }
          run.cursor++
          run[command.result]++
        } else if (command.type === 'finish') {
          if (
            ![
              'completed',
              'stopped',
              'captcha',
              'login_required',
              'restricted',
              'network_error',
              'unknown_error',
            ].includes(command.status)
          )
            throw new Error('历史补全停止状态无效')
          run.status = command.status
          run.error = command.error
          run.owner = ''
          run.expiresAt = 0
        }
        if (run.owner) run.expiresAt = Date.now() + HISTORY_DETAIL_LEASE_MS
      }
      assertHistoryDetailRun(run)
      await this.storage.setItem(HISTORY_DETAIL_STORAGE_KEY, jsonClone(run))
      return run
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
