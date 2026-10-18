import { defineProxy } from 'comctx'

import { browser, defineBackground } from '#imports'
import { BackgroundCounter, ProvideBackgroundAdapter } from '@/message/background'

import { observeProvider } from '../message/bridge'
import { installDiagnosticReceiver, startExtensionDiagnostics } from '../message/diagnostics'

export default defineBackground({
  main() {
    installDiagnosticReceiver()
    startExtensionDiagnostics('background')
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
