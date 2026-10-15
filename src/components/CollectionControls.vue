<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'

import JobLibrary from '@/components/JobLibrary.vue'
import { useHelper } from '@/composables/useHelper'
import type { BossHelperCtx } from '@/entrypoints/boss/runtime'

const base = useHelper()
const helper = base as BossHelperCtx
const analysisBusy = computed(() => base.key === 'boss' && helper.savedAnalyzer.busy.value)
const libraryOpen = computed({
  get: () => helper.jobLibraryOpen.value,
  set: (value: boolean) => {
    helper.jobLibraryOpen.value = value
  },
})
const libraryFunnelStage = computed(() => helper.jobLibraryFunnelStage.value)
const librarySelectedId = computed(() => helper.jobLibrarySelectedId.value)
const collapsed = ref(false)
const actionError = ref('')
const showAnalysis = ref(false)
const run = computed(() =>
  base.key === 'boss'
    ? helper.gatheringKind.value === 'detail'
      ? helper.detailRun.value
      : helper.collectionRun.value
    : null,
)
const paused = computed(() => run.value?.status === 'paused')
const statusLabels: Record<string, string> = {
  running: '进行中',
  paused: '已暂停',
  stopped: '已停止',
  completed: '已完成',
  login_required: '需登录',
  captcha: '需验证',
  restricted: '访问受限',
  network_error: '网络失败',
  unknown_error: '需检查',
}

async function start(kind: 'collection' | 'analysis') {
  actionError.value = ''
  collapsed.value = false
  showAnalysis.value = kind === 'analysis'
  try {
    if (kind === 'collection') await helper.collectOnly()
    else if (kind === 'analysis') {
      const result = await helper.savedAnalyzer.start({ collectNew: true })
      if (result.status === 'failed') actionError.value = result.error || '采集分析失败'
    }
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  if (base.key === 'boss') void helper.refreshJobLibrarySummary()
})
</script>

<template>
  <aside v-if="base.key === 'boss'" class="collection-controls" aria-label="岗位采集控制">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-semibold">
        本地岗位库 {{ helper.jobLibrarySummary.value?.total ?? '读取中' }}
      </span>
      <div class="flex items-center gap-1">
        <UButton
          icon="i-lucide-database"
          size="xs"
          color="neutral"
          variant="outline"
          @click="helper.openJobLibrary()"
        >
          岗位库
        </UButton>
        <UTooltip text="读回本地岗位库">
          <UButton
            icon="i-lucide-refresh-cw"
            aria-label="读回本地岗位库"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="helper.gatheringBusy.value"
            @click="void helper.refreshJobLibrarySummary()"
          />
        </UTooltip>
        <UTooltip :text="collapsed ? '展开采集控制' : '收起采集控制'">
          <UButton
            :icon="collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            :aria-label="collapsed ? '展开采集控制' : '收起采集控制'"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="collapsed = !collapsed"
          />
        </UTooltip>
      </div>
    </div>
    <div v-if="!collapsed" class="flex flex-col gap-2 mt-2">
      <div v-if="helper.jobLibrarySummary.value" class="text-xs text-muted">
        详情已完成 {{ helper.jobLibrarySummary.value.complete }} · 待补全
        {{ helper.jobLibrarySummary.value.pending }} · 待重试
        {{ helper.jobLibrarySummary.value.failed }}
      </div>
      <div class="flex items-center flex-wrap gap-2">
        <UButton
          icon="i-lucide-sparkles"
          size="sm"
          :disabled="helper.gatheringBusy.value || base.workflowRunning.value || analysisBusy"
          @click="void start('analysis')"
        >
          采集并分析
        </UButton>
        <UButton
          icon="i-lucide-list-plus"
          color="neutral"
          size="sm"
          :disabled="helper.gatheringBusy.value || base.workflowRunning.value || analysisBusy"
          @click="void start('collection')"
        >
          只采集
        </UButton>
      </div>
      <div
        v-if="showAnalysis && helper.savedAnalyzer.run.value"
        class="text-xs text-muted break-words"
        role="status"
        aria-live="polite"
      >
        分析已保存 {{ helper.savedAnalyzer.run.value.completed }} · 失败
        {{ helper.savedAnalyzer.run.value.failed }} · 跳过
        {{ helper.savedAnalyzer.run.value.skipped }}
        <div v-if="helper.savedAnalyzer.run.value.currentJob">
          {{ helper.savedAnalyzer.run.value.currentJob }}
        </div>
        <div v-if="helper.savedAnalyzer.run.value.error" class="text-error">
          {{ helper.savedAnalyzer.run.value.error }}
        </div>
      </div>
      <div v-if="run" class="text-xs leading-relaxed break-words" aria-live="polite">
        <div class="font-medium">
          {{ helper.gatheringKind.value === 'detail' ? '详情' : '采集' }}：{{
            statusLabels[run.status]
          }}
          <span v-if="run.phase && run.status === 'running'"> · {{ run.phase }}</span>
          <span v-if="run.waitSeconds"> · {{ run.waitSeconds }} 秒</span>
        </div>
        <template v-if="helper.gatheringKind.value === 'collection' && helper.collectionRun.value">
          <div>
            本轮新增 {{ helper.collectionRun.value.newCount }} · 本轮已见岗位重复读取
            {{ helper.collectionRun.value.duplicateCount }} 次
          </div>
          <div>
            当前列表 {{ helper.collectionRun.value.visibleCount ?? 0 }} · 滚动
            {{ helper.collectionRun.value.lastScrollTop }}/{{
              helper.collectionRun.value.lastScrollHeight
            }}
          </div>
        </template>
        <div v-else-if="helper.detailRun.value">
          本批完成 {{ helper.detailRun.value.completed }}/{{ helper.detailRun.value.total }} · 失败
          {{ helper.detailRun.value.failed }}
          <div v-if="helper.detailRun.value.currentJob">
            {{ helper.detailRun.value.currentJob }}
          </div>
        </div>
      </div>
      <div
        class="collection-indicator"
        :class="{
          paused,
          failed: run && !['running', 'paused', 'completed', 'stopped'].includes(run.status),
        }"
      />
      <div
        v-if="actionError || helper.jobLibraryError.value || run?.error"
        class="text-xs text-error break-words"
        role="alert"
      >
        {{ actionError || helper.jobLibraryError.value || run?.error }}
      </div>
    </div>
    <div v-if="helper.gatheringBusy.value" class="flex justify-end gap-2 mt-2">
      <UButton
        :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
        color="neutral"
        size="sm"
        :disabled="!run || !['running', 'paused'].includes(run.status)"
        @click="paused ? helper.resumeGathering() : helper.pauseGathering()"
      >
        {{ paused ? '继续' : '暂停' }}
      </UButton>
      <UButton
        icon="i-lucide-square"
        color="error"
        variant="soft"
        size="sm"
        @click="helper.stopGathering()"
      >
        停止
      </UButton>
    </div>
  </aside>
  <JobLibrary
    v-if="base.key === 'boss'"
    v-model:open="libraryOpen"
    :initial-funnel-stage="libraryFunnelStage"
    :initial-job-id="librarySelectedId"
  />
</template>
