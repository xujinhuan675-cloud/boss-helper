import { browser } from '#imports'

import {
  clearDiagnostics,
  configureDiagnostics,
  diagnostic,
  hydrateDiagnostics,
  normalizeDiagnostic,
  DIAGNOSTIC_SCRIPT_EVENT,
  getDiagnosticClearVersion,
  safeDiagnosticText,
} from '../utils/diagnostics'
import type { DiagnosticEvent, DiagnosticSource } from '../utils/diagnostics'

export const DIAGNOSTICS_KEY = 'boss-helper:diagnostics:v1'
export const DIAGNOSTICS_MIRROR_KEY = 'boss-helper:diagnostics-mirror:v1'
export type DiagnosticMirrorStatus = {
  ok: boolean
  path?: string
  exportedAt?: string
  error?: string
}
const REPORT = 'boss-helper:diagnostic'
const CLEAR = 'boss-helper:diagnostic-clear'
const SYNC = 'boss-helper:diagnostic-sync'
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
    await mirrorDiagnostics([...events, event])
    return { ok: true }
  })
}

async function mirrorDiagnostics(events: DiagnosticEvent[]): Promise<DiagnosticMirrorStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let status: DiagnosticMirrorStatus
  try {
    const result = await Promise.race([
      browser.runtime.sendNativeMessage('cc.offerhunt.diagnostics', {
        type: 'snapshot',
        version: browser.runtime.getManifest().version,
        events,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native diagnostics timeout')), 5000)
      }),
    ])
    if (
      !result?.ok ||
      typeof result.path !== 'string' ||
      !Number.isFinite(Date.parse(result.exportedAt))
    )
      throw new Error('Native diagnostics unavailable')
    status = { ok: true, path: result.path, exportedAt: result.exportedAt }
  } catch (error) {
    status = {
      ok: false,
      error: safeDiagnosticText(
        error instanceof Error ? error.message : 'Native diagnostics unavailable',
      ),
    }
  } finally {
    clearTimeout(timer)
  }
  // Mirroring failure must never turn a successful local save into a business failure.
  await browser.storage.local.set({ [DIAGNOSTICS_MIRROR_KEY]: status }).catch(() => {})
  return status
}

export function mirrorSavedDiagnostics() {
  return queueWrite(async () => {
    const stored = (await browser.storage.local.get(DIAGNOSTICS_KEY))[DIAGNOSTICS_KEY]
    const events = (Array.isArray(stored) ? stored.slice(-200) : []).flatMap((value) => {
      const event = normalizeDiagnostic(value)
      return event ? [event] : []
    })
    return mirrorDiagnostics(events)
  })
}

export async function syncDiagnosticMirror(): Promise<DiagnosticMirrorStatus> {
  return browser.runtime.sendMessage({ type: SYNC })
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
    if (message?.type !== REPORT && message?.type !== CLEAR && message?.type !== SYNC)
      return undefined
    if (sender.id !== browser.runtime.id) return Promise.resolve({ ok: false })
    if (message.type === SYNC) return mirrorSavedDiagnostics()
    if (message.type === CLEAR)
      return queueWrite(async () => {
        await browser.storage.local.remove(DIAGNOSTICS_KEY)
        await mirrorDiagnostics([])
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
