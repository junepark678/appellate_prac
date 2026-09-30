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

