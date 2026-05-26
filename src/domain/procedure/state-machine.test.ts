import { describe, expect, it } from 'vitest'

import {
  applyToolCall,
  createInitialSession,
  fileDraft,
  nextExpectedToolCall,
} from '../simulation'
import {
  advanceProcedure,
  inferProcedureState,
  nextProcedureToolCall,
  transitionAfterFiling,
} from './state-machine'
import type { CaseSession, FilingDraft, FilingRecord, ProcedureState, UploadedDocument } from '../types'

const pdf: UploadedDocument = {
  id: 'doc_1',
  fileName: 'filing.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedSignals: ['argument'],
}

const noticePdf: UploadedDocument = {
  ...pdf,
  fileName: 'notice-of-appeal.pdf',
  extractedSignals: ['notice of appeal'],
}

const disclosurePdf: UploadedDocument = {
  ...pdf,
  fileName: 'disclosure.pdf',
  extractedSignals: ['disclosure'],
}

const docketingPdf: UploadedDocument = {
  ...pdf,
  fileName: 'docketing-statement.pdf',
  extractedSignals: ['docketing statement'],
}

const transcriptAckPdf: UploadedDocument = {
  ...pdf,
  fileName: 'transcript-order-acknowledgment.pdf',
  extractedSignals: ['transcript'],
}

const appendixPdf: UploadedDocument = {
  ...pdf,
  fileName: 'joint-appendix.pdf',
  extractedSignals: ['appendix', 'pagination', 'record citation'],
}

const replyPdf: UploadedDocument = {
  ...pdf,
  fileName: 'reply-brief.pdf',
  extractedSignals: ['reply'],
}

function draft(eventId: string, role: 'appellant' | 'appellee' = 'appellant'): FilingDraft {
  return {
    eventId,
    participantRole: role,
    title: eventId,
    documents: [pdf],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

function buildCivilSessionThroughBriefing() {
  let session = createInitialSession()
  session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
  session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
  session = fileDraft(session, { ...draft('docketing_statement'), documents: [docketingPdf] })
  session = fileDraft(session, {
    ...draft('transcript_order_acknowledgment'),
    documents: [transcriptAckPdf],
  })
  session = applyToolCall(session, nextExpectedToolCall(session))
  session = fileDraft(session, draft('opening_brief'))
  session = fileDraft(session, { ...draft('joint_appendix'), documents: [appendixPdf] })
  return session
}

function withAcceptedFiling(session: CaseSession, eventId: string): CaseSession {
  const filing: FilingRecord = {
    id: `filing_${eventId}`,
    eventId,
    participantRole: 'appellant',
    title: eventId,
    documents: [pdf],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
    filedAt: session.simulatedDate,
    outcome: 'accepted',
    validationIssues: [],
  }
  return { ...session, filings: [...session.filings, filing] }
}

describe('inferProcedureState', () => {
  it('returns notice_pending on a fresh session with no filings', () => {
    const session = createInitialSession()
    expect(inferProcedureState(session)).toBe('notice_pending')
  })

  it('returns appearance_pending after notice of appeal is filed', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    expect(inferProcedureState(session)).toBe('appearance_pending')
  })

  it('returns docketing_statement_pending after appearance is filed', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    expect(inferProcedureState(session)).toBe('docketing_statement_pending')
  })

  it('returns record_ordering_pending after docketing statement is filed', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    expect(inferProcedureState(session)).toBe('record_ordering_pending')
  })

  it('returns briefing_schedule_pending after transcript order when no opening deadline exists', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    expect(inferProcedureState(session)).toBe('briefing_schedule_pending')
  })

  it('returns opening_brief_pending once the briefing deadline is set', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    session = applyToolCall(session, nextExpectedToolCall(session))
    expect(inferProcedureState(session)).toBe('opening_brief_pending')
  })

  it('returns appendix_pending after opening brief is filed', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = fileDraft(session, draft('opening_brief'))
    expect(inferProcedureState(session)).toBe('appendix_pending')
  })

  it('returns appellee_brief_pending after joint appendix is filed', () => {
    const session = buildCivilSessionThroughBriefing()
    expect(inferProcedureState(session)).toBe('appellee_brief_pending')
  })

  it('returns reply_brief_pending after appellee brief is filed', () => {
    let session = buildCivilSessionThroughBriefing()
    session = applyToolCall(session, nextExpectedToolCall(session))
    expect(inferProcedureState(session)).toBe('reply_brief_pending')
  })

  it('returns panel_deliberation after all briefing is complete', () => {
    let session = buildCivilSessionThroughBriefing()
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = fileDraft(session, { ...draft('reply_brief'), documents: [replyPdf] })
    expect(inferProcedureState(session)).toBe('panel_deliberation')
  })

  it('returns dismissed when session status is dismissed', () => {
    const session = { ...createInitialSession(), status: 'dismissed' as const }
    expect(inferProcedureState(session)).toBe('dismissed')
  })

  it('returns judgment_entered for closed session without rehearing', () => {
    const session = { ...createInitialSession(), status: 'closed' as const }
    expect(inferProcedureState(session)).toBe('judgment_entered')
  })

  it('returns rehearing_pending for closed session with accepted rehearing petition', () => {
    const session = createInitialSession()
    const withRehearing: typeof session = {
      ...session,
      status: 'closed',
      filings: [
        ...session.filings,
        {
          id: 'filing_rehearing',
          eventId: 'petition_rehearing',
          participantRole: 'appellant',
          title: 'Rehearing Petition',
          documents: [pdf],
          certificateOfService: true,
          certificateOfCompliance: false,
          sealed: false,
          notes: '',
          filedAt: session.simulatedDate,
          outcome: 'accepted',
          validationIssues: [],
        },
      ],
    }
    expect(inferProcedureState(withRehearing)).toBe('rehearing_pending')
  })

  it('returns panel_deliberation when session status is submitted', () => {
    const session = { ...createInitialSession(), status: 'submitted' as const }
    expect(inferProcedureState(session)).toBe('panel_deliberation')
  })

  it('advances through the full civil appeal lifecycle', () => {
    let session = createInitialSession()
    const states: ProcedureState[] = [inferProcedureState(session)]

    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    states.push(inferProcedureState(session))

    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    states.push(inferProcedureState(session))

    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    states.push(inferProcedureState(session))

    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    states.push(inferProcedureState(session))

    session = applyToolCall(session, nextExpectedToolCall(session))
    states.push(inferProcedureState(session))

    session = fileDraft(session, draft('opening_brief'))
    states.push(inferProcedureState(session))

    session = fileDraft(session, { ...draft('joint_appendix'), documents: [appendixPdf] })
    states.push(inferProcedureState(session))

    session = applyToolCall(session, nextExpectedToolCall(session))
    states.push(inferProcedureState(session))

    session = fileDraft(session, { ...draft('reply_brief'), documents: [replyPdf] })
    states.push(inferProcedureState(session))

    expect(states).toEqual([
      'notice_pending',
      'appearance_pending',
      'docketing_statement_pending',
      'record_ordering_pending',
      'briefing_schedule_pending',
      'opening_brief_pending',
      'appendix_pending',
      'appellee_brief_pending',
      'reply_brief_pending',
      'panel_deliberation',
    ])
  })
})

describe('inferProcedureState criminal pack', () => {
  it('returns fee_or_ifp_pending after docketing statement for criminal appeal', () => {
    let session = createInitialSession('synthetic-ca4-criminal-sentencing-waiver')
    session = fileDraft(session, draft('criminal_notice_of_appeal'))
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('criminal_docketing_statement'),
      documents: [docketingPdf],
    })
    expect(inferProcedureState(session)).toBe('fee_or_ifp_pending')
  })

  it('skips fee_or_ifp for civil appeal', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    expect(inferProcedureState(session)).toBe('record_ordering_pending')
  })
})

describe('inferProcedureState agency pack', () => {
  it('uses agency-specific event IDs for state transitions', () => {
    let session = createInitialSession('synthetic-ca4-agency-review-removal')
    expect(inferProcedureState(session)).toBe('notice_pending')

    session = fileDraft(session, draft('petition_for_review'))
    expect(inferProcedureState(session)).toBe('appearance_pending')

    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    expect(inferProcedureState(session)).toBe('docketing_statement_pending')

    session = fileDraft(session, {
      ...draft('agency_docketing_statement'),
      documents: [docketingPdf],
    })
    expect(inferProcedureState(session)).toBe('record_ordering_pending')

    session = withAcceptedFiling(session, 'certified_agency_record')
    expect(inferProcedureState(session)).toBe('briefing_schedule_pending')
  })
})

describe('inferProcedureState original-writ pack', () => {
  it('reaches motion_pending after record for original writ', () => {
    let session = createInitialSession('synthetic-ca4-original-writ-discovery')
    session = fileDraft(session, draft('petition_for_writ_mandamus'))
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('writ_docketing_statement'),
      documents: [docketingPdf],
    })
    session = withAcceptedFiling(session, 'appendix_to_writ_petition')
    expect(inferProcedureState(session)).toBe('motion_pending')
  })

  it('reaches reply_brief_pending after answer to writ', () => {
    let session = createInitialSession('synthetic-ca4-original-writ-discovery')
    session = fileDraft(session, draft('petition_for_writ_mandamus'))
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('writ_docketing_statement'),
      documents: [docketingPdf],
    })
    session = withAcceptedFiling(session, 'appendix_to_writ_petition')
    session = withAcceptedFiling(session, 'answer_to_writ_petition')
    expect(inferProcedureState(session)).toBe('reply_brief_pending')
  })

  it('reaches panel_deliberation after reply in support of writ', () => {
    let session = createInitialSession('synthetic-ca4-original-writ-discovery')
    session = fileDraft(session, draft('petition_for_writ_mandamus'))
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('writ_docketing_statement'),
      documents: [docketingPdf],
    })
    session = withAcceptedFiling(session, 'appendix_to_writ_petition')
    session = withAcceptedFiling(session, 'answer_to_writ_petition')
    session = withAcceptedFiling(session, 'reply_in_support_of_writ')
    expect(inferProcedureState(session)).toBe('panel_deliberation')
  })
})

describe('transitionAfterFiling', () => {
  it('returns session with updated procedureState after notice of appeal', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    const result = transitionAfterFiling(session)
    expect(result.procedureState).toBe('appearance_pending')
  })

  it('returns session with updated procedureState after appearance', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    const result = transitionAfterFiling(session)
    expect(result.procedureState).toBe('docketing_statement_pending')
  })

  it('returns session with updated procedureState after docketing statement', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    const result = transitionAfterFiling(session)
    expect(result.procedureState).toBe('record_ordering_pending')
  })

  it('preserves all other session fields', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    const result = transitionAfterFiling(session)
    expect(result.id).toBe(session.id)
    expect(result.courtPackId).toBe(session.courtPackId)
    expect(result.filings).toEqual(session.filings)
    expect(result.docketEntries).toEqual(session.docketEntries)
  })
})

describe('nextProcedureToolCall', () => {
  it('returns issueClerkOrder for notice_pending', () => {
    const session = createInitialSession()
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.actorId).toBe('ca4_clerk')
      expect(toolCall.title).toBe('Notice Regarding Case Opening')
    }
  })

  it('returns issueClerkOrder for appearance_pending', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.title).toBe('Clerk Order Directing Disclosure Statement')
    }
  })

  it('returns issueClerkOrder for docketing_statement_pending', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.title).toBe('Clerk Order Directing Docketing Statement')
    }
  })

  it('returns issueClerkOrder for record_ordering_pending', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.title).toBe('Clerk Order Regarding Transcript Order')
    }
  })

  it('returns setDeadline for briefing_schedule_pending', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('setDeadline')
    if (toolCall.tool === 'setDeadline') {
      expect(toolCall.targetEventId).toBe('opening_brief')
      expect(toolCall.offsetDays).toBe(40)
    }
  })

  it('returns issueClerkOrder for appendix_pending', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = fileDraft(session, draft('opening_brief'))
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.title).toBe('Clerk Order Regarding Appendix')
    }
  })

  it('returns fileCounterpartyDocument for appellee_brief_pending', () => {
    const session = buildCivilSessionThroughBriefing()
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('fileCounterpartyDocument')
    if (toolCall.tool === 'fileCounterpartyDocument') {
      expect(toolCall.eventId).toBe('appellee_brief')
      expect(toolCall.actorId).toBe('appellee_ai')
    }
  })

  it('returns issueClerkOrder for reply_brief_pending', () => {
    let session = buildCivilSessionThroughBriefing()
    session = applyToolCall(session, nextExpectedToolCall(session))
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.title).toBe('Briefing Notice')
    }
  })

  it('returns submitToPanel for panel_deliberation with active status', () => {
    let session = buildCivilSessionThroughBriefing()
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = fileDraft(session, { ...draft('reply_brief'), documents: [replyPdf] })
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('submitToPanel')
  })

  it('returns issueClerkOrder for fee_or_ifp_pending in criminal appeal', () => {
    let session = createInitialSession('synthetic-ca4-criminal-sentencing-waiver')
    session = fileDraft(session, draft('criminal_notice_of_appeal'))
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('criminal_docketing_statement'),
      documents: [docketingPdf],
    })
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('issueClerkOrder')
    if (toolCall.tool === 'issueClerkOrder') {
      expect(toolCall.title).toBe('Clerk Order Regarding CJA Financial Disclosure')
    }
  })

  it('returns setDeadline for motion_pending in original-writ when no answer deadline exists', () => {
    let session = createInitialSession('synthetic-ca4-original-writ-discovery')
    session = fileDraft(session, draft('petition_for_writ_mandamus'))
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('writ_docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, draft('appendix_to_writ_petition'))
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('setDeadline')
    if (toolCall.tool === 'setDeadline') {
      expect(toolCall.targetEventId).toBe('answer_to_writ_petition')
    }
  })

  it('returns draftStaffMemo for panel_deliberation when submitted without bench memo', () => {
    let session = buildCivilSessionThroughBriefing()
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = fileDraft(session, { ...draft('reply_brief'), documents: [replyPdf] })
    session = applyToolCall(session, nextExpectedToolCall(session))
    expect(session.status).toBe('submitted')
    const toolCall = nextProcedureToolCall(session)
    expect(toolCall.tool).toBe('draftStaffMemo')
  })
})

describe('advanceProcedure', () => {
  it('returns correct transition from notice_pending to appearance_pending', () => {
    const session = createInitialSession()
    const result = advanceProcedure(session)
    expect(result.transition.fromState).toBe('notice_pending')
    expect(result.transition.accepted).toBe(true)
    expect(result.transition.warnings).toEqual([])
  })

  it('returns a tool call that moves procedure forward', () => {
    const session = createInitialSession()
    const result = advanceProcedure(session)
    expect(result.toolCall.tool).toBe('issueClerkOrder')
  })

  it('returns an updated session with a new procedureState', () => {
    const session = createInitialSession()
    const result = advanceProcedure(session)
    expect(result.session.procedureState).toBeDefined()
  })

  it('advances through briefing_schedule_pending to opening_brief_pending', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    session = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [docketingPdf],
    })
    session = fileDraft(session, {
      ...draft('transcript_order_acknowledgment'),
      documents: [transcriptAckPdf],
    })
    const result = advanceProcedure(session)
    expect(result.transition.fromState).toBe('briefing_schedule_pending')
    expect(result.toolCall.tool).toBe('setDeadline')
  })

  it('advances through appellee_brief_pending by filing counterparty document', () => {
    const session = buildCivilSessionThroughBriefing()
    const result = advanceProcedure(session)
    expect(result.transition.fromState).toBe('appellee_brief_pending')
    expect(result.toolCall.tool).toBe('fileCounterpartyDocument')
  })
})

describe('rejected filings do not advance state', () => {
  it('stays at notice_pending when a filing is rejected', () => {
    const session = createInitialSession()
    const rejected = fileDraft(session, {
      ...draft('notice_of_appeal'),
      documents: [],
    })
    expect(rejected.filings).toHaveLength(0)
    expect(inferProcedureState(rejected)).toBe('notice_pending')
  })

  it('stays at appearance_pending when a docketing statement is filed without documents', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    const rejected = fileDraft(session, {
      ...draft('appearance_disclosure'),
      documents: [],
    })
    expect(rejected.filings).toHaveLength(1)
    expect(inferProcedureState(rejected)).toBe('appearance_pending')
  })

  it('does not count rejected filings as active filed events', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    const beforeState = inferProcedureState(session)
    const rejected = fileDraft(session, {
      ...draft('docketing_statement'),
      documents: [],
    })
    const afterState = inferProcedureState(rejected)
    expect(beforeState).toBe('appearance_pending')
    expect(afterState).toBe('appearance_pending')
  })

  it('still advances when a valid filing follows a rejected one', () => {
    let session = createInitialSession()
    session = fileDraft(session, { ...draft('notice_of_appeal'), documents: [noticePdf] })
    fileDraft(session, {
      ...draft('appearance_disclosure'),
      documents: [],
    })
    session = fileDraft(session, { ...draft('appearance_disclosure'), documents: [disclosurePdf] })
    expect(inferProcedureState(session)).toBe('docketing_statement_pending')
  })
})
