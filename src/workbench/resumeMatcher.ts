import type { JobData } from '@/composables/useHelper/type'

export const RESUME_MATCHER_BASE_URL = 'http://localhost:3000'
const HANDOFF_READY_TYPE = 'boss-helper-resume-matcher-ready'
const HANDOFF_TYPE = 'boss-helper-resume-matcher-handoff'
const HANDOFF_TIMEOUT_MS = 15_000

export type ResumeMatcherHandoff = {
  type: typeof HANDOFF_TYPE
  id: string
  createdAt: number
  job: {
    title: string
    company: string
    salary: string
    city: string
    link: string
    description: string
  }
}

export function buildResumeMatcherUrl(id: string) {
  const url = new URL('/tailor', RESUME_MATCHER_BASE_URL)
  url.hash = new URLSearchParams({ 'boss-helper-handoff': id }).toString()
  return url.href
}

export function buildResumeMatcherHandoff(
  job: JobData,
  id: string,
  createdAt = Date.now(),
): ResumeMatcherHandoff {
  return {
    type: HANDOFF_TYPE,
    id,
    createdAt,
    job: {
      title: job.jobName || job.positionName || '',
      company: job.brand?.name || '',
      salary: job.salary || '',
      city: job.city || '',
      link: job.link || '',
      description: job.jobDescription,
    },
  }
}

export function getResumeTailoringInputError(job: JobData) {
  if (!job?.jobDescription?.trim()) return '当前岗位缺少 JD，请先在 BOSS 获取岗位详情'
  return null
}

export function openResumeMatcher(job: JobData) {
  const id = crypto.randomUUID()
  const url = buildResumeMatcherUrl(id)
  const origin = new URL(RESUME_MATCHER_BASE_URL).origin
  let matcherWindow: Window | null = null
  let timeout: number | undefined

  const cleanup = () => {
    window.removeEventListener('message', onMessage)
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
  const onMessage = (event: MessageEvent) => {
    const message = event.data as { type?: unknown; id?: unknown } | null
    if (
      event.source !== matcherWindow ||
      event.origin !== origin ||
      message?.type !== HANDOFF_READY_TYPE ||
      message.id !== id
    ) {
      return
    }
    matcherWindow?.postMessage(buildResumeMatcherHandoff(job, id), origin)
    cleanup()
  }

  window.addEventListener('message', onMessage)
  timeout = window.setTimeout(cleanup, HANDOFF_TIMEOUT_MS)
  matcherWindow = window.open(url, `resume-matcher-${id}`)
  if (!matcherWindow) {
    cleanup()
    return false
  }
  return true
}
