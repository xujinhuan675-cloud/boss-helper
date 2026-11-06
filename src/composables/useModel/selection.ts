import type { ModelConf, ModelConfData } from '.'

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

export function selectModel(models: ModelConf[], task?: string) {
  const complete = models.filter(isCompleteModel)
  if (task === 'filtering') {
    const decisions = complete.find((model) => model.data.decisions)
    if (decisions) return decisions
  }
  return complete.find((model) => !model.data.decisions)
}
