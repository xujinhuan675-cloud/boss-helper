import { counter } from '@/message'

export { parseFiltering } from './scoring'

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
