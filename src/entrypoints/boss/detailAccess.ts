import type { browser } from '#imports'

import { getJobSnapshotFromDetail } from './jobData'
import {
  DETAIL_ACCESS_KEY,
  DETAIL_MESSAGE,
  assertCompleteJobDetail,
  hasCompleteJobDetail,
  jobIdFromUrl,
} from './jobDetails'
import type { JobDetailPage } from './jobDetails'
import type { JobLibraryStorage } from './jobLibraryStorage'
import {
  AUTO_CAPTURE_STORAGE_KEY,
  JOB_LIBRARY_STORAGE_KEY,
  assertJobLibrary,
  isJobExcluded,
} from './jobStore'

export type DetailAccessCommand =
  | { type: 'claim'; token: string; deadline: number; historyToken?: string }
  | { type: 'renew' | 'release'; token: string }
  | { type: 'visit'; token: string; jobId: string; url: string }
  | { type: 'read'; token: string; jobId: string }
export type DetailAccessSession = {
  token: string
  ownerTabId: number
  tabId?: number
  jobId?: string
  deadline: number
  expiresAt: number
  historyToken?: string
  error?: string
}
type DetailStorage = {
  getItem<T>(key: `local:${string}` | `session:${string}`): Promise<T | null>
  setItem<T>(key: `local:${string}` | `session:${string}`, value: T): Promise<void>
}

// This is a tab ownership guard, not a second job queue. Existing runs own scheduling.
export class DetailTabAccess {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    private tabs: Pick<typeof browser.tabs, 'get' | 'create' | 'update' | 'remove' | 'sendMessage'>,
    private storage: DetailStorage,
    private library: JobLibraryStorage,
  ) {}

  command(command: DetailAccessCommand, ownerTabId: number): Promise<JobDetailPage | null> {
    return this.enqueue(() => this.execute(command, ownerTabId))
  }

  private enqueue<T>(work: () => Promise<T>) {
    const result = this.pending.then(work)
    this.pending = result.catch(() => {})
    return result
  }

  private async execute(
    command: DetailAccessCommand,
    ownerTabId: number,
  ): Promise<JobDetailPage | null> {
    if (!Number.isSafeInteger(ownerTabId) || !command?.token?.trim())
      throw new Error('缺少详情任务所有者')
    let session = await this.storage.getItem<DetailAccessSession>(DETAIL_ACCESS_KEY)
    if (command.type === 'claim') {
      if (!Number.isFinite(command.deadline) || command.deadline <= Date.now())
        throw new Error('详情运行已到时限')
      if (session && session.token !== command.token) {
        if (session.expiresAt > Date.now() && session.deadline > Date.now())
          throw new Error('已有详情任务正在另一页面运行')
        if (
          session.tabId !== undefined &&
          (await this.tabs.get(session.tabId).then(
            () => true,
            () => false,
          ))
        )
          throw new Error('上次详情任务已中断，请关闭其采集标签页后再手动继续')
        session = null
      }
      if (session && session.ownerTabId !== ownerTabId) throw new Error('详情任务所有权已失效')
      if (session?.error) throw new Error(session.error)
      const history = await this.library.historyDetails({ type: 'read' })
      if (
        history?.owner &&
        history.expiresAt > Date.now() &&
        history.owner !== command.historyToken
      )
        throw new Error('历史补全正在另一页面运行')
      session ??= {
        token: command.token,
        ownerTabId,
        deadline: command.deadline,
        expiresAt: 0,
        historyToken: command.historyToken,
      }
      session.expiresAt = Math.min(session.deadline, Date.now() + 90_000)
      await this.storage.setItem(DETAIL_ACCESS_KEY, session)
      return null
    }
    if (!session || session.token !== command.token || session.ownerTabId !== ownerTabId)
      throw new Error('详情任务所有权已失效')
    if (command.type === 'release') {
      if (session.tabId !== undefined) {
        const tabId = session.tabId
        await this.tabs.remove(tabId).catch(async () => {
          if (
            await this.tabs.get(tabId).then(
              () => true,
              () => false,
            )
          )
            throw new Error('无法关闭采集详情标签页，请手动关闭后继续')
        })
      }
      await this.storage.setItem(DETAIL_ACCESS_KEY, null)
      return null
    }
    if (session.error) throw new Error(session.error)
    if (session.deadline <= Date.now()) throw new Error('详情运行已到时限，请手动继续')
    if (session.expiresAt <= Date.now()) throw new Error('详情任务所有权已失效，请手动继续')
    session.expiresAt = Math.min(session.deadline, Date.now() + 90_000)
    if (session.tabId !== undefined) {
      try {
        await this.tabs.get(session.tabId)
      } catch {
        session.error = '采集详情标签页已被关闭，任务已中断，请手动继续'
        await this.storage.setItem(DETAIL_ACCESS_KEY, session)
        throw new Error(session.error)
      }
    }
    if (command.type === 'visit') {
      if (!command.jobId || jobIdFromUrl(command.url) !== command.jobId)
        throw new Error('详情 URL 岗位 ID 不匹配')
      const history = await this.library.historyDetails({ type: 'read' })
      if (
        session.historyToken &&
        (!history || history.owner !== session.historyToken || history.expiresAt <= Date.now())
      )
        throw new Error('历史补全任务所有权已失效')
      if (
        history?.owner &&
        history.expiresAt > Date.now() &&
        history.owner !== session.historyToken
      )
        throw new Error('历史补全正在另一页面运行')
      if (session.tabId === undefined) {
        const tab = await this.tabs.create({ url: command.url, active: false })
        if (tab.id === undefined) throw new Error('无法创建采集详情标签页')
        session.tabId = tab.id
      } else {
        await this.tabs.update(session.tabId, { url: command.url })
      }
      session.jobId = command.jobId
    }
    await this.storage.setItem(DETAIL_ACCESS_KEY, session)
    if (command.type !== 'read') return null
    if (session.tabId === undefined || session.jobId !== command.jobId)
      throw new Error('详情任务岗位 ID 不匹配')
    const tab = await this.tabs.get(session.tabId)
    if (tab.status === 'loading') return { status: 'pending', error: '等待详情页面加载' }
    let page: JobDetailPage
    try {
      page = await this.tabs.sendMessage(
        session.tabId,
        { type: DETAIL_MESSAGE, jobId: command.jobId },
        { frameId: 0 },
      )
    } catch {
      return { status: 'pending', error: '等待详情页面连接或页面已重定向' }
    }
    if (!page || typeof page.status !== 'string')
      return { status: 'pending', error: '等待详情正文' }
    if (['captcha', 'login_required', 'restricted'].includes(page.status)) {
      session.error = 'error' in page ? page.error : '详情页面访问受限'
      await this.storage.setItem(DETAIL_ACCESS_KEY, session)
    }
    if (page.status === 'ready') {
      const current = await this.tabs.get(session.tabId).catch(() => {
        throw new Error('采集详情标签页已被关闭，任务已中断')
      })
      if (jobIdFromUrl(current.url ?? '') !== command.jobId || page.jobId !== command.jobId)
        throw new Error('详情页面岗位 ID 不匹配，已拒绝保存')
      assertCompleteJobDetail(page.detail, command.jobId)
    }
    return page
  }

  async passive(page: JobDetailPage, sender: { id: number; url: string }) {
    if (page?.status !== 'ready' || jobIdFromUrl(sender.url) !== page.jobId)
      throw new Error('手动详情岗位 ID 不匹配')
    const tab = await this.tabs.get(sender.id)
    if (jobIdFromUrl(tab.url ?? '') !== page.jobId) throw new Error('手动详情岗位 ID 不匹配')
    const session = await this.storage.getItem<DetailAccessSession>(DETAIL_ACCESS_KEY)
    if (session?.tabId === sender.id) return { status: 'managed' }
    assertCompleteJobDetail(page.detail, page.jobId)
    const records = (await this.storage.getItem<unknown>(JOB_LIBRARY_STORAGE_KEY)) ?? []
    assertJobLibrary(records)
    const record = records.find((r) => r.encryptJobId === page.jobId)
    if (record && (isJobExcluded(record) || hasCompleteJobDetail(record)))
      return { status: 'skipped' }
    if (!record && (await this.storage.getItem(AUTO_CAPTURE_STORAGE_KEY)) !== true)
      return { status: 'disabled' }
    if (!record) {
      await this.library.update({
        type: 'capture',
        items: [getJobSnapshotFromDetail(page.detail)],
        keyword: '手动详情页',
        batch: 'manual-detail',
        newOnly: true,
      })
    }
    const result = await this.library.update({
      type: 'detail',
      jobId: page.jobId,
      patch: { detailStatus: 'complete', detail: page.detail },
    })
    return { status: result.updated ? 'saved' : 'skipped' }
  }

  tabRemoved(tabId: number) {
    return this.enqueue(async () => {
      const session = await this.storage.getItem<DetailAccessSession>(DETAIL_ACCESS_KEY)
      if (!session) return
      if (session.ownerTabId === tabId) {
        await this.execute({ type: 'release', token: session.token }, tabId)
      } else if (session.tabId === tabId) {
        session.error = '采集详情标签页已被关闭，任务已中断，请手动继续'
        await this.storage.setItem(DETAIL_ACCESS_KEY, session)
      }
    })
  }
}
