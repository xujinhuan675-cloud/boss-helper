import type { StorageItemKey } from '#imports'
import { storage } from '#imports'
import { browser } from '#imports'

import type { DetailAccessCommand } from '../entrypoints/boss/detailAccess'
import { DETAIL_MESSAGE } from '../entrypoints/boss/jobDetails'
import type { JobDetailPage } from '../entrypoints/boss/jobDetails'
import type { BackgroundCounter } from './background'
export { ProvideContentAdapter } from './contentScriptShare'

function genKey(key: string): StorageItemKey {
  const prefixes = ['local:', 'session:', 'sync:', 'managed:'] as const
  return prefixes.some((prefix) => key.startsWith(prefix)) ? (key as StorageItemKey) : `sync:${key}`
}

export class ContentCounter implements BackgroundCounter {
  public background: BackgroundCounter
  public routerHooks: Array<(path: string) => void> = []

  constructor(background: BackgroundCounter) {
    this.background = background
  }

  async detailAccess(command: DetailAccessCommand): Promise<JobDetailPage | null> {
    const result = await browser.runtime.sendMessage({
      type: DETAIL_MESSAGE,
      action: 'access',
      command,
    })
    if (!result?.ok) throw new Error(result?.error || '详情标签页通道不可用')
    return result.page ?? null
  }

  _addRouterHook(hook: (path: string) => void) {
    this.routerHooks.push(hook)
  }

  async callRouterHooks(path: string) {
    for (const hook of this.routerHooks) {
      try {
        hook(path)
      } catch (e) {
        console.error('调用路由hook失败', e)
      }
    }
  }

  async request(...args: Parameters<BackgroundCounter['request']>) {
    return this.background.request(...args)
  }

  async updateJobLibrary(...args: Parameters<BackgroundCounter['updateJobLibrary']>) {
    return this.background.updateJobLibrary(...args)
  }

  async historyDetails(...args: Parameters<BackgroundCounter['historyDetails']>) {
    return this.background.historyDetails(...args)
  }

  async claimJobAnalysis(...args: Parameters<BackgroundCounter['claimJobAnalysis']>) {
    return this.background.claimJobAnalysis(...args)
  }

  async releaseJobAnalysis(...args: Parameters<BackgroundCounter['releaseJobAnalysis']>) {
    return this.background.releaseJobAnalysis(...args)
  }

  async fetchText(...args: Parameters<BackgroundCounter['fetchText']>) {
    return this.background.fetchText(...args)
  }

  async recognizeJobScreenshot(...args: Parameters<BackgroundCounter['recognizeJobScreenshot']>) {
    return this.background.recognizeJobScreenshot(...args)
  }

  async notify(...args: Parameters<BackgroundCounter['notify']>) {
    return this.background.notify(...args)
  }

  async backgroundTest(...args: Parameters<BackgroundCounter['backgroundTest']>) {
    return this.background.backgroundTest(...args)
  }

  async fetch(...args: Parameters<typeof fetch>) {
    return this.background.fetch(...args)
  }

  async getImage(...args: Parameters<BackgroundCounter['getImage']>) {
    return this.background.getImage(...args)
  }
  async setImage(...args: Parameters<BackgroundCounter['setImage']>) {
    return this.background.setImage(...args)
  }

  async storageGet<T>(key: string, defaultValue: T): Promise<T>
  async storageGet<T>(key: string): Promise<T | null>
  async storageGet<T>(key: string, defaultValue?: T): Promise<T | null> {
    return storage.getItem<T>(genKey(key), { fallback: defaultValue })
  }

  async storageSet<T>(key: string, value: T) {
    await storage.setItem(genKey(key), value)
    return true
  }

  async storageRm(key: string) {
    await storage.removeItem(genKey(key))
    return true
  }

  async contentScriptTest(type: 'success' | 'error') {
    if (type === 'error') {
      throw new Error(`test error date: ${Date.now()}`)
    }
    return Date.now()
  }
}
