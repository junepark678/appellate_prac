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

export type AiBudgetRun = {
  costCents: number
  createdAt: string
  errorClass?: string
}

export const staleAiReservationMs = 5 * 60 * 1000

export function isStaleAiReservation(
  run: Pick<AiBudgetRun, 'createdAt' | 'errorClass'>,
  nowIso: string,
  staleAfterMs = staleAiReservationMs,
) {
  if (run.errorClass !== 'in_flight') return false

  const createdAtMs = Date.parse(run.createdAt)
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false

  return nowMs - createdAtMs >= staleAfterMs
}

export function billableAiRuns<T extends AiBudgetRun>(
  runs: readonly T[],
  nowIso: string,
  staleAfterMs = staleAiReservationMs,
) {
  return runs.filter((run) => !isStaleAiReservation(run, nowIso, staleAfterMs))
}

export function aiSpentCents(
  runs: readonly AiBudgetRun[],
  nowIso: string,
  staleAfterMs = staleAiReservationMs,
) {
  return billableAiRuns(runs, nowIso, staleAfterMs).reduce(
    (sum, run) => sum + run.costCents,
    0,
  )
}
