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

const briefPdf: UploadedDocument = {
  id: 'brief',
  fileName: 'opening-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 240_000,
  pageCount: 32,
  extractedText: 'Statement of issues. Standard of review. Argument with record citation.',
  extractedSignals: ['argument', 'statement of issues', 'standard of review', 'record citation'],
}

const appendixPdf: UploadedDocument = {
  id: 'appendix',
  fileName: 'joint-appendix.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 240_000,
  extractedText: 'Joint appendix containing record excerpts.',
  extractedSignals: ['appendix'],
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
    expect(evaluateRelief(session).availableRelief).toEqual(['affirm'])

    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('opening_brief', briefPdf))
    session = fileDraft(session, draft('joint_appendix', appendixPdf))

    expect(evaluateRelief(session).availableRelief).toContain('vacate in part')
  })
})

