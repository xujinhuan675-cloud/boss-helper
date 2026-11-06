// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { beforeEach, expect, test } from 'bun:test'

import { DEFAULT_PADDLE_OCR_CONFIG, recognizeWithPaddleOcr } from './paddleOcr'

let requests
beforeEach(() => {
  requests = []
})

const response = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

test('submits a remote image and returns markdown from completed JSONL', async () => {
  const fetchImpl = async (input, init) => {
    requests.push({ input: String(input), init })
    if (requests.length === 1) return response({ data: { jobId: 'job-1' } })
    if (requests.length === 2) return response({ data: { state: 'running' } })
    if (requests.length === 3)
      return response({
        data: { state: 'done', resultUrl: { jsonUrl: 'https://result.test/1.jsonl' } },
      })
    return new Response('{"result":{"layoutParsingResults":[{"markdown":{"text":"ocr text"}}]}}\n')
  }
  const result = await recognizeWithPaddleOcr(
    'https://image.test/job.png',
    {
      ...DEFAULT_PADDLE_OCR_CONFIG,
      token: 'placeholder-token',
      pollIntervalMs: 0,
    },
    fetchImpl,
  )
  expect(result.text).toBe('ocr text')
  expect(result.pages).toHaveLength(1)
  expect(requests[0].init.headers.Authorization).toBe('Bearer placeholder-token')
  expect(JSON.parse(requests[0].init.body).fileUrl).toBe('https://image.test/job.png')
})

test('uploads a blob as multipart form data', async () => {
  const fetchImpl = async (_input, init) => {
    requests.push({ init })
    if (requests.length === 1) return response({ data: { jobId: 'job-2' } })
    if (requests.length === 2)
      return response({
        data: { state: 'done', resultUrl: { jsonUrl: 'https://result.test/2.jsonl' } },
      })
    return new Response('{"result":{"layoutParsingResults":[]}}\n')
  }
  await recognizeWithPaddleOcr(
    new Blob(['image']),
    {
      ...DEFAULT_PADDLE_OCR_CONFIG,
      token: 'token',
      pollIntervalMs: 0,
    },
    fetchImpl,
  )
  expect(requests[0].init.body).toBeInstanceOf(FormData)
  expect(requests[0].init.body.get('model')).toBe(DEFAULT_PADDLE_OCR_CONFIG.model)
  expect(requests[0].init.body.get('file')).toBeInstanceOf(Blob)
})

test('rejects failed jobs and missing tokens', async () => {
  await expect(
    recognizeWithPaddleOcr(
      'https://image.test/job.png',
      {
        ...DEFAULT_PADDLE_OCR_CONFIG,
        token: 'token',
        pollIntervalMs: 0,
      },
      async (_input, init) =>
        init?.method === 'POST'
          ? response({ data: { jobId: 'job-3' } })
          : response({ data: { state: 'failed', errorMsg: 'bad image' } }),
    ),
  ).rejects.toThrow('bad image')
  await expect(
    recognizeWithPaddleOcr(
      'https://image.test/job.png',
      {
        ...DEFAULT_PADDLE_OCR_CONFIG,
        token: '',
      },
      async () => response({ data: { jobId: 'job-3' } }),
    ),
  ).rejects.toThrow('token')
})
