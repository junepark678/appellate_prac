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
