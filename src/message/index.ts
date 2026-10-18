import type { StorageLikeAsync } from '@vueuse/core'
import { defineProxy } from 'comctx'

import { connectBridge } from './bridge'
import type { ContentCounter } from './contentScript'
import { ProvideContentScriptAdapter } from './contentScriptShare'

export const InjectAdapter = ProvideContentScriptAdapter

let _counter: ContentCounter | null = null

export function setCounter(value: ContentCounter) {
  _counter = value
}

export function initCounter(
  script: HTMLScriptElement = document.currentScript as HTMLScriptElement,
) {
  const [, injectCounter] = defineProxy(() => ({}) as ContentCounter, {
    namespace: '__boss-helper-content__',
    heartbeatTimeout: 3000,
  })
  _counter = connectBridge(injectCounter, new InjectAdapter(script), 'boss.content')
}

export const counter = new Proxy({} as ContentCounter, {
  get(_, key) {
    if (!_counter) {
      throw new Error(
        `Counter has not been initialized. Call initCounter() before using counter.${String(key)}`,
      )
    }

    const value = (_counter as any)[key]

    if (typeof value === 'function') {
      return value.bind(_counter)
    }

    return value
  },

  set(_, key, value) {
    if (!_counter) {
      throw new Error(
        `Counter has not been initialized. Call initCounter() before using counter.${String(key)}`,
      )
    }

    ;(_counter as any)[key] = value
    return true
  },
})

export const ExtStorage: StorageLikeAsync = {
  async getItem(key) {
    const deadline = Date.now() + 5000
    while (!_counter && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100))
    if (!_counter) throw new Error('Configuration bridge did not initialize within 5000ms')
    return (await counter.storageGet(key)) as never
  },
  async setItem(key, value) {
    await counter.storageSet(key, value)
  },
  async removeItem(key) {
    await counter.storageRm(key)
  },
}
