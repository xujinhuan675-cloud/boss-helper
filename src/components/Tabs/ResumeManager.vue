<script lang="ts" setup>
import { computed, ref } from 'vue'

import { useResumes } from '@/composables/useResume'
import type { ResumeRecord } from '@/composables/useResume'

const store = useResumes()
const editingId = ref<string | null>(null)
const name = ref('')
const content = ref('')
const saving = ref(false)
const disabled = computed(() => saving.value || !store.initialized.value)
const actionError = ref('')
const deleteOpen = ref(false)
const deleteId = ref<string | null>(null)
const replacementId = ref('__none__')

const editing = computed(() => store.resumes.value.find((resume) => resume.id === editingId.value))
const replacementOptions = computed(() => [
  { label: '进入无简历状态', value: '__none__' },
  ...store.resumes.value
    .filter((resume) => resume.id !== deleteId.value)
    .map((resume) => ({ label: resume.name, value: resume.id })),
])

function resetEditor() {
  if (saving.value) return
  editingId.value = null
  name.value = ''
  content.value = ''
  actionError.value = ''
}

function editResume(resume: ResumeRecord) {
  if (saving.value) return
  editingId.value = resume.id
  name.value = resume.name
  content.value = resume.content
  actionError.value = ''
}

async function saveResume() {
  if (disabled.value) return
  saving.value = true
  actionError.value = ''
  try {
    if (editingId.value) await store.updateResume(editingId.value, name.value, content.value)
    else await store.createResume(name.value, content.value)
    saving.value = false
    resetEditor()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

async function copyResume(resume: ResumeRecord) {
  if (disabled.value) return
  saving.value = true
  actionError.value = ''
  try {
    await store.copyResume(resume.id)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

async function selectResume(id: string) {
  if (disabled.value) return
  saving.value = true
  actionError.value = ''
  try {
    await store.selectResume(id)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

function requestDelete(resume: ResumeRecord) {
  if (disabled.value) return
  deleteId.value = resume.id
  replacementId.value = '__none__'
  if (store.currentResumeId.value === resume.id) {
    deleteOpen.value = true
    return
  }
  void confirmDelete()
}

async function confirmDelete() {
  if (!deleteId.value || disabled.value) return
  saving.value = true
  actionError.value = ''
  try {
    const replacement =
      store.currentResumeId.value === deleteId.value
        ? replacementId.value === '__none__'
          ? null
          : replacementId.value
        : undefined
    await store.deleteResume(deleteId.value, replacement)
    saving.value = false
    deleteOpen.value = false
    if (editingId.value === deleteId.value) resetEditor()
    deleteId.value = null
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-4" aria-label="求职者资料">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-lg font-semibold">求职者资料</h2>
        <span v-if="!store.currentResume.value" class="text-sm text-muted">当前未使用简历</span>
      </div>
      <UButton
        icon="i-lucide-file-plus-2"
        color="primary"
        :disabled="disabled"
        @click="resetEditor"
      >
        新建简历
      </UButton>
    </div>

    <div
      v-if="!store.resumes.value.length"
      class="rounded-md border border-dashed border-default p-4 text-sm text-muted"
    >
      还没有简历。请粘贴一份完整简历正文后保存。
    </div>

    <div v-else class="overflow-hidden rounded-md border border-default divide-y divide-default">
      <div
        v-for="resume in store.resumes.value"
        :key="resume.id"
        class="flex flex-wrap items-center justify-between gap-3 p-3 transition-colors hover:bg-elevated"
        :class="store.currentResumeId.value === resume.id ? 'bg-primary/5' : 'bg-default'"
      >
        <button
          type="button"
          class="min-w-0 flex-1 text-left disabled:opacity-60"
          :disabled="disabled"
          :aria-pressed="store.currentResumeId.value === resume.id"
          @click="void selectResume(resume.id)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-medium break-words min-w-0">{{ resume.name }}</span>
            <UBadge
              v-if="store.currentResumeId.value === resume.id"
              color="primary"
              variant="soft"
              class="shrink-0"
            >
              当前使用
            </UBadge>
          </div>
          <div class="text-xs text-muted">
            更新于 {{ new Date(resume.updatedAt).toLocaleString() }}
          </div>
        </button>
        <div class="flex items-center gap-1">
          <UTooltip text="编辑简历">
            <UButton
              icon="i-lucide-pencil"
              aria-label="编辑简历"
              size="sm"
              color="neutral"
              variant="ghost"
              :disabled="disabled"
              @click="editResume(resume)"
            />
          </UTooltip>
          <UTooltip text="复制简历">
            <UButton
              icon="i-lucide-copy"
              aria-label="复制简历"
              size="sm"
              color="neutral"
              variant="ghost"
              :disabled="disabled"
              @click="void copyResume(resume)"
            />
          </UTooltip>
          <UTooltip text="删除简历">
            <UButton
              icon="i-lucide-trash-2"
              aria-label="删除简历"
              size="sm"
              color="error"
              variant="ghost"
              :disabled="disabled"
              @click="requestDelete(resume)"
            />
          </UTooltip>
        </div>
      </div>
    </div>

    <div class="border-t border-default pt-4 space-y-4">
      <h3 class="text-base font-semibold">{{ editing ? '编辑简历' : '新建简历' }}</h3>
      <UFormField label="简历名称" class="settings-field">
        <UInput
          v-model="name"
          placeholder="例如：AI 产品经理主简历"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>
      <UFormField label="完整简历正文" class="settings-field">
        <UTextarea
          v-model="content"
          :rows="12"
          class="w-full"
          :disabled="disabled"
          placeholder="请粘贴完整简历正文"
        />
      </UFormField>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="outline" :disabled="disabled" @click="resetEditor"
          >清空编辑</UButton
        >
        <UButton
          icon="i-lucide-save"
          color="primary"
          :loading="saving"
          :disabled="disabled"
          @click="void saveResume"
          >保存简历</UButton
        >
      </div>
    </div>

    <p v-if="actionError" class="text-sm text-error" role="alert">{{ actionError }}</p>

    <UModal
      v-model:open="deleteOpen"
      title="删除当前简历"
      :dismissible="false"
      :close="!saving"
      :ui="{ overlay: 'z-[10006]', content: 'settings-modal z-[10007]' }"
    >
      <template #body>
        <p class="text-sm">
          当前简历正在被后续 AI 请求使用。请选择替代简历，或明确进入无简历状态。
        </p>
        <UFormField label="删除后使用" class="mt-4 settings-field">
          <USelectMenu
            v-model="replacementId"
            :items="replacementOptions"
            value-key="value"
            class="w-full"
            :disabled="saving"
            :ui="{ content: 'z-[10010]' }"
          />
        </UFormField>
        <p v-if="actionError" class="text-sm text-error mt-3" role="alert">{{ actionError }}</p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" :disabled="saving" @click="deleteOpen = false"
          >取消</UButton
        >
        <UButton color="error" :loading="saving" :disabled="saving" @click="void confirmDelete"
          >删除</UButton
        >
      </template>
    </UModal>
  </section>
</template>
