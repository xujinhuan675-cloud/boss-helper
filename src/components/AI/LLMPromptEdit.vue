<script lang="ts" setup>
import type { TableColumn } from '@nuxt/ui'
import UBadge from '@nuxt/ui/components/Badge.vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import { h, reactive, ref } from 'vue'

import JobCard from '@/components/JobCard.vue'
import { formInfoData, defaultFormData, useConf } from '@/composables/conf'
import {
  DEFAULT_MATCH_THRESHOLD,
  MATCH_SCORING_VERSION,
  validateMatchThreshold,
} from '@/composables/useApplying/scoring'
import { parseFiltering } from '@/composables/useApplying/utils'
import type { JobData } from '@/composables/useHelper'
import { useHelper } from '@/composables/useHelper'
import type { Prompt } from '@/types/formData'
import { logger } from '@/utils/logger'

const props = defineProps<{
  data: 'aiGreeting' | 'aiFiltering' | 'aiReply'
}>()
const toast = useToast()
const helper = useHelper()
const conf = useConf()
const show = defineModel<boolean>({ required: true })

const score = ref(
  props.data === 'aiFiltering'
    ? (conf.formData[props.data].score ?? DEFAULT_MATCH_THRESHOLD)
    : DEFAULT_MATCH_THRESHOLD,
)

const role = ['system', 'user', 'assistant']

const message = ref<Prompt>(jsonClone(conf.formData[props.data].prompt))

function inputExample() {
  message.value = jsonClone(defaultFormData[props.data].prompt)
}

function removeMessage(item: Prompt[number]) {
  message.value = message.value.filter((v) => v !== item)
}

function addMessage() {
  message.value.push({ role: 'user', content: '' })
}

const testDialog = ref(false)

interface TestData {
  key: string
  job: JobData
  checked: boolean | string | number
  loading: boolean
}
interface TestContent {
  time: string
  reasoning_content?: string | null
  content?: string
}

const testData = reactive<Array<TestData>>([])
const testExpanded = ref<Record<string, boolean>>({})
const testDataContent = reactive<Record<string, TestContent[]>>({})

const testTableColumns: TableColumn<TestData>[] = [
  {
    id: 'expand',
    header: '',
    cell: ({ row }) =>
      h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        icon: 'i-lucide-chevron-down',
        square: true,
        size: 'xs',
        'aria-label': 'Expand',
        ui: {
          leadingIcon: [
            'transition-transform',
            row.getIsExpanded() ? 'duration-200 rotate-180' : '',
          ],
        },
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          row.toggleExpanded()
        },
      }),
  },
  {
    id: 'jobName',
    header: '岗位名',
    accessorFn: (row) => row.job.jobName,
    cell: ({ row }) =>
      h(
        UPopover,
        {
          mode: 'hover',
          portal: testModelRef.value?.parentElement ?? false,
        },
        {
          default: () =>
            h('div', { class: 'flex items-center gap-1' }, [
              row.original.loading
                ? h(UBadge, {
                    trailingIcon: 'i-line-md-loading-twotone-loop',
                    variant: 'soft',
                    color: 'neutral',
                  })
                : null,
              h('span', row.original.job.jobName),
            ]),
          content: () => h(JobCard, { job: row.original.job, hover: false, style: 'width: 300px' }),
        },
      ),
  },
  {
    id: 'jobDescription',
    header: '内容',
    accessorFn: (row) => row.job.jobDescription,
    cell: ({ row }) =>
      h(
        'div',
        {
          class: 'truncate',
          title: row.original.job.jobDescription,
        },
        row.original.job.jobDescription,
      ),
  },
]

const testJobLoading = ref(false)
const testJobStop = ref(true)

async function addTestJob(n: number) {
  testJobLoading.value = true
  try {
    let count = 0
    for (let item of helper.jobList.value) {
      if (testData.some((v) => v.job.key === item.key)) {
        continue
      }
      await helper.onJobCardClick(item.key) // 触发加载更多数据
      const data = helper.jobMaps.get(item.key)
      if (data) {
        item = data.jobData
      }
      testData.push({ key: item.key, job: item, checked: false, loading: false })
      testDataContent[item.key] = []
      count++
      if (count >= n) {
        break
      }
    }
  } finally {
    testJobLoading.value = false
  }
}

async function testJob() {
  if (!testJobStop.value) {
    testJobStop.value = true
    return
  }
  testJobLoading.value = true
  testJobStop.value = false
  try {
    if (
      !helper.chatModel.createAgent(
        {
          prompt: message.value,
          enable: true,
        },
        props.data === 'aiFiltering' ? 'filtering' : 'greetings',
        {
          json: props.data === 'aiFiltering',
        },
      )
    ) {
      throw new Error('AI模型未配置, 初始化失败')
    }
    const handle = async (item: TestData) => {
      if (testJobStop.value) {
        return
      }

      try {
        const content = await helper.chatModel
          .chat(
            props.data === 'aiFiltering' ? 'filtering' : 'greetings',
            {
              jobData: item.job,
              rawData: null,
              state: {},
            },
            {
              disableMessages: true,
            },
          )
          .then((r) => Promise.all([r.text, r.reasoningText]))
        if (props.data === 'aiFiltering' && content[0]) {
          const { message } = parseFiltering(content[0])
          content[0] = message ?? content[0]
        }
        ;(testDataContent[item.key] ??= []).push({
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          reasoning_content: content[1],
          content: content[0],
        })
      } catch (err: any) {
        logger.error('TestJobError', err)
        toast.add({
          title: err.message,
          color: 'error',
        })
      } finally {
        item.loading = false
      }
    }

    for (let i = 0; i < testData.length; i += 4) {
      const batch = testData.slice(i, i + 4)
      await Promise.all(batch.map(handle))
    }
  } catch (err: any) {
    logger.error('TestJobError', err)
    toast.add({
      title: err.message,
      color: 'error',
    })
  } finally {
    testJobLoading.value = false
    testJobStop.value = true
  }
}

async function savePrompt() {
  if (props.data === 'aiFiltering') {
    try {
      validateMatchThreshold(score.value)
    } catch (error) {
      toast.add({ title: String(error), color: 'error' })
      return
    }
  }
  conf.formData[props.data].prompt = message.value

  if (props.data === 'aiFiltering') {
    conf.formData[props.data].score = score.value
    conf.formData[props.data].scoringVersion = MATCH_SCORING_VERSION
  }
  await conf.confSaving()
  show.value = false
}

const testModelRef = useTemplateRef('testModel')
</script>

<template>
  <UModal
    v-model:open="show"
    :title="formInfoData[data].label"
    :ui="{
      overlay: 'z-[10006]',
      content: 'sm:max-w-[70%] z-[10007]',
      body: 'flex flex-col gap-4',
    }"
    :dismissible="false"
  >
    <template #body>
      <div v-if="data === 'aiFiltering'">
        <UFormField label="通过分数（满分 100）">
          <UInputNumber v-model="score" :min="0" :max="100" :step="1" size="sm" placeholder="70" />
        </UFormField>
      </div>
      <div class="w-full flex items-center justify-between">
        <div class="flex gap-2">
          <UButton color="neutral"> 多对话模式 </UButton>
          <UButton color="primary" @click="addMessage"> 添加消息 </UButton>
        </div>
        <div class="flex gap-2">
          <UButton color="info" @click="inputExample"> 填入示例值 </UButton>
        </div>
      </div>
      <div v-pre>
        使用 {{}} 来渲染变量。
        <ULink
          to="https://github.com/Ocyss/boss-helper/blob/master/src/types/bossData.d.ts"
          target="_blank"
        >
          变量表
        </ULink>
        <br />
        推荐阅读
        <ULink to="https://langgptai.feishu.cn/wiki/RXdbwRyASiShtDky381ciwFEnpe" target="_blank">
          《LangGPT》
        </ULink>
        的提示词文档学习 ( 示例提示词写的并不好,欢迎AI大佬来提pr )
      </div>
      <div class="demo-dynamic space-y-3">
        <div v-for="(item, index) in message" :key="index" class="flex items-start gap-2">
          <div class="flex flex-col gap-3 w-27.5">
            <USelectMenu
              v-model="item.role"
              :items="role"
              :portal="false"
              :content="{ side: 'right' }"
            />
            <UButton
              color="error"
              variant="outline"
              @click.prevent="removeMessage(item)"
              class="w-full"
            >
              删除
            </UButton>
          </div>
          <UTextarea v-model="item.content" autoresize :rows="2" :maxrows="6" class="flex-1" />
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        @click="
          () => {
            show = false
          }
        "
      >
        关闭
      </UButton>
      <UButton
        color="neutral"
        variant="soft"
        @click="
          () => {
            testDialog = true
          }
        "
      >
        测试
      </UButton>
      <UButton color="primary" @click="savePrompt"> 保存 </UButton>
    </template>
  </UModal>
  <USlideover
    v-model:open="testDialog"
    title="Prompt 测试"
    :ui="{ overlay: 'z-[10008]', content: 'max-w-lg z-[10009]' }"
  >
    <template #body>
      <div class="flex gap-2 mb-4" ref="testModel">
        <UButton :loading="testJobLoading" @click="addTestJob(1)" color="neutral">
          从页面添加1个岗位
        </UButton>
        <UButton :loading="testJobLoading" @click="addTestJob(4)" color="neutral">
          从页面添加4个岗位
        </UButton>
        <UButton :loading="testJobLoading" @click="addTestJob(10)" color="neutral">
          从页面添加10个岗位
        </UButton>
      </div>
      <div class="overflow-auto">
        <UTable
          v-model:expanded="testExpanded"
          :data="testData"
          :get-row-id="(row: TestData) => row.key"
          :columns="testTableColumns"
          :ui="{ tr: 'data-[expanded=true]:bg-elevated/40' }"
        >
          <template #expanded="{ row }">
            <div class="test-content-wrapper">
              <div class="test-content-list">
                <div
                  v-for="(item, index) in (testDataContent[row.original.key] ?? []).slice(-3)"
                  :key="`${row.original.key}-${item.time}-${index}`"
                  class="test-content-item"
                >
                  <div class="test-content-time">
                    {{ item.time }}
                  </div>

                  <div
                    v-if="item.reasoning_content"
                    class="test-content-reasoning-content"
                    :title="item.reasoning_content"
                  >
                    {{ item.reasoning_content }}
                  </div>
                  <div class="test-content-content" :title="item.content">
                    {{ item.content }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </UTable>
      </div>
    </template>
    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" @click="close"> 取消 </UButton>
      <UButton color="primary" @click="testJob">
        {{ testJobStop ? '开始测试' : '停止测试' }}
      </UButton>
    </template>
  </USlideover>
</template>
