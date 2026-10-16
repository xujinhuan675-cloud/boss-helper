import { defineUnlistedScript } from '#imports'
import { initCounter } from '@/message'

export default defineUnlistedScript(async () => {
  // Capture currentScript before the asynchronous import and defer browser side effects.
  const script = document.currentScript as HTMLScriptElement
  initCounter(script)
  const { runBoss } = await import('./runtime')
  await runBoss(script)
})
