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

import { advanceAutonomousSimulation, advanceSimulationTurn } from './director'
import { createInitialSession, fileDraft } from '../simulation'
import type { FilingDraft, UploadedDocument } from '../types'

const pdf: UploadedDocument = {
  id: 'doc_1',
  fileName: 'filing.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedSignals: ['notice of appeal', 'disclosure', 'docketing statement', 'transcript'],
}

function draft(eventId: string, signals: string[]): FilingDraft {
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

describe('autonomous simulation safety', () => {
  it('stops before learner-required filings', () => {
    const result = advanceAutonomousSimulation(createInitialSession())

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('learner_required')
  })


  it('stops when criminal CJA disclosure is still pending', () => {
    let session = createInitialSession('synthetic-ca4-criminal-sentencing-waiver')
    session = fileDraft(session, draft('criminal_notice_of_appeal', ['notice of appeal']))
    session = fileDraft(session, draft('appearance_disclosure', ['disclosure']))
    session = fileDraft(session, draft('criminal_docketing_statement', ['docketing statement']))

    const result = advanceAutonomousSimulation(session, { stopOnDeficiency: false })

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('learner_required')
  })

  it('stops for original-writ answer stage after setting one answer deadline', () => {
    let session = createInitialSession('synthetic-ca4-original-writ-discovery')
    session = fileDraft(session, draft('petition_for_writ_mandamus', ['writ']))
    session = fileDraft(session, draft('appearance_disclosure', ['disclosure']))
    session = fileDraft(session, draft('writ_docketing_statement', ['docketing statement']))
    session = fileDraft(session, draft('appendix_to_writ_petition', ['record']))

    const result = advanceAutonomousSimulation(session, { stopOnDeficiency: false })

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('learner_required')
  })

  it('records deterministic audit hashes on each turn', () => {
    const result = advanceSimulationTurn(readyForBriefingSchedule())

    expect(result.turn.inputSnapshotHash).toMatch(/^[0-9a-f]{8}$/)
    expect(result.turn.outputSnapshotHash).toMatch(/^[0-9a-f]{8}$/)
    expect(result.turn.validatorVersion).toContain('ca4-autonomous-turn-validator')
    expect(result.turn.retryCount).toBe(0)
  })

  it('runs bounded turns and then stops on the next learner obligation', () => {
    const result = advanceAutonomousSimulation(readyForBriefingSchedule(), {
      maxTurnsPerRun: 3,
      maxCostCentsPerRun: 3,
      requireHumanApprovalFor: ['enterJudgment'],
    })

    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]?.effects[0]).toBe('setDeadline')
    expect(result.stoppedReason).toBe('learner_required')
    expect(result.budgetSpentCents).toBe(1)
  })

  it('honors pause mode before any mutation', () => {
    const result = advanceAutonomousSimulation(
      { ...readyForBriefingSchedule(), autonomyMode: 'paused' },
      { autonomyMode: 'paused' },
    )

    expect(result.turns).toHaveLength(0)
    expect(result.stoppedReason).toBe('autonomy_paused')
  })
})
