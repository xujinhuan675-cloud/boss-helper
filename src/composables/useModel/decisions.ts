import type { ModelMessage } from 'ai'

import { counter } from '@/message'

import { MATCH_REASON_LABELS as reasons, parseFiltering } from '../useApplying/scoring'
import type { OpenaiLLMConf } from './openai'

export async function requestJobDecision(conf: OpenaiLLMConf, messages: ModelMessage[]) {
  const url = new URL(conf.base_url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/\/v1\/?$/.test(url.pathname)
  )
    throw new Error('Jev API 基础地址应为 https://openrouter.ai/api/v1 或兼容代理地址')
  url.pathname = url.pathname.replace(/\/v1\/?$/, '/alpha/decisions')
  const headers = new Headers(conf.advanced?.extra_headers)
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${conf.api_key}`)
  headers.set('Content-Type', 'application/json')
  const response = await counter.fetchText({
    url: url.toString(),
    timeout: conf.other?.timeout ?? 60000,
    data: {
      method: 'POST',
      headers: Object.fromEntries(headers.entries()),
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify({
        model: conf.model,
        state: messages,
        questions: {
          match: {
            type: 'choice',
            instructions: '依据 state 中配置的岗位匹配规则选择结论。',
            criteria: {
              match: '匹配',
              no_match: '不匹配',
              uncertain: '待确认',
            },
          },
          reason: {
            type: 'choice',
            instructions: '依据 state 中配置的岗位匹配规则选择原因标签。',
            criteria: reasons,
          },
        },
      }),
    },
  })
  if (response.status < 200 || response.status >= 300)
    throw Object.assign(new Error(`Jev 请求错误 ${response.status}`), {
      statusCode: response.status,
    })
  const value = JSON.parse(response.text) as {
    answers?: Record<string, { type?: string; choice?: string }>
  }
  const match = value?.answers?.match
  if (match?.type !== 'choice' || !['match', 'no_match', 'uncertain'].includes(match.choice ?? ''))
    throw new Error('Jev 未返回有效匹配结论')
  const reason = value.answers?.reason
  const reasonDecision =
    reason?.choice === 'core_match'
      ? 'match'
      : reason?.choice === 'missing_info'
        ? 'uncertain'
        : 'no_match'
  const text = JSON.stringify({
    decision: match.choice,
    ...(reason?.type === 'choice' &&
    typeof reason.choice === 'string' &&
    Object.hasOwn(reasons, reason.choice) &&
    reasonDecision === match.choice
      ? { reason: reasons[reason.choice as keyof typeof reasons] }
      : {}),
  })
  parseFiltering(text)
  return text
}
