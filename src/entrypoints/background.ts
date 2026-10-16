import { defineProxy } from 'comctx'

import { browser, defineBackground } from '#imports'
import { BackgroundCounter, ProvideBackgroundAdapter } from '@/message/background'

export default defineBackground({
  main() {
    const [provideBackgroundCounter] = defineProxy(() => new BackgroundCounter(), {
      namespace: '__boss-helper-background__',
    })

    provideBackgroundCounter(new ProvideBackgroundAdapter())

    if (browser.sidePanel) {
      void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    } else {
      browser.action.onClicked.addListener(() => {
        void browser.tabs.create({ url: browser.runtime.getURL('/workbench.html') })
      })
    }
  },
})
