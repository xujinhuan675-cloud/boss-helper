import { defineProxy } from 'comctx'

import { browser, defineContentScript, injectScript } from '#imports'
import type { BackgroundCounter } from '@/message/background'
import { InjectBackgroundAdapter } from '@/message/background'
import { ContentCounter } from '@/message/contentScript'
import { ProvideContentScriptAdapter } from '@/message/contentScriptShare'
import type { RuntimeBridge } from '@/workbench/protocol'
import { EXECUTOR_NAMESPACE, handleExecutorMessage } from '@/workbench/protocol'

export default defineContentScript({
  matches: ['*://zhipin.com/*', '*://*.zhipin.com/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  async main() {
    const [, injectBackgroundCounter] = defineProxy(() => ({}) as BackgroundCounter, {
      namespace: '__boss-helper-background__',
    })

    const [provideContentCounter] = defineProxy(
      () => new ContentCounter(injectBackgroundCounter(new InjectBackgroundAdapter())),
      {
        namespace: '__boss-helper-content__',
        heartbeatTimeout: 3000,
      },
    )
    const [, injectExecutor] = defineProxy(() => ({}) as RuntimeBridge, {
      namespace: EXECUTOR_NAMESPACE,
    })

    await injectScript('/boss.js', {
      keepInDom: true,
      modifyScript(script) {
        const adapter = new ProvideContentScriptAdapter(script)
        provideContentCounter(adapter)
        const executor = injectExecutor(adapter)
        browser.runtime.onMessage.addListener((message, sender) =>
          handleExecutorMessage(message, sender, browser.runtime.id, executor),
        )
      },
    })
  },
})
