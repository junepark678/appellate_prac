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

import { ruleRefs } from '../../modules/registry'
import { createInitialSession, fileDraft } from '../simulation'
import {
  addBenchMemo,
  addPanelVote,
  assignPanel,
  canSubmitToPanel,
  createPanelDisposition,
  deterministicPanelVote,
  enterPanelDisposition,
  validatePanelDisposition,
  validatePanelVote,
} from './deliberation'
import type { FilingDraft, PanelVote, UploadedDocument } from '../types'

const noticePdf: UploadedDocument = {
  id: 'notice',
  fileName: 'notice-of-appeal.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Notice of appeal from final judgment.',
  extractedSignals: ['notice of appeal'],
}

const disclosurePdf: UploadedDocument = {
  id: 'disclosure',
  fileName: 'appearance-disclosure.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Disclosure statement.',
  extractedSignals: ['disclosure'],
}

const docketingPdf: UploadedDocument = {
  id: 'docketing',
  fileName: 'docketing-statement.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Docketing statement.',
  extractedSignals: ['docketing statement'],
}

const transcriptPdf: UploadedDocument = {
  id: 'transcript',
  fileName: 'transcript-order-acknowledgment.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Transcript order acknowledgment.',
  extractedSignals: ['transcript'],
}

const briefPdf: UploadedDocument = {
  id: 'brief',
  fileName: 'opening-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 200_000,
  pageCount: 32,
  extractedText:
    'Jurisdictional statement. Statement of issues. Standard of review. Argument with record citation and oral argument statement. Conclusion.',
  extractedSignals: [
    'jurisdiction',
    'statement of issues',
    'standard of review',
    'argument',
    'record citation',
    'oral argument',
    'conclusion',
  ],
}

const appendixPdf: UploadedDocument = {
  id: 'appendix',
  fileName: 'joint-appendix.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 200_000,
  extractedText: 'Joint appendix with pagination and J.A. 42 comparator evidence.',
  extractedSignals: ['appendix', 'pagination', 'record citation'],
}

const appelleePdf: UploadedDocument = {
  id: 'appellee',
  fileName: 'appellee-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 180_000,
  extractedText: 'Argument. Standard of review. Record citation. Conclusion.',
  extractedSignals: ['argument', 'standard of review', 'record citation', 'conclusion'],
}

const replyPdf: UploadedDocument = {
  id: 'reply',
  fileName: 'reply-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 150_000,
  extractedText: 'Reply brief with argument and conclusion.',
  extractedSignals: ['reply', 'argument', 'conclusion'],
}

function draft(
  eventId: string,
  document: UploadedDocument,
  participantRole: FilingDraft['participantRole'] = 'appellant',
): FilingDraft {
  return {
    eventId,
    participantRole,
    title: eventId,
    documents: [document],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

function briefedSession() {
  let session = createInitialSession()
  session = fileDraft(session, draft('notice_of_appeal', noticePdf))
  session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
  session = fileDraft(session, draft('docketing_statement', docketingPdf))
  session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptPdf))
  session = fileDraft(session, draft('opening_brief', briefPdf))
  session = fileDraft(session, draft('joint_appendix', appendixPdf))
  return session
}

function submittedSession() {
  let session = briefedSession()
  session = fileDraft(session, draft('appellee_brief', appelleePdf, 'appellee'))
  session = fileDraft(session, draft('reply_brief', replyPdf))
  return assignPanel({ ...session, status: 'submitted', procedureState: 'panel_deliberation' })
}

describe('assignPanel', () => {
  it('creates panel assignment with 3 judges', () => {
    const session = submittedSession()

    expect(session.panelAssignment).toBeDefined()
    expect(session.panelAssignment!.judgeActorIds).toHaveLength(3)
    expect(session.panelAssignment!.presidingJudgeActorId).toBe('ca4_judge_1')
    expect(session.panelAssignment!.oralArgumentDisposition).toBe('submitted_on_briefs')
  })

  it('does not overwrite an existing panel assignment', () => {
    const session = submittedSession()
    const result = assignPanel(session)

    expect(result.panelAssignment!.id).toBe(session.panelAssignment!.id)
  })

  it('creates panel deliberation in screening posture', () => {
    const session = submittedSession()

    expect(session.panelDeliberation).toBeDefined()
    expect(session.panelDeliberation!.posture).toBe('screening')
    expect(session.panelDeliberation!.votes).toHaveLength(0)
    expect(session.panelDeliberation!.mandateStatus).toBe('not_started')
  })
})

describe('canSubmitToPanel', () => {
  it('returns false before briefing is complete', () => {
    const session = createInitialSession()

    const result = canSubmitToPanel(session)

    expect(result.accepted).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.some((issue) => issue.includes('opening brief'))).toBe(true)
  })

  it('returns false when session status is not active or submitted', () => {
    let session = briefedSession()
    session = fileDraft(session, draft('appellee_brief', appelleePdf, 'appellee'))
    session = fileDraft(session, draft('reply_brief', replyPdf))
    session = { ...session, status: 'closed' }

    const result = canSubmitToPanel(session)

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('active or submitted'))).toBe(true)
  })

  it('returns true when all briefing events are filed and status is active', () => {
    let session = briefedSession()
    session = fileDraft(session, draft('appellee_brief', appelleePdf, 'appellee'))
    session = fileDraft(session, draft('reply_brief', replyPdf))

    const result = canSubmitToPanel(session)

    expect(result.accepted).toBe(true)
  })
})

describe('deterministicPanelVote', () => {
  it('produces consistent votes for the same session', () => {
    const session = submittedSession()

    const vote1 = deterministicPanelVote(session, 'ca4_judge_1')
    const vote2 = deterministicPanelVote(session, 'ca4_judge_1')

    expect(vote1.vote).toBe(vote2.vote)
    expect(vote1.reliefOption).toBe(vote2.reliefOption)
    expect(vote1.confidence).toBe(vote2.confidence)
  })

  it('assigns each vote the correct judge actor id', () => {
    const session = submittedSession()

    const vote1 = deterministicPanelVote(session, 'ca4_judge_1')
    const vote2 = deterministicPanelVote(session, 'ca4_judge_2')
    const vote3 = deterministicPanelVote(session, 'ca4_judge_3')

    expect(vote1.judgeActorId).toBe('ca4_judge_1')
    expect(vote2.judgeActorId).toBe('ca4_judge_2')
    expect(vote3.judgeActorId).toBe('ca4_judge_3')
  })

  it('produces a vote with confidence between 0 and 1', () => {
    const session = submittedSession()

    const vote = deterministicPanelVote(session, 'ca4_judge_1')

    expect(vote.confidence).toBeGreaterThanOrEqual(0)
    expect(vote.confidence).toBeLessThanOrEqual(1)
  })
})

describe('validatePanelVote', () => {
  it('accepts a valid vote from an assigned judge', () => {
    const session = submittedSession()
    const vote = deterministicPanelVote(session, 'ca4_judge_1')

    const result = validatePanelVote(session, vote)

    expect(result.accepted).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('rejects a vote from a judge not on the panel', () => {
    const session = submittedSession()
    const vote: PanelVote = {
      id: 'panel_vote_0001',
      judgeActorId: 'unassigned_judge',
      vote: 'affirm',
      reliefOption: 'affirm',
      rationale: 'Test',
      joinsMajority: false,
      confidence: 0.8,
      createdAt: session.simulatedDate,
    }

    const result = validatePanelVote(session, vote)

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('not assigned'))).toBe(true)
  })

  it('rejects a duplicate vote by the same judge', () => {
    let session = submittedSession()
    const vote = deterministicPanelVote(session, 'ca4_judge_1')
    session = addPanelVote(session, vote)

    const result = validatePanelVote(session, vote)

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('Duplicate'))).toBe(true)
  })

  it('rejects a vote with confidence outside 0-1', () => {
    const session = submittedSession()
    const vote: PanelVote = {
      id: 'panel_vote_0001',
      judgeActorId: 'ca4_judge_1',
      vote: 'affirm',
      reliefOption: 'affirm',
      rationale: 'Test',
      joinsMajority: false,
      confidence: 1.5,
      createdAt: session.simulatedDate,
    }

    const result = validatePanelVote(session, vote)

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('confidence'))).toBe(true)
  })

  it('rejects a vote when session is not in submitted or panel-deliberation posture', () => {
    const session = { ...submittedSession(), procedureState: 'opening_brief_pending' as const }
    const vote = deterministicPanelVote(session, 'ca4_judge_1')

    const result = validatePanelVote(session, vote)

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('posture'))).toBe(true)
  })
})

describe('addPanelVote', () => {
  it('accumulates votes and tracks majority position', () => {
    let session = submittedSession()
    const vote1 = deterministicPanelVote(session, 'ca4_judge_1')
    session = addPanelVote(session, vote1)

    expect(session.panelDeliberation!.votes).toHaveLength(1)
    expect(session.panelDeliberation!.posture).toBe('voting')

    const vote2 = deterministicPanelVote(session, 'ca4_judge_2')
    session = addPanelVote(session, vote2)

    expect(session.panelDeliberation!.votes).toHaveLength(2)
    expect(session.panelDeliberation!.posture).toBe('voting')

    const vote3 = deterministicPanelVote(session, 'ca4_judge_3')
    session = addPanelVote(session, vote3)

    expect(session.panelDeliberation!.votes).toHaveLength(3)
    expect(session.panelDeliberation!.majorityPosition).toBeDefined()
    expect(session.panelDeliberation!.posture).toBe('drafting')
  })

  it('marks majority votes with joinsMajority', () => {
    let session = submittedSession()
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const majority = session.panelDeliberation!.majorityPosition!
    const majorityVotes = session.panelDeliberation!.votes.filter(
      (v) => v.vote === majority,
    )

    expect(majorityVotes.length).toBeGreaterThanOrEqual(2)
    for (const v of majorityVotes) {
      expect(v.joinsMajority).toBe(true)
    }
  })

  it('returns session unchanged when vote validation fails', () => {
    const session = submittedSession()
    const invalidVote: PanelVote = {
      id: 'panel_vote_0001',
      judgeActorId: 'not_on_panel',
      vote: 'affirm',
      reliefOption: 'affirm',
      rationale: 'Invalid',
      joinsMajority: false,
      confidence: 0.8,
      createdAt: session.simulatedDate,
    }

    const result = addPanelVote(session, invalidVote)

    expect(result.panelDeliberation!.votes).toHaveLength(0)
  })
})

describe('createPanelDisposition', () => {
  it('creates disposition from votes with majority judge ids', () => {
    let session = submittedSession()
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const disposition = createPanelDisposition(session)

    expect(disposition.majorityJudgeActorIds.length).toBeGreaterThanOrEqual(2)
    expect(disposition.votes).toHaveLength(3)
    expect(disposition.judgmentText.length).toBeGreaterThan(0)
  })

  it('includes separate opinions for dissenting judges', () => {
    let session = submittedSession()
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const disposition = createPanelDisposition(session)
    const dissentingVotes = session.panelDeliberation!.votes.filter(
      (v) => v.separateWritingType === 'dissent',
    )

    if (dissentingVotes.length > 0) {
      expect(disposition.separateOpinions.length).toBe(dissentingVotes.length)
    }
  })
})

describe('validatePanelDisposition', () => {
  it('accepts a valid panel disposition with 3 votes and required rule refs', () => {
    let session = submittedSession()
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const disposition = createPanelDisposition(session)
    const result = validatePanelDisposition(session, disposition)

    expect(result.accepted).toBe(true)
  })

  it('rejects a disposition when fewer than 3 votes exist', () => {
    let session = submittedSession()
    const vote = deterministicPanelVote(session, 'ca4_judge_1')
    session = addPanelVote(session, vote)

    const disposition = createPanelDisposition(session)
    const result = validatePanelDisposition(session, disposition)

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('three'))).toBe(true)
  })

  it('rejects a disposition with empty judgment text', () => {
    let session = submittedSession()
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const result = validatePanelDisposition(session, {
      disposition: 'affirm',
      judgmentText: '  ',
      ruleRefs: [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
    })

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('judgment text'))).toBe(true)
  })

  it('rejects a disposition missing required rule refs', () => {
    let session = submittedSession()
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const result = validatePanelDisposition(session, {
      disposition: 'affirm',
      judgmentText: 'Judgment entered.',
      ruleRefs: [],
    })

    expect(result.accepted).toBe(false)
    expect(result.issues.some((issue) => issue.includes('App. P. 34'))).toBe(true)
  })
})

describe('addBenchMemo', () => {
  it('adds bench memo to deliberation and transitions to voting posture', () => {
    const session = submittedSession()
    const result = addBenchMemo(session)

    expect(result.benchMemo).toBeDefined()
    expect(result.benchMemo!.authorActorId).toBe('ca4_staff_attorney')
    expect(result.panelDeliberation!.posture).toBe('voting')
    expect(result.panelDeliberation!.staffMemo).toBeDefined()
    expect(result.panelDeliberation!.staffMemoRecord).toBeDefined()
  })

  it('transitions to voting posture even without a pre-existing panel assignment', () => {
    let session = briefedSession()
    session = fileDraft(session, draft('appellee_brief', appelleePdf, 'appellee'))
    session = fileDraft(session, draft('reply_brief', replyPdf))
    session = { ...session, status: 'submitted', procedureState: 'panel_deliberation' }

    const result = addBenchMemo(session)

    expect(result.panelDeliberation!.posture).toBe('voting')
  })
})

describe('enterPanelDisposition', () => {
  it('transitions deliberation posture to entered', () => {
    let session = submittedSession()
    session = addBenchMemo(session)
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const result = enterPanelDisposition(session)

    expect(result.panelDeliberation!.posture).toBe('entered')
    expect(result.panelDeliberation!.mandateStatus).toBe('pending')
    expect(result.panelDisposition).toBeDefined()
    expect(result.panelDisposition!.disposition).toBeDefined()
  })

  it('sets disposition text and judgment text on deliberation', () => {
    let session = submittedSession()
    session = addBenchMemo(session)
    for (const judgeId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const) {
      const vote = deterministicPanelVote(session, judgeId)
      session = addPanelVote(session, vote)
    }

    const result = enterPanelDisposition(session)

    expect(result.panelDeliberation!.dispositionText).toBeDefined()
    expect(result.panelDeliberation!.judgmentText).toBeDefined()
    expect(result.panelDeliberation!.dispositionText!.length).toBeGreaterThan(0)
    expect(result.panelDeliberation!.judgmentText!.length).toBeGreaterThan(0)
  })

  it('returns session unchanged when validation fails', () => {
    let session = submittedSession()
    const vote = deterministicPanelVote(session, 'ca4_judge_1')
    session = addPanelVote(session, vote)

    const result = enterPanelDisposition(session)

    expect(result.panelDeliberation!.posture).not.toBe('entered')
    expect(result.panelDisposition).toBeUndefined()
  })
})
