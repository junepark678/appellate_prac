import { describe, expect, it } from 'vitest'

import { ruleRefs } from '../modules/registry'
import { applyAcceptedActorWorkProduct } from './actors/effects'
import { actorDecisionAccepted, normalizeActorDecision } from './actors/decisions'
import { validateAiProposal } from './actors/proposals'
import {
  defaultFilingMetadata,
  filingDraftToSubmission,
  getAvailableEcfEventDefinitions,
  preflightEcfFiling,
  submitEcfFiling,
} from './filing/ecf'
import { ca4EcfCatalogEvents } from './filing/ca4-ecf-catalog'
import { evaluateRelief } from './merits/relief'
import { formPanelConference } from './panel/conference'
import {
  advanceProcedure,
  inferProcedureState,
  nextProcedureToolCall,
  transitionAfterFiling,
} from './procedure/state-machine'
import { calculateDeadlineDueDate } from './rules/deadline-calculator'
import { ca4DeadlineRules } from './rules/ca4-source-profile'
import { preflightFilingSubmission } from './rules/executable-constraints'
import { applyToolCall, createInitialSession, fileDraft } from './simulation'
import { advanceSimulationTurn } from './simulation/director'
import { nextCounterpartyReaction } from './counterparty/reactive-strategy'
import type {
  ActorWorkProduct,
  CaseSession,
  FilingDraft,
  FilingSubmission,
  UploadedDocument,
} from './types'

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

function expectFilingBackedDocketEntriesResolve(session: CaseSession) {
  const acceptedFilings = session.filings.filter((filing) => filing.outcome !== 'rejected')
  for (const filing of acceptedFilings) {
    expect(session.docketEntries.some((entry) => entry.filingId === filing.id)).toBe(true)
    for (const document of filing.documents) {
      expect(document.mimeType).toBe('application/pdf')
      expect(document.fileName.endsWith('.pdf')).toBe(true)
      expect(document.sizeBytes).toBeGreaterThan(0)
      expect(document.pageCount ?? 1).toBeGreaterThan(0)
    }
  }

  for (const entry of session.docketEntries.filter((candidate) => candidate.filingId)) {
    const filing = session.filings.find((candidate) => candidate.id === entry.filingId)
    expect(filing).toBeTruthy()
    expect(filing?.documents.length).toBeGreaterThan(0)
  }
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

const replyPdf: UploadedDocument = {
  id: 'reply',
  fileName: 'reply-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 140_000,
  extractedText:
    'Reply brief. Argument. Record citation. Oral argument statement. Conclusion.',
  extractedSignals: ['reply', 'argument', 'record citation', 'oral argument', 'conclusion'],
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
  it('computes source-backed weekend and federal holiday deadline carry-forward', () => {
    const weekendRule = ca4DeadlineRules.find((rule) => rule.deadlineId === 'motion_response_10_days')
    const holidayRule = ca4DeadlineRules.find((rule) => rule.deadlineId === 'notice_of_appeal_30_days')
    expect(weekendRule).toBeTruthy()
    expect(holidayRule).toBeTruthy()

    expect(calculateDeadlineDueDate('2026-05-13T12:00:00.000Z', weekendRule!)).toBe(
      '2026-05-26T12:00:00.000Z',
    )
    expect(calculateDeadlineDueDate('2026-06-19T12:00:00.000Z', holidayRule!)).toBe(
      '2026-07-20T12:00:00.000Z',
    )
    expect(calculateDeadlineDueDate('2026-12-02T12:00:00.000Z', holidayRule!)).toBe(
      '2027-01-04T12:00:00.000Z',
    )
    expect(calculateDeadlineDueDate('2021-12-01T12:00:00.000Z', holidayRule!)).toBe(
      '2022-01-03T12:00:00.000Z',
    )
  })

  it('exposes source-backed ECF event availability and catalog metadata', () => {
    const session = createInitialSession()
    const events = getAvailableEcfEventDefinitions(session)
    const notice = events.find((event) => event.eventId === 'notice_of_appeal')
    const motion = events.find((event) => event.eventId === 'motion')

    expect(ca4EcfCatalogEvents.length).toBeGreaterThan(10)
    expect(events.every((event) => event.courtEventName && event.sourceUrl)).toBe(true)
    expect(notice?.courtEventName).toBe('Notice of Appeal')
    expect(notice?.sourceUrl).toContain('filingevents')
    expect(notice?.availabilityReason).toContain('source-mapped')
    expect(motion?.reliefOptions).toContain('extend time')
  })

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
    expect(result.issues[0]?.sourceVersionIds?.length).toBeGreaterThan(0)
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

  it('runs a full ECF and actor-effect happy path through judgment and mandate deadline', () => {
    let session = createInitialSession()
    session = submitEcfFiling(session, submission('notice_of_appeal', noticePdf)).session
    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('docketing_statement', docketingPdf))
    session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf))
    session = fileDraft(session, draft('opening_brief', briefPdf))
    session = fileDraft(session, draft('joint_appendix', appendixPdf))

    const appelleeProduct = actorProduct({
      id: 'appellee_effect',
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
          'Jurisdictional response. Statement of issues. Standard of review. Argument with record citation. Oral argument statement. Conclusion. Certificate of Service. Certificate of Compliance.',
        certificateOfService: true,
        certificateOfCompliance: true,
        sealed: false,
        notes: 'Accepted AI appellee brief.',
        citations: [],
        ruleRefs: [ruleRefs.frap31],
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: session.filings.map((filing) => filing.id),
      createdAt: session.simulatedDate,
    })
    const appelleeEffect = applyAcceptedActorWorkProduct(session, appelleeProduct)
    session = appelleeEffect.session
    expect(appelleeEffect.receipt?.eventId).toBe('appellee_brief')

    session = fileDraft(session, draft('reply_brief', replyPdf))
    session = applyToolCall(session, {
      tool: 'submitToPanel',
      actorId: 'ca4_clerk',
      text: 'Briefing is complete and the case is submitted on the briefs.',
    })
    session = applyAcceptedActorWorkProduct(session, actorProduct({
      id: 'bench_effect',
      caseSessionId: session.id,
      actorId: 'ca4_staff_attorney',
      kind: 'bench_memo',
      status: 'proposed',
      workProduct: {
        title: 'Bench Memo',
        summary: 'Recommend affirmance.',
        reasoning: ['The record and briefs support affirmance.'],
        recommendations: ['Affirm.'],
        citations: [],
        ruleRefs: [ruleRefs.frap34],
        reliefOption: 'affirm',
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: session.filings.map((filing) => filing.id),
      createdAt: session.simulatedDate,
    })).session
    for (const judge of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3']) {
      session = applyAcceptedActorWorkProduct(session, actorProduct({
        id: `vote_effect_${judge}`,
        caseSessionId: session.id,
        actorId: judge,
        kind: 'judge_vote_memo',
        status: 'proposed',
        workProduct: {
          title: 'Vote Memo',
          summary: 'Vote to affirm.',
          reasoning: ['Affirmance is available on this record.'],
          recommendations: ['Affirm.'],
          citations: [],
          ruleRefs: [ruleRefs.frap34],
          reliefOption: 'affirm',
          requestedDisposition: 'affirm',
          confidence: 0.8,
        },
        sourceDocumentAnalysisIds: [],
        sourceFilingIds: session.filings.map((filing) => filing.id),
        createdAt: session.simulatedDate,
      })).session
    }

    session = applyAcceptedActorWorkProduct(session, actorProduct({
      id: 'disposition_effect',
      caseSessionId: session.id,
      actorId: 'ca4_panel',
      kind: 'panel_disposition_draft',
      status: 'proposed',
      workProduct: {
        title: 'Panel Disposition',
        summary: 'Judgment affirmed. The mandate will issue under FRAP 41.',
        reasoning: ['Three votes support affirmance.'],
        recommendations: ['Enter judgment affirming.'],
        citations: [],
        ruleRefs: [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
        reliefOption: 'affirm',
        requestedDisposition: 'affirm',
      },
      sourceDocumentAnalysisIds: [],
      sourceFilingIds: session.filings.map((filing) => filing.id),
      createdAt: session.simulatedDate,
    })).session
    session = applyToolCall(session, {
      tool: 'enterJudgment',
      actorId: 'ca4_panel',
      disposition: 'affirm',
      judgmentText: 'Judgment affirmed.',
      ruleRefs: [ruleRefs.frap36, ruleRefs.frap41],
    })

    expect(session.status).toBe('closed')
    expect(session.panelDeliberation?.votes).toHaveLength(3)
    expect(session.panelDisposition?.disposition).toBe('affirm')
    expect(session.deadlines.some((deadline) => deadline.targetEventId === 'mandate')).toBe(true)
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

    result = preflightEcfFiling(session, {
      ...submission('motion', stayMotionPdf),
      metadata: {
        ...defaultFilingMetadata('motion'),
        reliefRequested: '',
      },
    })
    expect(result.issues.some((issue) => issue.code === 'ecf_motion_relief_missing')).toBe(true)

    const closedSession = { ...session, status: 'closed' as const, procedureState: 'judgment_entered' as const }
    result = preflightFilingSubmission(closedSession, submission('rule_28j_letter', rule28jPdf))
    expect(result.issues.some((issue) => issue.code === 'rule_28j_after_judgment')).toBe(true)
  })

  it('creates rehearing, mandate, and costs deadlines from source-backed post-judgment rules', () => {
    let session = createInitialSession()
    session = { ...session, simulatedDate: '2026-05-11T12:00:00.000Z' }
    session = applyToolCall(
      {
        ...session,
        panelDisposition: {
          id: 'disposition',
          disposition: 'affirm',
          judgmentText: 'Judgment affirmed.',
          majorityJudgeActorIds: ['ca4_judge_1', 'ca4_judge_2'],
          separateOpinions: [],
          votes: [],
          ruleRefs: [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
          createdAt: session.simulatedDate,
        },
      },
      {
        tool: 'enterJudgment',
        actorId: 'ca4_panel',
        disposition: 'affirm',
        judgmentText: 'Judgment affirmed.',
        ruleRefs: [ruleRefs.frap36, ruleRefs.frap41],
      },
    )

    expect(session.deadlines.find((deadline) => deadline.targetEventId === 'petition_rehearing')?.dueDate).toBe(
      '2026-05-26T12:00:00.000Z',
    )
    expect(session.deadlines.find((deadline) => deadline.targetEventId === 'mandate')?.sourceRuleRefs.map((rule) => rule.ruleId)).toContain('FRAP_41')
    expect(session.deadlines.some((deadline) => deadline.targetEventId === 'bill_of_costs')).toBe(true)
  })

  it('advances a complete deterministic multi-agent simulation turn path through judgment', () => {
    let session = createInitialSession()
    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('docketing_statement', docketingPdf))
    session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf))
    session = advanceSimulationTurn(session).session
    session = fileDraft(session, draft('opening_brief', briefPdf))
    session = fileDraft(session, draft('joint_appendix', appendixPdf))

    for (let index = 0; index < 12 && session.status !== 'closed'; index += 1) {
      session = advanceSimulationTurn(session).session
      if (session.procedureState === 'reply_brief_pending') {
        session = fileDraft(session, draft('reply_brief', replyPdf))
      }
    }

    expect(session.status).toBe('closed')
    expect(session.simulationTurns?.length).toBeGreaterThanOrEqual(6)
    expect(session.panelDeliberation?.votes.map((vote) => vote.judgeActorId)).toEqual([
      'ca4_judge_1',
      'ca4_judge_2',
      'ca4_judge_3',
    ])
    expect(formPanelConference(session)?.majorityResult).toBeTruthy()
    expect(session.deadlines.some((deadline) => deadline.targetEventId === 'mandate')).toBe(true)
    expectFilingBackedDocketEntriesResolve(session)
  })

  it('rejects invalid actor decisions without applying unavailable relief', () => {
    const session = createInitialSession()
    const decision = normalizeActorDecision(session, 'appellee_ai', {
      tool: 'fileCounterpartyDocument',
      actorId: 'appellee_ai',
      eventId: 'reply_brief',
      title: 'Improper Reply Brief',
      text: 'Appellee attempts to file appellant reply briefing.',
    })

    expect(actorDecisionAccepted(decision)).toBe(false)
    expect(decision.validationIssues.map((issue) => issue.message).join(' ')).toContain('reply')
  })

  it('lets appellee react to a learner motion before merits briefing', () => {
    let session = createInitialSession()
    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    session = fileDraft(session, {
      ...draft('motion', stayMotionPdf),
      title: 'Motion to Extend Time',
    })

    const reaction = nextCounterpartyReaction(session)
    expect(reaction && 'eventId' in reaction ? reaction.eventId : null).toBe('motion_response')
    session = advanceSimulationTurn(session).session
    expect(session.filings.some((filing) => filing.eventId === 'motion_response')).toBe(true)
  })

  it('forms a split panel conference only after three independent judge votes', () => {
    let session = createInitialSession()
    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    session = fileDraft(session, draft('appearance_disclosure', disclosurePdf))
    session = fileDraft(session, draft('docketing_statement', docketingPdf))
    session = fileDraft(session, draft('transcript_order_acknowledgment', transcriptAckPdf))
    session = advanceSimulationTurn(session).session
    session = fileDraft(session, draft('opening_brief', briefPdf))
    session = fileDraft(session, draft('joint_appendix', appendixPdf))
    session = advanceSimulationTurn(session).session
    session = fileDraft(session, draft('reply_brief', replyPdf))

    for (let index = 0; index < 12 && !formPanelConference(session); index += 1) {
      session = advanceSimulationTurn(session).session
    }

    const conference = formPanelConference(session)
    expect(new Set(session.panelDeliberation?.votes.map((vote) => vote.judgeActorId)).size).toBe(3)
    expect(conference?.judgeActorIds).toHaveLength(3)
    expect(conference?.majorityResult).toBeTruthy()
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
