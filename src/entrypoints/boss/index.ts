import { defineUnlistedScript } from '#imports'
import { initCounter } from '@/message'

export default defineUnlistedScript(async () => {
  // Capture currentScript before the asynchronous import and defer browser side effects.
  initCounter()
  const { runBoss } = await import('./runtime')
  await runBoss()
})
