import { useSyncExternalStore } from 'react'

import { getWorkbenchState, subscribeWorkbench } from './store'

export function useWorkbench() {
  return useSyncExternalStore(subscribeWorkbench, getWorkbenchState)
}
