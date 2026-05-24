import { describe, expect, it } from 'vitest'

import { ruleRefs } from '../../modules/registry'
import { applyToolCall, createInitialSession, fileDraft } from '../simulation'
import { assignPanel } from '../panel/deliberation'
import type {
  ActorReasoningMemo,
  ActorWorkProduct,
  FilingDraft,
  GeneratedFilingDraft,
  UploadedDocument,
} from '../types'
import { applyAcceptedActorWorkProduct } from './effects'

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
  session = fileDraft(session, {
    ...draft('appellee_brief', {
      id: 'appellee',
      fileName: 'appellee-brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 180_000,
      extractedText: 'Argument. Standard of review. Record citation. Conclusion.',
      extractedSignals: ['argument', 'standard of review', 'record citation', 'conclusion'],
    }, 'appellee'),
    certificateOfCompliance: true,
  })
  session = fileDraft(session, draft('reply_brief', replyPdf))
  return assignPanel({ ...session, status: 'submitted', procedureState: 'panel_deliberation' })
}

function memoProduct(
  kind: ActorWorkProduct['kind'],
  actorId: string,
  workProduct: Partial<ActorReasoningMemo> = {},
): ActorWorkProduct {
  const session = createInitialSession()
  return {
    id: `${kind}_${actorId}`,
    caseSessionId: session.id,
    actorId,
    kind,
    status: 'proposed',
    workProduct: {
      title: workProduct.title ?? kind,
      summary: workProduct.summary ?? 'Source-linked recommendation.',
      reasoning: workProduct.reasoning ?? ['The accepted filings support the recommendation.'],
      recommendations: workProduct.recommendations ?? ['Proceed under the available posture.'],
      citations: workProduct.citations ?? [],
      ruleRefs: workProduct.ruleRefs ?? [],
      proceduralClaims: workProduct.proceduralClaims,
      requestedDisposition: workProduct.requestedDisposition,
      reliefOption: workProduct.reliefOption,
      confidence: workProduct.confidence,
    },
    sourceDocumentAnalysisIds: [],
    sourceFilingIds: [],
    createdAt: '2026-05-24T10:00:00.000Z',
  }
}

function filingProduct(
  kind: 'counterparty_filing_draft' | 'amicus_filing_draft',
  actorId: string,
  draftProduct: GeneratedFilingDraft,
): ActorWorkProduct {
  return {
    id: `${kind}_${actorId}`,
    caseSessionId: 'case_0001',
    actorId,
    kind,
    status: 'proposed',
    workProduct: draftProduct,
    sourceDocumentAnalysisIds: [],
    sourceFilingIds: [],
    createdAt: '2026-05-24T10:00:00.000Z',
  }
}

describe('accepted actor work product effects', () => {
  it('updates counterparty strategy from an accepted strategy memo', () => {
    const session = briefedSession()
    const product = memoProduct('counterparty_strategy', 'appellee_ai', {
      recommendations: ['File appellee brief emphasizing preservation and harmless error.'],
      proceduralClaims: ['Preservation defects support appellee response strategy.'],
      ruleRefs: [ruleRefs.frap31],
    })

    const result = applyAcceptedActorWorkProduct(session, product)

    expect(result.session.counterpartyStrategy?.meritsArguments.join(' ')).toContain(
      'appellee brief',
    )
  })

  it('dockets and receipts an accepted counterparty filing draft', () => {
    const session = briefedSession()
    const product = filingProduct('counterparty_filing_draft', 'appellee_ai', {
      eventId: 'appellee_brief',
      participantRole: 'appellee',
      title: 'Appellee Brief',
      documentFileName: 'appellee-brief.pdf',
      documentText:
        'Argument. Standard of review. Record citation. Oral argument statement. Conclusion. Certificate of Service. Certificate of Compliance.',
      certificateOfService: true,
      certificateOfCompliance: true,
      sealed: false,
      notes: 'Generated appellee brief.',
      citations: [],
      ruleRefs: [ruleRefs.frap31],
    })

    const result = applyAcceptedActorWorkProduct(session, product)

    expect(result.session.filings.at(-1)?.eventId).toBe('appellee_brief')
    expect(result.receipt?.eventId).toBe('appellee_brief')
  })

  it('creates amicus participation from an accepted recommendation', () => {
    const session = briefedSession()
    const product = memoProduct('amicus_recommendation', 'public_interest_amicus', {
      title: 'Civil Rights Appellate Center',
      summary: 'All parties consent to a public-interest amicus supporting appellant.',
      recommendations: ['Recommend amicus participation supporting appellant.'],
    })

    const result = applyAcceptedActorWorkProduct(session, product)

    expect(result.session.amicusParticipation?.candidates[0]?.organizationName).toBe(
      'Civil Rights Appellate Center',
    )
    expect(result.session.amicusParticipation?.candidates[0]?.consentStatus).toBe(
      'all_parties_consent',
    )
  })

  it('dockets an accepted amicus filing when consent or leave posture permits it', () => {
    const recommended = applyAcceptedActorWorkProduct(
      briefedSession(),
      memoProduct('amicus_recommendation', 'public_interest_amicus', {
        title: 'Civil Rights Appellate Center',
        summary: 'All parties consent to a public-interest amicus supporting appellant.',
      }),
    ).session
    const product = filingProduct('amicus_filing_draft', 'public_interest_amicus', {
      eventId: 'amicus_brief',
      participantRole: 'amicus',
      title: 'Amicus Brief',
      documentFileName: 'amicus-brief.pdf',
      documentText:
        'Amicus interest statement. Argument. Certificate of Service. Certificate of Compliance.',
      certificateOfService: true,
      certificateOfCompliance: true,
      sealed: false,
      notes: 'Generated amicus brief.',
      citations: [],
      ruleRefs: [ruleRefs.frap29],
    })

    const result = applyAcceptedActorWorkProduct(recommended, product)

    expect(result.session.filings.at(-1)?.eventId).toBe('amicus_brief')
  })

  it('moves panel posture to voting after an accepted bench memo', () => {
    const session = submittedSession()
    const product = memoProduct('bench_memo', 'ca4_staff_attorney', {
      reliefOption: 'affirm',
      ruleRefs: [ruleRefs.frap34],
    })

    const result = applyAcceptedActorWorkProduct(session, product)

    expect(result.session.benchMemo?.authorActorId).toBe('ca4_staff_attorney')
    expect(result.session.panelDeliberation?.posture).toBe('voting')
  })

  it('records three accepted judge vote memos', () => {
    let session = submittedSession()
    for (const judge of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3']) {
      session = applyAcceptedActorWorkProduct(
        session,
        memoProduct('judge_vote_memo', judge, {
          reliefOption: 'affirm',
          requestedDisposition: 'affirm',
          confidence: 0.8,
        }),
      ).session
    }

    expect(session.panelDeliberation?.votes).toHaveLength(3)
    expect(session.panelDeliberation?.majorityPosition).toBe('affirm')
  })

  it('creates a judgment-ready panel disposition from an accepted draft', () => {
    let session = submittedSession()
    for (const judge of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3']) {
      session = applyAcceptedActorWorkProduct(
        session,
        memoProduct('judge_vote_memo', judge, {
          reliefOption: 'affirm',
          requestedDisposition: 'affirm',
        }),
      ).session
    }

    const result = applyAcceptedActorWorkProduct(
      session,
      memoProduct('panel_disposition_draft', 'ca4_panel', {
        summary: 'Judgment affirmed. The mandate will issue under FRAP 41.',
        reliefOption: 'affirm',
        requestedDisposition: 'affirm',
        ruleRefs: [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
      }),
    )

    expect(result.session.panelDisposition?.disposition).toBe('affirm')
    expect(result.session.panelDeliberation?.posture).toBe('entered')
  })

  it('updates assessment after judgment only', () => {
    let session = submittedSession()
    for (const judge of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3']) {
      session = applyAcceptedActorWorkProduct(
        session,
        memoProduct('judge_vote_memo', judge, {
          reliefOption: 'affirm',
          requestedDisposition: 'affirm',
        }),
      ).session
    }
    session = applyAcceptedActorWorkProduct(
      session,
      memoProduct('panel_disposition_draft', 'ca4_panel', {
        summary: 'Judgment affirmed.',
        reliefOption: 'affirm',
        requestedDisposition: 'affirm',
        ruleRefs: [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
      }),
    ).session
    session = applyToolCall(session, {
      tool: 'enterJudgment',
      actorId: 'ca4_panel',
      disposition: 'affirm',
      judgmentText: 'Judgment affirmed.',
      ruleRefs: [ruleRefs.frap36, ruleRefs.frap41],
    })

    const result = applyAcceptedActorWorkProduct(
      session,
      memoProduct('assessment_feedback', 'ca4_staff_attorney', {
        confidence: 0.91,
        proceduralClaims: ['The learner completed the required ECF sequence.'],
        recommendations: ['Use tighter record citations in the next simulation.'],
      }),
    )

    expect(result.session.assessment?.score).toBe(91)
    expect(result.session.assessment?.proceduralFindings[0]).toContain('ECF sequence')
  })
})

