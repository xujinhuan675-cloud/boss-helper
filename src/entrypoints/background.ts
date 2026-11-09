import { defineProxy } from 'comctx'

import { browser, defineBackground } from '#imports'
import {
  BackgroundCounter,
  ProvideBackgroundAdapter,
  installDetailAccess,
} from '@/message/background'

import { observeProvider } from '../message/bridge'
import {
  installDiagnosticReceiver,
  mirrorSavedDiagnostics,
  startExtensionDiagnostics,
} from '../message/diagnostics'
import { installExtensionReload } from '../message/extensionReload'
import { EXECUTOR_MESSAGE_TYPE } from '../workbench/protocol'

export default defineBackground({
  main() {
    installExtensionReload()
    browser.runtime.onConnectNative?.addListener((port) => {
      if (port.name !== 'cc.offerhunt.diagnostics') return
      port.onMessage.addListener((message) => {
        if (message?.type !== 'apply-search' || typeof message.keyword !== 'string') return
        void (async () => {
          try {
            const tabs = await browser.tabs.query({ url: ['https://www.zhipin.com/web/geek/*'] })
            if (!tabs[0]?.id) throw new Error('No OfferHunt-enabled BOSS job-search tab')
            const url = tabs[0].url!
            const current = new URL(url)
            const filters = {
              query: message.keyword,
              city: current.searchParams.get('city') ?? '',
              jobType: current.searchParams.get('jobType') ?? '',
              salary: current.searchParams.get('salary') ?? '',
              experience: (current.searchParams.get('experience') ?? '').split(',').filter(Boolean),
              degree: (current.searchParams.get('degree') ?? '').split(',').filter(Boolean),
              stage: (current.searchParams.get('stage') ?? '').split(',').filter(Boolean),
              scale: (current.searchParams.get('scale') ?? '').split(',').filter(Boolean),
              industry: (current.searchParams.get('industry') ?? '').split(',').filter(Boolean),
            }
            const result = await browser.tabs.sendMessage(tabs[0].id, {
              type: EXECUTOR_MESSAGE_TYPE,
              command: { type: 'applyNativeFilters', filters },
            })
            if (result?.ok === false) throw new Error(result.error)
            port.postMessage(result)
          } catch (error) {
            port.postMessage({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })()
      })
    })
    installDetailAccess()
    installDiagnosticReceiver()
    startExtensionDiagnostics('background')
    void mirrorSavedDiagnostics().catch(() => {})
    const [provideBackgroundCounter] = defineProxy(() => new BackgroundCounter(), {
      namespace: '__boss-helper-background__',
    })

    provideBackgroundCounter(observeProvider(new ProvideBackgroundAdapter(), 'background'))

    if (browser.sidePanel) {
      void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    } else {
      browser.action.onClicked.addListener(() => {
        void browser.tabs.create({ url: browser.runtime.getURL('/workbench.html') })
      })
    }
  },
})
