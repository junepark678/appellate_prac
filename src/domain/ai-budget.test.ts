/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
