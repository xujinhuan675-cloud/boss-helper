import type { LogData } from '@/composables/useHelper/type'
import type { ExecutorLog, ExecutorSnapshot, RuntimeBridge } from '@/workbench/protocol'

import { reloadSettings } from '../../index'
import { diagnostic } from '../../utils/diagnostics'
import { isExecutorCommand } from '../../workbench/protocol'
import type { BossHelperCtx } from './runtime'

export type ExecutorState = { ready: boolean; error: string; lastError: string }

export function createExecutorBridge(
  ctx: BossHelperCtx,
  state: ExecutorState,
  initialize?: () => Promise<void>,
): RuntimeBridge {
  let selectedJob: string | null = null
  const jobActions: NonNullable<ExecutorSnapshot['jobActions']> = Object.create(null)
  function start(operation: string, task: () => Promise<unknown>, jobId?: string) {
    const action = jobId
      ? {
          type: operation as 'analyzeOne' | 'generateGreeting' | 'sendGreeting',
          status: 'running' as 'running' | 'completed' | 'failed',
          error: '',
        }
      : undefined
    if (action) {
      if (Object.values(jobActions).some((item) => item.status === 'running'))
        throw new Error('岗位操作正在进行，请稍后重试')
      jobActions[jobId!] = action
    }
    void Promise.resolve()
      .then(task)
      .then(() => {
        if (action) action.status = 'completed'
      })
      .catch((error) => {
        state.lastError = error instanceof Error ? error.message : String(error)
        if (action) {
          action.status = 'failed'
          action.error = state.lastError
        }
        diagnostic(`task.${operation}`, { error })
      })
    return { accepted: true }
  }
  return {
    async snapshot(chatJobKey) {
      const key =
        chatJobKey ?? selectedJob ?? ctx.currentJob.value ?? ctx.chatModel.jobs.value[0] ?? null
      const viewedJobId = ctx._jobDetail.value?.jobInfo?.encryptId
      const logs: ExecutorLog[] = ctx._logs.value.map(({ data, ...log }) => {
        if (!data) return log
        const safe: ExecutorLog['data'] = {}
        for (const name of [
          'message',
          'state',
          'err',
          'aiFilteringQ',
          'aiFilteringR',
          'aiFilteringAjson',
          'aiFilteringAtext',
          'aiGreetingQ',
          'aiGreetingR',
          'aiGreetingA',
        ] as const) {
          if (data[name] !== undefined) (safe as Partial<LogData>)[name] = data[name] as never
        }
        return { ...log, data: safe }
      })
      const snapshot: ExecutorSnapshot = {
        ...state,
        jobActions,
        url: typeof location === 'undefined' ? '' : location.href,
        collectionRun: ctx.collectionRun.value,
        detailRun: ctx.detailRun.value,
        historyDetailRun: ctx.historyDetailRun.value,
        gatheringKind: ctx.gatheringKind.value,
        gatheringBusy: ctx.gatheringBusy.value,
        keywordRotation: ctx.keywordRotation.value,
        keywords: ctx.keywordRotationKeywords.value,
        keywordExtractionBusy: ctx.keywordExtractionBusy.value,
        keywordRotationBusy: ctx.keywordRotationBusy.value,
        keywordRotationWaitSeconds: ctx.keywordRotationWaitSeconds.value,
        keywordRotationSaving: ctx.keywordRotationSaving.value,
        realtimeBusy: ctx.realtimeBusy.value,
        autoCaptureEnabled: ctx.autoCaptureEnabled.value,
        analysisRun: ctx.savedAnalyzer.run.value,
        analysisBusy: ctx.savedAnalyzer.busy.value,
        workflow: ctx.workflow
          ? {
              status: ctx.workflow.status.value,
              current: ctx.workflow.current.value,
              total: ctx.workflow.total.value,
            }
          : null,
        currentJob: ctx.currentJob.value,
        viewedJobKey: viewedJobId ? `boss::${viewedJobId}` : null,
        jobs: ctx.jobList.value,
        results: [...ctx.jobResultMaps],
        logs,
        chatJobs: ctx.chatModel.jobs.value,
        chatJobKey: key,
        messages: key ? (ctx.chatModel.states.get(key)?.messages ?? []) : [],
        pendingMessage: ctx.pendingMessages.value ?? '',
      }
      return JSON.parse(JSON.stringify(snapshot))
    },
    async command(command) {
      if (!isExecutorCommand(command)) throw new Error('Invalid executor command')
      if (!state.ready && initialize) await initialize()
      if (!state.ready) throw new Error(state.error || 'Executor is still initializing')
      state.lastError = ''
      try {
        switch (command.type) {
          case 'collect':
            return start('collect', () => ctx.collectOnly())
          case 'completeHistory':
          case 'resumeHistory':
            return start(command.type, () =>
              ctx.completeHistoricalDetails(command.type === 'resumeHistory'),
            )
          case 'rotate':
            return start('rotate', () =>
              ctx.startKeywordRotation(ctx.keywordRotationKeywords.value),
            )
          case 'stopRotation':
            return await ctx.stopKeywordRotation()
          case 'pauseGathering':
            return ctx.pauseGathering()
          case 'resumeGathering':
            return ctx.resumeGathering()
          case 'stopGathering':
            return ctx.stopGathering()
          case 'analyze':
            return start('analyze', () => ctx.savedAnalyzer.start({ limit: command.limit }))
          case 'analyzeOne':
          case 'generateGreeting':
            return start(
              command.type,
              async () => {
                ctx.savedAnalyzer.validateSetup()
                let record = (await ctx.getJobLibrary()).find(
                  (item) => item.encryptJobId === command.jobId,
                )
                const key = `boss::${command.jobId}`
                if (!record && ctx.jobMaps.has(key)) record = await ctx.captureJobSnapshot(key)
                if (
                  record &&
                  (record.detailStatus !== 'complete' ||
                    !record.detail?.jobInfo?.postDescription?.trim())
                ) {
                  await ctx.ensureSavedJobDetails(command.jobId)
                }
                if (command.type === 'generateGreeting')
                  return ctx.savedAnalyzer.generateGreetingOne(command.jobId)
                const run = await ctx.savedAnalyzer.analyzeOne(command.jobId)
                if (run?.status === 'failed' || run?.status === 'stopped')
                  throw new Error(run.error || '岗位分析已停止')
                if (run?.skipped && !run.completed)
                  throw new Error('岗位状态已变化或正在其他页面分析，请稍后查看结果')
              },
              command.jobId,
            )
          case 'stopAnalysis':
            return ctx.savedAnalyzer.stop()
          case 'startDelivery':
            return start('startDelivery', () => ctx.start())
          case 'stopDelivery':
            return ctx.stop()
          case 'resetDelivery':
            return ctx.reset()
          case 'selectJob':
            selectedJob = command.key
            return
          case 'captureJob': {
            const record = await ctx.captureJobSnapshot(command.key)
            return await ctx.ensureSavedJobDetails(record.encryptJobId)
          }
          case 'openJob':
            return ctx.openJob(command.key)
          case 'clearLogs':
            return ctx.logs.clear()
          case 'sendGreeting':
            return start(
              'sendGreeting',
              () => ctx.sendSavedGreeting(command.jobId, command.greeting),
              command.jobId,
            )
          case 'setFunnel':
            return await ctx.updateJobFunnelStage(command.jobId, command.stage)
          case 'setProcessing':
            return await ctx.updateJobProcessingStatus(command.jobId, command.status)
          case 'setAutoCapture':
            return await ctx.setAutoCaptureEnabled(command.enabled)
          case 'extractKeywords':
            return await ctx.extractKeywordRotationFromResume(command.input)
          case 'saveKeywords':
            return await ctx.saveKeywordRotationKeywords(command.input)
          case 'setPendingMessage':
            ctx.pendingMessages.value = command.value
            return
          case 'reloadSettings':
          case 'clearCache':
          case 'applyNativeFilters':
            if (
              ctx.gatheringBusy.value ||
              ctx.savedAnalyzer.busy.value ||
              ctx.realtimeBusy.value ||
              ctx.keywordRotationBusy.value ||
              ctx.keywordExtractionBusy.value ||
              ctx.keywordRotationSaving.value ||
              ctx.workflow?.status.value === 'running' ||
              ctx.hasPendingCollectionStorage
            )
              throw new Error('Wait for active tasks and pending saves before reloading settings')
            if (command.type === 'applyNativeFilters')
              return await ctx.applyNativeFilters(command.filters)
            if (command.type === 'clearCache') {
              const { getCacheManager } = await import('../../composables/useApplying')
              return await getCacheManager().clearCache()
            }
            await reloadSettings(ctx)
            await ctx.loadKeywordRotation()
            return
        }
      } catch (error) {
        const event = diagnostic(`command.${command.type}`, { error })
        state.lastError = event.error || '执行失败'
        throw new Error(`${state.lastError} [${event.id}]`, { cause: error })
      }
    },
  }
}
