import { ref } from 'vue'

import { counter } from '@/message'
import { jsonClone } from '@/utils/deepmerge'

import type { OpenaiLLMConf } from './openai'
import { openai } from './openai'

export * from './chatModel'

const toast = useToast()
export const confModelKey = 'conf-model'
export const llms = [openai.info]

export type ModelConfData = OpenaiLLMConf

export interface ModelConf {
  key: string
  name: string
  color?: string
  data?: ModelConfData
  // vip?: {
  //   description: string
  //   price: {
  //     input: string
  //     output: string
  //   }
  // }
}

export function isCompleteModel(
  model: ModelConf | undefined,
): model is ModelConf & { data: ModelConfData } {
  return (
    !!model?.data &&
    [model.data.api_key, model.data.base_url, model.data.model].every(
      (field) => typeof field === 'string' && !!field.trim(),
    )
  )
}

const modelData = ref<ModelConf[]>([])
let revision = 0

export const useModel = () => {
  async function init() {
    const readingRevision = revision
    const data = await counter.storageGet<ModelConf[]>(confModelKey, [])
    if (readingRevision === revision) modelData.value = data
  }

  async function save(models: ModelConf[] = modelData.value) {
    const snapshot = jsonClone(models)
    await counter.storageSet(confModelKey, snapshot)
    revision++
    modelData.value = snapshot
    toast.add({
      title: '保存成功',
      color: 'success',
    })
  }

  function getDefaultModelKey() {
    return modelData.value.find(isCompleteModel)?.key ?? modelData.value[0]?.key
  }

  return {
    initModel: init,
    modelData,
    saveModel: save,
    getDefaultModelKey,
  }
}
