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
  AutonomousRunStopReason,
  AutonomousSimulationRun,
  CaseSession,
  SimulationTurn,
  SimulationPolicy,
  ToolCall,
} from '../types'

export const simulationValidatorVersion = 'ca4-autonomous-turn-validator-v1'

export type SimulationTurnResult = {
  session: CaseSession
  turn: SimulationTurn
  packet: ActorPacket
  decision: ActorDecision
  toolCall: ToolCall
}

const defaultTurnPolicy = {
  maxTurnsPerRun: 1,
  requireHumanApprovalFor: ['disposeCase', 'enterJudgment'],
  stopOnDeficiency: true,
}

const learnerRequiredStates = new Set([
  'notice_pending',
  'appearance_pending',
  'docketing_statement_pending',
  'record_ordering_pending',
  'opening_brief_pending',
  'appendix_pending',
  'reply_brief_pending',
])

function makeTurnId(session: CaseSession, turnNumber: number) {
  return `turn_${session.id}_${String(turnNumber).padStart(4, '0')}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`
}

export function snapshotHash(value: unknown) {
  const text = stableStringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
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

function learnerStopReason(session: CaseSession): AutonomousRunStopReason | null {
  const procedureState = session.procedureState ?? inferProcedureState(session)
  return learnerRequiredStates.has(procedureState) ? 'learner_required' : null
}

function deficiencyStopReason(session: CaseSession): AutonomousRunStopReason | null {
  return session.filings.some((filing) => filing.outcome === 'accepted_with_deficiency')
    ? 'deficiency_detected'
    : null
}

function policyForSession(
  session: CaseSession,
  policy?: Partial<SimulationPolicy>,
): Pick<
  SimulationPolicy,
  'autonomyMode' | 'maxTurnsPerRun' | 'maxCostCentsPerRun' | 'requireHumanApprovalFor' | 'stopOnDeficiency'
> {
  const sessionPolicy = session.turnPolicy ?? defaultTurnPolicy
  return {
    autonomyMode: policy?.autonomyMode ?? session.autonomyMode ?? 'paused',
    maxTurnsPerRun: policy?.maxTurnsPerRun ?? sessionPolicy.maxTurnsPerRun,
    maxCostCentsPerRun: policy?.maxCostCentsPerRun ?? 25,
    requireHumanApprovalFor:
      policy?.requireHumanApprovalFor ?? sessionPolicy.requireHumanApprovalFor,
    stopOnDeficiency: policy?.stopOnDeficiency ?? sessionPolicy.stopOnDeficiency,
  }
}

export function advanceSimulationTurn(
  session: CaseSession,
  options: {
    debugRejectedAttempts?: boolean
    retryCount?: number
    stoppedReason?: string
    rawActorPacketStorageId?: string
    rawProviderResultStorageId?: string
  } = {},
): SimulationTurnResult {
  const toolCall = selectNextToolCall(session)
  const turnNumber = (session.simulationTurns?.length ?? 0) + 1
  const startedAt = session.simulatedDate
  const inputSnapshotHash = snapshotHash({
    session,
    toolCall,
    validatorVersion: simulationValidatorVersion,
  })
  const packet = buildActorPacket(session, toolCall.actorId, taskForToolCall(toolCall))
  const decision = normalizeActorDecision(session, toolCall.actorId, toolCall)
  const accepted = decision.validationIssues.every((issue) => issue.severity !== 'error')
  const appliedSession = accepted
    ? transitionAfterFiling(applyToolCall(session, toolCall))
    : options.debugRejectedAttempts
      ? applyToolCall(session, toolCall)
      : session
  const completedAt = appliedSession.simulatedDate
  const outputSnapshotHash = snapshotHash({
    session: appliedSession,
    decision,
    accepted,
  })
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
    inputSnapshotHash,
    outputSnapshotHash,
    validatorVersion: simulationValidatorVersion,
    retryCount: options.retryCount ?? 0,
    ...(options.stoppedReason ? { stoppedReason: options.stoppedReason } : {}),
    ...(options.rawActorPacketStorageId
      ? { rawActorPacketStorageId: options.rawActorPacketStorageId }
      : {}),
    ...(options.rawProviderResultStorageId
      ? { rawProviderResultStorageId: options.rawProviderResultStorageId }
      : {}),
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

export function advanceAutonomousSimulation(
  session: CaseSession,
  policy?: Partial<SimulationPolicy>,
): AutonomousSimulationRun {
  const effectivePolicy = policyForSession(session, policy)
  if (effectivePolicy.autonomyMode === 'paused') {
    return { session, turns: [], stoppedReason: 'autonomy_paused', budgetSpentCents: 0 }
  }

  let current = session
  const turns: SimulationTurn[] = []
  let budgetSpentCents = 0
  let stoppedReason: AutonomousRunStopReason = 'turn_limit'

  for (let index = 0; index < effectivePolicy.maxTurnsPerRun; index += 1) {
    if (budgetSpentCents >= effectivePolicy.maxCostCentsPerRun) {
      stoppedReason = 'budget_limit'
      break
    }

    if (effectivePolicy.stopOnDeficiency) {
      const deficiency = deficiencyStopReason(current)
      if (deficiency) {
        stoppedReason = deficiency
        break
      }
    }

    const learnerRequired = learnerStopReason(current)
    if (learnerRequired) {
      stoppedReason = learnerRequired
      break
    }

    const nextToolCall = selectNextToolCall(current)
    if (effectivePolicy.requireHumanApprovalFor.includes(nextToolCall.tool)) {
      stoppedReason = 'human_approval_required'
      break
    }

    const previousHash = snapshotHash(current)
    const result = advanceSimulationTurn(current)
    turns.push(result.turn)
    budgetSpentCents += 1
    current = result.session

    if (result.turn.status === 'rejected') {
      stoppedReason = 'validator_rejection'
      break
    }

    if (previousHash === snapshotHash(current)) {
      stoppedReason = 'unhandled_legal_issue'
      break
    }
  }

  return {
    session: current,
    turns,
    stoppedReason,
    budgetSpentCents,
  }
}
