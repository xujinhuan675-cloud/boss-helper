<script lang="ts" setup>
defineProps<{
  label: string
  help?: string
  disabled?: boolean
}>()
</script>

<template>
  <UFormField :data-help="help" :title="help">
    <template #label>{{ label }}排除关键词</template>
    <slot />
  </UFormField>
</template>
