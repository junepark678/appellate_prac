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
