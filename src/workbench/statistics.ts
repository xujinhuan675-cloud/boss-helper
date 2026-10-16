import type { Statistics } from '@/types/formData'

export function isStatistics(value: unknown): value is Statistics {
  if (!value || typeof value !== 'object') return false
  const day = value as Partial<Statistics>
  return (
    typeof day.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
    ['success', 'total', 'repeat', 'activityFilter'].every((key) => {
      const count = day[key as 'success' | 'total' | 'repeat' | 'activityFilter']
      return typeof count === 'number' && Number.isFinite(count) && count >= 0
    })
  )
}

export function statisticsHistory(
  today: Statistics | null,
  history: Statistics[],
  days: number | null,
  now = new Date(),
): Statistics[] {
  const cutoff = new Date(now)
  cutoff.setHours(0, 0, 0, 0)
  if (days !== null) cutoff.setDate(cutoff.getDate() - days + 1)
  const seen = new Set<string>()
  return [today, ...history]
    .filter((day): day is Statistics => {
      if (!day || seen.has(day.date)) return false
      seen.add(day.date)
      const timestamp = new Date(`${day.date}T00:00:00`).getTime()
      return timestamp <= now.getTime() && (days === null || timestamp >= cutoff.getTime())
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
