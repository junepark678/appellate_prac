import type { CaseSession, Deadline, DocketEffect, DocketEntry } from '../types'

function makeId(prefix: string, count: number) {
  return `${prefix}_${String(count + 1).padStart(4, '0')}`
}

function addDays(dateIso: string, days: number) {
  const date = new Date(dateIso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

export function appendDocketEffect(
  session: CaseSession,
  effect: DocketEffect,
): CaseSession {
  const entry: DocketEntry = {
    id: makeId('dkt', session.docketEntries.length),
    entryNumber: session.docketEntries.length + 1,
    filedAt: session.simulatedDate,
    actorRole: effect.actorRole,
    title: effect.title,
    text: effect.text,
    ...(effect.filingId ? { filingId: effect.filingId } : {}),
    ruleRefs: effect.ruleRefs,
  }

  return {
    ...session,
    docketEntries: [...session.docketEntries, entry],
  }
}

export function appendDeadline(
  session: CaseSession,
  label: string,
  targetEventId: string,
  offsetDays: number,
  sourceRuleRefs: Deadline['sourceRuleRefs'],
): CaseSession {
  const sourceEntry = session.docketEntries.at(-1)
  const deadline: Deadline = {
    id: makeId('deadline', session.deadlines.length),
    label,
    dueDate: addDays(session.simulatedDate, offsetDays),
    targetEventId,
    sourceEntryId: sourceEntry?.id ?? 'manual',
    status: 'open',
    sourceRuleRefs,
  }

  return {
    ...session,
    deadlines: [...session.deadlines, deadline],
  }
}

