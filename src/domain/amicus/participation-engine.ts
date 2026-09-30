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

import { recommendAmicusParticipation } from './workflow'
import type { CaseSession, ToolCall } from '../types'

function filedEvents(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

export function nextAmicusParticipationAction(session: CaseSession): ToolCall | null {
  const events = filedEvents(session)
  if (!events.has('opening_brief')) return null
  if (events.has('amicus_brief') || events.has('motion_for_leave_to_file_amicus')) return null

  const participation = session.amicusParticipation ?? recommendAmicusParticipation(session)
  const candidate = participation.candidates.find((item) => item.recommended)
  if (!candidate) return null

  if (candidate.requiresLeave && candidate.consentStatus !== 'all_parties_consent') {
    return {
      tool: 'fileCounterpartyDocument',
      actorId: 'public_interest_amicus',
      eventId: 'motion_for_leave_to_file_amicus',
      title: `Motion for Leave to File Amicus Brief by ${candidate.organizationName}`,
      text: `${candidate.organizationName} seeks leave to file an amicus brief because ${candidate.rationale}`,
    }
  }

  return {
    tool: 'fileCounterpartyDocument',
    actorId: 'public_interest_amicus',
    eventId: 'amicus_brief',
    title: `Amicus Brief of ${candidate.organizationName}`,
    text: `${candidate.organizationName} files an amicus brief with a distinct interest statement supporting ${candidate.supportsRole}.`,
  }
}
