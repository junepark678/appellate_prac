import { describe, expect, it } from 'vitest'

import {
  aiSpentCents,
  billableAiRuns,
  isStaleAiReservation,
  staleAiReservationMs,
} from './ai-budget'

describe('AI budget accounting', () => {
  it('excludes stale in-flight reservations from spent budget', () => {
    const nowIso = '2026-05-26T12:00:00.000Z'
    const staleCreatedAt = new Date(
      Date.parse(nowIso) - staleAiReservationMs,
    ).toISOString()
    const activeCreatedAt = new Date(Date.parse(nowIso) - 30_000).toISOString()
    const runs = [
      {
        costCents: 3,
        createdAt: staleCreatedAt,
        errorClass: 'in_flight',
      },
      {
        costCents: 2,
        createdAt: activeCreatedAt,
        errorClass: 'in_flight',
      },
      {
        costCents: 5,
        createdAt: staleCreatedAt,
      },
    ]

    expect(isStaleAiReservation(runs[0], nowIso)).toBe(true)
    expect(isStaleAiReservation(runs[1], nowIso)).toBe(false)
    expect(billableAiRuns(runs, nowIso)).toEqual([runs[1], runs[2]])
    expect(aiSpentCents(runs, nowIso)).toBe(7)
  })
})
