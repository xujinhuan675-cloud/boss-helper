<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'

import Alert from '@/components/Alert.vue'
import { useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'
import type { FunnelStage } from '@/entrypoints/boss/jobStore'
import type { BossHelperCtx } from '@/entrypoints/boss/runtime'

const helper = useHelper()
const collectionBusy = computed(
  () =>
    'gatheringBusy' in helper &&
    ((helper as typeof helper & { gatheringBusy: { value: boolean } }).gatheringBusy.value ||
      ('savedAnalyzer' in helper &&
        (helper as typeof helper & { savedAnalyzer: { busy: { value: boolean } } }).savedAnalyzer
          .busy.value)),
)

const { todayData, statisticsData } = helper.statistics
const bossHelper = computed(() => (helper.key === 'boss' ? (helper as BossHelperCtx) : null))
const jobFunnel = computed(() => bossHelper.value?.jobLibrarySummary.value?.funnel ?? null)
const funnelStages = [
  { key: 'collected', label: '采集' },
  { key: 'matched', label: '匹配' },
  { key: 'applied', label: '投递' },
  { key: 'replied', label: '回复' },
  { key: 'interview', label: '面试' },
  { key: 'offer', label: 'Offer' },
] as const satisfies ReadonlyArray<{ key: FunnelStage; label: string }>

function openFunnelStage(stage: FunnelStage) {
  bossHelper.value?.openJobLibrary(stage)
}

// const { next, page } = usePager()
const conf = useConf()
const statisticCycle = ref(1)

const statisticCycleData = [
  {
    label: '近三日投递',
    help: '愿你每一次投递都能得到回应',
    date: 3,
  },
  {
    label: '本周投递',
    help: '愿你早日找到心满意足的工作',
    date: 7,
  },
  {
    label: '本月投递',
    help: '愿你在面试中得到满意的结果',
    date: 30,
  },
  {
    label: '历史投递',
    help: '愿你能早九晚五还双休带五险',
    date: -1,
  },
]

const cycle = computed(() => {
  const date = statisticCycleData[statisticCycle.value]?.date
  let ans = 0
  if (!date) return ans
  for (
    let i = 0;
    // eslint-disable-next-line no-unmodified-loop-condition
    (date === -1 || i < date - 1) && i < statisticsData.value.length;
    i++
  ) {
    ans += statisticsData.value[i]?.success ?? 0
  }
  return ans
})

onMounted(() => {
  void helper.statistics.updateStatistics()
  void bossHelper.value?.refreshJobLibrarySummary()
})
</script>

<template>
  <div class="flex gap-2 flex-col">
    <Alert
      id="config-statistics"
      description="数据并不完全准确，投递上限根据自身情况调整, 建议 120-140, boss限制最高150"
      color="warning"
      show-icon
    />
    <div v-if="conf.configLevel.intermediate" class="grid grid-cols-5 gap-4">
      <div data-help="统计当天脚本扫描过的所有岗位">
        <div class="text-sm text-gray-500">岗位总数：</div>
        <div class="text-2xl font-semibold">
          {{ todayData.total }} <span class="text-sm text-gray-400">份</span>
        </div>
      </div>
      <div data-help="统计当天岗位过滤的比例,被过滤/总数">
        <div class="text-sm text-gray-500">过滤比例：</div>
        <div class="text-2xl font-semibold">
          {{ (((todayData.total - todayData.success) / todayData.total) * 100).toFixed(0) }}
          <span class="text-sm text-gray-400">%</span>
        </div>
      </div>
      <div data-help="统计当天刷到了多少处理过的岗位,重复/总数">
        <div class="text-sm text-gray-500">重复比例：</div>
        <div class="text-2xl font-semibold">
          {{ ((todayData.repeat / todayData.total) * 100).toFixed(0) }}
          <span class="text-sm text-gray-400">%</span>
        </div>
      </div>
      <div data-help="统计当天岗位中的活跃情况,不活跃/总数">
        <div class="text-sm text-gray-500">活跃比例：</div>
        <div class="text-2xl font-semibold">
          {{ ((todayData.activityFilter / todayData.total) * 100).toFixed(0) }}
          <span class="text-sm text-gray-400">%</span>
        </div>
      </div>
      <div :data-help="statisticCycleData[statisticCycle]?.help">
        <UDropdownMenu
          :items="
            statisticCycleData.map((item, index) => ({
              label: item.label,
              onSelect: () => (statisticCycle = index),
            }))
          "
        >
          <div class="text-sm text-gray-500 cursor-pointer flex items-center gap-1">
            {{ statisticCycleData[statisticCycle]?.label }}:
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 1024 1024">
              <path
                fill="currentColor"
                d="M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.592 30.592 0 0 0-42.752 0z"
              />
            </svg>
          </div>
        </UDropdownMenu>
        <div class="text-2xl font-semibold">
          {{ cycle + todayData.success }}
          <span class="text-sm text-gray-400">份</span>
        </div>
      </div>
    </div>
    <section
      v-if="jobFunnel"
      class="border-t border-default pt-4"
      aria-labelledby="job-funnel-title"
    >
      <div class="flex items-center justify-between gap-2 mb-3">
        <h3 id="job-funnel-title" class="text-sm font-semibold">岗位漏斗</h3>
        <span class="text-xs text-muted">本地岗位库</span>
      </div>
      <ol class="grid grid-cols-2 md:grid-cols-6 gap-3" aria-label="岗位处理漏斗">
        <li v-for="stage in funnelStages" :key="stage.key" class="min-w-0">
          <button
            type="button"
            class="w-full text-left rounded-sm p-1 -m-1 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :aria-label="`查看${stage.label}阶段岗位，共${jobFunnel[stage.key]}条`"
            @click="openFunnelStage(stage.key)"
          >
            <div class="text-xs text-muted">
              {{ stage.label }}
              <span
                v-if="stage.key === 'collected' && jobFunnel.collectedToday"
                class="text-primary"
              >
                +{{ jobFunnel.collectedToday }}
              </span>
              <span
                v-else-if="stage.key === 'matched' && jobFunnel.matchedToday"
                class="text-primary"
              >
                +{{ jobFunnel.matchedToday }}
              </span>
            </div>
            <div class="text-xl font-semibold tabular-nums">{{ jobFunnel[stage.key] }}</div>
            <UProgress
              :model-value="
                jobFunnel.collected ? (jobFunnel[stage.key] / jobFunnel.collected) * 100 : 0
              "
              size="xs"
              color="primary"
              :aria-label="`${stage.label} ${jobFunnel[stage.key]}`"
            />
          </button>
        </li>
      </ol>
      <p class="text-xs text-muted mt-3">
        点击阶段可打开对应岗位列表；回复默认复用 BOSS 的“已沟通”状态，面试和 Offer
        可在岗位库详情中手动设置。
      </p>
    </section>
    <div class="flex flex-row gap-2 items-center justify-center">
      <UFieldGroup>
        <UButton
          color="primary"
          data-help="点击开始投递就会开始投递"
          :loading="helper.workflow?.status.value === 'running'"
          :disabled="collectionBusy"
          @click="helper.start()"
        >
          {{ helper.workflow?.status.value === 'stop' ? '继续' : '开始投递' }}
        </UButton>
        <UButton
          v-if="helper.workflow?.status.value === 'stop'"
          :disabled="collectionBusy"
          color="warning"
          data-help="重置已被筛选的岗位，开始将重新处理"
          @click="helper.reset()"
        >
          重置筛选
        </UButton>
        <UButton
          v-if="helper.workflow?.status.value === 'running'"
          color="warning"
          data-help="暂停后应该能继续"
          @click="helper.stop()"
        >
          暂停
        </UButton>
      </UFieldGroup>
      <UProgress
        data-help="我会统计当天脚本投递的数量,该记录并不准确"
        class="flex-1"
        :model-value="(todayData.success / conf.formData.deliveryLimit.value) * 100"
      />
    </div>
  </div>
</template>

<style lang="scss"></style>
