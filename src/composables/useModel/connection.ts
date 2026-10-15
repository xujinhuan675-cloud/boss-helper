import type { OpenaiLLMConf } from './openai'

export type ModelConnectionStatus =
  | 'connected'
  | 'auth_error'
  | 'network_error'
  | 'unsupported'
  | 'invalid_response'
  | 'http_error'
  | 'invalid_config'

export interface ModelConnectionResult {
  status: ModelConnectionStatus
  title: string
  description: string
  httpStatus?: number
  modelCount?: number
  models?: string[]
  selectedModelVisibility?: 'visible' | 'not_listed' | 'not_selected'
}

type ConnectionConfig = Partial<
  Pick<OpenaiLLMConf, 'mode' | 'base_url' | 'api_key' | 'model' | 'advanced'>
>

export async function testModelConnection(
  conf: ConnectionConfig,
  fetchModels: typeof fetch = globalThis.fetch,
  timeoutMs = 10000,
): Promise<ModelConnectionResult> {
  let url: URL
  let headers: Headers
  try {
    url = new URL(conf.base_url || '')
    if (
      conf.mode !== 'openai' ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid configuration')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
    headers = new Headers({ Accept: 'application/json' })
    if (conf.api_key) headers.set('Authorization', `Bearer ${conf.api_key}`)
    const extraHeaders = conf.advanced?.extra_headers
    if (extraHeaders !== undefined) {
      if (!extraHeaders || typeof extraHeaders !== 'object' || Array.isArray(extraHeaders)) {
        throw new Error('Invalid headers')
      }
      for (const [key, value] of Object.entries(extraHeaders)) {
        if (typeof value !== 'string') throw new Error('Invalid header value')
        headers.set(key, value)
      }
    }
  } catch {
    return {
      status: 'invalid_config',
      title: '连接配置无效',
      description:
        '请检查 API 基础地址和额外请求头；地址应为不含账号、查询参数或片段的 HTTP(S) 地址。',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchModels(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
    })
    const httpStatus = response.status
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        status: 'auth_error',
        title: '认证失败',
        description: `模型列表接口返回 HTTP ${httpStatus}，请检查 API Key 和访问权限。`,
        httpStatus,
      }
    }
    if ([404, 405, 501].includes(httpStatus)) {
      return {
        status: 'unsupported',
        title: '模型列表接口不支持',
        description: `模型列表接口返回 HTTP ${httpStatus}，无法确认连接；请检查基础地址或服务商是否支持模型列表。`,
        httpStatus,
      }
    }
    if (!response.ok) {
      return {
        status: 'http_error',
        title: '连接检测未通过',
        description: `模型列表接口返回 HTTP ${httpStatus}，请检查服务状态、限额和基础地址。`,
        httpStatus,
      }
    }
    const body: unknown = await response.json()
    const data = body && typeof body === 'object' && 'data' in body ? body.data : undefined
    if (!Array.isArray(data)) {
      return {
        status: 'invalid_response',
        title: '模型列表响应无效',
        description: '接口未返回符合 OpenAI 格式的模型列表，无法确认连接。',
        httpStatus,
      }
    }
    const models = [
      ...new Set(
        data.flatMap((model) =>
          model && typeof model === 'object' && typeof model.id === 'string'
            ? [model.id.trim()].filter(Boolean)
            : [],
        ),
      ),
    ]
    if (models.length === 0 && data.length > 0) {
      return {
        status: 'invalid_response',
        title: '模型列表响应无效',
        description: '接口未返回符合 OpenAI 格式的模型列表，无法确认连接。',
        httpStatus,
      }
    }
    const selectedModelVisibility = !conf.model?.trim()
      ? 'not_selected'
      : models.includes(conf.model.trim())
        ? 'visible'
        : 'not_listed'
    const visibilityDescription = {
      visible: '当前模型已列出。',
      not_listed: '当前模型未列出，请确认模型 ID 和访问权限。',
      not_selected: '尚未填写模型 ID。',
    }[selectedModelVisibility]
    return {
      status: 'connected',
      title: '模型列表连接成功',
      description: `已读取 ${models.length} 个模型。${visibilityDescription}此结果不代表推理可用。`,
      httpStatus,
      modelCount: models.length,
      models,
      selectedModelVisibility,
    }
  } catch (error) {
    if (error instanceof SyntaxError && !controller.signal.aborted) {
      return {
        status: 'invalid_response',
        title: '模型列表响应无效',
        description: '接口未返回有效 JSON，无法确认连接。',
      }
    }
    return {
      status: 'network_error',
      title: controller.signal.aborted ? '连接检测超时' : '网络连接失败',
      description: controller.signal.aborted
        ? '模型列表请求超时，无法确认连接。'
        : '无法读取模型列表，请检查网络、跨域限制和 API 基础地址。',
    }
  } finally {
    clearTimeout(timer)
  }
}

export function selectAvailableModel(currentModel: string, models: string[]): string {
  if (currentModel && models.includes(currentModel.trim())) return currentModel.trim()
  return models[0] || currentModel
}
