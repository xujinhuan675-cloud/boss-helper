import type { DetailRun } from './jobStore'

export const HISTORY_DETAIL_STORAGE_KEY = 'local:boss-helper:history-details:v1'
export const HISTORY_DETAIL_LEASE_MS = 90_000

export type HistoryDetailRun = DetailRun & {
  id: string
  jobIds: string[]
  cursor: number
  skipped: number
  owner: string
  expiresAt: number
}

export type HistoryDetailCommand =
  | { type: 'read' }
  | { type: 'start' | 'resume' | 'renew'; token: string }
  | {
      type: 'advance'
      token: string
      jobId: string
      result: 'completed' | 'failed' | 'skipped'
    }
  | { type: 'finish'; token: string; status: DetailRun['status']; error?: string }

export function assertHistoryDetailRun(value: unknown): asserts value is HistoryDetailRun | null {
  if (value === null) return
  const run = value as HistoryDetailRun
  if (
    !run ||
    typeof run !== 'object' ||
    Array.isArray(run) ||
    typeof run.id !== 'string' ||
    !run.id ||
    typeof run.owner !== 'string' ||
    !Array.isArray(run.jobIds) ||
    run.jobIds.some((id) => typeof id !== 'string' || !id.trim()) ||
    new Set(run.jobIds).size !== run.jobIds.length ||
    ![
      'running',
      'paused',
      'completed',
      'stopped',
      'captcha',
      'login_required',
      'restricted',
      'network_error',
      'unknown_error',
    ].includes(run.status) ||
    ![run.cursor, run.completed, run.failed, run.skipped, run.total, run.retryable].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    run.cursor > run.jobIds.length ||
    run.total !== run.jobIds.length ||
    run.completed + run.failed + run.skipped !== run.cursor ||
    !Number.isFinite(run.expiresAt)
  )
    throw new Error('历史补全断点格式异常；已保留原数据')
}
