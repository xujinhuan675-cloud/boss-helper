// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { ref, shallowReactive, shallowRef, triggerRef } from 'vue'

const entry = fileURLToPath(new URL('./chatModel.ts', import.meta.url))
const built = await Bun.build({
  entrypoints: [entry],
  format: 'cjs',
  target: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'offline-model-config',
      setup(build) {
        build.onResolve({ filter: /^@\// }, ({ path }) => ({
          path:
            path === '@/message'
              ? 'message'
              : fileURLToPath(new URL(`../../${path.slice(2)}.ts`, import.meta.url)),
          ...(path === '@/message' ? { namespace: 'fixture' } : {}),
        }))
        build.onResolve({ filter: /^(@ai-sdk\/openai|ai)$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'ai'
              ? 'export class ToolLoopAgent { constructor(options) { this.options = options } stream(options) { if (globalThis.__chatStartError) throw globalThis.__chatStartError; globalThis.__chatMessages = options.messages; return { toUIMessageStream: async function* () { yield* globalThis.__chatChunks ?? [] } } } }; export const Output = {json:()=>({}),text:()=>({})}; export const createIdGenerator = () => () => "test-id"; export const APICallError={}; export const isReasoningUIPart=part=>part.type==="reasoning"; export const isTextUIPart=part=>part.type==="text"'
              : path === 'message'
                ? 'export const counter = { fetchText: async args => { globalThis.__backgroundFetch = args; return globalThis.__decisionResponse ?? { status: 200, text: "data: [DONE]\\n\\n", contentType: "text/event-stream" } } }'
                : 'export const createOpenAI = options => { globalThis.__openaiOptions = options; return {chat: model => ({model})} }',
          loader: 'js',
        }))
      },
    },
  ],
})
if (!built.success) throw new Error(built.logs.join('\n'))
const compiled = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  'ref',
  'shallowReactive',
  'shallowRef',
  'triggerRef',
  await built.outputs[0].text(),
)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
  ref,
  shallowReactive,
  shallowRef,
  triggerRef,
)
const { ChatModel } = compiled.exports

describe('model configuration snapshot', () => {
  it('routes quick filtering through Jev with the same job and profile snapshot', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          {
            key: 'chat',
            data: { model: 'chat', api_key: 'key', base_url: 'https://model.example/v1' },
          },
          {
            key: 'jev',
            data: {
              model: 'typesafe/jev-test',
              api_key: 'key',
              base_url: 'https://openrouter.ai/api/v1',
              decisions: true,
            },
          },
        ]),
      },
      resumes: { currentResume: ref(null) },
      conf: { formData: { jobProfile: '完整画像快照' } },
    })
    expect(
      chat.createAgent(
        {
          prompt: [
            { role: 'system', content: '允许跨行业，只接受上海岗位' },
            { role: 'user', content: 'JD: {{ jobData.jobDescription }}' },
          ],
          enable: true,
        },
        'filtering',
      ),
    ).toBe(true)
    expect(chat.agents.get('filtering')[0]).toBeNull()
    expect(chat.createAgent({ prompt: [], enable: true }, 'greetings')).toBe(true)
    expect(chat.agents.get('greetings')[1].key).toBe('chat')
    globalThis.__decisionResponse = {
      status: 200,
      text: JSON.stringify({ answers: { match: { type: 'choice', choice: 'match' } } }),
    }
    const data = { jobData: { key: 'quick-job', jobDescription: '岗位正文', brand: {}, boss: {} } }
    try {
      expect(await chat.chat('filtering', data)).toEqual({ text: '{"decision":"match"}' })
      const body = JSON.parse(globalThis.__backgroundFetch.data.body)
      expect(body.state).toContainEqual({ role: 'user', content: 'JD: 岗位正文' })
      expect(body.state.filter((message) => message.role === 'system')).toEqual([
        { role: 'system', content: '允许跨行业，只接受上海岗位' },
      ])
      expect(body.state.at(-1).content).toContain('完整画像快照')
      expect(chat.states.get('quick-job').status).toBe('ready')
      globalThis.__decisionResponse = { status: 401, text: 'private response' }
      await expect(chat.chat('filtering', data)).rejects.toMatchObject({ statusCode: 401 })
      expect(chat.states.get('quick-job').status).toBe('error')
    } finally {
      delete globalThis.__decisionResponse
    }
  })

  it('marks stream initialization failure and allows a successful retry on the same job', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
        ]),
      },
      resumes: { currentResume: ref(null) },
    })
    chat.createAgent({ prompt: [], enable: true }, 'greetings')
    const data = { jobData: { key: 'retry-job', brand: {}, boss: {} } }
    globalThis.__chatStartError = new Error('model unavailable')
    try {
      await expect(chat.chat('greetings', data)).rejects.toThrow('model unavailable')
      expect(chat.states.get('retry-job').status).toBe('error')
    } finally {
      delete globalThis.__chatStartError
    }
    await chat.chat('greetings', data)
    expect(chat.states.get('retry-job').status).toBe('ready')
    expect(chat.states.get('retry-job').error).toBeUndefined()
  })

  it('does not keep a previous error chunk after a successful retry', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
        ]),
      },
      resumes: { currentResume: ref(null) },
    })
    chat.createAgent({ prompt: [], enable: true }, 'greetings')
    const data = { jobData: { key: 'error-job', brand: {}, boss: {} } }
    globalThis.__chatChunks = [{ type: 'error', errorText: 'rate limited' }]
    try {
      await expect(chat.chat('greetings', data)).rejects.toThrow('rate limited')
      expect(chat.states.get('error-job').status).toBe('error')
    } finally {
      delete globalThis.__chatChunks
    }
    await chat.chat('greetings', data)
    expect(chat.states.get('error-job').error).toBeUndefined()
  })

  it('ignores empty stream endings and completes received reasoning and text parts', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
        ]),
      },
      resumes: { currentResume: ref(null) },
    })
    chat.createAgent({ prompt: [], enable: true }, 'greetings')
    globalThis.__chatChunks = [
      { type: 'reasoning-end' },
      { type: 'text-end' },
      { type: 'reasoning-delta', delta: 'reason' },
      { type: 'reasoning-end' },
      { type: 'text-delta', delta: 'hello' },
      { type: 'text-end' },
    ]
    try {
      await chat.chat('greetings', { jobData: { key: 'job', brand: {}, boss: {} } })
      const state = chat.states.get('job')
      expect(state.status).toBe('ready')
      expect(state.messages.at(-1).parts).toEqual([
        { type: 'reasoning', text: 'reason', state: 'done' },
        { type: 'text', text: 'hello', state: 'done' },
      ])
    } finally {
      delete globalThis.__chatChunks
    }
  })

  it('generates from resume messages without requiring a job or adding job chat history', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
        ]),
      },
    })
    const prompt = [{ role: 'user', content: '简历正文 {{ 不应作为模板渲染 }}' }]
    chat.createAgent({ prompt, enable: true }, 'keywords')
    chat.agents.get('keywords')[0].generate = async (request) => {
      expect(request.messages).toEqual(prompt)
      expect(request.timeout).toBe(60000)
      return { text: '{"keywords":["AI产品经理"]}' }
    }
    expect(await chat.generate('keywords')).toBe('{"keywords":["AI产品经理"]}')
    expect(chat.states.size).toBe(0)
    expect(chat.jobs.value).toEqual([])
    await expect(chat.generate('missing')).rejects.toThrow('not found')
  })

  it('routes inference fetches through the extension background bridge', async () => {
    const model = {
      key: 'active',
      name: 'active',
      data: { model: 'active-model', api_key: 'key', base_url: 'https://model.example/v1' },
    }
    const chat = new ChatModel({ models: { modelData: ref([model]) } })
    expect(chat.createAgent({ prompt: [], enable: true }, 'filtering')).toBe(true)

    const response = await globalThis.__openaiOptions.fetch('https://model.example/v1/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' },
      body: '{"stream":true}',
    })
    expect(globalThis.__backgroundFetch).toMatchObject({
      url: 'https://model.example/v1/chat',
      timeout: 60000,
      data: {
        method: 'POST',
        body: '{"stream":true}',
        headers: { authorization: 'Bearer key' },
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toContain('[DONE]')
  })

  it('keeps model and prompt settings stable if the configuration is edited during a batch', () => {
    const model = {
      key: 'model',
      name: 'original',
      data: { model: 'original-model', api_key: 'key', base_url: 'url', other: { timeout: 60000 } },
    }
    const settings = {
      prompt: [{ role: 'user', content: 'original prompt' }],
      enable: true,
    }
    const chat = new ChatModel({ models: { modelData: ref([model]) } })
    expect(chat.createAgent(settings, 'filtering', { json: true })).toBe(true)

    model.name = 'edited'
    model.data.other.timeout = 1000
    settings.prompt[0].content = 'edited prompt'

    const [, savedModel, savedPrompt] = chat.agents.get('filtering')
    expect(savedModel.name).toBe('original')
    expect(savedModel.data.other.timeout).toBe(60000)
    expect(savedPrompt.prompt[0].content).toBe('original prompt')
  })

  it('uses the first complete model configuration instead of prompt-local model fields', () => {
    const models = [
      {
        key: 'active',
        name: 'active',
        data: { model: 'active-model', api_key: 'key', base_url: 'url' },
      },
      {
        key: 'legacy',
        name: 'legacy',
        data: { model: 'legacy-model', api_key: 'key', base_url: 'url' },
      },
    ]
    const chat = new ChatModel({
      models: { modelData: ref(models), getDefaultModelKey: () => 'active' },
    })
    expect(chat.createAgent({ model: 'legacy', prompt: [], enable: true }, 'filtering')).toBe(true)
    expect(chat.agents.get('filtering')[1].key).toBe('active')
  })

  it('ignores legacy prompt model overrides when resolving the configured model list', () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'configured', api_key: 'key', base_url: 'url' } },
          { key: 'legacy', data: { model: 'old', api_key: 'key', base_url: 'url' } },
        ]),
      },
    })
    for (const role of ['filtering', 'greetings', 'reply', 'keywords']) {
      expect(chat.createAgent({ model: 'legacy', prompt: [], enable: true }, role)).toBe(true)
      expect(chat.agents.get(role)[1].key).toBe('active')
    }
  })

  it('appends the saved profile to filtering without appending the resume', async () => {
    const model = {
      key: 'active',
      name: 'active',
      data: { model: 'active-model', api_key: 'key', base_url: 'url' },
    }
    const chat = new ChatModel({
      models: { modelData: ref([model]), getDefaultModelKey: () => 'active' },
      resumes: {
        currentResume: ref({ id: 'resume-a', name: '主简历', content: '刘博华\nAI 产品经理' }),
      },
      conf: { formData: { jobProfile: '画像中的主投方向', resumeText: '旧配置简历' } },
    })
    const data = {
      jobData: {
        key: 'job-1',
        jobName: 'AI 产品经理',
        salary: '20-30K',
        brand: { name: 'Acme' },
        boss: { name: 'Alice', avatar: '' },
        jobDescription: '负责 AI 产品规划',
      },
    }

    expect(
      chat.createAgent(
        {
          model: 'legacy',
          prompt: [
            { role: 'system', content: '允许跨行业，只接受上海岗位' },
            { role: 'user', content: '匹配 {{ jobData.jobName }}' },
          ],
          enable: true,
        },
        'filtering',
      ),
    ).toBe(true)
    await chat.chat('filtering', data, { disableMessages: true })

    expect(globalThis.__chatMessages).toEqual([
      { role: 'system', content: '允许跨行业，只接受上海岗位' },
      { role: 'user', content: '匹配 AI 产品经理' },
      { role: 'user', content: '## 求职者个人画像\n画像中的主投方向' },
    ])
  })

  it('uses a fixed resume snapshot for greeting generation', async () => {
    const model = {
      key: 'active',
      name: 'active',
      data: { model: 'active-model', api_key: 'key', base_url: 'url' },
    }
    const chat = new ChatModel(
      {
        models: { modelData: ref([model]), getDefaultModelKey: () => 'active' },
        resumes: { currentResume: ref({ id: 'resume-a', name: '主简历', content: '当前简历' }) },
        conf: { formData: { resumeText: '' } },
      },
      { resume: '批次快照简历' },
    )
    const data = {
      jobData: {
        key: 'job-1',
        jobName: 'AI 产品经理',
        salary: '20-30K',
        brand: { name: 'Acme' },
        boss: { name: 'Alice', avatar: '' },
        jobDescription: '负责 AI 产品规划',
      },
    }
    expect(chat.createAgent({ prompt: [], enable: true }, 'greetings')).toBe(true)
    await chat.chat('greetings', data, { disableMessages: true })
    expect(globalThis.__chatMessages.at(-1)).toEqual({
      role: 'user',
      content: '## 求职者完整简历\n批次快照简历',
    })
  })

  it('uses the saved profile for matching and the selected resume for greetings', async () => {
    const currentResume = ref({ id: 'a', name: '主简历', content: '正文 A' })
    const formData = { jobProfile: '画像 A', resumeText: '遗留简历' }
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
        ]),
        getDefaultModelKey: () => 'active',
      },
      resumes: { currentResume },
      conf: { formData },
    })
    const data = { jobData: { key: 'job', brand: { name: '公司' }, boss: { name: 'HR' } } }
    for (const role of ['filtering', 'greetings']) {
      chat.createAgent({ prompt: [{ role: 'user', content: '原提示词' }], enable: true }, role)
      currentResume.value = { id: 'a', name: '主简历', content: '正文 A' }
      formData.jobProfile = '画像 A'
      await chat.chat(role, data, { disableMessages: true })
      expect(globalThis.__chatMessages.at(-1).content).toBe(
        role === 'filtering' ? '## 求职者个人画像\n画像 A' : '## 求职者完整简历\n正文 A',
      )
      currentResume.value = { id: 'b', name: '备用简历', content: '正文 B' }
      formData.jobProfile = '画像 B'
      await chat.chat(role, data, { disableMessages: true })
      expect(globalThis.__chatMessages.at(-1).content).toBe(
        role === 'filtering' ? '## 求职者个人画像\n画像 B' : '## 求职者完整简历\n正文 B',
      )
      currentResume.value = null
      await chat.chat(role, data, { disableMessages: true })
      expect(globalThis.__chatMessages.at(-1)?.content).toBe(
        role === 'filtering' ? '## 求职者个人画像\n画像 B' : '原提示词',
      )
    }
  })

  it('uses the saved job profile for matching and keeps the resume only for greeting generation', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
        ]),
        getDefaultModelKey: () => 'active',
      },
      resumes: { currentResume: ref({ id: 'a', name: '简历', content: '简历证据' }) },
      conf: { formData: { jobProfile: '主投 AI 应用产品，金融产品为承接方向' } },
    })
    const data = { jobData: { key: 'job', brand: {}, boss: {} } }
    chat.createAgent({ prompt: [{ role: 'user', content: '匹配' }], enable: true }, 'filtering')
    await chat.chat('filtering', data, { disableMessages: true })
    expect(globalThis.__chatMessages).toContainEqual({
      role: 'user',
      content: '## 求职者个人画像\n主投 AI 应用产品，金融产品为承接方向',
    })
    expect(globalThis.__chatMessages.some((message) => message.content.includes('简历证据'))).toBe(
      false,
    )
    chat.createAgent({ prompt: [{ role: 'user', content: '写招呼语' }], enable: true }, 'greetings')
    await chat.chat('greetings', data, { disableMessages: true })
    expect(globalThis.__chatMessages.at(-1).content).toBe('## 求职者完整简历\n简历证据')
  })

  it('uses a fixed profile snapshot when provided by a batch', async () => {
    const chat = new ChatModel(
      {
        models: {
          modelData: ref([
            { key: 'active', data: { model: 'active', api_key: 'key', base_url: 'url' } },
          ]),
        },
        resumes: { currentResume: ref(null) },
        conf: { formData: { jobProfile: '当前画像' } },
      },
      { profile: '启动时画像' },
    )
    chat.createAgent({ prompt: [{ role: 'user', content: '匹配' }], enable: true }, 'filtering')
    await chat.chat(
      'filtering',
      { jobData: { key: 'job', brand: {}, boss: {} } },
      { disableMessages: true },
    )
    expect(globalThis.__chatMessages.at(-1).content).toBe('## 求职者个人画像\n启动时画像')
  })

  it('uses only the editable prompt without injecting hidden matching or output rules', async () => {
    const chat = new ChatModel({
      models: {
        modelData: ref([
          { key: 'active', data: { model: 'model', api_key: 'key', base_url: 'url' } },
        ]),
      },
      resumes: { currentResume: ref(null) },
    })
    const prompt = [{ role: 'system', content: '必须双休，只看金融产品经理' }]
    const data = { jobData: { key: 'job', brand: {}, boss: {} } }
    chat.createAgent({ prompt, enable: true }, 'filtering')
    await chat.chat('filtering', data, { disableMessages: true })
    expect(globalThis.__chatMessages).toEqual(prompt)
    chat.createAgent({ prompt, enable: true }, 'greetings')
    await chat.chat('greetings', data, { disableMessages: true })
    expect(globalThis.__chatMessages).toEqual(prompt)
  })
})
