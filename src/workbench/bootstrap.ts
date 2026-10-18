import { defineProxy } from 'comctx'

import { browser } from '#imports'
import { setCounter } from '@/message'
import type { BackgroundCounter } from '@/message/background'
import { InjectBackgroundAdapter } from '@/message/background'
import { ContentCounter } from '@/message/contentScript'

import { connectBridge } from '../message/bridge'
import { DIAGNOSTICS_KEY, loadDiagnostics, startExtensionDiagnostics } from '../message/diagnostics'
import { clearDiagnostics, diagnostic } from '../utils/diagnostics'

export async function startWorkbench(mode: 'sidepanel' | 'workbench') {
  startExtensionDiagnostics('workbench')
  void loadDiagnostics().catch((error) => diagnostic('diagnostics.load', { error }))
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[DIAGNOSTICS_KEY]) {
      if (changes[DIAGNOSTICS_KEY].newValue === undefined) clearDiagnostics()
      else void loadDiagnostics().catch((error) => diagnostic('diagnostics.load', { error }))
    }
  })
  const [, injectBackground] = defineProxy(() => ({}) as BackgroundCounter, {
    namespace: '__boss-helper-background__',
    heartbeatTimeout: 3000,
  })
  setCounter(
    new ContentCounter(
      connectBridge(injectBackground, new InjectBackgroundAdapter('popup'), 'workbench.background'),
    ),
  )
  const { mountWorkbench } = await import('./mount')
  mountWorkbench(mode)
}
