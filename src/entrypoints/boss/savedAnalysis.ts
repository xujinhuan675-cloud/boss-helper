import { ref } from 'vue'

import { ChatModel } from '@/composables/useModel/chatModel'

import {
  getFilteringDecision,
  parseFiltering,
  validateMatchThreshold,
} from '../../composables/useApplying/scoring'
import { jsonClone } from '../../utils/deepmerge'
import { isJobExcluded } from './jobStore'
import type { BossJobLibraryRecord } from './jobStore'
import type { BossHelperCtx } from './runtime'

export type SavedAnalysisRun = {
  status: 'running' | 'stopping' | 'stopped' | 'completed' | 'failed'
  total: number
  completed: number
  failed: number
  skipped: number
  currentJob?: string
  error?: string
}

export function isSavedJobEligible(record: BossJobLibraryRecord) {
  return (
    !isJobExcluded(record) &&
    record.detailStatus === 'complete' &&
    !!record.detail?.jobInfo?.postDescription?.trim() &&
    record.analysisStatus !== 'ready' &&
    record.reviewStatus === 'pending' &&
    record.sendStatus === 'pending'
  )
}

export class SavedJobAnalyzer {
  readonly busy = ref(false)
  readonly collecting = ref(false)
  readonly run = ref<SavedAnalysisRun | null>(null)

  constructor(public host: BossHelperCtx) {}

  stop() {
    if (this.busy.value && this.run.value?.status === 'running') {
      this.run.value.status = 'stopping'
      if (this.collecting.value) this.host.stopCollection()
    }
  }

  private get stopping() {
    return this.run.value?.status === 'stopping'
  }

  private checkOtherWork() {
    if (
      (this.host.gatheringBusy.value &&
        !(this.collecting.value && this.host.gatheringKind.value === 'collection')) ||
      this.host.realtimeBusy.value ||
      this.host.workflow?.status.value === 'running' ||
      this.host.hasPendingCollectionStorage
    ) {
      throw new Error('请先等待采集、详情补全、实时投递或保存结束')
    }
  }

  async start({
    modelKey,
    limit = 20,
    collectNew = false,
    jobId,
  }: {
    modelKey?: string
    limit?: number
    collectNew?: boolean
    jobId?: string
  }): Promise<SavedAnalysisRun> {
    if (this.busy.value) throw new Error('本地岗位分析正在进行，请等待当前请求结束')
    this.checkOtherWork()
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('批次数量必须是正整数')
    const selectedKey = modelKey ?? this.host.models.getDefaultModelKey()
    const model = this.host.models.modelData.value.find((item) => item.key === selectedKey)
    if (
      !model?.data ||
      ![model.data.api_key, model.data.base_url, model.data.model].every(
        (field) => typeof field === 'string' && !!field.trim(),
      )
    ) {
      throw new Error('请先配置并选择模型、接口地址与 API Key')
    }
    const filtering = {
      ...jsonClone(this.host.conf.formData.aiFiltering),
      model: selectedKey,
      enable: true,
    }
    const greetings = {
      ...jsonClone(this.host.conf.formData.aiGreeting),
      model: selectedKey,
      enable: true,
    }
    validateMatchThreshold(filtering.score)
    if (
      ![filtering, greetings].every(
        (config) =>
          Array.isArray(config.prompt) && config.prompt.some((message) => message.content?.trim()),
      )
    ) {
      throw new Error('请先保存筛选标准、分数阈值与招呼语提示词')
    }
    const resume = this.host.resumes.currentResume.value
    const resumeText = resume?.content.trim()
    if (!resume || !resumeText) {
      throw new Error('请先在简历页选择并保存完整简历，再开始分析')
    }

    this.collecting.value = collectNew
    this.busy.value = true
    this.run.value = { status: 'running', total: 0, completed: 0, failed: 0, skipped: 0 }
    const run = this.run.value
    try {
      const chat = new ChatModel(this.host, resumeText)
      if (
        !chat.createAgent(filtering, 'filtering', { json: true }) ||
        !chat.createAgent(greetings, 'greetings')
      ) {
        throw new Error('模型未配置，无法初始化分析')
      }
      const metadata = {
        modelKey: selectedKey,
        modelName: model.name,
        model: model.data.model,
        resumeId: resume.id,
        resumeName: resume.name,
        scoreThreshold: filtering.score,
        filteringPrompt: filtering.prompt,
        greetingPrompt: greetings.prompt,
      }
      const analyze = async (candidate: BossJobLibraryRecord) => {
        if (this.stopping) return
        this.checkOtherWork()
        const record = (await this.host.getJobLibrary()).find(
          (item) => item.encryptJobId === candidate.encryptJobId,
        )
        if (!record || !isSavedJobEligible(record)) {
          run.skipped++
          return
        }
        if (
          this.stopping ||
          (collectNew && !(await this.host.waitForCollectionAnalysis('匹配度分析')))
        )
          return
        if (collectNew) run.total++
        run.currentJob = record.snapshot.jobName
        let analysis = record.analysis
        let finalGreeting = record.finalGreeting
        let failure: unknown
        let stoppedAfterFiltering = false
        try {
          const data = this.host.getSavedJobData(record)
          const content = await chat
            .chat('filtering', data, { disableMessages: true })
            .then((response) => response.text)
          const result = parseFiltering(content)
          const passed = getFilteringDecision(result, filtering.score)
          analysis = {
            ...metadata,
            analyzedAt: new Date().toISOString(),
            ...result,
            passed,
          }
          if (passed === true) {
            if (this.stopping) {
              stoppedAfterFiltering = true
            } else {
              this.checkOtherWork()
              const latest = (await this.host.getJobLibrary()).find(
                (item) => item.encryptJobId === record.encryptJobId,
              )
              if (!latest || !isSavedJobEligible(latest)) {
                run.skipped++
                return
              }
              if (this.stopping) {
                stoppedAfterFiltering = true
              } else if (
                collectNew &&
                !(await this.host.waitForCollectionAnalysis('生成招呼语草稿'))
              ) {
                if (this.stopping) stoppedAfterFiltering = true
                else throw new Error('已停止；筛选结果已保留，招呼语尚未生成')
              }
              if (!stoppedAfterFiltering) {
                const greeting = await chat
                  .chat('greetings', this.host.getSavedJobData(latest), { disableMessages: true })
                  .then((response) => response.text)
                if (typeof greeting !== 'string' || !greeting.trim())
                  throw new Error('模型返回了空招呼语')
                finalGreeting = greeting.trim()
              }
            }
          }
        } catch (error) {
          failure = error
        }
        const saved = await this.host.saveJobAnalysis(record.encryptJobId, {
          analysisStatus: stoppedAfterFiltering ? 'pending' : failure ? 'failed' : 'ready',
          ...(analysis ? { analysis } : {}),
          ...(finalGreeting ? { finalGreeting } : {}),
          ...(!stoppedAfterFiltering
            ? {
                analysisFailureReason:
                  failure instanceof Error ? failure.message : failure ? String(failure) : '',
              }
            : {}),
        })
        if (!saved) run.skipped++
        else if (stoppedAfterFiltering) run.skipped++
        else if (failure) {
          run.failed++
          run.error = failure instanceof Error ? failure.message : String(failure)
        } else run.completed++
        const statusCode =
          (failure as { statusCode?: number; status?: number } | undefined)?.statusCode ??
          (failure as { status?: number } | undefined)?.status
        if (
          failure &&
          ([401, 402, 403, 404, 429].includes(statusCode ?? 0) ||
            (failure instanceof Error &&
              /请求错误\s*(401|402|403|404|429)\b/.test(failure.message)))
        ) {
          throw failure
        }
      }
      if (collectNew) {
        const collection = await this.host.collectOnly(undefined, analyze)
        if (!['completed', 'stopped'].includes(collection.status))
          throw new Error(collection.error || '采集未正常完成；请检查采集结束原因')
        run.status =
          this.stopping || collection.status === 'stopped'
            ? 'stopped'
            : run.failed > 0
              ? 'failed'
              : 'completed'
      } else {
        const candidates = (await this.host.getJobLibrary())
          .filter(isSavedJobEligible)
          .filter((record) => !jobId || record.encryptJobId === jobId)
          .slice(0, limit)
        run.total = candidates.length
        for (const candidate of candidates) {
          if (this.stopping) break
          await analyze(candidate)
        }
        run.status = this.stopping ? 'stopped' : run.failed > 0 ? 'failed' : 'completed'
      }
    } catch (error) {
      run.status = this.stopping ? 'stopped' : 'failed'
      run.error = error instanceof Error ? error.message : String(error)
    } finally {
      delete run.currentJob
      this.busy.value = false
      this.collecting.value = false
      if (!this.host.keywordRotationBusy.value) {
        const task = collectNew ? '采集并分析' : '岗位分析'
        const status =
          run.status === 'completed' ? '完成' : run.status === 'stopped' ? '已停止' : '异常停止'
        void this.host.notification(
          `${task}${status}：完成 ${run.completed}/${run.total}，失败 ${run.failed}，跳过 ${run.skipped}${run.error ? `；${run.error}` : ''}`,
        )
      }
      if (run.status === 'completed') this.host.scheduleBackgroundDetailCompletion?.()
    }
    return run
  }

  analyzeOne(jobId: string, modelKey?: string) {
    if (!jobId?.trim()) throw new Error('缺少岗位 ID')
    if (this.busy.value) throw new Error('本地岗位分析正在进行，请等待当前请求结束')
    this.checkOtherWork()
    return this.host.getJobLibrary().then((records) => {
      const record = records.find((item) => item.encryptJobId === jobId)
      if (!record) throw new Error('未找到已保存岗位')
      if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim())
        throw new Error('请先在 BOSS 当前岗位页补全此岗位详情')
      if (
        record.analysisStatus === 'ready' ||
        record.reviewStatus !== 'pending' ||
        record.sendStatus !== 'pending'
      )
        throw new Error('该岗位已分析、已审核或已进入发送流程，不能覆盖')
      return this.start({ modelKey, limit: 1, jobId })
    })
  }
}
