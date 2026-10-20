import type { BossZpDetailData } from './types'

export const DETAIL_MESSAGE = 'boss-helper:job-detail'
export const DETAIL_ACCESS_KEY = 'session:boss-helper:detail-access'
export type DetailStopReason = 'captcha' | 'login_required' | 'restricted'
export type JobDetailPage =
  | { status: 'ready'; jobId: string; detail: BossZpDetailData }
  | { status: 'pending' | 'failed' | DetailStopReason; error: string }

export function jobIdFromUrl(href: string): string | null {
  try {
    const url = new URL(href)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !/^(?:www\.)?zhipin\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null
    return url.pathname.match(/^\/job_detail\/([\w~-]+)\.html$/)?.[1] ?? null
  } catch {
    return null
  }
}

export function detailStopReason(
  message: string,
  errorMessage = false,
): DetailStopReason | undefined {
  const text = message.replace(/\s+/g, '')
  if (errorMessage && /验证码|安全验证|滑动验证|人机验证/.test(text)) return 'captcha'
  if (
    /请(?:先)?(?:完成|进行|通过)(?:安全|滑动|人机)验证|(?:需要|需)(?:完成|进行)?(?:安全|滑动|人机)验证|请(?:先)?(?:输入|填写)(?:图形|图片|短信)?验证码|验证码(?:已)?(?:错误|失效|过期)|拖动(?:下方)?滑块|返回验证页面/.test(
      text,
    )
  )
    return 'captcha'
  if (
    /请先登录|需要登录|登录(?:已)?(?:过期|失效)|未登录|(?:登录|登入)(?:后)?(?:可|即可)?(?:查看|阅读|解锁)(?:全部|完整|职位详情|更多)|请登录后查看|登录后可查看/.test(
      text,
    )
  )
    return 'login_required'
  if (
    /操作(?:过于|太)频繁|访问(?:过于|太)频繁|访问受限|账号异常|账户异常|(?:环境|账户|账号)存在异常|HTTP(?:403|429)/i.test(
      text,
    )
  )
    return 'restricted'
  return undefined
}

export function assertCompleteJobDetail(
  value: unknown,
  jobId: string,
): asserts value is BossZpDetailData {
  const detail = value as BossZpDetailData | undefined
  if (detail?.jobInfo?.encryptId !== jobId) throw new Error('历史详情岗位 ID 不匹配，已拒绝保存')
  if (detail.jobInfo.invalidStatus) throw new Error('岗位已失效')
  const text = detail.jobInfo.postDescription
  if (typeof text !== 'string' || !text.trim()) throw new Error('岗位详情未返回完整 JD')
  const stop = detailStopReason(text)
  if (stop) throw new Error(stop === 'login_required' ? '登录查看完整内容，详情仍待补全' : text)
  if (/展开(?:全部|完整)|查看完整(?:内容|职位|描述)|(?:\.{3}|…{1,2})\s*$/.test(text))
    throw new Error('岗位详情内容被截断，仍待补全')
}

export function hasCompleteJobDetail(record: {
  encryptJobId: string
  detailStatus: string
  detail?: unknown
}): boolean {
  if (record.detailStatus !== 'complete') return false
  const detail = record.detail as BossZpDetailData | undefined
  try {
    // Legacy saved JDs may lack an ID; new writes always require the real response identity.
    assertCompleteJobDetail(
      {
        ...detail,
        jobInfo: {
          ...detail?.jobInfo,
          encryptId: detail?.jobInfo?.encryptId ?? record.encryptJobId,
        },
      },
      record.encryptJobId,
    )
    return true
  } catch {
    return false
  }
}

export function readJobDetailPage(doc: Document): JobDetailPage {
  const text = doc.body?.innerText ?? doc.body?.textContent ?? ''
  const reason = detailStopReason(text)
  if (reason)
    return {
      status: reason,
      error:
        reason === 'login_required'
          ? '登录查看完整内容或登录已失效'
          : `详情页面要求处理：${reason === 'captcha' ? '安全验证' : '访问受限'}`,
    }
  const visible = (el: Element) =>
    el.getClientRects().length > 0 && doc.defaultView?.getComputedStyle(el).visibility !== 'hidden'
  if (
    Array.from(
      doc.querySelectorAll(
        'input[name="captcha"], iframe[src*="captcha"], iframe[src*="verify"], input[placeholder*="验证码"]',
      ),
    ).some(visible)
  )
    return { status: 'captcha', error: '详情页面要求安全验证' }
  if (/\/web\/user|\/login|\/passport/.test(doc.location.pathname))
    return { status: 'login_required', error: '详情页面已跳转登录' }
  if (/\/captcha|\/verify|\/security-check/.test(doc.location.pathname))
    return { status: 'captcha', error: '详情页面已跳转验证' }
  const jobId = jobIdFromUrl(doc.location.href)
  if (!jobId) return { status: 'failed', error: '详情 URL 已重定向至其他页面' }
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
  if (canonical && jobIdFromUrl(canonical) !== jobId)
    return { status: 'failed', error: '详情正文对应岗位 ID 与页面 URL 不匹配' }
  if (/该职位已关闭|该职位已下线|职位不存在|职位已失效|页面不存在/.test(text))
    return { status: 'failed', error: '岗位已失效或页面不存在' }
  // Only the labelled JD section is authoritative; company and recommendation text is excluded.
  const sections = Array.from(doc.querySelectorAll('.job-detail .job-sec, .job-detail-section'))
  const section = sections.find((el) =>
    /^(?:职位描述|岗位职责|工作职责)$/.test(
      el.querySelector('h3, h2, .job-sec-title')?.textContent?.trim() ?? '',
    ),
  )
  const body = section?.querySelector<HTMLElement>('.job-sec-text, .job-description')
  if (!body) return { status: 'pending', error: '等待职位描述正文加载' }
  const style = doc.defaultView?.getComputedStyle(body)
  const description = (body.innerText ?? body.textContent ?? '').trim()
  if (
    description.length < 20 ||
    body.hidden ||
    style?.display === 'none' ||
    style?.visibility === 'hidden' ||
    (style?.getPropertyValue('-webkit-line-clamp') &&
      style.getPropertyValue('-webkit-line-clamp') !== 'none' &&
      style.getPropertyValue('-webkit-line-clamp') !== '0') ||
    (style?.overflow === 'hidden' && style.maxHeight && style.maxHeight !== 'none') ||
    /展开(?:全部|完整)|查看完整(?:内容|职位|描述)/.test(section?.textContent ?? '')
  )
    return { status: 'pending', error: '正文尚未完整加载或内容被截断' }
  const textFrom = (selectors: string[]) =>
    selectors
      .map((selector) => doc.querySelector(selector)?.textContent?.trim() ?? '')
      .find(Boolean) ?? ''
  const jobName = textFrom(['.job-name', '.job-detail-header h1', '.job-detail-header .name', 'h1'])
  const salaryDesc = textFrom(['.salary', '.job-detail-header .salary'])
  const brandName = textFrom(['.company-name', '.company-info .name', '.sider-company .name'])
  const detail = {
    jobInfo: {
      encryptId: jobId,
      postDescription: description,
      ...(jobName ? { jobName, positionName: jobName } : {}),
      ...(salaryDesc ? { salaryDesc } : {}),
    },
    ...(brandName ? { brandComInfo: { brandName } } : {}),
  }
  try {
    assertCompleteJobDetail(detail, jobId)
    return { status: 'ready', jobId, detail }
  } catch (error) {
    return { status: 'pending', error: error instanceof Error ? error.message : String(error) }
  }
}
