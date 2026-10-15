<script lang="ts" setup>
import { ref } from 'vue'

import type { ModelConf } from '@/composables/useModel'
import { useModel } from '@/composables/useModel'
import { isPlainObject, jsonClone } from '@/utils/deepmerge'
import { exportJson, importJson } from '@/utils/jsonImportExport'

import CreateLLM from './LLMModelEdit.vue'

const modelStore = useModel()
const createBoxShow = ref(false)
const toast = useToast()
const open = ref(false)
const saving = ref(false)

async function persist(models: ModelConf[]) {
  if (saving.value) return false
  saving.value = true
  try {
    await modelStore.saveModel(models)
    return true
  } catch {
    toast.add({ title: '模型保存失败，输入已保留，请重试', color: 'error' })
    return false
  } finally {
    saving.value = false
  }
}

async function del(d: ModelConf) {
  await persist(modelStore.modelData.value.filter((v) => d.key !== v.key))
}

async function copy(d: ModelConf) {
  if (saving.value) return
  d = jsonClone(d)
  d.key = crypto.randomUUID()
  d.name = `${d.name} 副本`
  await persist([...modelStore.modelData.value, d])
}

const createModelData = ref()

function edit(d: ModelConf) {
  if (saving.value) return
  createModelData.value = d
  createBoxShow.value = true
}

function newllm() {
  if (saving.value) return
  createModelData.value = undefined
  createBoxShow.value = true
}

async function create(d: ModelConf) {
  if (saving.value) return
  const models = jsonClone(modelStore.modelData.value)
  const index = models.findIndex((v) => v.key === d.key)
  const next = jsonClone(d)
  if (index >= 0) models[index] = next
  else models.push({ ...next, key: crypto.randomUUID() })
  if (await persist(models)) createBoxShow.value = false
}
function close() {
  if (saving.value) return
  open.value = false
}

function exportllm() {
  exportJson(jsonClone(modelStore.modelData.value), 'Ai模型配置')
}

async function importllm() {
  if (saving.value) return
  const data = await importJson<ModelConf[]>()
  if (
    !Array.isArray(data) ||
    data.some(
      (model) =>
        !model ||
        typeof model.key !== 'string' ||
        !model.key.trim() ||
        typeof model.name !== 'string' ||
        (model.data !== undefined &&
          (!isPlainObject(model.data) ||
            (['mode', 'avatar', 'api_key', 'base_url', 'model'] as const).some(
              (field) => model.data![field] !== undefined && typeof model.data![field] !== 'string',
            ) ||
            (['advanced', 'other'] as const).some(
              (field) => model.data![field] !== undefined && !isPlainObject(model.data![field]),
            ) ||
            (model.data.responses !== undefined && typeof model.data.responses !== 'boolean'))),
    )
  ) {
    toast.add({ title: '模型配置文件格式无效，未修改现有配置', color: 'error' })
    return
  }
  await persist(data)
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="AI 模型配置"
    :ui="{
      overlay: 'z-[10006]',
      content: 'settings-modal z-[10007]',
      footer: 'justify-end flex-wrap',
    }"
    ref="manageModelRef"
    :dismissible="false"
    :close="saving ? false : undefined"
  >
    <slot />
    <template #body>
      <div class="overflow-hidden rounded-md border border-default">
        <UTable
          :data="modelStore.modelData.value"
          :columns="[
            { id: 'model', header: '模型' },
            { id: 'desc', header: 'API 地址' },
            { id: 'manage', header: '管理' },
          ]"
          class="w-full"
        >
          <template #model-cell="{ row }">
            <div class="flex items-center gap-2 min-w-0">
              <UAvatar :src="row.original.data?.avatar" :alt="row.original.name" />
              <span class="break-words">{{ row.original.name }}</span>
              <UBadge
                v-if="row.original.key === modelStore.getDefaultModelKey()"
                color="primary"
                variant="soft"
                class="shrink-0"
                >当前模型</UBadge
              >
            </div>
          </template>
          <template #desc-cell="{ row }">
            <p class="max-w-64 truncate" :title="row.original.data?.base_url">
              {{ row.original.data && row.original.data.base_url }}
            </p>
          </template>
          <template #manage-cell="{ row }">
            <div class="flex flex-wrap items-center gap-1">
              <UTooltip text="编辑模型" :ui="{ content: 'z-[10010]' }">
                <UButton
                  icon="i-lucide-pencil"
                  aria-label="编辑模型"
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  :disabled="saving"
                  @click="edit(row.original)"
                />
              </UTooltip>
              <UTooltip text="复制模型" :ui="{ content: 'z-[10010]' }">
                <UButton
                  icon="i-lucide-copy"
                  aria-label="复制模型"
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  :disabled="saving"
                  @click="copy(row.original)"
                />
              </UTooltip>
              <UTooltip text="删除模型" :ui="{ content: 'z-[10010]' }">
                <UButton
                  icon="i-lucide-trash-2"
                  aria-label="删除模型"
                  variant="ghost"
                  color="error"
                  size="sm"
                  :disabled="saving"
                  @click="del(row.original)"
                />
              </UTooltip>
            </div>
          </template>
        </UTable>
      </div>
      <CreateLLM
        v-if="createBoxShow"
        v-model="createBoxShow"
        :model="createModelData"
        :saving="saving"
        @create="create"
      />
    </template>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton color="neutral" variant="outline" :disabled="saving" @click="close">
          关闭
        </UButton>
        <UButton icon="i-lucide-download" color="neutral" variant="outline" @click="exportllm">
          导出
        </UButton>
        <UButton
          icon="i-lucide-upload"
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="importllm"
        >
          导入
        </UButton>
        <UButton icon="i-lucide-plus" :disabled="saving" @click="newllm"> 新建模型 </UButton>
      </div>
    </template>
  </UModal>
</template>
