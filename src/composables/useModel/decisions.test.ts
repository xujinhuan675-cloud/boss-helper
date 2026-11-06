// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, expect, mock, test } from 'bun:test'

let requests: any[] = []
let result: any
mock.module('@/message', () => ({
  counter: {
    fetchText: async (request) => {
      requests.push(request)
      return result
    },
  },
}))
const { requestJobDecision } = await import('./decisions')
const conf = {
  mode: 'openai',
  base_url: 'https://openrouter.ai/api/v1/',
  api_key: 'offline-key',
  model: 'typesafe/jev-test',
  decisions: true,
  other: { timeout: 1234 },
}
beforeEach(() => {
  requests = []
  result = {
    status: 200,
    text: JSON.stringify({
      answers: {
        match: { type: 'choice', choice: 'uncertain', confidence: 0.99 },
        reason: { type: 'choice', choice: 'missing_info' },
      },
    }),
  }
})

test('uses one Decisions request with job context and returns a tri-state decision rather than confidence as score', async () => {
  const text = await requestJobDecision(conf, [{ role: 'user', content: '岗位和完整简历' }])
  expect(JSON.parse(text)).toEqual({ decision: 'uncertain', reason: '关键信息待确认' })
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe('https://openrouter.ai/api/alpha/decisions')
  expect(requests[0].timeout).toBe(1234)
  expect(new Headers(requests[0].data.headers).get('Authorization')).toBe('Bearer offline-key')
  const body = JSON.parse(requests[0].data.body)
  expect(body.model).toBe(conf.model)
  expect(body.state).toContainEqual({ role: 'user', content: '岗位和完整简历' })
  expect(body.questions.match.type).toBe('choice')
  expect(Object.keys(body.questions.match.criteria)).toEqual(['match', 'no_match', 'uncertain'])
  expect(body.stream).toBeUndefined()
})

test('uses the saved matching rules as the judgment policy instead of an overriding hidden rubric', async () => {
  const rules = [{ role: 'system', content: '允许跨行业；只接受上海岗位' }]
  await requestJobDecision(conf, rules)
  const body = JSON.parse(requests[0].data.body)
  expect(body.state).toEqual(rules)
  expect(body.questions.match.instructions).toContain('state')
  expect(body.questions.match.instructions).toContain('匹配规则')
  expect(body.questions.match.instructions).not.toContain('核心职责和关键能力')
  expect(body.questions.reason.instructions).toContain('匹配规则')
})

test.each([
  ['experience_requirement', '岗位经验类型不在投递范围'],
  ['education_requirement', '学历不符合岗位硬性要求'],
  ['skill_requirement', '明确缺少岗位必需技能'],
  ['location_conflict', '工作地点与明确求职要求冲突'],
  ['salary_conflict', '薪资范围与明确求职要求冲突'],
])(
  'returns a specific short mismatch reason for %s without another request',
  async (choice, reason) => {
    result.text = JSON.stringify({
      answers: {
        match: { type: 'choice', choice: 'no_match' },
        reason: { type: 'choice', choice },
      },
    })
    expect(JSON.parse(await requestJobDecision(conf, []))).toEqual({ decision: 'no_match', reason })
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0].data.body).questions.reason.criteria[choice]).toBe(reason)
  },
)

test.each([
  {},
  { answers: {} },
  { answers: { match: { type: 'choice', choice: 'yes' } } },
  { answers: { match: { type: 'noul', noul: 0.9 } } },
])('rejects incomplete or invalid decision answers without retrying: %j', async (body) => {
  result.text = JSON.stringify(body)
  await expect(requestJobDecision(conf, [])).rejects.toThrow('匹配结论')
  expect(requests).toHaveLength(1)
})

test('keeps HTTP status available to stop the batch and omits response bodies from errors', async () => {
  result = { status: 429, text: 'private upstream response' }
  await expect(requestJobDecision(conf, [])).rejects.toMatchObject({ statusCode: 429 })
  expect(requests).toHaveLength(1)
})

test.each([
  { type: 'choice', choice: 'core_match' },
  { type: 'choice', choice: ['missing_info'] },
  { type: 'choice', choice: 'unknown' },
  { type: 'text', choice: 'missing_info' },
])('omits inconsistent or invalid reason labels without requesting again: %j', async (reason) => {
  result.text = JSON.stringify({
    answers: { match: { type: 'choice', choice: 'uncertain' }, reason },
  })
  expect(JSON.parse(await requestJobDecision(conf, []))).toEqual({ decision: 'uncertain' })
  expect(requests).toHaveLength(1)
})

test('rejects invalid API addresses before exposing credentials', async () => {
  await expect(
    requestJobDecision({ ...conf, base_url: 'https://user:pass@example.com/api/v1' }, []),
  ).rejects.toThrow()
  expect(requests).toHaveLength(0)
})
