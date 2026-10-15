<script setup lang="ts">
import type { AlertProps } from '@nuxt/ui/components/Alert.vue'
import { computed, onMounted, ref, useAttrs } from 'vue'

import { counter } from '@/message'

export interface ExtendedAlertProps extends /* @vue-ignore */ AlertProps {
  id?: string
  showIcon?: boolean
}

defineOptions({ inheritAttrs: false })
const declaredProps = withDefaults(defineProps<ExtendedAlertProps>(), { showIcon: true })
const attrs = useAttrs()
const props = computed(() => ({ ...attrs, ...declaredProps }) as ExtendedAlertProps)

const storageKey = computed(() => (props.value.id ? `local:alert:${props.value.id}` : ''))
const isVisible = ref(true)
const dismissed = ref(false)

onMounted(async () => {
  if (!storageKey.value) return
  try {
    const shouldHide = await counter.storageGet(storageKey.value, false)
    if (!dismissed.value) isVisible.value = !shouldHide
  } catch {
    // A failed read should not prevent the alert from rendering.
  }
})

const closeProp = computed(() =>
  props.value.close !== undefined ? props.value.close : props.value.id ? true : undefined,
)

const handleOpenChange = async (open: boolean) => {
  if (open) return
  dismissed.value = true
  isVisible.value = false
  if (storageKey.value) {
    try {
      await counter.storageSet(storageKey.value, true)
    } catch {
      // Dismissal remains local when persistence is unavailable.
    }
  }
}

const icon = computed(() => {
  if (props.value.icon) return props.value.icon
  if (props.value.showIcon === false) return null
  switch (props.value.color) {
    case 'success':
      return 'solar:check-circle-outline'
    case 'error':
      return 'solar:close-circle-outline'
    case 'warning':
      return 'solar:shield-warning-outline'
    default:
      return 'solar:info-circle-outline'
  }
})
</script>

<template>
  <UAlert
    v-if="isVisible"
    v-bind="props"
    :close="closeProp"
    @update:open="handleOpenChange"
    :icon="icon"
    :color="props.color ?? 'info'"
    :variant="props.variant ?? 'subtle'"
    :orientation="props.orientation ?? 'horizontal'"
  >
    <slot />
    <template #title>
      <slot name="title"></slot>
    </template>
    <template #description>
      <slot name="description"></slot>
    </template>
  </UAlert>
</template>
