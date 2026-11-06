import { diagnostic, traceDiagnostic } from '../../utils/diagnostics'

export interface PaddleOcrConfig {
  enabled: boolean
  baseUrl: string
  token: string
  model: string
  pollIntervalMs?: number
  useDocOrientationClassify?: boolean
  useDocUnwarping?: boolean
  useChartRecognition?: boolean
}

export const DEFAULT_PADDLE_OCR_CONFIG: PaddleOcrConfig = {
  enabled: false,
  baseUrl: 'https://paddleocr.aistudio-app.com/api/v2/ocr',
  token: '',
  model: 'PaddleOCR-VL-1.6',
  pollIntervalMs: 5000,
  useDocOrientationClassify: false,
  useDocUnwarping: false,
  useChartRecognition: false,
}

export interface PaddleOcrResult {
  text: string
  pages: string[]
}

type FetchLike = typeof fetch

function optionalPayload(config: PaddleOcrConfig) {
  return {
    useDocOrientationClassify: config.useDocOrientationClassify,
    useDocUnwarping: config.useDocUnwarping,
    useChartRecognition: config.useChartRecognition,
  }
}

async function readJson(response: Response, context: string) {
  diagnostic('ocr.http', { context: { phase: context, statusCode: response.status } })
  if (!response.ok) throw new Error(`PaddleOCR ${context} failed: HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error(`PaddleOCR ${context} returned malformed JSON`)
  }
}

function parseResultJsonl(value: string): PaddleOcrResult {
  const pages: string[] = []
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue
    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error('PaddleOCR result returned malformed JSONL')
    }
    const results = parsed?.result?.layoutParsingResults
    if (!Array.isArray(results)) throw new Error('PaddleOCR result is missing layoutParsingResults')
    for (const page of results) {
      const text = page?.markdown?.text
      if (typeof text === 'string' && text.trim()) pages.push(text.trim())
    }
  }
  return { text: pages.join('\n\n'), pages }
}

export async function recognizeWithPaddleOcr(
  input: string | Blob,
  config: PaddleOcrConfig,
  fetchImpl: FetchLike = fetch,
): Promise<PaddleOcrResult> {
  if (!config.token.trim()) throw new Error('PaddleOCR token is required')
  if (!config.model.trim()) throw new Error('PaddleOCR model is required')
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('PaddleOCR base URL is invalid')
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token.trim()}` }
  const payload = optionalPayload(config)
  const init: RequestInit = { method: 'POST', headers }
  if (typeof input === 'string') {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      fileUrl: input,
      model: config.model.trim(),
      optionalPayload: payload,
    })
  } else {
    const body = new FormData()
    body.set('model', config.model.trim())
    body.set('optionalPayload', JSON.stringify(payload))
    body.set('file', input, 'ocr-input.png')
    init.body = body
  }
  const submitted = await traceDiagnostic('ocr.submit', async () =>
    readJson(await fetchImpl(`${baseUrl}/jobs`, init), 'submit'),
  )
  const jobId = submitted?.data?.jobId
  if (typeof jobId !== 'string' || !jobId)
    throw new Error('PaddleOCR submit response is missing jobId')

  const pollStarted = performance.now()
  while (true) {
    const status = await readJson(
      await fetchImpl(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${config.token.trim()}` },
      }),
      'poll',
    )
    const data = status?.data
    if (data?.state === 'failed') throw new Error(data.errorMsg || 'PaddleOCR job failed')
    if (data?.state === 'done') {
      diagnostic('ocr.poll', { durationMs: performance.now() - pollStarted })
      const jsonUrl = data?.resultUrl?.jsonUrl
      if (typeof jsonUrl !== 'string' || !jsonUrl)
        throw new Error('PaddleOCR result URL is missing')
      return traceDiagnostic('ocr.parse', async () => {
        const resultResponse = await fetchImpl(jsonUrl)
        if (!resultResponse.ok)
          throw new Error(`PaddleOCR result download failed: HTTP ${resultResponse.status}`)
        return parseResultJsonl(await resultResponse.text())
      })
    }
    if (!['pending', 'running'].includes(data?.state))
      throw new Error('PaddleOCR returned an unknown job state')
    if ((config.pollIntervalMs ?? 5000) > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs ?? 5000))
  }
}
