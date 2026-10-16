import { counter } from '@/message'
import type { FormDataRange } from '@/types/formData'

export { parseFiltering } from './scoring'

export function rangeMatchFormat(v: FormDataRange, unit: string): string {
  return `${v[0]} - ${v[1]} ${unit} ${v[2] ? '严格' : '宽松'}`
}

// 匹配范围
export function rangeMatch(rangeStr: string, form: FormDataRange): boolean {
  if (!rangeStr) return false
  let [start, end, mode] = form // mode: true=严格(包含)，false=宽松(重叠)
  if (start > end) {
    ;[start, end] = [end, start]
  }
  const re = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/
  const m = String(rangeStr).match(re)
  if (!m) return false

  let inputStart = Number.parseFloat(m[1])
  let inputEnd = Number.parseFloat(m[2] != null ? m[2] : m[1])
  if (!Number.isFinite(inputStart) || !Number.isFinite(inputEnd)) return false

  if (inputStart > inputEnd) {
    ;[inputStart, inputEnd] = [inputEnd, inputStart]
  }
  // console.log({
  //     inputStart,inputEnd,start,end
  // })
  if (mode) {
    // 严格：职位范围(input) 完全覆盖 目标范围(form)
    return start <= inputStart && inputEnd <= end
  } else {
    // 宽松：任意重叠（闭区间）
    return Math.max(inputStart, start) <= Math.min(inputEnd, end)
  }
}

export async function loadSet(key: string, uid: string): Promise<Map<string, number>> {
  const raw = await counter.storageGet<Record<string, string[] | Record<string, number>>>(key, {})

  const map = new Map<string, number>()

  const value = raw[uid]

  const entries = Array.isArray(value)
    ? value.map((id) => [id, 0] as const)
    : Object.entries(value ?? {})

  for (const [id, time] of entries) {
    map.set(id, time)
  }

  return map
}

export async function saveSet(key: string, uid: string, map: Map<string, number>, EXPIRE = 0) {
  const now = Date.now()
  const expire = now - EXPIRE
  if (EXPIRE > 0) {
    // GC
    for (const [id, time] of map) {
      if (time < expire) {
        map.delete(id)
      }
    }
  }

  const old = await counter.storageGet(key, {})

  await counter.storageSet(key, {
    ...old,
    [uid]: Object.fromEntries(map),
  })
}
