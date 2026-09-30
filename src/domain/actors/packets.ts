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

import { getCourtPack } from '../packs'
import { evaluateRelief } from '../legal/evaluators'
import { ca4SourceBackedConstraints } from '../rules/ca4-source-profile'
import type { ActorPacket, AiActorRole, CaseSession, RuleRef } from '../types'

function acceptedFilingSummaries(session: CaseSession): ActorPacket['filingSummaries'] {
  return session.filings
    .filter((filing) => filing.outcome !== 'rejected')
    .map((filing) => ({
      filingId: filing.id,
      eventId: filing.eventId,
      participantRole: filing.participantRole,
      title: filing.title,
      filedAt: filing.filedAt,
    }))
}

function sourceFacts(session: CaseSession) {
  return [
    `${session.scenario.shortCaption} in ${session.scenario.lowerTribunal}`,
    session.scenario.proceduralPosture,
    ...session.scenario.issuesPresented,
    ...(session.scenario.recordExcerpts?.slice(0, 5).map((excerpt) => excerpt.text) ?? []),
  ]
}

function ruleConstraints() {
  return ca4SourceBackedConstraints.map((constraint) => ({
    code: constraint.constraintId,
    ruleRefs: constraint.ruleRefs as RuleRef[],
    sourceVersionIds: constraint.sourceVersionIds,
    summary: constraint.cureSuggestion,
  }))
}

export function buildActorPacket(
  session: CaseSession,
  actorId: string,
  task: string,
): ActorPacket {
  const actor = getCourtPack(session.courtPackId).aiActors.find(
    (candidate) => candidate.id === actorId,
  )
  const relief = evaluateRelief(session)

  return {
    caseSessionId: session.id,
    actorId,
    role: actor?.role ?? ('staff_attorney' as AiActorRole | 'staff_attorney'),
    task,
    allowedTools: actor?.allowedTools ?? [],
    sourceFacts: sourceFacts(session),
    docketSnapshot: session.docketEntries.filter((entry) => entry.filingId || entry.actorRole !== 'judge'),
    filingSummaries: acceptedFilingSummaries(session),
    ruleConstraints: ruleConstraints(),
    availableRelief: relief.availableRelief,
    forbiddenActions: [
      'Do not cite uncited procedural rules.',
      'Do not invent filings, docket entries, record facts, or unavailable relief.',
      'Do not act outside the actor authority and allowed tools.',
    ],
  }
}
