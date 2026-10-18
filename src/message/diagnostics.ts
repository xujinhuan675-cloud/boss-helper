import { browser } from '#imports'

import {
  clearDiagnostics,
  configureDiagnostics,
  diagnostic,
  hydrateDiagnostics,
  normalizeDiagnostic,
  DIAGNOSTIC_SCRIPT_EVENT,
  getDiagnosticClearVersion,
} from '../utils/diagnostics'
import type { DiagnosticEvent, DiagnosticSource } from '../utils/diagnostics'

export const DIAGNOSTICS_KEY = 'boss-helper:diagnostics:v1'
const REPORT = 'boss-helper:diagnostic'
const CLEAR = 'boss-helper:diagnostic-clear'
let pending: Promise<unknown> = Promise.resolve()

function queueWrite(work: () => Promise<unknown>) {
  const saving = pending.then(work)
  pending = saving.catch(() => {})
  return saving
}

function persistDiagnostic(event: DiagnosticEvent) {
  return queueWrite(async () => {
    const data = await browser.storage.local.get(DIAGNOSTICS_KEY)
    const stored = Array.isArray(data[DIAGNOSTICS_KEY]) ? (data[DIAGNOSTICS_KEY] as unknown[]) : []
    const events = stored.slice(-199).flatMap((value) => {
      const entry = normalizeDiagnostic(value)
      return entry && entry.id !== event.id ? [entry] : []
    })
    await browser.storage.local.set({ [DIAGNOSTICS_KEY]: [...events, event] })
    return { ok: true }
  })
}

export function startExtensionDiagnostics(source: Exclude<DiagnosticSource, 'boss'>) {
  configureDiagnostics(source, (event) =>
    source === 'background'
      ? persistDiagnostic(event)
      : browser.runtime.sendMessage({ type: REPORT, event }).then((response) => {
          if (!response?.ok) throw new Error('Diagnostic persistence unavailable')
          return response
        }),
  )
  globalThis.addEventListener?.('unhandledrejection', (event) => {
    diagnostic(`unhandled.${source}`, { error: (event as PromiseRejectionEvent).reason })
  })
  globalThis.addEventListener?.('error', (event) => {
    diagnostic(`uncaught.${source}`, {
      error: (event as ErrorEvent).error ?? (event as ErrorEvent).message,
    })
  })
}

export function forwardPageDiagnostics(script: HTMLScriptElement) {
  script.addEventListener(DIAGNOSTIC_SCRIPT_EVENT, ((message: CustomEvent<string>) => {
    if (typeof message.detail !== 'string' || message.detail.length > 8000) return
    try {
      const event = normalizeDiagnostic(JSON.parse(message.detail))
      if (event)
        void browser.runtime
          .sendMessage({ type: REPORT, event: { ...event, source: 'boss' } })
          .then((response) => {
            if (!response?.ok) throw new Error('Diagnostic persistence unavailable')
          })
          .catch((error) => {
            diagnostic('diagnostics.forward', { error })
          })
    } catch {
      /* Ignore malformed page reports. */
    }
  }) as EventListener)
}

export function installDiagnosticReceiver() {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== REPORT && message?.type !== CLEAR) return undefined
    if (sender.id !== browser.runtime.id) return Promise.resolve({ ok: false })
    if (message.type === CLEAR)
      return queueWrite(async () => {
        await browser.storage.local.remove(DIAGNOSTICS_KEY)
        return { ok: true }
      }).catch(() => ({ ok: false }))
    const event = normalizeDiagnostic(message.event)
    if (!event) return Promise.resolve({ ok: false })
    if (sender.tab?.id !== undefined) {
      event.context.tabId = sender.tab.id
      event.context.frameId = sender.frameId ?? 0
    }
    return persistDiagnostic(event).catch(() => ({ ok: false }))
  })
}

export async function loadDiagnostics() {
  const version = getDiagnosticClearVersion()
  const data = await browser.storage.local.get(DIAGNOSTICS_KEY)
  if (version === getDiagnosticClearVersion()) hydrateDiagnostics(data[DIAGNOSTICS_KEY])
}

export async function clearSavedDiagnostics() {
  const response = await browser.runtime.sendMessage({ type: CLEAR })
  if (!response?.ok) throw new Error('诊断清空失败，请重试')
  clearDiagnostics()
}
