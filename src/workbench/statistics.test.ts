// @ts-nocheck
import { describe, expect, test } from 'bun:test'

import { isStatistics, statisticsHistory } from './statistics'

const day = (date) => ({ date, success: 2, total: 5, repeat: 1, activityFilter: 1, tasks: {} })
describe('persisted delivery statistics', () => {
  test('rejects malformed counters and dates before rendering', () => {
    expect(isStatistics(day('2026-10-16'))).toBe(true)
    for (const value of [
      null,
      [],
      day('bad'),
      { ...day('2026-10-16'), success: {} },
      { ...day('2026-10-16'), total: NaN },
    ])
      expect(isStatistics(value)).toBe(false)
  })
  test('uses calendar dates and counts today once at the cutoff', () => {
    const history = ['2026-10-17', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13'].map(day)
    expect(
      statisticsHistory(day('2026-10-16'), history, 3, new Date('2026-10-16T12:00:00')).map(
        (value) => value.date,
      ),
    ).toEqual(['2026-10-16', '2026-10-15', '2026-10-14'])
    expect(statisticsHistory(null, history, null, new Date('2026-10-16T12:00:00'))).toHaveLength(4)
  })
})
