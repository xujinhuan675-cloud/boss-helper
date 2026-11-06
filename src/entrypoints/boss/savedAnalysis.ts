import { ref } from 'vue'

import { ChatModel } from '@/composables/useModel/chatModel'

import {
  getFilteringDecision,
  parseFiltering,
  validateMatchThreshold,
} from '../../composables/useApplying/scoring'
import { jsonClone } from '../../utils/deepmerge'
import { diagnostic, traceDiagnostic } from '../../utils/diagnostics'
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

export type SavedAnalysisHost = Pick<
  BossHelperCtx,
  | 'conf'
  | 'models'
  | 'resumes'
  | 'getJobLibrary'
  | 'getSavedJobData'
  | 'saveJobAnalysis'
  | 'saveJobGreeting'
  | 'claimJobAnalysis'
  | 'releaseJobAnalysis'
> &
  Partial<
    Pick<
      BossHelperCtx,
      | 'gatheringBusy'
      | 'gatheringKind'
      | 'realtimeBusy'
      | 'workflow'
      | 'hasPendingCollectionStorage'
      | 'stopCollection'
      | 'waitForCollectionAnalysis'
      | 'collectOnly'
      | 'keywordRotationBusy'
      | 'notification'
    >
  >

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

  constructor(public host: SavedAnalysisHost) {}

  stop() {
    if (this.busy.value && this.run.value?.status === 'running') {
      this.run.value.status = 'stopping'
      if (this.collecting.value) this.host.stopCollection?.()
    }
  }

  private get stopping() {
    return this.run.value?.status === 'stopping'
  }

  private checkOtherWork() {
    if (
      (this.host.gatheringBusy?.value &&
        !(this.collecting.value && this.host.gatheringKind?.value === 'collection')) ||
      this.host.realtimeBusy?.value ||
      this.host.workflow?.status.value === 'running' ||
      this.host.hasPendingCollectionStorage
    ) {
      throw new Error('请先等待采集、详情补全、实时投递或保存结束')
    }
  }

  validateSetup(task = 'filtering') {
    if (this.busy.value) throw new Error('本地岗位分析正在进行，请等待当前请求结束')
    this.checkOtherWork()
    const profileText = this.host.conf.formData.jobProfile?.trim()
    if (task === 'filtering' && !profileText)
      throw new Error('请先填写并保存个人求职画像，再开始岗位分析')
    const resume = task === 'greetings' ? this.host.resumes.currentResume.value : null
    const resumeText = resume?.content.trim()
    if (task === 'greetings' && !resumeText)
      throw new Error('请先在简历页选择并保存完整简历，再生成招呼语')
    const selectedKey = this.host.models.getDefaultModelKey(task)
    const model = this.host.models.modelData.value.find((item) => item.key === selectedKey)
    if (
      !model?.data ||
      ![model.data.api_key, model.data.base_url, model.data.model].every(
        (field) => typeof field === 'string' && !!field.trim(),
      )
    ) {
      throw new Error('请先配置可用于此任务的模型、接口地址与 API Key；招呼语需要普通生成模型')
    }
    return { selectedKey, model, profileText, resume, resumeText }
  }

  async start({
    limit = 20,
    collectNew = false,
    jobId,
  }: {
    limit?: number
    collectNew?: boolean
    jobId?: string
  }): Promise<SavedAnalysisRun> {
    const { selectedKey, model, profileText } = this.validateSetup()
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('批次数量必须是正整数')
    const filtering = {
      ...jsonClone(this.host.conf.formData.aiFiltering),
      enable: true,
    }
    validateMatchThreshold(filtering.score)
    if (
      !Array.isArray(filtering.prompt) ||
      !filtering.prompt.some((message) => message.content?.trim())
    ) {
      throw new Error('请先保存岗位匹配标准')
    }
    if (collectNew && (!this.host.collectOnly || !this.host.waitForCollectionAnalysis))
      throw new Error('采集新岗位需要连接 BOSS 岗位页')

    this.collecting.value = collectNew
    this.busy.value = true
    this.run.value = { status: 'running', total: 0, completed: 0, failed: 0, skipped: 0 }
    const run = this.run.value
    const started = performance.now()
    try {
      const chat = new ChatModel(this.host, { profile: profileText })
      if (!chat.createAgent(filtering, 'filtering', { json: true })) {
        throw new Error('模型未配置，无法初始化分析')
      }
      const metadata = {
        modelKey: selectedKey,
        modelName: model.name,
        model: model.data!.model,
        scoreThreshold: filtering.score,
        filteringPrompt: filtering.prompt,
      }
      const analyze = async (candidate: BossJobLibraryRecord) => {
        if (this.stopping) return
        this.checkOtherWork()
        if (collectNew && !(await this.host.waitForCollectionAnalysis!('匹配度分析'))) return
        if (this.stopping) return
        const token = crypto.randomUUID()
        // Abandoned windows release their claim after the single request timeout.
        const duration = (model.data?.other?.timeout ?? 60000) + 30000
        const claim = () => this.host.claimJobAnalysis(candidate.encryptJobId, token, duration)
        if (!(await claim())) {
          run.skipped++
          return
        }
        try {
          const record = (await this.host.getJobLibrary()).find(
            (item) => item.encryptJobId === candidate.encryptJobId,
          )
          if (!record || !isSavedJobEligible(record)) {
            run.skipped++
            return
          }
          if (this.stopping) return
          if (collectNew) run.total++
          run.currentJob = record.snapshot.jobName
          let analysis = record.analysis
          let failure: unknown
          try {
            const data = this.host.getSavedJobData(record)
            const content = await traceDiagnostic('job.judge', () =>
              chat
                .chat('filtering', data, { disableMessages: true })
                .then((response) => response.text),
            )
            const result = parseFiltering(content)
            const passed = getFilteringDecision(result, filtering.score)
            analysis = {
              ...metadata,
              analyzedAt: new Date().toISOString(),
              ...result,
              passed,
            }
          } catch (error) {
            failure = error
          }
          const saved = await this.host.saveJobAnalysis(record.encryptJobId, {
            analysisStatus: failure ? 'failed' : 'ready',
            ...(analysis ? { analysis } : {}),
            analysisFailureReason:
              failure instanceof Error ? failure.message : failure ? String(failure) : '',
          })
          if (!saved) run.skipped++
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
        } finally {
          await this.host.releaseJobAnalysis(candidate.encryptJobId, token)
        }
      }
      if (collectNew) {
        const collection = await this.host.collectOnly!(undefined, analyze)
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
      diagnostic('analysis.finish', {
        level: run.status === 'failed' || run.failed > 0 ? 'error' : undefined,
        error: run.error,
        durationMs: performance.now() - started,
        context: { status: run.status, count: run.completed },
      })
      delete run.currentJob
      this.busy.value = false
      this.collecting.value = false
      if (!this.host.keywordRotationBusy?.value) {
        const task = collectNew ? '采集并分析' : '岗位分析'
        const status =
          run.status === 'completed' ? '完成' : run.status === 'stopped' ? '已停止' : '异常停止'
        void this.host.notification?.(
          `${task}${status}：完成 ${run.completed}/${run.total}，失败 ${run.failed}，跳过 ${run.skipped}${run.error ? `；${run.error}` : ''}`,
        )
      }
    }
    return run
  }

  validateOne(jobId: string) {
    if (!jobId?.trim()) throw new Error('缺少岗位 ID')
    if (this.busy.value) throw new Error('本地岗位分析正在进行，请等待当前请求结束')
    this.checkOtherWork()
    return this.host.getJobLibrary().then((records) => {
      const record = records.find((item) => item.encryptJobId === jobId)
      if (!record) throw new Error('未找到已保存岗位')
      if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim())
        throw new Error('请先在 BOSS 当前岗位页补全此岗位详情')
      if (isJobExcluded(record) || record.sendStatus !== 'pending')
        throw new Error('该岗位已分析、已审核或已进入发送流程，不能覆盖')
    })
  }

  async analyzeOne(jobId: string) {
    await this.validateOne(jobId)
    return this.start({ limit: 1, jobId })
  }

  async generateGreetingOne(jobId: string) {
    if (!jobId?.trim()) throw new Error('缺少岗位 ID')
    const { model, resumeText } = this.validateSetup('greetings')
    const config = { ...jsonClone(this.host.conf.formData.aiGreeting), enable: true }
    if (!Array.isArray(config.prompt) || !config.prompt.some((message) => message.content?.trim()))
      throw new Error('请先保存招呼语提示词')
    const token = crypto.randomUUID()
    let claimed = false
    this.busy.value = true
    try {
      claimed = await this.host.claimJobAnalysis(
        jobId,
        token,
        (model.data?.other?.timeout ?? 60000) + 30000,
      )
      if (!claimed) throw new Error('该岗位正在另一页面处理中，请稍后重试')
      const record = (await this.host.getJobLibrary()).find((item) => item.encryptJobId === jobId)
      if (!record) throw new Error('未找到已保存岗位')
      if (
        isJobExcluded(record) ||
        record.reviewStatus !== 'pending' ||
        record.sendStatus !== 'pending'
      )
        throw new Error('该岗位已排除、已审核或已进入发送流程，不能覆盖招呼语')
      if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim())
        throw new Error('请先补全此岗位详情')
      const chat = new ChatModel(this.host, { resume: resumeText })
      if (!chat.createAgent(config, 'greetings')) throw new Error('模型未配置，无法生成招呼语')
      const text = await chat
        .chat('greetings', this.host.getSavedJobData(record), { disableMessages: true })
        .then((response) => response.text)
      if (typeof text !== 'string' || !text.trim()) throw new Error('模型返回了空招呼语')
      this.checkOtherWork()
      if (!(await this.host.saveJobGreeting(jobId, text.trim())))
        throw new Error('岗位状态已变化，招呼语未保存，请重新查看岗位')
    } finally {
      try {
        if (claimed) await this.host.releaseJobAnalysis(jobId, token)
      } finally {
        this.busy.value = false
      }
    }
  }
}
