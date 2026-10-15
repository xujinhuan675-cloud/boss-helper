<script setup lang="ts">
import { computed, ref } from 'vue'

import type { JobStatus } from '@/composables/useApplying/type'
import type { JobData } from '@/composables/useHelper'
import { useHelper } from '@/composables/useHelper'
import type { BossHelperCtx } from '@/entrypoints/boss/runtime'

const helper = useHelper()

const props = defineProps<{
  job: JobData
  hover?: boolean
  quickActions?: boolean
}>()

const bossHelper = helper as BossHelperCtx
const quickActionBusy = ref('')
const actionMessage = ref('')
const savedGreeting = ref('')
const jobId = computed(() => props.job.key.replace(/^boss::/, ''))

const jobResult = computed(() => {
  return helper.jobResultMaps.get(props.job.key)
})

const stateMaps: Record<JobStatus, string> = {
  pending: '#CECECE',
  wait: '#CECECE',
  error: '#e74c3c',
  warn: '#f39c12',
  success: '#2ecc71',
  running: '#98F5F9',
  request: '#3498db',
  ai: '#9b59b6',
}

const jobStatus = computed(() => {
  const status = jobResult.value?.status ?? 'pending'
  const data = stateMaps[status]
  return {
    status,
    color: data,
    show: jobResult.value?.status !== 'pending' ? 'flex' : 'none',
  }
})

const showDescription = ref(false)
const showDescriptionLoading = ref(false)
const showDescriptionMessage = ref<string | null>(null)

async function showDescriptionHandler() {
  showDescription.value = true
  showDescriptionLoading.value = true
  showDescriptionMessage.value = null
  try {
    await helper.onJobCardClick(props.job.key)
  } catch (e) {
    console.error('showDescriptionHandler error', e)
    showDescriptionMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    showDescriptionLoading.value = false
  }
}

async function readSavedRecord() {
  return (await bossHelper.getJobLibrary()).find((record) => record.encryptJobId === jobId.value)
}

async function prepareSavedJob() {
  let record = await readSavedRecord()
  if (!record) {
    record = await bossHelper.captureJobSnapshot(props.job.key)
  }
  if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim()) {
    record = await bossHelper.ensureSavedJobDetails(jobId.value)
  }
  if (record.detailStatus !== 'complete' || !record.detail?.jobInfo?.postDescription?.trim()) {
    throw new Error('岗位详情尚未补全')
  }
  return record
}

async function analyzeJob() {
  if (quickActionBusy.value) return
  quickActionBusy.value = 'analyze'
  actionMessage.value = ''
  try {
    await prepareSavedJob()
    const result = await bossHelper.savedAnalyzer.analyzeOne(jobId.value)
    const record = await readSavedRecord()
    savedGreeting.value = record?.finalGreeting?.trim() ?? ''
    actionMessage.value = result.status === 'failed' ? result.error || '分析失败' : '分析完成'
    if (result.status !== 'failed') bossHelper.openJobLibrary(null, jobId.value)
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    quickActionBusy.value = ''
  }
}

async function copyGreeting() {
  if (quickActionBusy.value) return
  quickActionBusy.value = 'copy'
  actionMessage.value = ''
  try {
    const record = await readSavedRecord()
    savedGreeting.value = record?.finalGreeting?.trim() ?? savedGreeting.value
    if (!savedGreeting.value) throw new Error('该岗位暂无已保存招呼语')
    if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板')
    await navigator.clipboard.writeText(savedGreeting.value)
    actionMessage.value = '已复制招呼语'
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    quickActionBusy.value = ''
  }
}

async function sendGreeting() {
  if (quickActionBusy.value) return
  quickActionBusy.value = 'send'
  actionMessage.value = ''
  try {
    const record = await readSavedRecord()
    savedGreeting.value = record?.finalGreeting?.trim() ?? savedGreeting.value
    if (!savedGreeting.value) throw new Error('该岗位暂无已保存招呼语')
    await bossHelper.sendSavedGreeting(jobId.value)
    actionMessage.value = '已发送招呼语'
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    quickActionBusy.value = ''
  }
}

function getActiveTimeType(job: JobData): 'success' | 'warning' | 'error' {
  const activeTime = job.activeTime
  if (!activeTime) return 'error'

  const now = Date.now()
  const diffDays = (now - activeTime) / (1000 * 60 * 60 * 24)

  if (diffDays <= 2) return 'success'
  if (diffDays <= 7) return 'warning'
  return 'error'
}
</script>

<template>
  <div
    class="job-card"
    :class="{ 'job-card-hover': hover }"
    :style="{
      '--state-color': jobStatus.color,
      '--state-show': jobStatus.show,
    }"
    v-if="job"
  >
    <div class="card-tag">{{ job.brand.industry }},{{ job.degreeName }},{{ job.brand.scale }}</div>
    <!-- `https://www.zhipin.com/job_detail/${job.encryptJobId}.html`" -->
    <a :href="job.link" target="_blank" class="card-title">
      {{ job.jobName }}
    </a>
    <h3 class="card-salary">
      {{ job.salary }}
    </h3>
    <div
      v-show="showDescription"
      class="card-content"
      :title="job.jobDescription"
      @click="showDescription = false"
    >
      <template v-if="showDescriptionLoading">
        加载中...
        <USkeleton class="h-4 w-full" />
        <USkeleton class="h-4 w-4/5" />
      </template>
      <template v-else-if="showDescriptionMessage">
        {{ showDescriptionMessage }}
      </template>
      <template v-else>
        {{ job.jobDescription }}
      </template>
    </div>
    <div v-show="!showDescription" class="card-content" @click="showDescriptionHandler">
      <div>
        <div class="flex flex-wrap gap-1">
          <UBadge v-for="tag in job.skills" :key="tag" size="sm" variant="subtle" color="warning">
            {{ tag }}
          </UBadge>
          <UBadge
            v-for="tag in job.jobLabels"
            :key="tag"
            size="sm"
            variant="subtle"
            color="success"
          >
            {{ tag }}
          </UBadge>
        </div>
      </div>
      <div class="card-footer" v-if="job.welfareList && job.welfareList.length > 0">
        {{ job.welfareList.join(',') }}
      </div>
    </div>

    <div v-if="job.activeTime || job.activeTimeStr" class="active-time-tag">
      <UBadge :color="getActiveTimeType(job)" variant="subtle">
        活跃时间：{{
          job.activeTime
            ? `${new Date(job.activeTime).toLocaleString('zh')}${job.activeTimeStr ? ` (${job.activeTimeStr})` : ''}`
            : job.activeTimeStr
        }}
      </UBadge>
    </div>

    <div class="author-row">
      <img alt="" class="avatar" height="80" :src="job.brand.logo" width="80" />
      <div>
        <span class="company-name">{{ job.brand.name }}</span>
        <!-- <h4>{{ job.cityName }}/{{ job.areaDistrict }}/{{ job.businessDistrict }}</h4> -->
        <h4>{{ job.address }}</h4>
      </div>
    </div>
    <div
      v-if="quickActions"
      class="flex flex-wrap items-center justify-center gap-1 px-2 pb-2"
      @click.stop
    >
      <UButton
        icon="i-lucide-scan-search"
        size="xs"
        color="primary"
        variant="soft"
        :loading="quickActionBusy === 'analyze'"
        :disabled="!!quickActionBusy"
        @click.stop="void analyzeJob()"
      >
        开始分析
      </UButton>
      <UButton
        icon="i-lucide-copy"
        size="xs"
        color="neutral"
        variant="outline"
        :loading="quickActionBusy === 'copy'"
        :disabled="!!quickActionBusy"
        @click.stop="void copyGreeting()"
      >
        复制招呼语
      </UButton>
      <UButton
        icon="i-lucide-send"
        size="xs"
        color="success"
        variant="soft"
        :loading="quickActionBusy === 'send'"
        :disabled="!!quickActionBusy"
        @click.stop="void sendGreeting()"
      >
        发送招呼语
      </UButton>
      <span v-if="actionMessage" class="w-full text-center text-xs text-muted break-words">
        {{ actionMessage }}
      </span>
    </div>
    <div
      class="card-status flex-row gap-2 justify-center items-center"
      v-if="jobResult"
      :title="jobResult?.reason || jobResult?.msg"
    >
      <UIcon v-if="jobStatus.status === 'running'" name="i-line-md-loading-twotone-loop" />
      <UIcon v-else-if="jobStatus.status === 'request'" name="i-svg-spinners-wifi-fade" />
      <UIcon v-else-if="jobStatus.status === 'ai'" name="i-line-md-hazard-lights-loop" />
      {{ jobResult?.msg || jobResult?.reason || '无内容' }}
    </div>
  </div>
</template>
