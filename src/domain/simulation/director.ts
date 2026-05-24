import { nextAmicusParticipationAction } from '../amicus/participation-engine'
import { normalizeActorDecision } from '../actors/decisions'
import { buildActorPacket } from '../actors/packets'
import { nextCounterpartyReaction } from '../counterparty/reactive-strategy'
import { applyToolCall } from '../simulation'
import {
  inferProcedureState,
  nextProcedureToolCall,
  transitionAfterFiling,
} from '../procedure/state-machine'
import type {
  ActorDecision,
  ActorPacket,
  CaseSession,
  SimulationTurn,
  ToolCall,
} from '../types'

export type SimulationTurnResult = {
  session: CaseSession
  turn: SimulationTurn
  packet: ActorPacket
  decision: ActorDecision
  toolCall: ToolCall
}

function makeTurnId(session: CaseSession, turnNumber: number) {
  return `turn_${session.id}_${String(turnNumber).padStart(4, '0')}`
}

function kindForToolCall(toolCall: ToolCall): SimulationTurn['kind'] {
  if (toolCall.actorId === 'appellee_ai') return 'appellee'
  if (toolCall.actorId === 'public_interest_amicus') return 'amicus'
  if (toolCall.tool === 'draftStaffMemo') return 'staff_attorney'
  if (toolCall.tool === 'castRuntimePanelVote') return 'judge_vote'
  if (toolCall.tool === 'draftRuntimePanelDisposition') return 'panel_conference'
  if (toolCall.tool === 'enterJudgment') return 'judgment'
  if (toolCall.tool === 'setMandateDeadline') return 'mandate'
  return 'clerk'
}

function taskForToolCall(toolCall: ToolCall) {
  if ('title' in toolCall) return toolCall.title
  if ('eventId' in toolCall && typeof toolCall.eventId === 'string') {
    return `File ${toolCall.eventId.replaceAll('_', ' ')}`
  }
  return toolCall.tool.replaceAll('_', ' ')
}

function selectNextToolCall(session: CaseSession): ToolCall {
  const procedureState = session.procedureState ?? inferProcedureState(session)
  const counterparty = nextCounterpartyReaction(session)
  if (counterparty) return counterparty

  const amicus = nextAmicusParticipationAction(session)
  if (amicus && procedureState !== 'reply_brief_pending') return amicus

  return nextProcedureToolCall({ ...session, procedureState })
}

export function advanceSimulationTurn(
  session: CaseSession,
  options: { debugRejectedAttempts?: boolean } = {},
): SimulationTurnResult {
  const toolCall = selectNextToolCall(session)
  const turnNumber = (session.simulationTurns?.length ?? 0) + 1
  const startedAt = session.simulatedDate
  const packet = buildActorPacket(session, toolCall.actorId, taskForToolCall(toolCall))
  const decision = normalizeActorDecision(session, toolCall.actorId, toolCall)
  const accepted = decision.validationIssues.every((issue) => issue.severity !== 'error')
  const appliedSession = accepted
    ? transitionAfterFiling(applyToolCall(session, toolCall))
    : options.debugRejectedAttempts
      ? applyToolCall(session, toolCall)
      : session
  const completedAt = appliedSession.simulatedDate
  const turn: SimulationTurn = {
    id: makeTurnId(session, turnNumber),
    caseSessionId: session.id,
    turnNumber,
    actorId: toolCall.actorId,
    kind: kindForToolCall(toolCall),
    status: accepted ? 'applied' : 'rejected',
    startedAt,
    completedAt,
    effects: accepted
      ? [
          toolCall.tool,
          appliedSession.docketEntries.at(-1)?.title ?? taskForToolCall(toolCall),
        ]
      : decision.validationIssues.map((issue) => issue.message),
  }

  return {
    session: {
      ...appliedSession,
      simulationTurns: [...(session.simulationTurns ?? []), turn],
    },
    turn,
    packet,
    decision,
    toolCall,
  }
}
