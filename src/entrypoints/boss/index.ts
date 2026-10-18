import { defineUnlistedScript } from '#imports'
import { initCounter } from '@/message'

import { diagnostic, startPageDiagnostics } from '../../utils/diagnostics'

export default defineUnlistedScript(async () => {
  // Capture currentScript before the asynchronous import and defer browser side effects.
  const script = document.currentScript as HTMLScriptElement
  startPageDiagnostics(script)
  initCounter(script)
  try {
    const { runBoss } = await import('./runtime')
    await runBoss(script)
  } catch (error) {
    diagnostic('boss.bootstrap', { error })
    throw error
  }
})
