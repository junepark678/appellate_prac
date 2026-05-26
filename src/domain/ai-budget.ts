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
