import type { Adapter } from 'comctx'

import { diagnostic, safeDiagnosticText } from '../utils/diagnostics'

export function connectBridge<T extends object, M extends object>(
  inject: (adapter: Adapter<M>) => T,
  adapter: Adapter<M>,
  channel: string,
): T {
  return new Proxy({} as T, {
    get(_object, key) {
      if (typeof key !== 'string' || key === 'then') return undefined
      return async (...args: unknown[]) => {
        const started = performance.now()
        let rejectSend!: (error: unknown) => void
        const sendFailed = new Promise<never>((_, reject) => {
          rejectSend = reject
        })
        const cleanups = new Set<() => unknown>()
        let active = true
        const target = inject({
          name: adapter.name,
          onMessage: async (callback) => {
            const off = await adapter.onMessage(callback)
            if (off) {
              if (active) cleanups.add(off)
              else void off()
            }
            return off
          },
          sendMessage: async (message, transfer) => {
            if (!active) return
            try {
              await adapter.sendMessage(message, transfer)
            } catch (error) {
              // comctx does not await heartbeat sends; propagate through the public call.
              rejectSend(error)
            }
          },
        })
        try {
          return await Promise.race([
            Promise.resolve().then(() => {
              const method = Reflect.get(target, key) as (...values: unknown[]) => unknown
              return method.apply(target, args)
            }),
            sendFailed,
          ])
        } catch (error) {
          active = false
          for (const off of cleanups) void off()
          const event = diagnostic(`${channel}.${key}`, {
            error,
            durationMs: performance.now() - started,
          })
          throw new Error(
            `${safeDiagnosticText(error instanceof Error ? error.message : String(error))} [${channel}.${key}; ${event.id}]`,
            { cause: error },
          )
        }
      }
    },
  })
}

export function observeProvider<M extends object>(
  adapter: Adapter<M>,
  channel: string,
): Adapter<M> {
  return {
    name: adapter.name,
    onMessage: (callback) => adapter.onMessage(callback),
    sendMessage: async (message, transfer) => {
      try {
        await adapter.sendMessage(message, transfer)
      } catch (error) {
        diagnostic(`${channel}.reply`, {
          error,
          context: { namespace: message.namespace, method: message.path.join('.') },
        })
      }
    },
  }
}
