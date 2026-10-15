<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'

import { useHelper } from '@/composables/useHelper'
import type { BossHelperCtx } from '@/entrypoints/boss/runtime'
import { isSavedJobEligible } from '@/entrypoints/boss/savedAnalysis'
import type { SavedAnalysisRun } from '@/entrypoints/boss/savedAnalysis'

const emit = defineEmits<{ completed: [run: SavedAnalysisRun] }>()
const base = useHelper()
const helper = base as BossHelperCtx
const limit = ref(20)
const available = ref<number | null>(null)
const reading = ref(false)
const readError = ref('')
const actionError = ref('')
const analyzer = helper.savedAnalyzer
const busy = computed(() => analyzer.busy.value)
const run = computed(() => analyzer.run.value)
const isCompleteModel = (model: (typeof base.models.modelData.value)[number] | undefined) =>
  [model?.data?.api_key, model?.data?.base_url, model?.data?.model].every(
    (field) => typeof field === 'string' && !!field.trim(),
  )
const defaultModelKey = () =>
  base.models.getDefaultModelKey?.() ??
  base.models.modelData.value.find(isCompleteModel)?.key ??
  base.models.modelData.value[0]?.key
const modelKey = computed(defaultModelKey)
const selectedModel = computed(() =>
  base.models.modelData.value.find((model) => model.key === modelKey.value),
)
const currentResumeText = computed(() => base.resumes.currentResume.value?.content.trim() ?? '')
const blocked = computed(
  () =>
    busy.value ||
    helper.gatheringBusy.value ||
    helper.realtimeBusy.value ||
    helper.hasPendingCollectionStorage ||
    base.workflowRunning.value,
)
const startDisabledReason = computed(() => {
  if (busy.value) return '本地岗位分析正在进行'
  if (reading.value) return '正在读取岗位库'
  if (readError.value) return `岗位库读取失败：${readError.value}`
  if (available.value === null) return '等待岗位库读取完成'
  if (!available.value) return '没有包含完整 JD 的待分析岗位'
  if (!Number.isSafeInteger(limit.value) || limit.value < 1) return '本批数量必须是正整数'
  if (!selectedModel.value) return '请先在模型配置中保存模型'
  if (!isCompleteModel(selectedModel.value))
    return '当前模型配置不完整，请补齐接口地址、API Key 和模型 ID'
  if (!currentResumeText.value) return '请先在简历页选择并保存完整简历'
  if (helper.gatheringBusy.value) return '采集或详情补全正在进行'
  if (helper.realtimeBusy.value) return '实时投递正在进行'
  if (helper.hasPendingCollectionStorage) return '岗位库保存尚未完成'
  if (base.workflowRunning.value) return '已有自动化任务正在进行'
  return ''
})
const statusLabels = {
  running: '分析中',
  stopping: '停止中，等待当前模型请求结束',
  stopped: '已停止',
  completed: '本批完成',
  failed: '本批失败',
}

async function refreshCount() {
  if (reading.value) return
  reading.value = true
  readError.value = ''
  try {
    available.value = (await helper.getJobLibrary()).filter(isSavedJobEligible).length
  } catch (error) {
    available.value = null
    readError.value = error instanceof Error ? error.message : String(error)
  } finally {
    reading.value = false
  }
}

async function start() {
  const disabledReason = startDisabledReason.value
  if (disabledReason) {
    actionError.value = disabledReason
    return
  }
  actionError.value = ''
  try {
    const completedRun = await analyzer.start({
      modelKey: modelKey.value,
      limit: limit.value,
    })
    await refreshCount()
    emit('completed', completedRun)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void refreshCount()
})
</script>

<template>
  <section
    v-if="base.key === 'boss'"
    class="job-library-analysis border-b border-default pb-3 space-y-3"
    aria-label="本地岗位批量分析"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-base font-semibold">本地岗位批量分析</h3>
      <div class="flex items-center gap-1 text-xs text-muted">
        <span>完整 JD 待分析 {{ available ?? '未读取' }}</span>
        <UTooltip text="读取待分析数量" :ui="{ content: 'z-[10004]' }">
          <UButton
            icon="i-lucide-refresh-cw"
            aria-label="读取待分析数量"
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="reading"
            :disabled="reading || busy"
            @click="void refreshCount()"
          />
        </UTooltip>
      </div>
    </div>
    <div class="job-library-analysis-fields">
      <UFormField label="当前模型" orientation="vertical" class="min-w-0">
        <div class="text-sm text-muted py-2">{{ selectedModel?.name ?? '未配置' }}</div>
      </UFormField>
      <UFormField label="本批数量" orientation="vertical" class="min-w-0">
        <UInputNumber
          v-model="limit"
          :min="1"
          :step="1"
          aria-label="本批分析数量"
          class="w-full"
          :disabled="blocked"
        />
      </UFormField>
      <UButton
        v-if="!busy"
        icon="i-lucide-play"
        :disabled="!!startDisabledReason"
        @click="void start()"
      >
        开始分析
      </UButton>
      <UButton
        v-else
        icon="i-lucide-square"
        color="warning"
        :disabled="run?.status === 'stopping'"
        @click="analyzer.stop()"
      >
        {{ run?.status === 'stopping' ? '停止中' : '停止分析' }}
      </UButton>
    </div>
    <p v-if="startDisabledReason && !busy" class="text-xs text-warning break-words" role="status">
      {{ startDisabledReason }}
    </p>
    <div v-if="run" class="space-y-1 text-sm" role="status" aria-live="polite">
      <div>{{ statusLabels[run.status] }}</div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span>本批 {{ run.total }}</span>
        <span>已保存 {{ run.completed }}</span>
        <span>失败 {{ run.failed }}</span>
        <span>跳过 {{ run.skipped }}</span>
      </div>
      <div v-if="run.currentJob" class="text-xs text-muted break-words">{{ run.currentJob }}</div>
    </div>
    <div v-if="actionError || run?.error" class="text-sm text-error break-words" role="alert">
      {{ actionError || run?.error }}
    </div>
  </section>
</template>
