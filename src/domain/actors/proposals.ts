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
import type { CaseSession, ToolCall, ToolValidationResult } from '../types'

export const proposalOnlyTools = new Set<ToolCall['tool']>([
  'recommendClerkAction',
  'draftClerkOrder',
  'draftCounterpartyFiling',
  'recommendAmicusParticipation',
  'draftBenchMemo',
  'castPanelVote',
  'draftPanelDisposition',
  'draftAssessmentFeedback',
])

export function validateAiProposal(
  session: CaseSession,
  toolCall: ToolCall,
): ToolValidationResult {
  const actor = getCourtPack(session.courtPackId).aiActors.find(
    (candidate) => candidate.id === toolCall.actorId,
  )
  const issues: string[] = []

  if (!actor) {
    issues.push('Actor is not registered for this court pack.')
  } else if (!actor.allowedTools.includes(toolCall.tool)) {
    issues.push(`${actor.label} is not authorized to propose ${toolCall.tool}.`)
  }

  if (!proposalOnlyTools.has(toolCall.tool)) {
    issues.push(`${toolCall.tool} is not an AI proposal-only tool.`)
  }

  if (
    toolCall.tool === 'draftPanelDisposition' &&
    !['submitted', 'panel_deliberation'].includes(session.procedureState ?? session.status)
  ) {
    issues.push('Panel disposition proposals require submitted or panel-deliberation posture.')
  }

  return { accepted: issues.length === 0, issues }
}
