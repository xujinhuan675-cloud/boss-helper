import type { Adapter, Message, OnMessage, SendMessage } from 'comctx'
import { openDB } from 'idb'

import type { Browser } from '#imports'
import { browser, storage } from '#imports'
import type { ResponseType } from '@/utils/request'

import { JobLibraryStorage } from '../entrypoints/boss/jobLibraryStorage'
import type { JobLibraryMutation } from '../entrypoints/boss/jobLibraryStorage'
import { diagnostic, traceDiagnostic } from '../utils/diagnostics'

const jobLibrary = new JobLibraryStorage(storage)

export const userKey = 'local:conf-user'

const DB_NAME = 'ExtensionGlobalDB'
const STORE_NAME = 'images'

async function initDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    },
  })
}

export class BackgroundCounter {
  async updateJobLibrary(mutation: JobLibraryMutation) {
    return jobLibrary.update(mutation)
  }

  async claimJobAnalysis(jobId: string, token: string, duration: number) {
    return jobLibrary.claimAnalysis(jobId, token, duration)
  }

  async releaseJobAnalysis(jobId: string, token: string) {
    await jobLibrary.releaseAnalysis(jobId, token)
  }

  async fetchText(args: { url: string; data: RequestInit; timeout: number }) {
    return traceDiagnostic(
      'network.fetchText',
      async () => {
        const signal = AbortSignal.timeout(args.timeout)
        const res = await fetch(args.url, {
          ...args.data,
          signal,
          mode: 'cors',
          credentials: 'omit',
        })
        if (!res.ok)
          diagnostic('network.http', {
            level: 'error',
            context: { endpoint: args.url, statusCode: res.status },
          })
        return {
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          text: await res.text(),
        }
      },
      { endpoint: args.url, timeoutMs: args.timeout },
    )
  }

  async request(args: {
    url: string
    data: RequestInit
    timeout: number
    responseType: ResponseType
  }) {
    return traceDiagnostic(
      'network.request',
      async () => {
        const signal = AbortSignal.timeout(args.timeout * 1000)

        const res = await fetch(args.url, {
          ...args.data,
          signal,
          mode: 'cors',
          credentials: 'include',
        }).then(async (res) => {
          if (!res.ok || res.status >= 400) {
            const errorText = await res.text()
            throw Object.assign(new Error(`状态码: ${res.status}: ${errorText}`), {
              statusCode: res.status,
            })
          }

          const result = args.responseType === 'json' ? await res.json() : await res.text()

          return result
        })
        return res
      },
      { endpoint: args.url, timeoutMs: args.timeout * 1000 },
    )
  }

  async notify(args: Browser.notifications.NotificationCreateOptions) {
    await browser.notifications.create({
      type: args.type,
      iconUrl: args.iconUrl,
      title: args.title,
      message: args.message,
    })
    return true
  }

  async backgroundTest(type: 'success' | 'error') {
    if (type === 'error') {
      throw new Error(`background test error date: ${Date.now()}`)
    }
    return Date.now()
  }

  async fetch(...args: Parameters<typeof fetch>) {
    return await fetch(...args)
  }
  async getImage(key: string): Promise<
    | { success: false }
    | {
        success: true
        name: string
        type: string
        buffer: number[]
      }
  > {
    const db = await initDB()
    const file: File | undefined = await db.get(STORE_NAME, key)
    if (!file) {
      return { success: false }
    }
    const arrayBuffer = await file.arrayBuffer()
    return {
      success: true,
      name: file.name,
      type: file.type,
      buffer: Array.from(new Uint8Array(arrayBuffer)),
    }
  }
  async setImage(opt: {
    name: string
    type: string
    buffer: number[]
  }): Promise<{ success: boolean; key: string }> {
    const db = await initDB()
    const file = new File([new Uint8Array(opt.buffer).buffer], opt.name, { type: opt.type })
    const key = `img-${await calculateFileMD5(file)}`
    await db.put(STORE_NAME, file, key)
    return { success: true, key }
  }
}

interface MessageMeta {
  url: string
  injector: 'content' | 'popup'
  tabId?: number
  frameId?: number
}

export class ProvideBackgroundAdapter implements Adapter<MessageMeta> {
  sendMessage: SendMessage<MessageMeta> = async (message) => {
    switch (message.meta.injector) {
      case 'content': {
        if (message.meta.tabId === undefined) throw new Error('Missing reply tab')
        await browser.tabs.sendMessage(message.meta.tabId, message, {
          frameId: message.meta.frameId ?? 0,
        })
        break
      }
      case 'popup': {
        await browser.runtime.sendMessage(message).catch((error) => {
          if (error.message.includes('Receiving end does not exist')) {
            return
          }
          throw error
        })
        break
      }
    }
  }
  onMessage: OnMessage<MessageMeta> = (callback) => {
    const handler = (
      message: Partial<Message<MessageMeta>> | undefined,
      sender: Browser.runtime.MessageSender,
    ) => {
      if (!message?.meta) {
        return callback(message)
      }
      callback({
        ...message,
        meta: {
          ...message.meta,
          injector: message?.sender?.name as MessageMeta['injector'],
          tabId: sender.tab?.id,
          frameId: sender.frameId,
        },
      })
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }
}

export class InjectBackgroundAdapter implements Adapter<MessageMeta> {
  constructor(public name: MessageMeta['injector'] = 'content') {}
  sendMessage: SendMessage<MessageMeta> = (message) => {
    return browser.runtime.sendMessage(browser.runtime.id, {
      ...message,
      meta: { url: document.location.href, injector: this.name },
    } satisfies Message<MessageMeta>)
  }
  onMessage: OnMessage<MessageMeta> = (callback) => {
    const handler = (message?: Partial<Message<MessageMeta>>) => {
      callback(message)
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }
}
