import type { browser } from '#imports'

import { DETAIL_MESSAGE, jobIdFromUrl, readJobDetailPage } from './jobDetails'
import type { JobDetailPage } from './jobDetails'

export function installJobDetailReader(
  runtime: Pick<typeof browser.runtime, 'id' | 'onMessage' | 'sendMessage'>,
  doc: Document,
) {
  let signature = ''
  let stableAt = 0
  const read = (): JobDetailPage => {
    const page = readJobDetailPage(doc)
    if (page.status !== 'ready') {
      signature = ''
      return page
    }
    const next = `${page.jobId}:${page.detail.jobInfo.postDescription}`
    if (next !== signature) {
      signature = next
      stableAt = Date.now()
    }
    return Date.now() - stableAt >= 800 ? page : { status: 'pending', error: '等待详情正文稳定' }
  }
  runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== runtime.id || message?.type !== DETAIL_MESSAGE) return
    const page = read()
    if (page.status === 'ready' && page.jobId !== message.jobId)
      return Promise.resolve({ status: 'failed', error: '详情页面岗位 ID 不匹配' })
    return Promise.resolve(page)
  })
  if (!jobIdFromUrl(doc.location.href)) return
  const deadline = Date.now() + 60_000
  let sending = false
  const timer = setInterval(() => {
    if (Date.now() >= deadline) {
      clearInterval(timer)
      return
    }
    if (sending) return
    const page = read()
    if (page.status !== 'ready') return
    sending = true
    void runtime
      .sendMessage({ type: DETAIL_MESSAGE, action: 'passive', page })
      .then((result) => {
        if (result?.ok) clearInterval(timer)
      })
      .catch(() => {})
      .finally(() => {
        sending = false
      })
  }, 1000)
  doc.defaultView?.addEventListener('pagehide', () => clearInterval(timer), { once: true })
}
