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

import { validateToolCall } from '../simulation'
import type { ActorCitation, ActorDecision, CaseSession, ToolCall, ValidationIssue } from '../types'

function issue(message: string): ValidationIssue {
  return {
    severity: 'error',
    code: 'actor_decision_invalid',
    message,
    ruleRefs: [],
    cureSuggestion: 'Regenerate the actor decision with an authorized tool and source citations.',
  }
}

export function normalizeActorDecision(
  session: CaseSession,
  actorId: string,
  toolCall: ToolCall,
  citations: ActorCitation[] = [],
  confidence = 0.75,
): ActorDecision {
  const validation = validateToolCall(session, toolCall)
  return {
    actorId,
    tool: toolCall.tool,
    workProduct: toolCall,
    citations,
    confidence,
    validationIssues: validation.issues.map(issue),
  }
}

export function actorDecisionAccepted(decision: ActorDecision) {
  return decision.validationIssues.every((candidate) => candidate.severity !== 'error')
}
