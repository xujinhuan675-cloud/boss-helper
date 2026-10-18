export type DiagnosticSource = 'workbench' | 'boss' | 'content' | 'background'
export type DiagnosticEvent = {
  id: string
  time: string
  source: DiagnosticSource
  operation: string
  level: 'info' | 'warning' | 'error'
  durationMs?: number
  error?: string
  context: Record<string, string | number | boolean>
}

const contextKeys = new Set([
  'namespace',
  'method',
  'tabId',
  'frameId',
  'visibility',
  'statusCode',
  'endpoint',
  'status',
  'phase',
  'count',
  'matchedTerm',
  'evidenceSource',
  'timeoutMs',
])
let source: DiagnosticSource = 'workbench'
let sink: ((event: DiagnosticEvent) => unknown) | undefined
let events: DiagnosticEvent[] = []
let storageError = false
let clearVersion = 0
const listeners = new Set<() => void>()
const modelErrors = new WeakSet<object>()
export const DIAGNOSTIC_SCRIPT_EVENT = '_boss-helper-diagnostic_'
export const getDiagnostics = () => events
export const getDiagnosticClearVersion = () => clearVersion
export const hasDiagnosticStorageError = () => storageError
export const subscribeDiagnostics = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const changed = () => {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* A diagnostics view cannot interrupt business work. */
    }
  }
}

export function safeDiagnosticText(value: string) {
  return value
    .replace(/((?:状态码[:：]\s*|请求错误\s*|HTTP\s+)[45]\d{2})[^\r\n]*/gi, '$1 [response omitted]')
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
      try {
        return new URL(url).origin
      } catch {
        return '[URL]'
      }
    })
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[\w-]+/g, '[redacted]')
    .replace(
      /((?:api[_-]?key|authorization|token|password|cookie)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[redacted]',
    )
    .split(/[\r\n{]/, 1)[0]!
    .slice(0, 400)
}

export function configureDiagnostics(next: DiagnosticSource, send?: typeof sink) {
  source = next
  sink = send
}

export function startPageDiagnostics(script: HTMLScriptElement) {
  configureDiagnostics('boss', (event) => {
    script.dispatchEvent(
      new CustomEvent(DIAGNOSTIC_SCRIPT_EVENT, { detail: JSON.stringify(event) }),
    )
  })
}

export function normalizeDiagnostic(value: unknown): DiagnosticEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as DiagnosticEvent
  if (
    typeof event.id !== 'string' ||
    event.id.length > 80 ||
    !event.id ||
    typeof event.time !== 'string' ||
    !Number.isFinite(Date.parse(event.time)) ||
    !['workbench', 'boss', 'content', 'background'].includes(event.source) ||
    typeof event.operation !== 'string' ||
    !/^[\w.:-]{1,160}$/.test(event.operation) ||
    !['info', 'warning', 'error'].includes(event.level)
  )
    return null
  const context: DiagnosticEvent['context'] = {}
  for (const [key, val] of Object.entries(event.context ?? {})) {
    if (!contextKeys.has(key)) continue
    if (typeof val === 'string') context[key] = safeDiagnosticText(val)
    else if (typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val)))
      context[key] = val
  }
  return {
    id: event.id,
    time: event.time,
    source: event.source,
    operation: event.operation,
    level: event.level,
    context,
    ...(typeof event.error === 'string' ? { error: safeDiagnosticText(event.error) } : {}),
    ...(typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
      ? { durationMs: Math.max(0, event.durationMs) }
      : {}),
  }
}

export function hydrateDiagnostics(stored: unknown) {
  if (!Array.isArray(stored)) return
  const merged = new Map(events.map((event) => [event.id, event]))
  for (const value of stored.slice(-200)) {
    const event = normalizeDiagnostic(value)
    if (event) merged.set(event.id, event)
  }
  events = [...merged.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-200)
  changed()
}

export function clearDiagnostics() {
  clearVersion++
  events = []
  changed()
}

export function diagnostic(
  operation: string,
  options: {
    level?: DiagnosticEvent['level']
    error?: unknown
    durationMs?: number
    context?: Record<string, unknown>
  } = {},
) {
  const error = options.error as
    | { name?: string; message?: string; statusCode?: number }
    | undefined
  if (operation.startsWith('model.') && error && typeof error === 'object') modelErrors.add(error)
  // API errors may echo prompts in their message; retain only their type and status.
  let description: string | undefined
  if (error?.statusCode !== undefined)
    description = `${error.name || 'HTTPError'} HTTP ${error.statusCode}`
  else if (options.error !== undefined) {
    const sensitive =
      operation.startsWith('model.') ||
      operation === 'analysis.finish' ||
      operation === 'rotation.finish' ||
      error instanceof SyntaxError ||
      (error && typeof error === 'object' && modelErrors.has(error))
    if (sensitive) description = error?.name || 'ModelError'
    else if (error instanceof Error) description = error.message
    else if (typeof options.error === 'string') description = options.error
    else description = error?.name || 'UnknownError'
  }
  const event = normalizeDiagnostic({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    source,
    operation,
    level: options.level ?? (options.error === undefined ? 'info' : 'error'),
    error: description,
    durationMs: options.durationMs,
    context: {
      ...(typeof document !== 'undefined' ? { visibility: document.visibilityState } : {}),
      ...options.context,
      ...(error?.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
    },
  })!
  const previous = events.at(-1)
  if (
    event.level === 'error' &&
    previous?.source === event.source &&
    previous.operation === event.operation &&
    previous.error === event.error &&
    JSON.stringify(previous.context) === JSON.stringify(event.context) &&
    Date.parse(event.time) - Date.parse(previous.time) < 10000
  )
    return previous
  events = [...events, event].slice(-200)
  changed()
  const failed = () => {
    if (!storageError) {
      storageError = true
      changed()
    }
  }
  try {
    void Promise.resolve(sink?.(event))
      .then((result) => {
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
          failed()
          return
        }
        if (storageError) {
          storageError = false
          changed()
        }
      })
      .catch(failed)
  } catch {
    failed()
  }
  return event
}

export async function traceDiagnostic<T>(
  operation: string,
  work: () => Promise<T>,
  context?: Record<string, unknown>,
) {
  const started = performance.now()
  try {
    const result = await work()
    diagnostic(operation, { durationMs: performance.now() - started, context })
    return result
  } catch (error) {
    diagnostic(operation, { error, durationMs: performance.now() - started, context })
    throw error
  }
}
