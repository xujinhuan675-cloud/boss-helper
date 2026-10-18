import { createOpenAI } from '@ai-sdk/openai'

import type { other } from './common'
import type { LLMConf, LLMInfo } from './type'

export type OpenaiLLMConf = LLMConf<
  'openai',
  {
    avatar?: string
    base_url: string
    api_key: string
    model: string
    responses?: boolean
    other?: other['other']
    advanced?: {
      json?: boolean | true
      stream?: boolean | true

      temperature?: number
      top_p?: number
      presence_penalty?: number
      frequency_penalty?: number

      tool_choice?: string
      tools?: Array<Record<string, any>>

      extra_headers?: Record<string, string>
      extra_body?: object
    }
  }
>

const info: LLMInfo<Pick<OpenaiLLMConf, 'mode' | 'base_url' | 'api_key' | 'model' | 'responses'>> =
  {
    mode: {
      mode: 'openai',
      label: 'OpenAI',
    },
    base_url: {
      desc: '可使用中转/代理API, 前提是符合openai的规范, 需要填写base api地址',
      type: 'input',
      // format: 'menu', // TODO: 修复用户体验, 当前创建有问题, 要多次回车/点击
      config: {
        placeholder: 'https://api.openai.com/v1',
        items: [
          'https://api.openai.com/v1',
          'https://openrouter.ai/api/v1',
          'https://api.deepseek.com',
          'https://api.moonshot.cn/v1',
          'https://token-plan-sgp.xiaomimimo.com/v1',
          'https://ark.cn-beijing.volces.com/api/v3',
        ],
        createItem: 'always',
      },
      required: true,
    },
    api_key: { type: 'input', required: true },
    model: {
      config: {
        placeholder: 'gpt-4o-mini',
        items: [
          'gpt-4o',
          'gpt-5.4',
          'deepseek-chat',
          'doubao-seed-2-0-pro-260215',
          'mimo-v2.5-pro',
          'mimo-v2.5',
          'kimi-k2.6',
          'deepseek-v4-flash',
          'minimax-m2.7',
          'deepseek-v3.2',
        ],
        createItem: 'always',
      },
      value: 'deepseek-chat',
      type: 'input',
      // format: 'menu',
      required: true,
    },
    responses: {
      value: false,
      type: 'switch',
      desc: '默认使用ChatCompletions',
    },
  }

const createModel = (conf: OpenaiLLMConf) => {
  const openai = createOpenAI({
    baseURL: conf.base_url,
    apiKey: conf.api_key,
    headers: conf.advanced?.extra_headers,
    // fetch: counter.fetch,
  })
  if (conf.responses) {
    return openai.responses(conf.model)
  }
  return openai.chat(conf.model)
}

export const openai = {
  createModel,
  info,
}
