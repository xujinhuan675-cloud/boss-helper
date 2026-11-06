import { defineProxy } from 'comctx'

import { browser, defineContentScript, injectScript } from '#imports'
import type { BackgroundCounter } from '@/message/background'
import { InjectBackgroundAdapter } from '@/message/background'
import { ContentCounter } from '@/message/contentScript'
import { ProvideContentScriptAdapter } from '@/message/contentScriptShare'
import type { RuntimeBridge } from '@/workbench/protocol'
import {
  EXECUTOR_NAMESPACE,
  EXECUTOR_UPDATE_MESSAGE_TYPE,
  handleExecutorMessage,
} from '@/workbench/protocol'

import { connectBridge, observeProvider } from '../message/bridge'
import { forwardPageDiagnostics, startExtensionDiagnostics } from '../message/diagnostics'
import { diagnostic } from '../utils/diagnostics'
import { installJobDetailReader } from './boss/jobDetailContent'
import { jobIdFromUrl } from './boss/jobDetails'

export default defineContentScript({
  matches: ['*://zhipin.com/*', '*://*.zhipin.com/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  async main() {
    installJobDetailReader(browser.runtime, document)
    if (jobIdFromUrl(location.href) || !/^\/web\/geek\//.test(location.pathname)) return
    startExtensionDiagnostics('content')
    const [, injectBackgroundCounter] = defineProxy(() => ({}) as BackgroundCounter, {
      namespace: '__boss-helper-background__',
      heartbeatTimeout: 3000,
    })

    const [provideContentCounter] = defineProxy(
      () =>
        new ContentCounter(
          connectBridge(
            injectBackgroundCounter,
            new InjectBackgroundAdapter(),
            'content.background',
          ),
        ),
      {
        namespace: '__boss-helper-content__',
        heartbeatTimeout: 3000,
      },
    )
    const [, injectExecutor] = defineProxy(() => ({}) as RuntimeBridge, {
      namespace: EXECUTOR_NAMESPACE,
      heartbeatTimeout: 3000,
    })

    await injectScript('/boss.js', {
      keepInDom: true,
      modifyScript(script) {
        const adapter = new ProvideContentScriptAdapter(script)
        forwardPageDiagnostics(script)
        provideContentCounter(observeProvider(adapter, 'content'))
        const executor = connectBridge(injectExecutor, adapter, 'content.executor')
        void executor
          .subscribe((snapshot) => {
            void browser.runtime.sendMessage({ type: EXECUTOR_UPDATE_MESSAGE_TYPE, snapshot })
          })
          .catch((error) => diagnostic('executor.subscribe', { error }))
        browser.runtime.onMessage.addListener((message, sender) =>
          handleExecutorMessage(message, sender, browser.runtime.id, executor),
        )
      },
    }).catch((error) => {
      diagnostic('content.inject', { error })
      throw error
    })
  },
})
