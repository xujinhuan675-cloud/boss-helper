import type { TaskResult } from '@/composables/useApplying/type'
import type { JobData, Log, LogData } from '@/composables/useHelper/type'
import type { Message } from '@/composables/useModel/chatModel'
import type { CollectionRun, DetailRun, FunnelStage } from '@/entrypoints/boss/jobStore'
import type { KeywordRotationPlan } from '@/entrypoints/boss/keywordRotation'
import type { SavedAnalysisRun } from '@/entrypoints/boss/savedAnalysis'

import { isFunnelStage } from '../entrypoints/boss/jobStore'

export const EXECUTOR_NAMESPACE = '__boss-helper-executor__'
export const EXECUTOR_MESSAGE_TYPE = 'boss-helper:executor'

export type ExecutorCommand =
  | {
      type:
        | 'collect'
        | 'collectAnalyze'
        | 'rotate'
        | 'stopRotation'
        | 'pauseGathering'
        | 'resumeGathering'
        | 'stopGathering'
        | 'completeDetails'
        | 'stopAnalysis'
        | 'startDelivery'
        | 'stopDelivery'
        | 'resetDelivery'
        | 'reloadSettings'
        | 'clearLogs'
        | 'clearCache'
    }
  | { type: 'analyze'; limit: number }
  | { type: 'analyzeOne' | 'sendGreeting'; jobId: string }
  | { type: 'selectJob' | 'captureJob' | 'openJob'; key: string }
  | { type: 'setFunnel'; jobId: string; stage: FunnelStage | null }
  | { type: 'setProcessing'; jobId: string; status: 'active' | 'excluded' }
  | { type: 'setAutoCapture'; enabled: boolean }
  | { type: 'extractKeywords' | 'saveKeywords'; input: string }
  | { type: 'setPendingMessage'; value: string }

export type ExecutorLog = Omit<Log, 'data'> & {
  data?: Partial<
    Pick<
      LogData,
      | 'message'
      | 'state'
      | 'err'
      | 'aiFilteringQ'
      | 'aiFilteringR'
      | 'aiFilteringAjson'
      | 'aiFilteringAtext'
      | 'aiGreetingQ'
      | 'aiGreetingR'
      | 'aiGreetingA'
    >
  >
}

export type ExecutorSnapshot = {
  ready: boolean
  url: string
  error: string
  lastError: string
  collectionRun: CollectionRun | null
  detailRun: DetailRun | null
  gatheringKind: 'collection' | 'detail'
  gatheringBusy: boolean
  keywordRotation: KeywordRotationPlan | null
  keywords: string
  keywordExtractionBusy: boolean
  keywordRotationBusy: boolean
  keywordRotationWaitSeconds: number
  keywordRotationSaving: boolean
  realtimeBusy: boolean
  autoCaptureEnabled: boolean
  analysisRun: SavedAnalysisRun | null
  analysisBusy: boolean
  workflow: { status: string; current: number; total: number } | null
  currentJob: string | null
  jobs: JobData[]
  results: [string, TaskResult][]
  logs: ExecutorLog[]
  chatJobs: string[]
  chatJobKey: string | null
  messages: Message[]
  pendingMessage: string
}

export type ExecutorRequest = {
  type: typeof EXECUTOR_MESSAGE_TYPE
  command: ExecutorCommand | { type: 'snapshot'; chatJobKey?: string }
}
export type ExecutorResponse<T = unknown> = { ok: true; data?: T } | { ok: false; error: string }
export type RuntimeBridge = {
  snapshot(chatJobKey?: string): Promise<ExecutorSnapshot>
  command(command: ExecutorCommand): Promise<unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isExecutorCommand(value: unknown): value is ExecutorCommand {
  if (!record(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'analyze':
      return (
        keys(value, ['type', 'limit']) &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) > 0
      )
    case 'analyzeOne':
    case 'sendGreeting':
      return keys(value, ['type', 'jobId']) && text(value.jobId)
    case 'selectJob':
    case 'captureJob':
    case 'openJob':
      return keys(value, ['type', 'key']) && text(value.key)
    case 'setFunnel':
      return (
        keys(value, ['type', 'jobId', 'stage']) &&
        text(value.jobId) &&
        (value.stage === null || isFunnelStage(value.stage))
      )
    case 'setProcessing':
      return (
        keys(value, ['type', 'jobId', 'status']) &&
        text(value.jobId) &&
        (value.status === 'active' || value.status === 'excluded')
      )
    case 'setAutoCapture':
      return keys(value, ['type', 'enabled']) && typeof value.enabled === 'boolean'
    case 'extractKeywords':
    case 'saveKeywords':
      return keys(value, ['type', 'input']) && typeof value.input === 'string'
    case 'setPendingMessage':
      return keys(value, ['type', 'value']) && typeof value.value === 'string'
    case 'collect':
    case 'collectAnalyze':
    case 'rotate':
    case 'stopRotation':
    case 'pauseGathering':
    case 'resumeGathering':
    case 'stopGathering':
    case 'completeDetails':
    case 'stopAnalysis':
    case 'startDelivery':
    case 'stopDelivery':
    case 'resetDelivery':
    case 'reloadSettings':
    case 'clearLogs':
    case 'clearCache':
      return keys(value, ['type'])
    default:
      return false
  }
}

export function handleExecutorMessage(
  message: unknown,
  sender: { id?: string; tab?: unknown },
  extensionId: string,
  bridge: RuntimeBridge,
): Promise<ExecutorResponse> | undefined {
  // Other runtime protocols must remain available to comctx's listener.
  if (!record(message) || message.type !== EXECUTOR_MESSAGE_TYPE) return undefined
  return (async () => {
    try {
      if (sender.id !== extensionId || sender.tab !== undefined)
        throw new Error('Unauthorized executor sender')
      const command = message.command
      if (!keys(message, ['type', 'command']) || !record(command))
        throw new Error('Invalid executor request')
      if (command.type === 'snapshot') {
        if (
          !keys(command, ['type', 'chatJobKey']) ||
          (command.chatJobKey !== undefined && !text(command.chatJobKey))
        )
          throw new Error('Invalid snapshot request')
        return { ok: true, data: await bridge.snapshot(command.chatJobKey as string | undefined) }
      }
      if (!isExecutorCommand(command)) throw new Error('Invalid executor command')
      return { ok: true, data: await bridge.command(command) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })()
}
