import { EXECUTOR_MESSAGE_TYPE } from './protocol'
import type { ExecutorRequest, ExecutorResponse } from './protocol'

export async function requestExecutor(
  send: (tabId: number, request: ExecutorRequest) => Promise<unknown>,
  tabId: number,
  command: ExecutorRequest['command'],
) {
  const response = (await send(tabId, { type: EXECUTOR_MESSAGE_TYPE, command })) as
    | ExecutorResponse
    | undefined
  if (!response || typeof response.ok !== 'boolean')
    throw new Error('BOSS 标签页未连接新执行器，请刷新该页面')
  if (!response.ok) throw new Error(response.error || '执行器拒绝了操作')
  return response.data
}
