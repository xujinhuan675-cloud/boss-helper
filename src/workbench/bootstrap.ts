import { setCounter } from '@/message'
import { BackgroundCounter } from '@/message/background'
import { ContentCounter } from '@/message/contentScript'

export async function startWorkbench(mode: 'sidepanel' | 'workbench') {
  setCounter(new ContentCounter(new BackgroundCounter()))
  const { mountWorkbench } = await import('./mount')
  mountWorkbench(mode)
}
