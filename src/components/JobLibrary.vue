<script lang="ts" setup>
import { computed, ref, shallowRef, watch } from 'vue'

import BatchAnalysis from '@/components/AI/BatchAnalysis.vue'
import {
  MATCH_DIMENSIONS,
  MATCH_SCORING_VERSION,
  parseFiltering,
} from '@/composables/useApplying/scoring'
import { useHelper } from '@/composables/useHelper'
import {
  filterJobLibrary,
  FUNNEL_STAGES,
  getJobFunnelStage,
  isSameLocalDay,
  sortJobLibraryByMatch,
} from '@/entrypoints/boss/jobStore'
import type {
  BossJobLibraryRecord,
  DetailStatus,
  FunnelStage,
  ProcessingStatusFilter,
} from '@/entrypoints/boss/jobStore'
import type { BossHelperCtx } from '@/entrypoints/boss/runtime'
import { exportJson } from '@/utils/jsonImportExport'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  initialFunnelStage?: FunnelStage | null
  initialJobId?: string
}>()
const base = useHelper()
const helper = base as BossHelperCtx
const records = shallowRef<BossJobLibraryRecord[]>([])
const loading = ref(false)
let reloadPending = false
const readError = ref('')
const exportError = ref('')
const search = ref('')
const company = ref<string | null>(null)
const sourceKeyword = ref<string | null>(null)
const detailStatus = ref<DetailStatus | null>(null)
const funnelStage = ref<FunnelStage | null>(props.initialFunnelStage ?? null)
const processingStatus = ref<ProcessingStatusFilter>('active')
const page = ref(1)
const selectedId = ref('')
const analyzingJobId = ref('')
const analysisActionError = ref('')
const copyStatus = ref('')
const pageSize = 20
const isMatchedToday = (matchedAt?: string) => isSameLocalDay(matchedAt, new Date())

const detailLabels = { pending: '待补全', complete: '已完成', failed: '失败待重试' }
const analysisLabels = { pending: '待分析', ready: '已分析', failed: '分析失败' }
const reviewLabels = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }
const sendLabels = {
  pending: '未发送',
  queued: '待发送',
  sent: '已发送',
  unknown: '发送结果未知',
  failed: '发送失败',
}
const funnelStageLabels: Record<FunnelStage, string> = {
  collected: '已采集',
  matched: '已匹配',
  applied: '已投递',
  replied: '已回复',
  interview: '面试中',
  offer: '已获 Offer',
}
const funnelStageOptions = [
  { label: '自动判断', value: null },
  ...FUNNEL_STAGES.map((value) => ({ label: funnelStageLabels[value], value })),
]
const funnelFilterOptions = [
  { label: '全部漏斗阶段', value: null },
  ...FUNNEL_STAGES.map((value) => ({ label: `${funnelStageLabels[value]}及以上`, value })),
]
const detailOptions = [
  { label: '全部详情状态', value: null },
  ...Object.entries(detailLabels).map(([value, label]) => ({
    label,
    value: value as DetailStatus,
  })),
]
const processingStatusOptions = [
  { label: '正常岗位', value: 'active' as const },
  { label: '本地排除', value: 'excluded' as const },
  { label: '全部岗位', value: 'all' as const },
]
const companyOptions = computed(() => [
  { label: '全部公司', value: null },
  ...[
    ...new Set(
      records.value.flatMap((record) => [
        record.snapshot.brandName,
        record.detail?.brandComInfo?.brandName,
        record.detail?.bossInfo?.brandName,
      ]),
    ),
  ]
    .filter((value): value is string => !!value)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({ label: value, value })),
])
const keywordOptions = computed(() => [
  { label: '全部来源关键词', value: null },
  ...[...new Set(records.value.flatMap((record) => record.sourceKeywords))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({ label: value, value })),
])
const filteredRecords = computed(() =>
  sortJobLibraryByMatch(
    filterJobLibrary(records.value, {
      search: search.value,
      company: company.value ?? undefined,
      sourceKeyword: sourceKeyword.value ?? undefined,
      detailStatus: detailStatus.value ?? '',
      funnelStage: funnelStage.value ?? '',
      processingStatus: processingStatus.value,
    }),
  ),
)
const pageRecords = computed(() =>
  filteredRecords.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)
const selected = computed(() =>
  pageRecords.value.find((record) => record.encryptJobId === selectedId.value),
)
const selectedScoring = computed(() => {
  const analysis = selected.value?.analysis
  if (analysis?.scoringVersion !== MATCH_SCORING_VERSION) return null
  try {
    return parseFiltering(JSON.stringify(analysis.res))
  } catch {
    return null
  }
})
const requirementLabels = { met: '满足', unmet: '不满足', unknown: '待确认' }

function formatMatchScore(analysis?: Record<string, unknown>) {
  if (typeof analysis?.rating !== 'number' || !Number.isFinite(analysis.rating)) return ''
  return `${analysis.needsConfirmation ? '暂定 ' : ''}${analysis.rating}/100`
}

function analysisResultLabel(record: BossJobLibraryRecord) {
  if (record.analysis?.passed === true) return '通过筛选'
  if (record.analysis?.passed === false) return '未通过筛选'
  if (record.analysis?.passed === null || record.analysis?.needsConfirmation === true)
    return '待确认'
  return analysisLabels[record.analysisStatus]
}
const jobUrl = computed(() =>
  selected.value
    ? `https://www.zhipin.com/job_detail/${encodeURIComponent(selected.value.encryptJobId)}.html`
    : '',
)

watch(
  () => props.initialFunnelStage,
  (value) => {
    funnelStage.value = value ?? null
  },
)
watch([search, company, sourceKeyword, detailStatus, funnelStage, processingStatus], () => {
  page.value = 1
})
watch(
  () => filteredRecords.value.length,
  (total) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(total / pageSize)))
  },
)
watch(pageRecords, (items) => {
  if (!items.some((record) => record.encryptJobId === selectedId.value)) {
    selectedId.value = items[0]?.encryptJobId ?? ''
  }
})
watch(
  open,
  (value) => {
    if (value && base.key === 'boss') void loadRecords()
  },
  { immediate: true },
)
watch(
  () => props.initialJobId,
  (value) => {
    if (value && open.value && base.key === 'boss') void loadRecords()
  },
)
watch(
  () => {
    const analyzer = helper.savedAnalyzer
    return [analyzer.run.value?.completed, analyzer.run.value?.failed, analyzer.busy.value]
  },
  () => {
    if (open.value && base.key === 'boss') {
      if (loading.value) reloadPending = true
      else void loadRecords()
    }
  },
)

async function loadRecords() {
  if (loading.value) return
  loading.value = true
  readError.value = ''
  exportError.value = ''
  try {
    records.value = await helper.getJobLibrary()
    if (props.initialJobId) {
      resetFilters()
      const index = filteredRecords.value.findIndex(
        (record) => record.encryptJobId === props.initialJobId,
      )
      if (index >= 0) {
        page.value = Math.floor(index / pageSize) + 1
        selectedId.value = props.initialJobId
      }
    }
  } catch (error) {
    records.value = []
    readError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
    if (reloadPending) {
      reloadPending = false
      if (open.value) void loadRecords()
    }
  }
}

function resetFilters() {
  search.value = ''
  company.value = null
  sourceKeyword.value = null
  detailStatus.value = null
  funnelStage.value = null
  processingStatus.value = 'active'
}

async function updateFunnelStage(value: FunnelStage | null) {
  if (!selected.value) return
  try {
    await helper.updateJobFunnelStage(selected.value.encryptJobId, value)
    await loadRecords()
  } catch (error) {
    readError.value = error instanceof Error ? error.message : String(error)
  }
}

async function updateProcessingStatus(status: 'active' | 'excluded') {
  if (!selected.value) return
  try {
    await helper.updateJobProcessingStatus(selected.value.encryptJobId, status)
    await loadRecords()
  } catch (error) {
    readError.value = error instanceof Error ? error.message : String(error)
  }
}

function download(filtered: boolean) {
  if (loading.value || readError.value) return
  const data = filtered ? filteredRecords.value : records.value
  if (!data.length) return
  exportError.value = ''
  try {
    exportJson(
      data,
      `boss-helper-job-library${filtered ? '-filtered' : ''}-${new Date().toISOString().slice(0, 10)}`,
    )
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : String(error)
  }
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value || '未记录'
    : date.toLocaleString('zh-CN', { hour12: false })
}

async function analyzeSelected() {
  let record = selected.value
  if (!record || analyzingJobId.value) return
  if (record.processingStatus === 'excluded') {
    analysisActionError.value = '该岗位已标记为本地排除，不再进行分析'
    return
  }
  analysisActionError.value = ''
  copyStatus.value = ''
  if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim()) {
    if (!helper.ensureSavedJobDetails) {
      analysisActionError.value = '请先在 BOSS 当前岗位页打开此岗位并补全详情'
      return
    }
    try {
      await helper.ensureSavedJobDetails(record.encryptJobId)
      await loadRecords()
      record = selected.value
      if (!record) {
        analysisActionError.value = '详情补全后未找到岗位记录'
        return
      }
    } catch (error) {
      analysisActionError.value = error instanceof Error ? error.message : String(error)
      return
    }
  }
  if (
    record.analysisStatus === 'ready' ||
    record.reviewStatus !== 'pending' ||
    record.sendStatus !== 'pending'
  ) {
    analysisActionError.value = '该岗位已分析、已审核或已进入发送流程，不能覆盖'
    return
  }
  const id = record.encryptJobId
  analyzingJobId.value = id
  try {
    const run = await helper.savedAnalyzer.analyzeOne(id)
    if (run.status === 'failed' || run.error) analysisActionError.value = run.error || '分析失败'
    await loadRecords()
    if (records.value.some((item) => item.encryptJobId === id)) selectedId.value = id
  } catch (error) {
    analysisActionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    analyzingJobId.value = ''
  }
}

async function copyGreeting() {
  const greeting = selected.value?.finalGreeting?.trim()
  if (!greeting) return
  copyStatus.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板')
    await navigator.clipboard.writeText(greeting)
    copyStatus.value = '已复制招呼语'
  } catch (error) {
    copyStatus.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <UModal
    v-if="base.key === 'boss'"
    v-model:open="open"
    title="本地岗位库"
    :close="{ 'aria-label': '关闭岗位库' }"
    :ui="{
      content: 'job-library-content',
      overlay: 'z-[10001]',
      body: 'job-library-body',
      footer: 'job-library-footer',
    }"
  >
    <template #actions>
      <UTooltip text="刷新本地岗位库" :ui="{ content: 'z-[10004]' }">
        <UButton
          icon="i-lucide-refresh-cw"
          aria-label="刷新本地岗位库"
          color="neutral"
          variant="ghost"
          :loading="loading"
          :disabled="loading"
          @click="void loadRecords()"
        />
      </UTooltip>
    </template>
    <template #body>
      <BatchAnalysis v-if="open" @completed="void loadRecords()" />
      <div class="job-library-filters">
        <UFormField label="岗位 / JD" orientation="vertical">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="搜索岗位标题或 JD"
            aria-label="搜索岗位标题或 JD"
            class="w-full"
          />
        </UFormField>
        <UFormField label="公司" orientation="vertical">
          <USelect
            v-model="company"
            :items="companyOptions"
            :ui="{ content: 'z-[10003]' }"
            aria-label="筛选公司"
            class="w-full"
          />
        </UFormField>
        <UFormField label="来源关键词" orientation="vertical">
          <USelect
            v-model="sourceKeyword"
            :items="keywordOptions"
            :ui="{ content: 'z-[10003]' }"
            aria-label="筛选来源关键词"
            class="w-full"
          />
        </UFormField>
        <UFormField label="详情状态" orientation="vertical">
          <USelect
            v-model="detailStatus"
            :items="detailOptions"
            :ui="{ content: 'z-[10003]' }"
            aria-label="筛选详情状态"
            class="w-full"
          />
        </UFormField>
        <UFormField label="漏斗阶段" orientation="vertical">
          <USelect
            v-model="funnelStage"
            :items="funnelFilterOptions"
            :ui="{ content: 'z-[10003]' }"
            aria-label="筛选漏斗阶段"
            class="w-full"
          />
        </UFormField>
        <UFormField label="岗位处理状态" orientation="vertical">
          <USelect
            v-model="processingStatus"
            :items="processingStatusOptions"
            :ui="{ content: 'z-[10003]' }"
            aria-label="筛选岗位处理状态"
            class="w-full"
          />
        </UFormField>
      </div>
      <div v-if="readError || exportError" class="text-sm text-error break-words" role="alert">
        {{ readError ? `读取失败：${readError}` : `导出失败：${exportError}` }}
      </div>
      <div v-if="loading" class="flex-1 flex items-center justify-center text-muted" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin mr-2" />
        正在读取本地岗位库
      </div>
      <div
        v-else-if="!filteredRecords.length"
        class="flex-1 flex flex-col items-center justify-center gap-3 text-muted"
        role="status"
      >
        <UIcon name="i-lucide-inbox" class="size-8" />
        <span>{{
          readError ? '岗位库未能读取' : records.length ? '没有匹配的岗位' : '本地岗位库暂无岗位'
        }}</span>
        <UButton
          v-if="readError"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          @click="void loadRecords()"
        >
          重试读取
        </UButton>
        <UButton
          v-else-if="records.length"
          icon="i-lucide-filter-x"
          color="neutral"
          variant="outline"
          @click="resetFilters"
        >
          清空筛选
        </UButton>
      </div>
      <div v-else class="job-library-workspace">
        <ul class="job-library-list" aria-label="已保存岗位">
          <li v-for="record in pageRecords" :key="record.encryptJobId">
            <button
              type="button"
              class="job-library-row relative border-b border-default p-3 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :class="{ 'bg-elevated': selectedId === record.encryptJobId }"
              :aria-pressed="selectedId === record.encryptJobId"
              :aria-label="`查看已存详情：${record.detail?.jobInfo?.jobName || record.snapshot.jobName}`"
              @click="selectedId = record.encryptJobId"
            >
              <UBadge
                v-if="isMatchedToday(record.matchedAt)"
                class="absolute top-3 right-3"
                color="primary"
                variant="subtle"
              >
                今日
              </UBadge>
              <span class="block font-medium text-sm break-words pr-12">
                {{ record.detail?.jobInfo?.jobName || record.snapshot.jobName || '未命名岗位' }}
              </span>
              <span class="block text-xs text-muted break-words mt-1">
                {{
                  record.detail?.brandComInfo?.brandName ||
                  record.snapshot.brandName ||
                  '公司待补全'
                }}
              </span>
              <span class="flex flex-wrap items-center justify-between gap-2 mt-2 text-xs">
                <span class="text-primary">{{
                  record.detail?.jobInfo?.salaryDesc || record.snapshot.salaryDesc || '薪资待补全'
                }}</span>
                <span class="flex items-center gap-2">
                  <UBadge
                    v-if="record.processingStatus === 'excluded'"
                    color="warning"
                    variant="subtle"
                  >
                    本地排除
                  </UBadge>
                  <UBadge
                    v-if="typeof record.analysis?.rating === 'number'"
                    :color="record.analysis?.passed === false ? 'error' : 'neutral'"
                    variant="subtle"
                  >
                    {{ formatMatchScore(record.analysis) }}
                  </UBadge>
                  <UBadge
                    v-else-if="record.analysisStatus === 'ready'"
                    color="neutral"
                    variant="subtle"
                  >
                    已分析
                  </UBadge>
                </span>
              </span>
            </button>
          </li>
        </ul>
        <article v-if="selected" class="job-library-detail p-4" aria-label="已保存岗位详情">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <h3 class="text-lg font-semibold break-words min-w-0 flex-1">
              {{ selected.detail?.jobInfo?.jobName || selected.snapshot.jobName || '未命名岗位' }}
            </h3>
            <a
              :href="jobUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="shrink-0 text-primary"
              aria-label="打开岗位链接"
              title="打开岗位链接"
            >
              <UIcon name="i-lucide-external-link" class="size-5" />
            </a>
          </div>
          <section class="mt-3 border-y border-default py-3" aria-labelledby="job-summary-title">
            <h4 id="job-summary-title" class="text-sm font-semibold mb-3">岗位处理摘要</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div>
                <div class="text-xs text-muted mb-1">漏斗阶段</div>
                <div class="flex flex-wrap items-center gap-2">
                  <span>{{ funnelStageLabels[getJobFunnelStage(selected)] }}</span>
                  <USelect
                    :model-value="selected.manualFunnelStage ?? null"
                    :items="funnelStageOptions"
                    :ui="{ content: 'z-[10003]' }"
                    aria-label="手动设置漏斗阶段"
                    class="min-w-36"
                    @update:model-value="
                      (value) => void updateFunnelStage((value as FunnelStage | null) ?? null)
                    "
                  />
                </div>
              </div>
              <div>
                <div class="text-xs text-muted mb-1">AI 匹配</div>
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="
                      selected.analysis?.passed === true
                        ? 'success'
                        : selected.analysis?.passed === false
                          ? 'error'
                          : 'neutral'
                    "
                    variant="subtle"
                  >
                    {{ analysisResultLabel(selected) }}
                  </UBadge>
                  <span v-if="typeof selected.analysis?.rating === 'number'" class="text-muted">
                    {{ formatMatchScore(selected.analysis) }}
                  </span>
                </div>
              </div>
              <div>
                <div class="text-xs text-muted mb-1">岗位处理</div>
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="selected.processingStatus === 'excluded' ? 'warning' : 'success'"
                    variant="subtle"
                  >
                    {{ selected.processingStatus === 'excluded' ? '本地排除' : '正常处理' }}
                  </UBadge>
                  <UButton
                    :icon="
                      selected.processingStatus === 'excluded'
                        ? 'i-lucide-archive-restore'
                        : 'i-lucide-archive'
                    "
                    size="xs"
                    color="neutral"
                    variant="outline"
                    :disabled="!!analyzingJobId || selected.processingStatus === 'excluded'"
                    @click="
                      void updateProcessingStatus(
                        selected.processingStatus === 'excluded' ? 'active' : 'excluded',
                      )
                    "
                  >
                    {{ selected.processingStatus === 'excluded' ? '恢复处理' : '标记为本地排除' }}
                  </UButton>
                </div>
              </div>
              <div>
                <div class="text-xs text-muted mb-1">流程状态</div>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>分析：{{ analysisLabels[selected.analysisStatus] }}</span>
                  <span>审核：{{ reviewLabels[selected.reviewStatus] }}</span>
                  <span>发送：{{ sendLabels[selected.sendStatus] }}</span>
                </div>
              </div>
            </div>
            <div class="mt-4">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div class="text-xs text-muted">打招呼用语</div>
                <UButton
                  icon="i-lucide-copy"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :disabled="
                    selected.processingStatus === 'excluded' ||
                    !selected.finalGreeting ||
                    !!analyzingJobId
                  "
                  @click="void copyGreeting()"
                >
                  复制打招呼语
                </UButton>
              </div>
              <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">
                {{ selected.finalGreeting || '暂无已保存话术' }}
              </p>
              <p v-if="copyStatus" class="text-sm text-muted mt-2" role="status">
                {{ copyStatus }}
              </p>
            </div>
          </section>
          <section class="mt-5" aria-labelledby="analysis-title">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 id="analysis-title" class="text-sm font-semibold">AI 分析结果</h4>
              <UButton
                icon="i-lucide-scan-search"
                size="xs"
                color="primary"
                variant="soft"
                :loading="analyzingJobId === selected.encryptJobId"
                :disabled="!!analyzingJobId || selected.processingStatus === 'excluded'"
                @click="void analyzeSelected()"
              >
                {{ analyzingJobId === selected.encryptJobId ? '正在评分' : '立即评分' }}
              </UButton>
            </div>
            <p v-if="selected.analysis" class="text-sm text-muted mb-2 break-words">
              使用简历：{{ selected.analysis.resumeName ?? '历史记录未记录' }}
              <span v-if="selected.analysis.resumeId">（{{ selected.analysis.resumeId }}）</span>
            </p>
            <div v-if="selected.analysis" class="space-y-3 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="
                    selected.analysis.passed === true
                      ? 'success'
                      : selected.analysis.passed === false
                        ? 'error'
                        : 'neutral'
                  "
                  variant="subtle"
                >
                  {{ analysisResultLabel(selected) }}
                </UBadge>
                <span v-if="typeof selected.analysis.rating === 'number'" class="text-muted">
                  匹配分 {{ formatMatchScore(selected.analysis) }}
                </span>
                <span
                  v-if="typeof selected.analysis.scoreThreshold === 'number' && selectedScoring"
                  class="text-muted"
                >
                  通过线 {{ selected.analysis.scoreThreshold }}/100
                </span>
              </div>
              <template v-if="selectedScoring">
                <dl class="divide-y divide-default">
                  <div
                    v-for="(item, index) in selectedScoring.res.dimensions"
                    :key="item.key"
                    class="py-2"
                  >
                    <dt class="flex flex-wrap justify-between gap-2 font-medium">
                      <span>{{ MATCH_DIMENSIONS[index].label }}</span>
                      <span
                        >{{ item.score ?? '待确认' }}/{{ MATCH_DIMENSIONS[index].maxScore }}</span
                      >
                    </dt>
                    <dd class="mt-1 text-muted break-words">{{ item.reason }}</dd>
                  </div>
                </dl>
                <div v-if="selectedScoring.res.hardRequirements.length">
                  <h5 class="font-medium mb-1">硬性条件</h5>
                  <ul class="space-y-2">
                    <li
                      v-for="(item, index) in selectedScoring.res.hardRequirements"
                      :key="index"
                      class="break-words"
                    >
                      <span
                        :class="
                          item.status === 'unmet'
                            ? 'text-error'
                            : item.status === 'unknown'
                              ? 'text-warning'
                              : 'text-success'
                        "
                      >
                        {{ requirementLabels[item.status] }}：{{ item.requirement }}
                      </span>
                      <p class="text-muted mt-1">{{ item.reason }}</p>
                    </li>
                  </ul>
                </div>
                <div v-if="selectedScoring.res.strengths.length">
                  <h5 class="font-medium text-success mb-1">匹配优势</h5>
                  <ul class="list-disc pl-5 space-y-1 break-words">
                    <li v-for="(item, index) in selectedScoring.res.strengths" :key="index">
                      {{ item }}
                    </li>
                  </ul>
                </div>
                <div v-if="selectedScoring.res.gaps.length">
                  <h5 class="font-medium text-error mb-1">匹配短板</h5>
                  <ul class="list-disc pl-5 space-y-1 break-words">
                    <li v-for="(item, index) in selectedScoring.res.gaps" :key="index">
                      {{ item }}
                    </li>
                  </ul>
                </div>
                <div v-if="selectedScoring.res.uncertainties.length">
                  <h5 class="font-medium text-warning mb-1">待确认信息</h5>
                  <ul class="list-disc pl-5 space-y-1 break-words">
                    <li v-for="(item, index) in selectedScoring.res.uncertainties" :key="index">
                      {{ item }}
                    </li>
                  </ul>
                </div>
              </template>
              <p
                v-if="!selectedScoring && typeof selected.analysis.message === 'string'"
                class="whitespace-pre-wrap break-words leading-relaxed"
              >
                {{ selected.analysis.message }}
              </p>
              <p
                v-if="!selectedScoring && typeof selected.analysis.message !== 'string'"
                class="text-muted"
              >
                分析结果已保存
              </p>
            </div>
            <p v-else class="text-sm text-muted">待分析</p>
            <p v-if="analysisActionError" class="text-sm text-error break-words mt-2" role="alert">
              {{ analysisActionError }}
            </p>
          </section>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm mt-2 break-words">
            <span class="text-primary font-medium">{{
              selected.detail?.jobInfo?.salaryDesc || selected.snapshot.salaryDesc || '薪资待补全'
            }}</span>
            <span>{{
              selected.detail?.jobInfo?.locationName || selected.snapshot.cityName || '城市待补全'
            }}</span>
            <span>{{
              selected.detail?.jobInfo?.experienceName || selected.snapshot.jobExperience
            }}</span>
            <span>{{ selected.detail?.jobInfo?.degreeName || selected.snapshot.jobDegree }}</span>
          </div>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm mt-4 break-words">
            <dt class="text-muted">公司</dt>
            <dd>
              {{
                selected.detail?.brandComInfo?.brandName ||
                selected.snapshot.brandName ||
                '公司待补全'
              }}
              <span class="text-muted"
                >{{
                  selected.detail?.brandComInfo?.industryName || selected.snapshot.brandIndustry
                }}
                {{ selected.detail?.brandComInfo?.scaleName || selected.snapshot.brandScaleName }}
                {{
                  selected.detail?.brandComInfo?.stageName || selected.snapshot.brandStageName
                }}</span
              >
            </dd>
            <dt class="text-muted">HR</dt>
            <dd>
              {{ selected.detail?.bossInfo?.name || selected.snapshot.bossName || 'HR 待补全' }}
              {{ selected.detail?.bossInfo?.title || selected.snapshot.bossTitle }}
              {{ selected.detail?.bossInfo?.activeTimeDesc }}
            </dd>
            <dt class="text-muted">地址</dt>
            <dd>
              {{
                selected.detail?.jobInfo?.address ||
                [
                  selected.snapshot.cityName,
                  selected.snapshot.areaDistrict,
                  selected.snapshot.businessDistrict,
                ]
                  .filter(Boolean)
                  .join(' ') ||
                '地址待补全'
              }}
            </dd>
            <dt class="text-muted">来源</dt>
            <dd>{{ selected.sourceKeywords.join('、') || '未记录关键词' }}</dd>
            <dt class="text-muted">首次发现</dt>
            <dd>
              <time :datetime="selected.firstSeenAt">{{ formatTime(selected.firstSeenAt) }}</time>
            </dd>
            <dt class="text-muted">最近发现</dt>
            <dd>
              <time :datetime="selected.lastSeenAt">{{ formatTime(selected.lastSeenAt) }}</time>
            </dd>
          </dl>
          <div
            v-if="selected.failureReason"
            class="text-sm text-error break-words mt-4"
            role="note"
          >
            详情失败原因：{{ selected.failureReason }}
          </div>
          <section class="mt-5">
            <h4 class="text-sm font-semibold mb-2">JD</h4>
            <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {{ selected.detail?.jobInfo?.postDescription || 'JD 待补全' }}
            </p>
          </section>
          <section v-if="selected.detail?.brandComInfo?.introduce" class="mt-5">
            <h4 class="text-sm font-semibold mb-2">公司介绍</h4>
            <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {{ selected.detail.brandComInfo.introduce }}
            </p>
          </section>
        </article>
      </div>
    </template>
    <template #footer>
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span aria-live="polite"
          >全库 {{ records.length }} 条 / 筛选 {{ filteredRecords.length }} 条</span
        >
        <UTooltip text="清空筛选" :ui="{ content: 'z-[10004]' }">
          <UButton
            icon="i-lucide-filter-x"
            aria-label="清空筛选"
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="
              !search &&
              !company &&
              !sourceKeyword &&
              !detailStatus &&
              !funnelStage &&
              processingStatus === 'active'
            "
            @click="resetFilters"
          />
        </UTooltip>
      </div>
      <UPagination
        v-if="filteredRecords.length > pageSize"
        v-model:page="page"
        :items-per-page="pageSize"
        :total="filteredRecords.length"
        :sibling-count="0"
        :show-edges="false"
        size="xs"
        aria-label="岗位库分页"
      />
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="loading || !!readError || !filteredRecords.length"
          @click="download(true)"
        >
          导出筛选 JSON
        </UButton>
        <UButton
          icon="i-lucide-database-backup"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="loading || !!readError || !records.length"
          @click="download(false)"
        >
          完整库 JSON
        </UButton>
      </div>
    </template>
  </UModal>
</template>
