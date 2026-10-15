<script lang="ts" setup>
import { ref, watch } from 'vue'

import type { ModelConf } from '@/composables/useModel'
import { selectAvailableModel, testModelConnection } from '@/composables/useModel/connection'
import type { ModelConnectionResult } from '@/composables/useModel/connection'
import type { OpenaiLLMConf } from '@/composables/useModel/openai'
import { counter } from '@/message'
import { jsonClone } from '@/utils/deepmerge'

import LLMForm from './LLMForm.vue'

const props = defineProps<{
  model?: ModelConf
  saving?: boolean
}>()
const emit = defineEmits<{ (e: 'create', data: ModelConf): void }>()

function color16() {
  const r = Math.floor(Math.random() * 256)
  const g = Math.floor(Math.random() * 256)
  const b = Math.floor(Math.random() * 256)
  const color = `#${r.toString(16)}${g.toString(16)}${b.toString(16)}`
  return color
}

const show = defineModel<boolean>({ required: true })
const createName = ref(props.model?.name || '')
const createColor = ref(props.model?.color || color16())
const connectionLoading = ref(false)
const connectionResult = ref<ModelConnectionResult>()
const availableModels = ref<string[]>([])

const llmFormData = ref(
  jsonClone(props.model?.data ?? ({ mode: 'openai', advanced: {}, other: {} } as OpenaiLLMConf)),
)
let connectionRevision = 0

async function fetchModelsThroughBackground(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const { signal: _signal, ...data } = init ?? {}
  const result = await counter.fetchText({
    url: String(input),
    data: { ...data, headers: Object.fromEntries(headers.entries()) },
    timeout: 10000,
  })
  return new Response(result.text, { status: result.status })
}

watch(
  () => [
    llmFormData.value.base_url,
    llmFormData.value.api_key,
    llmFormData.value.advanced?.extra_headers,
  ],
  () => {
    connectionRevision++
    availableModels.value = []
    connectionResult.value = undefined
  },
  { deep: true, flush: 'sync' },
)

async function testConnection() {
  if (connectionLoading.value || props.saving) return
  connectionLoading.value = true
  connectionResult.value = undefined
  const revision = connectionRevision
  const config = jsonClone(llmFormData.value)
  try {
    const result = await testModelConnection(config, fetchModelsThroughBackground)
    if (revision === connectionRevision) connectionResult.value = result
  } finally {
    connectionLoading.value = false
  }
}

async function getModels() {
  if (connectionLoading.value || props.saving) return
  connectionLoading.value = true
  connectionResult.value = undefined
  availableModels.value = []
  const revision = connectionRevision
  const config = jsonClone(llmFormData.value)
  try {
    const result = await testModelConnection(config, fetchModelsThroughBackground)
    if (revision !== connectionRevision) return
    connectionResult.value = result
    if (result.status === 'connected' && result.models?.length) {
      availableModels.value = result.models
      llmFormData.value.model = selectAvailableModel(llmFormData.value.model, result.models)
    }
  } finally {
    connectionLoading.value = false
  }
}

function create() {
  if (props.saving || connectionLoading.value) return
  const data: ModelConf = jsonClone(props.model || { name: '', key: '' })
  data.name = createName.value
  data.data = jsonClone(llmFormData.value) as ModelConf['data'] & {}
  data.data.mode = 'openai'
  data.color = createColor.value
  emit('create', data)
}

function cancel() {
  if (props.saving) return
  show.value = false
}
</script>

<template>
  <UModal
    v-model:open="show"
    :title="props.model ? '编辑 AI 模型' : '创建 AI 模型'"
    :ui="{
      overlay: 'z-[10008]',
      content: 'settings-modal z-[10009]',
      footer: 'justify-end flex-wrap',
    }"
    :dismissible="false"
    :close="!props.saving"
  >
    <template #body>
      <fieldset :disabled="props.saving" class="min-w-0 space-y-4">
        <UFormField label="模型名称" class="settings-field">
          <UInput v-model="createName" class="w-full" />
        </UFormField>
        <LLMForm
          v-model="llmFormData"
          :model-items="availableModels"
          :connection-loading="connectionLoading"
          @get-models="getModels"
        />
        <p
          v-if="connectionLoading || connectionResult"
          role="status"
          aria-live="polite"
          class="mt-4 text-sm"
          :class="
            connectionLoading
              ? 'text-muted'
              : connectionResult?.status === 'connected'
                ? 'text-success'
                : 'text-error'
          "
        >
          {{ connectionLoading ? '正在检测连接…' : connectionResult?.title }}
          <template v-if="!connectionLoading && connectionResult?.status === 'connected'">
            · {{ connectionResult.modelCount }} 个模型，未验证推理。
          </template>
        </p>
      </fieldset>
    </template>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton color="neutral" variant="outline" :disabled="props.saving" @click="cancel">
          取消
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plug"
          :loading="connectionLoading"
          :disabled="connectionLoading || props.saving"
          @click="testConnection"
        >
          连接测试
        </UButton>
        <UButton
          icon="i-lucide-save"
          :loading="props.saving"
          :disabled="props.saving || connectionLoading"
          @click="create"
        >
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
