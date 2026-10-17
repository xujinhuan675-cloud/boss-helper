import { defineProxy } from 'comctx'

import { setCounter } from '@/message'
import type { BackgroundCounter } from '@/message/background'
import { InjectBackgroundAdapter } from '@/message/background'
import { ContentCounter } from '@/message/contentScript'

export async function startWorkbench(mode: 'sidepanel' | 'workbench') {
  const [, injectBackground] = defineProxy(() => ({}) as BackgroundCounter, {
    namespace: '__boss-helper-background__',
  })
  setCounter(new ContentCounter(injectBackground(new InjectBackgroundAdapter('popup'))))
  const { mountWorkbench } = await import('./mount')
  mountWorkbench(mode)
}
