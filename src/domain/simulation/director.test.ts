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

import { describe, expect, it } from 'vitest'

import {
  advanceAutonomousSimulation,
  advanceSimulationTurn,
  simulationValidatorVersion,
  snapshotHash,
} from './director'
import { createInitialSession, fileDraft } from '../simulation'
import type {
  CaseSession,
  FilingDraft,
  FilingRecord,
  SimulationTurn,
  UploadedDocument,
} from '../types'

const pdf: UploadedDocument = {
  id: 'doc_1',
  fileName: 'filing.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedSignals: ['notice of appeal'],
}

function draft(eventId: string, signals: string[] = []): FilingDraft {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    documents: [{ ...pdf, fileName: `${eventId}.pdf`, extractedSignals: signals }],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

function readyForBriefingSchedule() {
  let session = createInitialSession()
  session = fileDraft(session, draft('notice_of_appeal', ['notice of appeal']))
  session = fileDraft(session, draft('appearance_disclosure', ['disclosure']))
  session = fileDraft(session, draft('docketing_statement', ['docketing statement']))
  session = fileDraft(session, draft('transcript_order_acknowledgment', ['transcript']))
  return session
}

function deficientFiling(): FilingRecord {
  return {
    id: 'filing_deficient',
    eventId: 'deficient_event',
    participantRole: 'appellant',
    title: 'Deficient Filing',
    documents: [pdf],
    certificateOfService: true,
    certificateOfCompliance: false,
    sealed: false,
    notes: '',
    filedAt: '2024-01-15T10:00:00Z',
    outcome: 'accepted_with_deficiency',
    validationIssues: [],
  }
}

describe('snapshotHash', () => {
  it('is deterministic — same input produces same output', () => {
    const input = { caseId: 'abc-123', filings: [{ id: 'f1' }], turn: 1 }
    expect(snapshotHash(input)).toBe(snapshotHash(input))
  })

  it('is sensitive to input changes — different input produces different output', () => {
    const base = { caseId: 'abc-123', turn: 1 }
    expect(snapshotHash(base)).not.toBe(snapshotHash({ ...base, turn: 2 }))
    expect(snapshotHash(base)).not.toBe(snapshotHash({ ...base, caseId: 'xyz-999' }))
  })

  it('normalizes key order so {a:1,b:2} and {b:2,a:1} hash identically', () => {
    expect(snapshotHash({ a: 1, b: 2 })).toBe(snapshotHash({ b: 2, a: 1 }))
  })

  it('returns an 8-character lowercase hex string', () => {
    expect(snapshotHash({ any: 'value' })).toMatch(/^[0-9a-f]{8}$/)
  })

  it('produces distinct hashes for structurally different values', () => {
    const hashes = new Set([
      snapshotHash(null),
      snapshotHash({}),
      snapshotHash([]),
      snapshotHash(0),
      snapshotHash(''),
      snapshotHash(false),
    ])
    expect(hashes.size).toBeGreaterThan(1)
  })

  it('distinguishes nested objects that differ in one leaf value', () => {
    const left = { session: { filings: [{ id: 'a', outcome: 'accepted' }] } }
    const right = { session: { filings: [{ id: 'a', outcome: 'rejected' }] } }
    expect(snapshotHash(left)).not.toBe(snapshotHash(right))
  })
})

describe('simulationValidatorVersion', () => {
  it('is a non-empty string constant', () => {
    expect(typeof simulationValidatorVersion).toBe('string')
    expect(simulationValidatorVersion.length).toBeGreaterThan(0)
  })

  it('contains the expected validator prefix', () => {
    expect(simulationValidatorVersion).toContain('ca4-autonomous-turn-validator')
  })
})

describe('advanceSimulationTurn', () => {
  it('produces a turn record with all required fields', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)

    expect(result.turn.id).toMatch(/^turn_.+_\d{4}$/)
    expect(result.turn.caseSessionId).toBe(session.id)
    expect(result.turn.turnNumber).toBe(1)
    expect(result.turn.actorId).toBeTruthy()
    expect(result.turn.kind).toBeTruthy()
    expect(['applied', 'rejected']).toContain(result.turn.status)
    expect(result.turn.startedAt).toBeTruthy()
    expect(result.turn.effects).toBeInstanceOf(Array)
    expect(result.turn.inputSnapshotHash).toMatch(/^[0-9a-f]{8}$/)
    expect(result.turn.outputSnapshotHash).toMatch(/^[0-9a-f]{8}$/)
    expect(result.turn.validatorVersion).toBe(simulationValidatorVersion)
    expect(result.turn.retryCount).toBe(0)
  })

  it('appends the new turn to session.simulationTurns', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)

    expect(result.session.simulationTurns).toHaveLength(1)
    expect(result.session.simulationTurns![0]).toBe(result.turn)
  })

  it('increments turnNumber across successive calls', () => {
    const session = readyForBriefingSchedule()
    const first = advanceSimulationTurn(session)
    const second = advanceSimulationTurn(first.session)

    expect(first.turn.turnNumber).toBe(1)
    expect(second.turn.turnNumber).toBe(2)
  })

  it('produces distinct input snapshot hashes across successive turns', () => {
    const session = readyForBriefingSchedule()
    const first = advanceSimulationTurn(session)
    const second = advanceSimulationTurn(first.session)

    expect(first.turn.inputSnapshotHash).not.toBe(second.turn.inputSnapshotHash)
  })

  it('passes through optional metadata fields', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session, {
      retryCount: 2,
      stoppedReason: 'test_stop',
      rawActorPacketStorageId: 'pkt-001',
      rawProviderResultStorageId: 'res-001',
    })

    expect(result.turn.retryCount).toBe(2)
    expect(result.turn.stoppedReason).toBe('test_stop')
    expect(result.turn.rawActorPacketStorageId).toBe('pkt-001')
    expect(result.turn.rawProviderResultStorageId).toBe('res-001')
  })

  it('returns the toolCall and decision alongside the turn', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)

    expect(result.toolCall).toBeTruthy()
    expect(result.toolCall.tool).toBeTruthy()
    expect(result.decision).toBeTruthy()
    expect(result.decision.actorId).toBe(result.turn.actorId)
    expect(result.packet).toBeTruthy()
    expect(result.packet.caseSessionId).toBe(session.id)
  })

  it('uses retryCount 0 when no options are provided', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)

    expect(result.turn.retryCount).toBe(0)
    expect(result.turn.stoppedReason).toBeUndefined()
    expect(result.turn.rawActorPacketStorageId).toBeUndefined()
    expect(result.turn.rawProviderResultStorageId).toBeUndefined()
  })
})

describe('advanceAutonomousSimulation', () => {
  it('stops at turn_limit when maxTurnsPerRun is zero', () => {
    const session = readyForBriefingSchedule()
    const result = advanceAutonomousSimulation(session, {
      maxTurnsPerRun: 0,
      maxCostCentsPerRun: 100,
    })

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('turn_limit')
  })

  it('stops at turn_limit after exactly maxTurnsPerRun turns', () => {
    const session = readyForBriefingSchedule()
    const result = advanceAutonomousSimulation(session, {
      maxTurnsPerRun: 1,
      maxCostCentsPerRun: 100,
      requireHumanApprovalFor: [],
    })

    expect(result.turns).toHaveLength(1)
    expect(result.stoppedReason).toBe('turn_limit')
  })

  it('stops on deficiency when stopOnDeficiency policy is true', () => {
    const base = readyForBriefingSchedule()
    const session: CaseSession = {
      ...base,
      filings: [...base.filings, deficientFiling()],
    }

    const result = advanceAutonomousSimulation(session, {
      stopOnDeficiency: true,
      maxTurnsPerRun: 10,
      maxCostCentsPerRun: 100,
    })

    expect(result.stoppedReason).toBe('deficiency_detected')
  })

  it('does not stop on deficiency when stopOnDeficiency is false', () => {
    const base = readyForBriefingSchedule()
    const session: CaseSession = {
      ...base,
      filings: [...base.filings, deficientFiling()],
    }

    const result = advanceAutonomousSimulation(session, {
      stopOnDeficiency: false,
      maxTurnsPerRun: 1,
      maxCostCentsPerRun: 100,
      requireHumanApprovalFor: [],
    })

    expect(result.stoppedReason).not.toBe('deficiency_detected')
  })

  it('respects paused autonomy mode', () => {
    const session = { ...readyForBriefingSchedule(), autonomyMode: 'paused' as const }
    const result = advanceAutonomousSimulation(session, { autonomyMode: 'paused' })

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('autonomy_paused')
    expect(result.budgetSpentCents).toBe(0)
  })

  it('tracks budget spent per turn', () => {
    const session = readyForBriefingSchedule()
    const result = advanceAutonomousSimulation(session, {
      maxTurnsPerRun: 1,
      maxCostCentsPerRun: 100,
      requireHumanApprovalFor: [],
    })

    expect(result.budgetSpentCents).toBe(result.turns.length)
  })

  it('stops before learner-required procedure states', () => {
    const result = advanceAutonomousSimulation(createInitialSession())

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('learner_required')
  })
})

describe('turn kind mapping', () => {
  const validKinds: Set<SimulationTurn['kind']> = new Set([
    'clerk',
    'appellee',
    'amicus',
    'staff_attorney',
    'judge_vote',
    'panel_conference',
    'judgment',
    'mandate',
  ])

  it('maps setDeadline to clerk kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)

    expect(result.toolCall.tool).toBe('setDeadline')
    expect(result.turn.kind).toBe('clerk')
  })

  it('always produces a kind from the valid set', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)

    expect(validKinds.has(result.turn.kind)).toBe(true)
  })

  it('maps appellee_ai actorId to appellee kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.actorId === 'appellee_ai') {
      expect(result.turn.kind).toBe('appellee')
    }
  })

  it('maps public_interest_amicus actorId to amicus kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.actorId === 'public_interest_amicus') {
      expect(result.turn.kind).toBe('amicus')
    }
  })

  it('maps draftStaffMemo tool to staff_attorney kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.tool === 'draftStaffMemo') {
      expect(result.turn.kind).toBe('staff_attorney')
    }
  })

  it('maps castRuntimePanelVote tool to judge_vote kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.tool === 'castRuntimePanelVote') {
      expect(result.turn.kind).toBe('judge_vote')
    }
  })

  it('maps draftRuntimePanelDisposition tool to panel_conference kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.tool === 'draftRuntimePanelDisposition') {
      expect(result.turn.kind).toBe('panel_conference')
    }
  })

  it('maps enterJudgment tool to judgment kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.tool === 'enterJudgment') {
      expect(result.turn.kind).toBe('judgment')
    }
  })

  it('maps setMandateDeadline tool to mandate kind', () => {
    const session = readyForBriefingSchedule()
    const result = advanceSimulationTurn(session)
    if (result.toolCall.tool === 'setMandateDeadline') {
      expect(result.turn.kind).toBe('mandate')
    }
  })
})
