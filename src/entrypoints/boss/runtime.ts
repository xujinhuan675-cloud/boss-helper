import { computed, reactive, ref } from 'vue'

import { appearanceConf, useConf } from '@/composables/conf'
import type { WorkflowData } from '@/composables/useApplying/type'
import { createLazyObject, isInitialized } from '@/composables/useApplying/type'
import type { JobData } from '@/composables/useHelper'
import { HelperContext } from '@/composables/useHelper'
import type { AlertItem, ConfigAccordionItem } from '@/composables/useHelper/type'
import { getRootVue, useHookVueData, useHookVueFn } from '@/composables/useVue'
import { run } from '@/index'
import { counter } from '@/message'
import type { FormDataInput } from '@/types/formData'
import { delay } from '@/utils'
import { jsonClone } from '@/utils/deepmerge'
import elmGetter from '@/utils/elmGetter'
import { logger } from '@/utils/logger'

import { GeekChatClientManager } from './chat'
import type { BoosJobData } from './delivery'
import { bossWorkflow } from './delivery'
import type { BossJobLibraryRecord, CollectionRun, DetailRun } from './jobStore'
import {
  COLLECTION_RUN_STORAGE_KEY,
  COLLECTION_SCROLL_SELECTORS,
  JOB_LIBRARY_STORAGE_KEY,
  buildAnalysisHandoff,
  createCollectionRun,
  type FunnelStage,
  getJobFunnel,
  isJobExcluded,
  isFunnelStage,
  isProcessingStatus,
  mergeJobRecords,
  stopCollectionRun,
} from './jobStore'
import { getBossData, uploadImage } from './requests'
import { SavedJobAnalyzer } from './savedAnalysis'
import type { BossZpDetailData, BossZpJobItemData } from './types'

function removeAd() {
  // 新职位发布时通知我
  void elmGetter.rm('.job-list-wrapper .subscribe-weixin-wrapper')
  // 侧栏
  void elmGetter.rm('.job-side-wrapper')
  // 侧边悬浮框
  void elmGetter.rm('.side-bar-box')
  // 搜索栏登录框
  void elmGetter.rm('.go-login-btn')
  // 底部页脚
  // elmGetter.rm("#footer-wrapper");

  // 新版: 微信扫码
  void elmGetter.rm('.c-subscribe-weixin')
  // 新版: 求职工具
  void elmGetter.rm('.c-job-tools.job-tools')
  // 新版: 热门职位
  void elmGetter.rm('.c-hot-link.hot-link')
  // 新版: 面包屑
  void elmGetter.rm('.c-breadcrumb')
  // 新版: 职位详情页的引导(想要什么工作)
  void elmGetter.rm('.job-detail-container .job-detail-guide-cont')
}

const initChange = useHookVueFn('#wrap .page-job-wrapper', 'pageChangeAction')
const initSearch = useHookVueFn('#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main', [
  'searchJobAction',
  'onSearch',
])

function formatActiveTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const day = 24 * 60 * 60 * 1000

  if (diff < day) return '今日活跃'
  if (diff < 2 * day) return '昨日活跃'
  if (diff < 7 * day) return '本周活跃'
  if (diff < 30 * day) return '本月活跃'
  return '较久未活跃'
}

function convertBossZpJobItemToJobData(item: BossZpJobItemData): JobData {
  const key = `boss::${item.encryptJobId}`

  return {
    key,
    link: `https://www.zhipin.com/job_detail/${item.encryptJobId}.html`,
    jobName: item.jobName,
    positionName: item.jobName,
    jobDescription: '',

    // 经验和学历要求 - 从 jobLabels 中解析或直接使用
    experienceName: item.jobExperience || item.jobLabels?.[0] || '经验不限',
    degreeName: item.jobDegree || '学历不限',
    salary: item.salaryDesc,

    // 地址相关
    address: [item.cityName, item.areaDistrict, item.businessDistrict].filter(Boolean).join('-'),
    addressCoords: item.gps ? [item.gps.longitude, item.gps.latitude] : undefined,

    // 技能标签
    showSkills: item.skills || [],
    jobLabels: item.jobLabels || [],
    skills: item.skills || [],

    // 活跃时间 - 从 lastModifyTime 获取
    activeTime: item.lastModifyTime,
    activeTimeStr: item.lastModifyTime ? formatActiveTime(item.lastModifyTime) : undefined,

    // 福利
    welfareList: item.welfareList,

    // 招聘者信息
    boss: {
      link: `https://www.zhipin.com/boss_detail/${item.encryptBossId}.html`,
      name: item.bossName,
      title: item.bossTitle,
      avatar: item.bossAvatar,
      certificated: item.bossCert > 0,
      isHeadhunter: item.goldHunter === 1,
      isFriend: false,
      isOnline: item.bossOnline ?? false,
    },

    // 公司品牌信息
    brand: {
      link: `https://www.zhipin.com/gongsi/${item.encryptBrandId}.html`,
      name: item.brandName,
      logo: item.brandLogo,
      scale: item.brandScaleName,
      industry: item.brandIndustry,
      stageName: item.brandStageName,
      introduce: '',
      labels: [],
    },

    // 状态信息
    // status: {
    //   status: item.contact ? 'warn' : 'pending',
    //   msg: item.contact ? '已沟通' : '未开始',
    // },
  }
}

function applySavedJobDetail(job: JobData, detail: BossZpDetailData): JobData {
  return {
    ...job,
    activeTime: detail.brandComInfo?.activeTime ?? job.activeTime,
    activeTimeStr: detail.bossInfo?.activeTimeDesc ?? job.activeTimeStr,
    jobDescription: detail.jobInfo.postDescription ?? job.jobDescription,
    city: detail.jobInfo.locationName ?? job.city,
    address: detail.jobInfo.address ?? job.address,
    addressCoords:
      typeof detail.jobInfo.longitude === 'number' && typeof detail.jobInfo.latitude === 'number'
        ? [detail.jobInfo.longitude, detail.jobInfo.latitude]
        : job.addressCoords,
    boss: {
      ...job.boss,
      isOnline: detail.bossInfo?.bossOnline ?? job.boss.isOnline,
      isCertificated: detail.bossInfo?.certificated ?? job.boss.isCertificated,
    },
    brand: {
      ...job.brand,
      labels: detail.brandComInfo?.labels ?? job.brand.labels,
      introduce: detail.brandComInfo?.introduce ?? job.brand.introduce,
      stageName: detail.brandComInfo?.stageName ?? job.brand.stageName,
    },
  }
}

export class BossHelperCtx extends HelperContext<BossHelperCtx, BoosJobData, {}> {
  private static instance: HTMLElement | null = null
  label = 'Boss直聘'
  key = 'boss'

  geek!: GeekChatClientManager

  _page = ref({ page: 1, pageSize: 15 })
  _pageHasMore = ref(true)
  _jobDetail = ref<BossZpDetailData>()
  _pageChange = (_v: number) => {
    throw new Error('pageChange is undefined')
  }
  _clickJobCardAction = (_: BossZpJobItemData) => {}
  _jobList: Ref<BossZpJobItemData[]>
  _jobDataMap: Map<string, BoosJobData>

  rootVue: any = null
  jobMaps: Map<string, WorkflowData<BoosJobData, {}>>
  jobList: Ref<JobData[]>
  collectionRun = ref<CollectionRun | null>(null)
  collectionRunning = computed(() => this.collectionRun.value?.status === 'running')
  detailRun = ref<DetailRun | null>(null)
  gatheringKind = ref<'collection' | 'detail'>('collection')
  gatheringBusy = ref(false)
  jobLibrarySummary = ref<{
    total: number
    complete: number
    pending: number
    failed: number
    funnel: ReturnType<typeof getJobFunnel>
  } | null>(null)
  jobLibraryOpen = ref(false)
  jobLibraryFunnelStage = ref<FunnelStage | null>(null)
  jobLibrarySelectedId = ref('')
  jobLibraryError = ref('')
  autoCaptureEnabled = ref(false)
  readonly realtimeBusy = ref(false)
  readonly savedAnalyzer = new SavedJobAnalyzer(this)
  private detailPromise: Promise<DetailRun> | null = null
  private pausedPhase = ''
  private collectionStopRequested = false
  private collectionPromise: Promise<CollectionRun> | null = null
  private collectionAnalysisRun: CollectionRun | null = null
  private collectionStoragePending: Promise<unknown> | null = null
  private jobCapturePromise: Promise<void> = Promise.resolve()
  private backgroundDetailQueued = false
  private mounted = false

  constructor() {
    const jobList = ref<JobData[]>([])
    const _jobList = ref<BossZpJobItemData[]>([])
    const _jobListMap = new Map<string, BoosJobData>()

    super()

    this.jobList = jobList
    this._jobList = _jobList
    this._jobDataMap = _jobListMap

    this.jobMaps = reactive(new Map())
  }

  get uid() {
    // return window?.Cookie.get('bst') // token ?
    if (!window._PAGE.encryptUserId) {
      useToast().add({
        color: 'error',
        title: '未获取到用户ID，可能会出现奇怪bug, 请尝试刷新页面或反馈',
      })
    }
    return window._PAGE.encryptUserId
  }

  get userInfo() {
    return {
      id: window._PAGE.encryptUserId,
      name: window._PAGE.showName ?? window._PAGE.name,
      avatar: window._PAGE.largeAvatar ?? window._PAGE.tinyAvatar ?? '',
    }
  }

  static async new() {
    const ctx = new BossHelperCtx()
    ctx.rootVue = await getRootVue()
    ctx.workflow = await bossWorkflow(ctx)
    return ctx
  }

  async loadMoreJob(delay: Promise<any>): Promise<boolean> {
    try {
      const oldLen = this._jobList.value.length
      const oldFirstJobId = this._jobList.value[0]?.encryptJobId ?? ''

      this._pageChange(this._page.value.page + 1)
      await delay
      const currentFirstJobId = this._jobList.value[0]?.encryptJobId ?? ''
      if (
        (location.href.includes('/web/geek/job-recommend') ||
          location.href.includes('/web/geek/jobs')) &&
        oldLen === this._jobList.value.length &&
        oldFirstJobId === currentFirstJobId
      ) {
        logger.error('翻页: 内容无变化')
        return false
      }
    } catch (err) {
      logger.error('翻页: 下一页错误', err)
      return false
    }
    return true
  }

  async start() {
    if (this.savedAnalyzer.busy.value) throw new Error('请先停止本地岗位分析')
    if (this.gatheringBusy.value) throw new Error('请先停止采集或详情补全')
    if (this.realtimeBusy.value || this.collectionStoragePending)
      throw new Error('已有任务正在运行或等待保存，请稍后重试')
    this.realtimeBusy.value = true
    try {
      if (!this.workflow) {
        this.workflow = await bossWorkflow(this)
      }
      await this.workflow.executeAll(this._jobDataMap)
    } finally {
      this.realtimeBusy.value = false
    }
  }

  private async readJobLibrary() {
    const records = await counter.storageGet<BossJobLibraryRecord[]>(JOB_LIBRARY_STORAGE_KEY, [])
    if (
      !Array.isArray(records) ||
      records.some(
        (record) =>
          !record ||
          typeof record !== 'object' ||
          Array.isArray(record) ||
          typeof record.encryptJobId !== 'string' ||
          !record.encryptJobId.trim() ||
          !record.snapshot ||
          typeof record.snapshot !== 'object' ||
          Array.isArray(record.snapshot) ||
          record.snapshot.encryptJobId !== record.encryptJobId ||
          !Array.isArray(record.sourceKeywords) ||
          !record.sourceKeywords.every((keyword) => typeof keyword === 'string') ||
          !Array.isArray(record.batches) ||
          !record.batches.every((batch) => typeof batch === 'string') ||
          !['pending', 'complete', 'failed'].includes(record.detailStatus) ||
          !['pending', 'ready', 'failed'].includes(record.analysisStatus) ||
          !['pending', 'approved', 'rejected'].includes(record.reviewStatus) ||
          !['pending', 'queued', 'sent', 'unknown', 'failed'].includes(record.sendStatus) ||
          (record.processingStatus !== undefined && !isProcessingStatus(record.processingStatus)) ||
          (record.manualFunnelStage !== undefined && !isFunnelStage(record.manualFunnelStage)) ||
          (record.detail !== undefined &&
            (!record.detail ||
              typeof record.detail !== 'object' ||
              Array.isArray(record.detail) ||
              !record.detail.jobInfo ||
              typeof record.detail.jobInfo !== 'object' ||
              Array.isArray(record.detail.jobInfo))),
      )
    )
      throw new Error('本地岗位库格式异常；已保留原数据')
    this.updateJobLibrarySummary(records)
    return records
  }

  private async writeJobLibrary(records: BossJobLibraryRecord[]) {
    await counter.storageSet(JOB_LIBRARY_STORAGE_KEY, jsonClone(records))
    this.updateJobLibrarySummary(records)
  }

  async captureNewJobs(items: BossZpJobItemData[], keyword = ''): Promise<number> {
    const run = this.jobCapturePromise.then(async () => {
      if (!items.length || this.gatheringBusy.value) return 0
      const unique = [...new Map(items.map((item) => [item.encryptJobId, item])).values()].filter(
        (item) => !!item.encryptJobId,
      )
      if (!unique.length) return 0
      const stored = await this.waitForCollectionStorage(
        () => this.readJobLibrary(),
        '读取本地岗位库',
        null,
      )
      const storedIds = new Set(stored.map((record) => record.encryptJobId))
      const unseen = unique.filter((item) => !storedIds.has(item.encryptJobId))
      if (!unseen.length) return 0
      const merged = mergeJobRecords(
        stored,
        unseen,
        keyword || new URL(location.href).searchParams.get('query') || '',
        `auto_${Date.now()}`,
      )
      await this.waitForCollectionStorage(
        () => this.writeJobLibrary(merged.records),
        '保存新岗位',
        null,
      )
      this.scheduleBackgroundDetailCompletion()
      return merged.newCount
    })
    this.jobCapturePromise = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async captureJobSnapshot(jobKey: string, keyword = ''): Promise<BossJobLibraryRecord> {
    const job = this.jobMaps.get(jobKey)
    if (!job) throw new Error('未找到当前岗位数据')
    await this.captureNewJobs([job.rawData.jobitem], keyword)
    const record = (await this.getJobLibrary()).find(
      (item) => item.encryptJobId === job.rawData.jobitem.encryptJobId,
    )
    if (!record) throw new Error('岗位快照未保存')
    return record
  }

  private updateJobLibrarySummary(records: BossJobLibraryRecord[]) {
    this.jobLibrarySummary.value = {
      total: records.length,
      complete: records.filter((record) => record.detailStatus === 'complete').length,
      pending: records.filter((record) => record.detailStatus === 'pending').length,
      failed: records.filter((record) => record.detailStatus === 'failed').length,
      funnel: getJobFunnel(records),
    }
    this.jobLibraryError.value = ''
  }

  async refreshJobLibrarySummary() {
    if (this.gatheringBusy.value || this.collectionStoragePending) return
    try {
      await this.getJobLibrary()
    } catch (error) {
      this.jobLibraryError.value = error instanceof Error ? error.message : String(error)
    }
  }

  openJobLibrary(stage: FunnelStage | null = null, selectedJobId = '') {
    this.jobLibraryFunnelStage.value = stage
    this.jobLibrarySelectedId.value = selectedJobId
    this.jobLibraryOpen.value = true
  }

  setAutoCaptureEnabled(enabled: boolean) {
    this.autoCaptureEnabled.value = enabled
    if (enabled) {
      return this.captureNewJobs(this._jobList.value).catch((error) => {
        logger.error('自动保存新岗位失败', error)
        return 0
      })
    }
  }

  scheduleBackgroundDetailCompletion() {
    if (!this.mounted || this.backgroundDetailQueued || this.detailPromise) return
    this.backgroundDetailQueued = true
    void Promise.resolve().then(async () => {
      this.backgroundDetailQueued = false
      if (
        !this.mounted ||
        this.savedAnalyzer.busy.value ||
        this.gatheringBusy.value ||
        this.collectionStoragePending ||
        this.realtimeBusy.value ||
        this.workflow?.status.value === 'running'
      )
        return
      try {
        await this.completeCollectedDetails({ availableOnly: true })
      } catch (error) {
        logger.error('鍚庡彴琛ヨˉ宀椾綅璇︽儏澶辫触', error)
      }
    })
  }

  private async writeCollectionRun(run: CollectionRun) {
    const runs = await counter.storageGet<CollectionRun[]>(COLLECTION_RUN_STORAGE_KEY, [])
    const next = [...runs.filter((item) => item.id !== run.id), run].slice(-100)
    await counter.storageSet(COLLECTION_RUN_STORAGE_KEY, jsonClone(next))
  }

  private async waitForCollectionStorage<T>(
    operation: () => Promise<T>,
    phase: string,
    run: CollectionRun | DetailRun | null = this.collectionRun.value,
  ): Promise<T> {
    if (run && run.status !== 'paused' && run.status !== 'stopped') run.phase = phase
    const pending = operation()
    this.collectionStoragePending = pending
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${phase}超时；请停止采集并刷新页面后重试`)),
            8000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
      // A timeout cannot cancel a storage write; block restart until its reply arrives.
      const settled = () => {
        if (this.collectionStoragePending === pending) this.collectionStoragePending = null
      }
      void pending.then(settled, settled)
    }
  }

  private getScrollTarget(): HTMLElement | Window {
    for (const selector of COLLECTION_SCROLL_SELECTORS) {
      let element = document.querySelector<HTMLElement>(selector)
      while (element) {
        const style = getComputedStyle(element)
        if (
          element.clientHeight > 0 &&
          element.scrollHeight > element.clientHeight + 8 &&
          /^(auto|scroll|overlay)$/.test(style.overflowY)
        ) {
          return element
        }
        element = element.parentElement
      }
    }
    return (document.scrollingElement as HTMLElement | null) ?? window
  }

  private getScrollState(target: HTMLElement | Window) {
    if (target === window || target === document.scrollingElement) {
      const root = document.documentElement
      const body = document.body
      const height = Math.max(root.scrollHeight, body.scrollHeight)
      const top = Math.max(window.scrollY, root.scrollTop, body.scrollTop)
      return { top, height, clientHeight: window.innerHeight }
    }
    return { top: target.scrollTop, height: target.scrollHeight, clientHeight: target.clientHeight }
  }

  private scrollDown(target: HTMLElement | Window) {
    const beforeTop = this.getScrollState(target).top
    const distance = Math.max(
      160,
      Math.floor(this.getScrollState(target).clientHeight * (0.45 + Math.random() * 0.25)),
    )
    if (target === window) {
      window.scrollBy({ top: distance, behavior: 'auto' })
      return
    }
    target.scrollBy({ top: distance, behavior: 'auto' })
    if (target.scrollTop === beforeTop) target.scrollTop = beforeTop + distance
  }

  private detectCollectionIssue(
    message = document.body?.innerText ?? '',
  ): CollectionRun['status'] | undefined {
    const text = message.replace(/\s+/g, '')
    if (/验证码|安全验证|滑动验证|人机验证/.test(text)) return 'captcha'
    if (/登录后|请先登录|登录过期/.test(text)) return 'login_required'
    if (/操作(过于|太)频繁|访问(过于|太)频繁|访问受限|账号异常|账户异常|稍后再试/.test(text))
      return 'restricted'
    if (/网络异常|加载失败|请求失败|服务异常/.test(text)) return 'network_error'
    return undefined
  }

  private async waitForNewJobs(previousIds: Set<string>, waitMs = 2200) {
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline && !this.collectionStopRequested) {
      if (this._jobList.value.some((item) => !previousIds.has(item.encryptJobId))) return true
      if (this.detectCollectionIssue()) return false
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
    }
    return this._jobList.value.some((item) => !previousIds.has(item.encryptJobId))
  }

  private gatheringIssue(run: CollectionRun | DetailRun) {
    const issue = this.detectCollectionIssue()
    if (issue && (run.status === 'running' || run.status === 'paused')) {
      run.status = issue
      run.error = {
        captcha: '页面要求安全验证，已停止',
        login_required: '登录已失效，已停止',
        restricted: '页面提示访问限制，已停止',
        network_error: '页面提示网络失败，已停止',
      }[issue as 'captcha' | 'login_required' | 'restricted' | 'network_error']
    }
    return run.status !== 'running' && run.status !== 'paused'
  }

  private collectionDelay(kind: 'Scroll' | 'Detail') {
    const defaults = kind === 'Scroll' ? [1, 2] : [2, 5]
    const min = Number(this.conf.formData[`delayCollection${kind}Min`] ?? defaults[0])
    const max = Number(this.conf.formData[`delayCollection${kind}Max`] ?? defaults[1])
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0.5 || max < min || max > 3600) {
      throw new Error('采集间隔必须在 0.5～3600 秒内，最长间隔不能小于最短间隔')
    }
    return (min + Math.random() * (max - min)) * 1000
  }

  private async waitForGathering(ms: number, run: CollectionRun | DetailRun) {
    let remaining = ms
    while (!this.gatheringIssue(run)) {
      if (run.status === 'running' && remaining <= 0) {
        run.waitSeconds = undefined
        return true
      }
      run.waitSeconds = Math.ceil(remaining / 1000)
      const started = Date.now()
      const wasRunning = run.status === 'running'
      await new Promise<void>((resolve) => setTimeout(resolve, 200))
      if (wasRunning && run.status === 'running') remaining -= Date.now() - started
    }
    run.waitSeconds = undefined
    return false
  }

  pauseGathering() {
    const run = this.detailPromise ? this.detailRun.value : this.collectionRun.value
    if (this.gatheringBusy.value && run?.status === 'running') {
      this.pausedPhase = run.phase ?? ''
      run.status = 'paused'
      run.phase = '已暂停'
    }
  }

  resumeGathering() {
    const run = this.detailPromise ? this.detailRun.value : this.collectionRun.value
    if (!this.gatheringBusy.value || run?.status !== 'paused') return
    if (this.gatheringIssue(run)) return
    if (
      run === this.collectionRun.value &&
      (run.searchUrl !== location.href ||
        run.filterSnapshot.salary !== String(this.conf.formData.salaryRange.value ?? '') ||
        (this._jobList.value[0]?.cityName ?? '') !== run.filterSnapshot.city)
    ) {
      run.status = 'unknown_error'
      run.error = '搜索条件已变化；请在新条件下重新采集'
      return
    }
    run.status = 'running'
    run.phase = this.pausedPhase || '继续处理'
  }

  stopGathering() {
    if (this.collectionAnalysisRun) this.savedAnalyzer.stop()
    this.stopCollection()
    if (this.detailRun.value && ['running', 'paused'].includes(this.detailRun.value.status)) {
      this.detailRun.value.status = 'stopped'
      this.detailRun.value.phase = '已停止'
    }
  }

  stopCollection() {
    this.collectionStopRequested = true
    const run = this.collectionRun.value
    if (run && ['running', 'paused'].includes(run.status)) {
      Object.assign(run, stopCollectionRun(run), { phase: '已停止' })
    }
  }

  async collectOnly(
    keyword = new URL(location.href).searchParams.get('query') ?? '',
    analyze?: (record: BossJobLibraryRecord) => Promise<void>,
  ): Promise<CollectionRun> {
    if (this.savedAnalyzer.busy.value && !analyze) throw new Error('请先停止本地岗位分析')
    if (analyze && !(this.savedAnalyzer.busy.value && this.savedAnalyzer.collecting.value))
      throw new Error('请从采集并分析入口启动')
    if (this.collectionPromise) return this.collectionPromise
    if (this.collectionStoragePending && this.collectionRun.value) return this.collectionRun.value
    if (
      this.collectionStoragePending ||
      this.gatheringBusy.value ||
      this.realtimeBusy.value ||
      this.workflow?.status.value === 'running'
    )
      throw new Error('已有任务正在运行或等待保存，请稍后重试')
    this.collectionStopRequested = false
    const run = reactive(
      createCollectionRun({
        keyword,
        searchUrl: location.href,
        salary: String(this.conf.formData.salaryRange.value ?? ''),
        city: this._jobList.value[0]?.cityName ?? '',
      }),
    )
    run.visibleCount = this._jobList.value.length
    run.phase = '等待岗位列表'
    this.collectionRun.value = run
    this.collectionAnalysisRun = analyze ? run : null
    this.gatheringKind.value = 'collection'
    this.gatheringBusy.value = true
    this.collectionPromise = (async () => {
      let idleRounds = 0
      const handled = new Set<string>()
      try {
        while (!this.collectionStopRequested && ['running', 'paused'].includes(run.status)) {
          if (!(await this.waitForGathering(0, run))) break
          run.visibleCount = this._jobList.value.length
          const issue = this.detectCollectionIssue()
          if (issue) {
            run.status = issue
            break
          }
          if (!this._jobList.value.length) {
            run.phase = '等待岗位列表'
            await this.waitForNewJobs(new Set(), 8000)
            if (this.collectionStopRequested) break
            if (!this._jobList.value.length) {
              run.status = this.detectCollectionIssue() ?? 'unknown_error'
              run.error = '未读取到岗位列表；请等待页面加载或刷新后重试'
              break
            }
          }
          const current = this._jobList.value.slice()
          run.visibleCount = current.length
          const beforeIds = new Set(current.map((item) => item.encryptJobId))
          const stored = await this.waitForCollectionStorage(
            () => this.readJobLibrary(),
            '读取已存岗位',
          )
          if (this.collectionStopRequested) break
          const storedIds = new Set(stored.map((record) => record.encryptJobId))
          const merged = mergeJobRecords(stored, current, keyword, run.id)
          await this.waitForCollectionStorage(
            () => this.writeJobLibrary(merged.records),
            '保存当前岗位',
          )
          run.savedCount = merged.records.length
          run.newCount += merged.newCount
          run.duplicateCount += merged.duplicateCount
          if (this.collectionStopRequested) break
          if (analyze) {
            const pending = merged.records
              .filter(
                (record) =>
                  !isJobExcluded(record) &&
                  beforeIds.has(record.encryptJobId) &&
                  !handled.has(record.encryptJobId) &&
                  !record.snapshot.contact &&
                  record.detailStatus !== 'failed' &&
                  record.analysisStatus === 'pending' &&
                  record.reviewStatus === 'pending' &&
                  record.sendStatus === 'pending',
              )
              .sort(
                (a, b) =>
                  Number(storedIds.has(a.encryptJobId)) - Number(storedIds.has(b.encryptJobId)),
              )
            for (const record of pending) {
              handled.add(record.encryptJobId)
              const completed =
                record.detailStatus === 'complete'
                  ? record
                  : await this.completeCollectedJob(record, run)
              if (this.gatheringIssue(run)) break
              if (
                completed?.detailStatus === 'complete' &&
                completed.detail?.jobInfo?.postDescription?.trim()
              )
                await analyze(completed)
            }
            if (this.gatheringIssue(run)) break
          }
          const target = this.getScrollTarget()
          const before = this.getScrollState(target)
          run.lastScrollTop = before.top
          run.lastScrollHeight = before.height
          await this.waitForCollectionStorage(() => this.writeCollectionRun(run), '保存本轮进度')
          if (this.collectionStopRequested) break
          run.phase = run.status === 'paused' ? '已暂停' : '等待下次滚动'
          if (!(await this.waitForGathering(this.collectionDelay('Scroll'), run))) break
          run.phase = '向下滚动'
          this.scrollDown(target)
          run.phase = '等待更多岗位'
          const scrolled = this.getScrollState(target)
          const atLoadingEdge = scrolled.top + scrolled.clientHeight >= scrolled.height - 8
          const hasNew = await this.waitForNewJobs(beforeIds, atLoadingEdge ? 2200 : 500)
          const after = this.getScrollState(target)
          run.lastScrollTop = after.top
          run.lastScrollHeight = after.height
          if (this.collectionStopRequested) break
          if (hasNew) {
            idleRounds = 0
            continue
          }
          idleRounds++
          const atBottom = after.top + after.clientHeight >= after.height - 8
          if (atBottom && idleRounds >= 3) {
            const exhausted =
              this._pageHasMore.value === false ||
              /没有更多|暂无更多|已全部加载/.test(document.body?.innerText ?? '')
            run.status = this.detectCollectionIssue() ?? (exhausted ? 'completed' : 'unknown_error')
            if (run.status === 'unknown_error')
              run.error = '列表已到底但仍可能加载更多岗位；请稍后重试'
            break
          }
          if (idleRounds >= 3 && after.top === before.top && after.height === before.height) {
            run.status = 'unknown_error'
            run.error = '页面滚动后没有新增岗位且未到达底部'
            break
          }
        }
        if (this.collectionStopRequested && run.status === 'running') run.status = 'stopped'
      } catch (error) {
        run.status = this.collectionStopRequested ? 'stopped' : 'unknown_error'
        run.error = error instanceof Error ? error.message : String(error)
      } finally {
        run.endedAt ??= new Date().toISOString()
        try {
          if (!this.collectionStoragePending) {
            await this.waitForCollectionStorage(() => this.writeCollectionRun(run), '保存结束记录')
          }
        } catch (error) {
          if (run.status === 'completed') run.status = 'unknown_error'
          run.error = error instanceof Error ? error.message : String(error)
        } finally {
          this.collectionAnalysisRun = null
          run.phase = run.status === 'stopped' ? '已停止' : '采集结束'
          run.waitSeconds = undefined
          this.collectionPromise = null
          this.gatheringBusy.value = false
          this.scheduleBackgroundDetailCompletion()
        }
      }
      return run
    })()
    return this.collectionPromise
  }

  async waitForCollectionAnalysis(phase: string): Promise<boolean> {
    const run = this.collectionAnalysisRun
    if (!run || !(await this.waitForGathering(0, run))) return false
    run.phase = phase
    return true
  }

  private async completeCollectedJob(record: BossJobLibraryRecord, run: CollectionRun | DetailRun) {
    if (this.gatheringIssue(run) || !(await this.waitForGathering(0, run))) return null
    const job = this.jobMaps.get(record.key)
    if (!job) {
      record.detailStatus = 'failed'
      record.detailRetryCount++
      record.failureReason = '岗位不在当前列表，恢复原搜索后重试'
    } else {
      run.phase = '等待打开详情'
      if (!(await this.waitForGathering(this.collectionDelay('Detail'), run))) return null
      try {
        run.phase = '获取详情'
        await this.onJobCardClick(record.key, () => this.gatheringIssue(run))
        if (this.gatheringIssue(run)) return null
        record.detail = job.rawData.detail as BossZpDetailData
        record.detailStatus = 'complete'
        record.failureReason = undefined
      } catch (error) {
        if (run.status === 'stopped') return null
        record.detailStatus = 'failed'
        record.detailRetryCount++
        record.failureReason = error instanceof Error ? error.message : String(error)
        const issue = this.detectCollectionIssue(record.failureReason)
        if (issue) {
          run.status = issue
          run.error = record.failureReason
        }
      }
    }
    // 只回写详情字段，保留等待期间用户更新的审核和发送记录。
    const latest = await this.waitForCollectionStorage(
      () => this.readJobLibrary(),
      '读取最新岗位记录',
      run,
    )
    const stored = latest.find((item) => item.encryptJobId === record.encryptJobId)
    if (!stored) throw new Error('待补全岗位已不在本地库；已停止，未覆盖其他数据')
    Object.assign(stored, {
      detail: record.detail,
      detailStatus: record.detailStatus,
      detailRetryCount: record.detailRetryCount,
      failureReason: record.failureReason,
    })
    await this.waitForCollectionStorage(() => this.writeJobLibrary(latest), '保存详情', run)
    return stored
  }

  async completeCollectedDetails(options: { availableOnly?: boolean } = {}) {
    if (this.savedAnalyzer.busy.value) throw new Error('请先停止本地岗位分析')
    if (this.detailPromise) return this.detailPromise
    if (
      this.collectionStoragePending ||
      this.gatheringBusy.value ||
      this.realtimeBusy.value ||
      this.workflow?.status.value === 'running'
    )
      throw new Error('已有任务正在运行或等待保存，请稍后重试')
    const run = reactive<DetailRun>({
      status: 'running',
      completed: 0,
      failed: 0,
      retryable: 0,
      total: 0,
      phase: '读取本地岗位库',
    })
    this.detailRun.value = run
    this.gatheringKind.value = 'detail'
    this.gatheringBusy.value = true
    this.detailPromise = (async () => {
      try {
        this.collectionDelay('Detail')
        const records = await this.waitForCollectionStorage(
          () => this.readJobLibrary(),
          '读取本地岗位库',
          run,
        )
        const pending = records
          .filter(
            (record) =>
              !isJobExcluded(record) &&
              record.detailStatus !== 'complete' &&
              (!options.availableOnly || this.jobMaps.has(record.key)),
          )
          .sort((a, b) => Number(this.jobMaps.has(b.key)) - Number(this.jobMaps.has(a.key)))
          .slice(0, 5)
        run.total = pending.length
        for (const record of pending) {
          if (this.gatheringIssue(run) || !(await this.waitForGathering(0, run))) break
          run.currentJob = record.snapshot.jobName
          const stored = await this.completeCollectedJob(record, run)
          if (!stored) break
          if (stored.detailStatus === 'complete') run.completed++
          else run.failed++
          run.retryable = this.jobLibrarySummary.value?.failed ?? 0
        }
        if (!this.gatheringIssue(run) && (await this.waitForGathering(0, run)))
          run.status = 'completed'
      } catch (error) {
        if (run.status !== 'stopped') run.status = 'unknown_error'
        run.error = error instanceof Error ? error.message : String(error)
      } finally {
        run.waitSeconds = undefined
        run.phase = run.status === 'stopped' ? '已停止' : '详情批次结束'
        this.detailPromise = null
        this.gatheringBusy.value = false
        if (options.availableOnly && run.status === 'completed' && run.total > 0)
          this.scheduleBackgroundDetailCompletion()
      }
      return run
    })()
    return this.detailPromise
  }

  async getJobLibrary(): Promise<BossJobLibraryRecord[]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const records = await Promise.race([
        this.readJobLibrary(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('读取本地岗位库超时；请刷新页面后重试')), 8000)
        }),
      ])
      return jsonClone(records)
    } finally {
      clearTimeout(timer)
    }
  }

  async sendSavedGreeting(jobId: string): Promise<void> {
    if (!jobId?.trim()) throw new Error('缺少岗位 ID')
    if (
      this.savedAnalyzer.busy.value ||
      this.gatheringBusy.value ||
      this.realtimeBusy.value ||
      this.collectionStoragePending ||
      this.workflow?.status.value === 'running'
    )
      throw new Error('已有任务正在运行或等待保存结束，请稍后重试')
    let record = (await this.getJobLibrary()).find((item) => item.encryptJobId === jobId)
    if (!record) throw new Error('未找到已保存岗位')
    if (isJobExcluded(record)) throw new Error('Excluded jobs are not processed')
    const greeting = record.finalGreeting?.trim()
    if (!greeting) throw new Error('该岗位暂无已保存招呼语')
    if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim()) {
      record = await this.ensureSavedJobDetails(jobId)
    }
    const job = this.jobMaps.get(record.key)
    if (!job) throw new Error('请回到该岗位所在的 BOSS 搜索页后再发送')
    if (!record.detail) throw new Error('岗位详情未补全完成')
    job.rawData.detail = record.detail
    job.rawData.boss = await getBossData({
      securityId: job.rawData.jobitem.securityId,
      encryptUserId: this.uid,
    })
    await this.sendMessage({ jobData: job.jobData, rawData: job.rawData, state: {} }, greeting)
  }

  async ensureSavedJobDetails(jobId: string): Promise<BossJobLibraryRecord> {
    if (
      this.savedAnalyzer.busy.value ||
      this.gatheringBusy.value ||
      this.realtimeBusy.value ||
      this.collectionStoragePending ||
      this.workflow?.status.value === 'running'
    )
      throw new Error('已有任务正在运行或等待保存，请稍后重试')
    const records = await this.waitForCollectionStorage(
      () => this.readJobLibrary(),
      '读取本地岗位库',
      null,
    )
    const record = records.find((item) => item.encryptJobId === jobId)
    if (!record) throw new Error('未找到已保存岗位')
    if (isJobExcluded(record)) throw new Error('Excluded jobs are not processed')
    if (record.detailStatus === 'complete' && record.detail?.jobInfo?.postDescription?.trim())
      return record
    const job = this.jobMaps.get(record.key)
    if (!job) throw new Error('请回到该岗位所在 BOSS 搜索页后再补全详情')
    await this.onJobCardClick(record.key)
    const detail = job.rawData.detail as BossZpDetailData | undefined
    if (!detail?.jobInfo?.postDescription?.trim()) throw new Error('岗位详情未返回完整 JD')
    const latest = await this.waitForCollectionStorage(
      () => this.readJobLibrary(),
      '读取最新岗位记录',
      null,
    )
    const stored = latest.find((item) => item.encryptJobId === jobId)
    if (!stored) throw new Error('待补全岗位已不在本地库')
    Object.assign(stored, { detail, detailStatus: 'complete', failureReason: undefined })
    await this.waitForCollectionStorage(() => this.writeJobLibrary(latest), '保存详情', null)
    return stored
  }

  async getAnalysisHandoff() {
    return buildAnalysisHandoff(await this.getJobLibrary())
  }

  get hasPendingCollectionStorage(): boolean {
    return this.collectionStoragePending !== null
  }

  getSavedJobData(record: BossJobLibraryRecord): WorkflowData<BossJobLibraryRecord, {}> {
    const job = convertBossZpJobItemToJobData(record.snapshot)
    return {
      jobData: record.detail ? applySavedJobDetail(job, record.detail) : job,
      rawData: record,
      state: {},
    }
  }

  async saveJobAnalysis(
    jobId: string,
    patch: {
      analysisStatus: 'pending' | 'ready' | 'failed'
      analysis?: Record<string, unknown>
      finalGreeting?: string
      analysisFailureReason?: string
    },
  ): Promise<boolean> {
    if (
      (this.gatheringBusy.value &&
        !(this.collectionAnalysisRun && this.savedAnalyzer.busy.value)) ||
      this.collectionStoragePending
    )
      throw new Error('已有任务正在运行或等待保存，请稍后重试')
    if (
      !patch ||
      !['pending', 'ready', 'failed'].includes(patch.analysisStatus) ||
      (patch.analysis !== undefined &&
        (!patch.analysis || typeof patch.analysis !== 'object' || Array.isArray(patch.analysis))) ||
      (patch.finalGreeting !== undefined && typeof patch.finalGreeting !== 'string') ||
      (patch.analysisFailureReason !== undefined && typeof patch.analysisFailureReason !== 'string')
    )
      throw new Error('分析结果格式异常；已保留原数据')
    const records = jsonClone(
      await this.waitForCollectionStorage(() => this.readJobLibrary(), '读取本地岗位库', null),
    )
    const record = records.find((item) => item.encryptJobId === jobId)
    if (!record) throw new Error('未找到已保存岗位')
    if (
      record.reviewStatus !== 'pending' ||
      record.sendStatus !== 'pending' ||
      record.analysisStatus === 'ready'
    )
      return false
    if (isJobExcluded(record)) return false
    record.analysisStatus = patch.analysisStatus
    if (patch.analysis !== undefined) record.analysis = jsonClone(patch.analysis)
    if (patch.analysis?.passed === true && !record.matchedAt)
      record.matchedAt = new Date().toISOString()
    if (patch.finalGreeting !== undefined) record.finalGreeting = patch.finalGreeting
    record.analysisFailureReason =
      patch.analysisStatus === 'failed' ? patch.analysisFailureReason : undefined
    await this.waitForCollectionStorage(() => this.writeJobLibrary(records), '保存岗位分析', null)
    return true
  }

  async updateJobFunnelStage(jobId: string, stage: FunnelStage | null): Promise<boolean> {
    if (this.gatheringBusy.value || this.collectionStoragePending)
      throw new Error('已有任务正在运行或等待保存，请稍后重试')
    if (stage !== null && !isFunnelStage(stage)) throw new Error('漏斗阶段无效')
    const records = jsonClone(
      await this.waitForCollectionStorage(() => this.readJobLibrary(), '读取本地岗位库', null),
    )
    const record = records.find((item) => item.encryptJobId === jobId)
    if (!record) throw new Error('未找到已保存岗位')
    if (stage === null) delete record.manualFunnelStage
    else record.manualFunnelStage = stage
    await this.waitForCollectionStorage(() => this.writeJobLibrary(records), '保存漏斗阶段', null)
    return true
  }

  async updateJobProcessingStatus(jobId: string, status: 'active' | 'excluded'): Promise<boolean> {
    if (this.gatheringBusy.value || this.collectionStoragePending)
      throw new Error('A job task is running or its save is pending')
    if (!isProcessingStatus(status)) throw new Error('Invalid job processing status')
    const records = jsonClone(
      await this.waitForCollectionStorage(() => this.readJobLibrary(), 'Read saved jobs', null),
    )
    const record = records.find((item) => item.encryptJobId === jobId)
    if (!record) throw new Error('Saved job not found')
    if (status === 'active') delete record.processingStatus
    else record.processingStatus = status
    await this.waitForCollectionStorage(
      () => this.writeJobLibrary(records),
      'Save job processing status',
      null,
    )
    return true
  }

  async sendMessage(data: WorkflowData<BoosJobData, {}>, msgs: FormDataInput['value']) {
    logger.debug('发送消息', { jobKey: data.jobData.key, msg: msgs })

    const stanza = {
      uid: Number(data.rawData.boss.data.bossId),
      friendSource: data.rawData.detail.bossInfo.bossSource ?? 0,
      encryptUid: data.rawData.jobitem.encryptBossId,
      encryptGid: '',
      clientMid: Date.now(),
    }
    if (typeof msgs === 'string') {
      msgs = [{ type: 'text', content: msgs }]
    }
    for (const msg of msgs) {
      var m
      // Each chat message needs its own client id; reusing one makes later messages look duplicated.
      stanza.clientMid = Date.now()
      if (msg.type === 'image') {
        const response = await counter.getImage(msg.image)
        if (!response.success) {
          throw new Error('图片未上传或已过期')
        }
        const u8Array = new Uint8Array(response.buffer)
        const file = new File([u8Array.buffer], response.name, { type: response.type })
        const img = await uploadImage(data.rawData.boss.data.securityId, file)

        m = this.geek.msgBuilder.createImageMessage(stanza, {
          content: {
            iid: 0,
            ...img,
          },
        })
      } else if (msg.type === 'text') {
        this.pendingMessages.value = msg.content
        await delay(this.conf.formData.delayMessageSending)
        m = this.geek.msgBuilder.createTextMessage(stanza, {
          text: this.pendingMessages.value,
        })
        this.pendingMessages.value = undefined
      } else {
        throw new Error('不支持的消息类型:' + msg['type'])
      }
      this.geek.client.publish('chat', this.geek.msgBuilder.encode(m), {
        qos: 1,
        retain: true,
      })
    }
  }

  async onMount(path?: string) {
    if (!path) {
      path = this.rootVue.$route.path
    }

    try {
      if (await elmGetter.get('boss-helper-job', 3000)) {
        return
      }
    } catch {}

    if (BossHelperCtx.instance) {
      BossHelperCtx.instance.remove()
      BossHelperCtx.instance = null
    }
    // TODO: 移除menu, 可能导致nuxtui实例冲突
    // if (!document.querySelector('boss-helper-menu')) {
    //   const menuElement = document.createElement('boss-helper-menu')
    //   document.body.appendChild(menuElement)
    // }
    const elm = await elmGetter.get(
      '.job-search-wrapper,.job-recommend-main,.page-jobs .page-jobs-main',
    )

    const appElement = document.createElement('boss-helper-job')
    BossHelperCtx.instance = appElement
    elm.insertBefore(appElement, elm.firstChild)
    removeAd()

    await this._initJobList()
    await this._initPage()
    await this._initPageChange()
    await this._initJobDetail()
    await this._initClickJobCardAction()

    this.initNetConf()
    const contentElm = elm.querySelector<HTMLDivElement>('.recommend-result-inner')
    this.geek = new GeekChatClientManager()
    await this.geek.connect()
    watch(
      appearanceConf.value,
      (v) => {
        if (!contentElm) return
        contentElm.style.marginRight =
          v.leftChat && v.contentOffset != 25 ? `${v.contentOffset}%` : 'auto'
        contentElm.style.marginLeft =
          !v.leftChat && v.contentOffset != 25 ? `${v.contentOffset}%` : 'auto'
      },
      { immediate: true },
    )
    this.mounted = true
    this.scheduleBackgroundDetailCompletion()
  }
  getConfigItems() {
    const conf = useConf()
    return computed<[AlertItem[], (ConfigAccordionItem | false)[]]>(() => {
      return [
        [
          {
            type: 'alert',
            id: 'config-alert-1',
            showIcon: true,
            title: '首次配置前请先进入帮助模式查看说明',
            color: 'success',
            description:
              '所有配置项均提供说明，获取岗位滚动至约 150 条会自动停止，刷新页面或修改求职期望后可重新获取；如遇 Bug 或帮助内容不清晰，欢迎反馈并提出改进建议。',
          },
        ],
        [
          {
            label: '筛选配置',
            value: 'filter',
            items: [
              {
                type: 'alert',
                id: 'filter-config-alert-enable',
                title: '复选框打钩才会启用，别忘记打钩启用哦。保存也别忘了',
                description: '排除和包含可点击切换，混合模式适用性过低难以配置不会考虑开发',
                color: 'success',
                showIcon: true,
              },
              {
                type: 'div',
                class: 'grid grid-cols-2 gap-2 mt-2 w-full',

                items: [
                  {
                    type: 'select',
                    key: 'company',
                  },
                  {
                    type: 'select',
                    key: 'jobTitle',
                  },
                  {
                    type: 'select',
                    key: 'jobContent',
                  },
                  {
                    type: 'select',
                    key: 'hrPosition',
                  },
                  conf.configLevel.intermediate && {
                    type: 'select',
                    key: 'jobAddress',
                  },
                  {
                    type: 'div',
                  },
                ],
              },
              {
                type: 'div',
                class: 'flex gap-2 mt-3',
                items: [
                  conf.configLevel.intermediate && {
                    type: 'salaryRange',
                    key: 'salaryRange',
                  },
                  conf.configLevel.intermediate && {
                    type: 'companySizeRange',
                    key: 'companySizeRange',
                  },
                ],
              },
              {
                type: 'div',
                class: 'col-span-full flex flex-wrap gap-2 mt-3',
                items: [
                  conf.configLevel.intermediate && {
                    type: 'checkbox',
                    key: 'activityFilter',
                  },
                  {
                    type: 'checkbox',
                    key: 'goldHunterFilter',
                  },
                  {
                    type: 'checkbox',
                    key: 'friendStatus',
                  },
                  {
                    type: 'checkbox',
                    key: 'bossGoldMedalHr',
                  },
                  conf.configLevel.intermediate && {
                    type: 'checkbox-expire',
                    key: 'sameCompanyFilter',
                  },
                  conf.configLevel.intermediate && {
                    type: 'checkbox-expire',
                    key: 'sameHrFilter',
                  },
                ],
              },
            ],
          },
          conf.configLevel.intermediate && {
            label: '招呼语配置',
            value: 'greetings',
            items: [
              {
                type: 'alert',
                id: 'config-alert-2',
                showIcon: true,
                color: 'success',
                description: '使用自定义招呼语前 推荐禁用boss直聘自带招呼语',
                actions: [
                  {
                    label: '前往',
                    color: 'neutral',
                    variant: 'subtle',
                    onClick: () => {
                      window.open(
                        'https://www.zhipin.com/web/geek/notify-set?type=greetSet',
                        '_blank',
                      )
                    },
                  },
                ],
              },
              { type: 'customGreeting', key: 'customGreeting' },
            ],
          },
          {
            label: '采集间隔',
            value: 'collection-delay',
            items: [
              {
                type: 'div',
                class: 'grid grid-cols-2 gap-3',
                items: [
                  ['delayCollectionScrollMin', '滚动最短间隔（秒）'],
                  ['delayCollectionScrollMax', '滚动最长间隔（秒）'],
                  ['delayCollectionDetailMin', '详情最短间隔（秒）'],
                  ['delayCollectionDetailMax', '详情最长间隔（秒）'],
                ].map(([key, label]) => ({
                  type: 'inputNumber' as const,
                  key,
                  fieldProps: { label },
                  inputNumberProps: { min: 0.5, max: 3600, step: 0.5 },
                })),
              },
            ],
          },
          {
            label: '外观配置',
            value: 'appearance',
            items: [{ type: 'appearance', key: 'appearance' }],
          },
          conf.configLevel.advanced && {
            label: '地址配置',
            value: 'address',
            items: [{ type: 'address', key: 'address' }],
          },
          conf.configLevel.intermediate && {
            label: '延迟配置',
            value: 'delay',
            items: [
              {
                type: 'div',
                class: 'grid grid-cols-2 gap-3',
                items: [
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryStarts',
                    fieldProps: {
                      label: '投递开始',
                      'data-help': '点击投递按钮会等待一段时间,默认值10s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryInterval',
                    fieldProps: {
                      label: '投递间隔',
                      'data-help': '每个投递的间隔,太快易风控,默认值2s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryPageNext',
                    fieldProps: {
                      label: '投递翻页',
                      'data-help': '投递完下一页之后等待的间隔,太快易风控,默认值60s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayMessageSending',
                    fieldProps: {
                      label: '消息发送',
                      'data-help': '在发送消息前允许等待一定的时间让用户来修改或手动发送,默认值2s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                      disable: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      ]
    })
  }
  async onJobCardClick(key: string, shouldStop?: () => boolean) {
    // const detail = await requestDetail({
    //   securityId: job.rawData.jobitem.securityId,
    //   lid: job.rawData.jobitem.encryptJobId,
    // }).then((r) => r.zpData)
    const job = this.jobMaps.get(key)
    if (!job) {
      throw new Error('未找到job数据')
    }
    if (isInitialized(job.rawData.detail)) {
      return
    }
    if (shouldStop?.()) throw new Error('详情补全已停止')
    this._clickJobCardAction(job.rawData.jobitem)
    const deadline = Date.now() + 60000
    while (!this._jobDetail.value || this._jobDetail.value.lid !== job.rawData.jobitem.lid) {
      if (shouldStop?.()) throw new Error('详情补全已停止')
      if (Date.now() >= deadline) throw new Error('bossZpDetailData获取超时')
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    const detail = this._jobDetail.value

    job.rawData.detail = detail
    Object.assign(job.jobData, applySavedJobDetail(job.jobData, detail))
    this.jobMaps.set(key, job)
  }
  async _initJobList() {
    return useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'jobList',
      this._jobList,
      (v) => {
        this.jobList.value = v.map((item) => {
          // const jobData = convertBossZpJobItemToJobData(item)
          // if (this.conf.formData.useCache.value) {
          //   const cacheCheck = checkJobCache(jobData.key)
          //   if (cacheCheck) {
          //     jobData.status = {
          //       status: cacheCheck.status,
          //       msg: `${cacheCheck.message} (缓存)`,
          //     }
          //   }
          // }
          const job = convertBossZpJobItemToJobData(item)

          let jobData = this._jobDataMap.get(job.key)
          if (jobData) {
            jobData = {
              ...jobData,
              jobitem: item,
            }
          } else {
            jobData = {
              jobitem: item,
              detail: createLazyObject('岗位详情获取'),
              boss: createLazyObject('Boss信息获取'),
            }
          }
          this._jobDataMap.set(job.key, jobData)

          return job
        })
        this.jobList.value.forEach((job) => {
          this.jobMaps.set(job.key, {
            jobData: job,
            rawData: this._jobDataMap.get(job.key)!,
            state: {},
          })
        })
        if (this.autoCaptureEnabled.value) {
          void this.captureNewJobs(v).catch((error) => {
            logger.error('自动保存新岗位失败', error)
          })
        }
        this.scheduleBackgroundDetailCompletion()
      },
    )()
  }

  async _initPage() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'pageVo',
      this._page,
    )()
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'hasMore',
      this._pageHasMore,
    )()
  }

  async _initJobDetail() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'jobDetail',
      this._jobDetail,
    )()
  }

  async _initPageChange() {
    let pc =
      location.href.includes('/web/geek/job-recommend') || location.href.includes('/web/geek/jobs')
        ? await initSearch()
        : await initChange()
    if (!pc) {
      throw new Error('pageChange is undefined')
    }
    this._pageChange = pc
  }

  async _initClickJobCardAction() {
    this._clickJobCardAction = await useHookVueFn(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'clickJobCardAction',
    )()
  }
}

// function shouldCaptureChatSocket(url: string | URL | undefined) {
//   return url != null && url.toString().includes('chatws')
// }

// function hookChatSocket() {
//   const NativeWebSocket = window.WebSocket
//   const HOOK_SYMBOL = Symbol('__IS_HOOKED__')

//   if (!(NativeWebSocket as any)[HOOK_SYMBOL]) {
//     window.WebSocket = new Proxy(NativeWebSocket, {
//       construct(target, args, newTarget) {
//         const socket = Reflect.construct(target, args, newTarget)

//         const [url] = args as [string | URL | undefined, string | string[] | undefined]

//         if (!shouldCaptureChatSocket(url)) {
//           return socket
//         }
//         BossHelperCtx.setSocket(socket)
//         socket.addEventListener('open', () => {
//           BossHelperCtx.setSocket(socket)
//         })
//         socket.addEventListener('close', () => {
//           BossHelperCtx.setSocket(null)
//         })

//         return socket
//       },
//     }) as typeof WebSocket

//     Object.defineProperty(window.WebSocket, HOOK_SYMBOL, {
//       value: true,
//       enumerable: false,
//       writable: false,
//       configurable: false,
//     })
//   }
// }

export async function runBoss() {
  // hookChatSocket()

  const bossHelpCtx = await BossHelperCtx.new()

  bossHelpCtx.rootVue.$router.afterHooks.push(
    (to: {
      name: string
      meta: {
        notLogin: boolean
        wrapClassName: string
        scrollBehavior: string
        hideFooter: boolean
        headerV2: boolean
      }
      path: string
      hash: string
      query: {
        ka: string
      }
      params: {}
      fullPath: string
    }) => {
      // hookChatSocket()
      bossHelpCtx.onMount(to.path)
    },
  )

  await run(bossHelpCtx)
}
