import { describe, expect, it } from 'vitest'

import { ruleRefs } from '../../modules/registry'
import { defaultFilingMetadata } from '../filing/ecf'
import { addPanelVote, assignPanel, deterministicPanelVote } from '../panel/deliberation'
import { transitionAfterFiling } from '../procedure/state-machine'
import { createInitialSession, fileDraft } from '../simulation'
import { generateActorWorkProductWithProvider } from './orchestration'
import {
  canAcceptActorWorkProduct,
  generatedFilingToSubmission,
  validateActorWorkProduct,
} from './work-products'
import type {
  ActorReasoningMemo,
  ActorWorkProduct,
  FilingDraft,
  GeneratedFilingDraft,
  UploadedDocument,
} from '../types'
import type { AiProvider, StructuredAiRequest, StructuredAiResult } from '../ports'

function actorProduct(
  input: Omit<
    ActorWorkProduct,
    'reviewStatus' | 'citations' | 'ruleRefs' | 'recordRefs' | 'confidence' | 'roleAuthority'
  >,
): ActorWorkProduct {
  return {
    ...input,
    reviewStatus:
      input.status === 'accepted'
        ? 'accepted'
        : input.status === 'rejected'
          ? 'rejected'
          : 'proposed',
    citations: input.workProduct.citations,
    ruleRefs: input.workProduct.ruleRefs,
    recordRefs: input.workProduct.recordRefs ?? [],
    confidence: input.workProduct.confidence ?? 0.75,
    roleAuthority: input.workProduct.roleAuthority ?? 'test_actor',
  }
}

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
  fileName: 'disclosure.pdf',
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
    'Jurisdictional statement. Statement of issues. Retaliation summary judgment comparator evidence. Standard of review. Argument with record citation and J.A. 42. Oral argument statement. Conclusion.',
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
  extractedText: 'Joint appendix. Comparator evidence record excerpts for retaliation.',
  extractedSignals: ['appendix'],
}

const replyPdf: UploadedDocument = {
  id: 'reply',
  fileName: 'reply-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 150_000,
  extractedText: 'Reply brief.',
  extractedSignals: ['reply'],
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

class FakeProvider implements AiProvider {
  id = 'fake'

  constructor(private readonly value: ActorReasoningMemo | GeneratedFilingDraft) {}

  async completeStructured<T>(
    request: StructuredAiRequest<T>,
  ): Promise<StructuredAiResult<T>> {
    expect(request.schemaName).toBeTruthy()
    return {
      value: this.value as T,
      rawText: JSON.stringify(this.value),
      providerId: this.id,
    }
  }
}

describe('actor work products', () => {
  it('validates AI work products by actor role and procedure state', () => {
    const session = createInitialSession()
    const product = actorProduct({
      id: 'wp1',
      caseSessionId: session.id,
      actorId: 'ca4_judge_1',
      kind: 'counterparty_strategy',
      status: 'proposed',
      workProduct: {
        title: 'Strategy',
        summary: 'Improper actor.',
        reasoning: [],
        recommendations: [],
        citations: [],
        ruleRefs: [],
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: [],
      createdAt: session.simulatedDate,
    })

    const issues = validateActorWorkProduct(session, product)
    expect(issues.some((issue) => issue.code === 'actor_role_not_authorized')).toBe(true)
    expect(
      issues.some((issue) => issue.code === 'opening_brief_required_for_work_product'),
    ).toBe(true)
  })

  it('converts a generated appellee brief into an ECF submission', () => {
    const session = briefedSession()
    const product = actorProduct({
      id: 'wp2',
      caseSessionId: session.id,
      actorId: 'appellee_ai',
      kind: 'counterparty_filing_draft',
      status: 'proposed',
      workProduct: {
        eventId: 'appellee_brief',
        participantRole: 'appellee',
        title: 'Appellee Brief',
        documentFileName: 'appellee-brief.pdf',
        documentText:
          'Argument. Standard of review. Record citation. Conclusion. Certificate of Service. Certificate of Compliance.',
        certificateOfService: true,
        certificateOfCompliance: true,
        sealed: false,
        notes: 'Converted draft.',
        citations: [{ id: 'brief', label: 'Opening brief', sourceType: 'filing', sourceId: session.filings[2]?.id }],
        ruleRefs: [],
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: [session.filings[2]?.id ?? 'missing'],
      createdAt: session.simulatedDate,
    })

    const submission = generatedFilingToSubmission(session, product)
    expect(submission?.eventId).toBe('appellee_brief')
    expect(submission?.metadata).toEqual({
      ...defaultFilingMetadata('appellee_brief'),
      representedPartyId: 'appellee',
    })
    expect(canAcceptActorWorkProduct(session, product).accepted).toBe(true)
  })

  it('rejects panel vote work products when relief is barred', () => {
    let session = createInitialSession()
    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    session = assignPanel({ ...session, status: 'submitted', procedureState: 'panel_deliberation' })
    const product = actorProduct({
      id: 'wp3',
      caseSessionId: session.id,
      actorId: 'ca4_judge_1',
      kind: 'judge_vote_memo',
      status: 'proposed',
      workProduct: {
        title: 'Vote memo',
        summary: 'Vote for relief.',
        reasoning: [],
        recommendations: [],
        citations: [],
        ruleRefs: [],
        requestedDisposition: 'vacate',
        reliefOption: 'vacate',
        confidence: 0.8,
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: [],
      createdAt: session.simulatedDate,
    })

    expect(validateActorWorkProduct(session, product).map((issue) => issue.code)).toContain(
      'barred_relief_requested',
    )
  })

  it('only recommends amicus participation after proper posture', async () => {
    const provider = new FakeProvider({
      title: 'Amicus recommendation',
      summary: 'Civil rights issue has broader significance.',
      reasoning: ['The opening brief raises retaliation and comparator evidence.'],
      recommendations: ['Recommend a public-interest amicus supporting appellant.'],
      citations: [],
      ruleRefs: [],
    })

    await expect(
      generateActorWorkProductWithProvider({
        session: createInitialSession(),
        provider,
        kind: 'amicus_recommendation',
      }),
    ).rejects.toThrow('No actor work product')

    const product = await generateActorWorkProductWithProvider({
      session: briefedSession(),
      provider,
      kind: 'amicus_recommendation',
    })
    expect(product.kind).toBe('amicus_recommendation')
    expect(product.actorId).toBe('public_interest_amicus')
  })

  it('allows panel disposition drafts after three votes', () => {
    let session = briefedSession()
    session = fileDraft(session, draft('reply_brief', replyPdf))
    session = transitionAfterFiling(
      assignPanel({ ...session, status: 'submitted', procedureState: 'panel_deliberation' }),
    )

    const product = actorProduct({
      id: 'wp4',
      caseSessionId: session.id,
      actorId: 'ca4_panel',
      kind: 'panel_disposition_draft',
      status: 'proposed',
      workProduct: {
        title: 'Disposition',
        summary: 'Affirm.',
        reasoning: [],
        recommendations: [],
        citations: [],
        ruleRefs: [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
        requestedDisposition: 'affirm',
        reliefOption: 'affirm',
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: [],
      createdAt: session.simulatedDate,
    })

    const withoutVotes = validateActorWorkProduct(session, product)
    expect(withoutVotes.map((issue) => issue.code)).toContain(
      'three_votes_required_for_disposition',
    )

    let withVotes = session
    for (const judge of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3']) {
      withVotes = addPanelVote(withVotes, {
        ...deterministicPanelVote(withVotes, judge),
        vote: 'affirm',
        reliefOption: 'affirm',
      })
    }
    expect(validateActorWorkProduct(withVotes, product)).toHaveLength(0)
  })
})
