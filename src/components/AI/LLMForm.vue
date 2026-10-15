<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue'

import type { ModelConfData } from '@/composables/useModel'
import { openai } from '@/composables/useModel/openai'

const formData = defineModel<ModelConfData>({ required: true })
const props = defineProps<{ modelItems?: string[]; connectionLoading?: boolean }>()
const emit = defineEmits<{ (e: 'getModels'): void }>()

const llmFormRef = useTemplateRef('LLMFormRef')

const modelPlaceholder = computed(() => {
  const config = openai.info.model.config
  return config && 'placeholder' in config ? config.placeholder : undefined
})
</script>

<template>
  <div class="space-y-4" ref="LLMFormRef">
    <UFormField label="API 地址" required class="settings-field">
      <UInput v-model="formData.base_url" placeholder="https://api.openai.com/v1" class="w-full" />
    </UFormField>
    <UFormField label="API Key" required class="settings-field">
      <UInput v-model="formData.api_key" type="password" autocomplete="off" class="w-full" />
    </UFormField>
    <UFormField label="Model" required class="settings-field">
      <div class="flex items-start gap-2 max-sm:flex-col">
        <UInputMenu
          v-if="props.modelItems?.length"
          v-model="formData.model"
          :items="props.modelItems"
          :placeholder="modelPlaceholder"
          :portal="llmFormRef ?? undefined"
          :clear="false"
          class="min-w-0 flex-1 w-full"
          create-item
          @create="formData.model = $event"
        />
        <UInput
          v-else
          v-model="formData.model"
          :placeholder="modelPlaceholder"
          class="min-w-0 flex-1 w-full"
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          :loading="props.connectionLoading"
          :disabled="props.connectionLoading"
          class="shrink-0"
          @click="emit('getModels')"
        >
          获取模型
        </UButton>
      </div>
    </UFormField>
  </div>
</template>
