<script lang="ts" setup>
import { formInfoData, useConf } from '@/composables/conf'

const conf = useConf()
const toast = useToast()

const amapGeocodeLoading = ref(false)

async function amapGeocodeHandler() {
  amapGeocodeLoading.value = true
  try {
    const res = await amapGeocode(conf.formData.amap.origins)
    if (res) {
      conf.formData.amap.origins = res.location
    } else {
      toast.add({
        title: '获取地址失败',
        color: 'error',
      })
      logger.error('AmapGeocodeError', res)
    }
  } catch (error) {
    toast.add({
      title: '获取地址失败',
      color: 'error',
    })
    logger.error('AmapGeocodeError', error)
  } finally {
    amapGeocodeLoading.value = false
  }
}

function gotoAmapDevSetting() {
  window.open('https://lbs.amap.com/dev/', '_blank')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Alert
      id="config-amap-2"
      show-icon
      type="info"
      title="使用高德地图前, 需自行创建key (每日免费配额足够使用)"
      description="创建路径: 创建应用 -> 添加key -> Web服务"
      :actions="[
        {
          label: '前往创建',
          color: 'primary',
          variant: 'subtle',
          onClick: gotoAmapDevSetting,
        },
      ]"
    >
    </Alert>
    <Alert
      id="config-amap-ai"
      :close="false"
      type="info"
      title="AI Prompt 参考如下语法(仅筛选可用):"
    >
      <template #description>
        <div class="grid grid-cols-2 gap-2">
          <span v-pre>最大直线距离: {{ amap.straightDistance }}km</span>
        </div>
      </template>
    </Alert>
    <div class="flex gap-3 items-center">
      <UFormField v-bind="formInfoData.amap.key">
        <UInput v-model="conf.formData.amap.key" />
      </UFormField>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <UFormField v-bind="formInfoData.amap.origins">
        <UFieldGroup>
          <UInput v-model="conf.formData.amap.origins" :disabled="amapGeocodeLoading" />
          <UButton
            color="primary"
            :loading="amapGeocodeLoading"
            @click="amapGeocodeHandler()"
            icon="solar:magnifer-bug-outline"
            title="根据完整地址获取经纬度"
          >
          </UButton>
        </UFieldGroup>
      </UFormField>
      <UFormField v-bind="formInfoData.amap.straightDistance">
        <UFieldGroup>
          <UInputNumber
            v-model="conf.formData.amap.straightDistance"
            :precision="1"
            :max="1000"
            :min="0"
            :step="1"
          />
          <UBadge label="km" />
        </UFieldGroup>
      </UFormField>
    </div>
  </div>
</template>
