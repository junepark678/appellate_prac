import { describe, expect, it } from 'vitest'

import { validateAiProposal } from './actors/proposals'
import {
  defaultFilingMetadata,
  filingDraftToSubmission,
  submitEcfFiling,
} from './filing/ecf'
import { evaluateRelief } from './merits/relief'
import {
  advanceProcedure,
  inferProcedureState,
  nextProcedureToolCall,
  transitionAfterFiling,
} from './procedure/state-machine'
import { preflightFilingSubmission } from './rules/executable-constraints'
import { createInitialSession, fileDraft } from './simulation'
import type { FilingDraft, FilingSubmission, UploadedDocument } from './types'

const noticePdf: UploadedDocument = {
  id: 'notice',
  fileName: 'notice-of-appeal.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Notice of appeal from final civil judgment.',
  extractedSignals: ['notice of appeal'],
}

const disclosurePdf: UploadedDocument = {
  id: 'disclosure',
  fileName: 'appearance-disclosure.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Disclosure statement and appearance.',
  extractedSignals: ['disclosure'],
}

const docketingPdf: UploadedDocument = {
  id: 'docketing',
  fileName: 'docketing-statement.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Docketing statement identifying final judgment and jurisdiction.',
  extractedSignals: ['docketing statement'],
}

const transcriptAckPdf: UploadedDocument = {
  id: 'transcript',
  fileName: 'transcript-order-acknowledgment.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Transcript order acknowledgment. Trial transcript ordered where needed.',
  extractedSignals: ['transcript'],
}

const briefPdf: UploadedDocument = {
  id: 'brief',
  fileName: 'opening-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 240_000,
  pageCount: 32,
  extractedText: 'Jurisdictional statement. Statement of issues. Standard of review. Argument with record citation. Oral argument requested. Conclusion.',
  extractedSignals: ['argument', 'jurisdiction', 'statement of issues', 'standard of review', 'record citation', 'oral argument', 'conclusion'],
}

const appendixPdf: UploadedDocument = {
  id: 'appendix',
  fileName: 'joint-appendix.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 240_000,
  extractedText: 'Joint appendix with pagination, J.A. 42, comparator memoranda, termination timeline, summary judgment order, and excluded declaration.',
  extractedSignals: ['appendix', 'pagination', 'record citation'],
}

const stayMotionPdf: UploadedDocument = {
  id: 'stay',
  fileName: 'stay-pending-appeal-motion.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Motion to stay pending appeal. Emergency relief requested.',
  extractedSignals: ['motion', 'stay'],
}

const amicusPdf: UploadedDocument = {
  id: 'amicus',
  fileName: 'amicus-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Amicus brief with interest statement and argument.',
  extractedSignals: ['amicus', 'argument', 'interest'],
}

const rehearingPdf: UploadedDocument = {
  id: 'rehearing',
  fileName: 'petition-rehearing.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Petition for rehearing.',
  extractedSignals: ['rehearing'],
}

const costsPdf: UploadedDocument = {
  id: 'costs',
  fileName: 'bill-of-costs.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Bill of costs.',
  extractedSignals: ['costs'],
}

const rule28jPdf: UploadedDocument = {
  id: 'rule28j',
  fileName: 'rule-28j-letter.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Rule 28(j) letter regarding supplemental authority.',
  extractedSignals: ['28(j)'],
}

function draft(eventId: string, document: UploadedDocument): FilingDraft {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    documents: [document],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

function submission(eventId: string, document: UploadedDocument): FilingSubmission {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    mainDocument: document,
    attachments: [],
    metadata: defaultFilingMetadata(eventId),
    notes: '',
  }
}

describe('production appellate flow', () => {
  it('preflights filing submissions with source-backed issue codes and cure suggestions', () => {
    const session = createInitialSession()
    const result = preflightFilingSubmission(session, {
      ...submission('notice_of_appeal', noticePdf),
      metadata: {
        ...defaultFilingMetadata('notice_of_appeal'),
        certificateOfService: false,
      },
    })

    expect(result.accepted).toBe(false)
    expect(result.outcome).toBe('rejected')
    expect(result.issues[0]?.code).toBe('certificate_of_service_missing')
    expect(result.issues[0]?.cureSuggestion).toContain('certificate of service')
  })

  it('converts legacy drafts into ECF submissions and creates receipts for accepted filings', () => {
    const session = createInitialSession()
    const converted = filingDraftToSubmission(draft('notice_of_appeal', noticePdf))
    expect(converted?.mainDocument.fileName).toBe('notice-of-appeal.pdf')

    const result = submitEcfFiling(session, converted as FilingSubmission)
    expect(result.preflight.accepted).toBe(true)
    expect(result.receipt?.receiptNumber).toContain('CA4-')
    expect(result.session.filings.at(-1)?.eventId).toBe('notice_of_appeal')
  })

  it('infers and advances state-machine procedure without using the legacy next-event path', () => {
    let session = createInitialSession()
    expect(inferProcedureState(session)).toBe('notice_pending')

    session = transitionAfterFiling(fileDraft(session, draft('notice_of_appeal', noticePdf)))
    expect(session.procedureState).toBe('appearance_pending')

    session = transitionAfterFiling(
      fileDraft(session, draft('appearance_disclosure', disclosurePdf)),
    )
    expect(session.procedureState).toBe('docketing_statement_pending')

    session = transitionAfterFiling(fileDraft(session, draft('docketing_statement', docketingPdf)))
    expect(session.procedureState).toBe('record_ordering_pending')

    session = transitionAfterFiling(
      fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf)),
    )
    expect(nextProcedureToolCall(session).tool).toBe('setDeadline')

    const advanced = advanceProcedure(session)
    expect(advanced.transition.fromState).toBe('briefing_schedule_pending')
    expect(advanced.session.deadlines.some((deadline) => deadline.targetEventId === 'opening_brief')).toBe(
      true,
    )
  })

  it('validates AI proposal-only tools against actor authority', () => {
    const session = createInitialSession()
    const result = validateAiProposal(session, {
      tool: 'castPanelVote',
      actorId: 'ca4_judge_1',
      vote: 'vacate in part',
      reliefOption: 'vacate in part and remand',
      rationale: 'Comparator evidence issue warrants remand.',
      confidence: 0.82,
    })

    expect(result.accepted).toBe(true)
  })

  it('constrains relief to preserved issues with record support', () => {
    let session = createInitialSession()
    expect(evaluateRelief(session).availableRelief).toContain('affirm')
    expect(evaluateRelief(session).availableRelief).toContain('dismiss for lack of jurisdiction')

    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('docketing_statement', docketingPdf))
    session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf))
    session = fileDraft(session, draft('opening_brief', briefPdf))
    session = fileDraft(session, draft('joint_appendix', appendixPdf))

    expect(evaluateRelief(session).availableRelief).toContain('vacate in part')
  })

  it('generates strategy, amicus, and rich receipt state from accepted filings', () => {
    let session = createInitialSession()
    const result = submitEcfFiling(session, submission('notice_of_appeal', noticePdf))
    expect(result.receipt?.documentList?.[0]?.fileName).toBe('notice-of-appeal.pdf')
    expect(result.receipt?.docketText).toContain('Service')

    session = result.session
    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('docketing_statement', docketingPdf))
    session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf))
    session = fileDraft(session, draft('opening_brief', briefPdf))

    expect(session.counterpartyStrategy?.meritsArguments.length).toBeGreaterThan(0)
    expect(session.amicusParticipation?.candidates[0]?.requiresLeave).toBe(true)
  })

  it('covers opening-stage, motion, amicus, sealed, and post-judgment filing constraints', () => {
    let session = createInitialSession()
    session = fileDraft(session, draft('notice_of_appeal', noticePdf))

    expect(
      session.deadlines.some((deadline) => deadline.targetEventId === 'docketing_statement'),
    ).toBe(true)

    let result = preflightFilingSubmission(session, submission('opening_brief', briefPdf))
    expect(result.issues.some((issue) => issue.code === 'opening_brief_before_docketing_statement')).toBe(true)

    result = preflightFilingSubmission(session, submission('motion_stay_pending_appeal', stayMotionPdf))
    expect(result.issues.some((issue) => issue.code === 'stay_motion_district_court_first_missing')).toBe(true)

    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('docketing_statement', docketingPdf))
    expect(inferProcedureState(session)).toBe('record_ordering_pending')
    session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf))
    session = fileDraft(session, draft('opening_brief', briefPdf))

    result = preflightFilingSubmission(session, {
      ...submission('amicus_brief', amicusPdf),
      participantRole: 'amicus',
      metadata: {
        ...defaultFilingMetadata('amicus_brief'),
        consentStatus: 'unknown',
      },
    })
    expect(result.issues.some((issue) => issue.code === 'amicus_leave_required')).toBe(true)

    result = preflightFilingSubmission(session, {
      ...submission('motion_to_seal', stayMotionPdf),
      metadata: {
        ...defaultFilingMetadata('motion_to_seal', true),
        redactionAcknowledged: false,
      },
    })
    expect(result.issues.some((issue) => issue.code === 'sealed_redaction_acknowledgment_missing')).toBe(true)

    result = preflightFilingSubmission(session, submission('bill_of_costs', costsPdf))
    expect(result.issues.some((issue) => issue.code === 'bill_of_costs_before_judgment')).toBe(true)

    result = preflightFilingSubmission(session, submission('petition_rehearing', rehearingPdf))
    expect(result.issues.some((issue) => issue.code === 'rehearing_before_judgment')).toBe(true)

    const closedSession = { ...session, status: 'closed' as const, procedureState: 'judgment_entered' as const }
    result = preflightFilingSubmission(closedSession, submission('rule_28j_letter', rule28jPdf))
    expect(result.issues.some((issue) => issue.code === 'rule_28j_after_judgment')).toBe(true)
  })

  it('drives scenario-specific jurisdiction, sealed-record, and qualified-immunity outcomes', () => {
    let finalitySession = createInitialSession('synthetic-finality-rule54-contract')
    finalitySession = fileDraft(finalitySession, draft('notice_of_appeal', noticePdf))
    expect(evaluateRelief(finalitySession).availableRelief).toEqual([
      'dismiss for lack of jurisdiction',
    ])
    expect(finalitySession.counterpartyStrategy?.jurisdictionArguments.join(' ')).toContain(
      'Rule 54',
    )

    const sealedSession = createInitialSession('synthetic-sealed-foia-record')
    const sealedResult = preflightFilingSubmission(sealedSession, {
      ...submission('opening_brief', {
        ...briefPdf,
        fileName: 'sealed-opening-brief.pdf',
        extractedText: `${briefPdf.extractedText} sealed confidential material`,
        extractedSignals: [...briefPdf.extractedSignals, 'sealed', 'confidential'],
      }),
      metadata: {
        ...defaultFilingMetadata('opening_brief', true),
        redactionAcknowledged: false,
      },
    })
    expect(
      sealedResult.issues.some(
        (issue) => issue.code === 'sealed_redaction_acknowledgment_missing',
      ),
    ).toBe(true)

    let immunitySession = createInitialSession('synthetic-section1983-qualified-immunity')
    immunitySession = fileDraft(immunitySession, draft('notice_of_appeal', noticePdf))
    immunitySession = fileDraft(immunitySession, draft('appearance_disclosure', disclosurePdf))
    immunitySession = fileDraft(immunitySession, draft('docketing_statement', docketingPdf))
    immunitySession = fileDraft(
      immunitySession,
      draft('transcript_order_acknowledgment', transcriptAckPdf),
    )
    immunitySession = fileDraft(immunitySession, {
      ...draft('opening_brief', {
        ...briefPdf,
        extractedText: `${briefPdf.extractedText} interlocutory legal question qualified immunity disputed facts`,
      }),
    })
    expect(evaluateRelief(immunitySession).barredRelief).toContain('fact-bound reversal')
  })
})
