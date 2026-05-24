import { getCourtPack, getFilingEvent, ruleRefs } from '../../modules/registry'
import { evaluateRelief } from '../legal/evaluators'
import { defaultFilingMetadata } from '../filing/ecf'
import { validatePanelDisposition } from '../panel/deliberation'
import { preflightFilingSubmission } from '../rules/executable-constraints'
import { isActorReasoningMemo, isGeneratedFilingDraft, validateWorkProductPayload } from './schemas'
import type {
  ActorWorkProduct,
  ActorWorkProductKind,
  CaseSession,
  FilingSubmission,
  GeneratedFilingDraft,
  ParticipantRole,
  UploadedDocument,
  ValidationIssue,
} from '../types'

const workProductToolByKind: Record<ActorWorkProductKind, string> = {
  counterparty_strategy: 'draftCounterpartyStrategy',
  counterparty_filing_draft: 'draftCounterpartyFiling',
  amicus_recommendation: 'recommendAmicusParticipation',
  amicus_filing_draft: 'draftCounterpartyFiling',
  bench_memo: 'draftBenchMemo',
  judge_vote_memo: 'castPanelVote',
  panel_disposition_draft: 'draftPanelDisposition',
  assessment_feedback: 'draftAssessmentFeedback',
}

const roleByKind: Record<ActorWorkProductKind, string[]> = {
  counterparty_strategy: ['opposing_party'],
  counterparty_filing_draft: ['opposing_party'],
  amicus_recommendation: ['amicus'],
  amicus_filing_draft: ['amicus'],
  bench_memo: ['judge'],
  judge_vote_memo: ['judge'],
  panel_disposition_draft: ['panel'],
  assessment_feedback: ['judge', 'panel', 'clerk'],
}

function activeFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.eventId))
}

function sourceFilingIds(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.id))
}

function sourceDocumentAnalysisIds(session: CaseSession) {
  return new Set(
    activeFilings(session)
      .flatMap((filing) => filing.documents)
      .flatMap((document) => [
        ...(document.analysisId ? [document.analysisId] : []),
        ...(document.analysis ? [`${document.id}:analysis`] : []),
      ]),
  )
}

function sourceRecordExcerptIds(session: CaseSession) {
  return new Set(session.scenario.recordExcerpts?.map((excerpt) => excerpt.id) ?? [])
}

function sourceDocketEntryIds(session: CaseSession) {
  return new Set(session.docketEntries.map((entry) => entry.id))
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  cureSuggestion: string,
): ValidationIssue {
  return {
    severity,
    code,
    message,
    ruleRefs: [ruleRefs.ca4Local45],
    cureSuggestion,
  }
}

function normalizedRelief(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').trim()
}

function actorIssues(session: CaseSession, product: Pick<ActorWorkProduct, 'actorId' | 'kind'>) {
  const courtPack = getCourtPack(session.courtPackId)
  const actor = courtPack.aiActors.find((candidate) => candidate.id === product.actorId)
  const issues: ValidationIssue[] = []
  const expectedTool = workProductToolByKind[product.kind]

  if (!actor) {
    issues.push(
      issue(
        'error',
        'actor_not_registered',
        'Actor is not registered for this court pack.',
        'Use an AI actor published by the current Fourth Circuit court pack.',
      ),
    )
    return issues
  }

  if (!roleByKind[product.kind].includes(actor.role)) {
    issues.push(
      issue(
        'error',
        'actor_role_not_authorized',
        `${actor.label} cannot create ${product.kind.replaceAll('_', ' ')} work products.`,
        'Choose an actor whose role has authority for this work product kind.',
      ),
    )
  }

  if (!actor.allowedTools.includes(expectedTool as never)) {
    issues.push(
      issue(
        'error',
        'actor_tool_not_authorized',
        `${actor.label} is not authorized to use ${expectedTool}.`,
        'Update the court pack actor authority or choose a different work product.',
      ),
    )
  }

  return issues
}

function postureIssues(session: CaseSession, kind: ActorWorkProductKind) {
  const filedEvents = activeFiledEventSet(session)
  const issues: ValidationIssue[] = []

  if (
    ['counterparty_strategy', 'amicus_recommendation'].includes(kind) &&
    !filedEvents.has('opening_brief')
  ) {
    issues.push(
      issue(
        'error',
        'opening_brief_required_for_work_product',
        'This work product requires an accepted opening brief.',
        'Docket the appellant opening brief before generating this actor work product.',
      ),
    )
  }

  if (
    ['counterparty_filing_draft', 'amicus_filing_draft'].includes(kind) &&
    (!filedEvents.has('opening_brief') || !filedEvents.has('joint_appendix'))
  ) {
    issues.push(
      issue(
        'error',
        'brief_and_appendix_required_for_filing_draft',
        'Generated merits filing drafts require an accepted opening brief and joint appendix.',
        'Docket the opening brief and joint appendix before drafting responsive filings.',
      ),
    )
  }

  if (kind === 'bench_memo' && !['submitted', 'panel_deliberation'].includes(session.procedureState ?? session.status)) {
    issues.push(
      issue(
        'error',
        'bench_memo_requires_panel_posture',
        'A bench memo requires submitted or panel-deliberation posture.',
        'Complete briefing and submit the case to the panel first.',
      ),
    )
  }

  if (kind === 'judge_vote_memo' && !['submitted', 'panel_deliberation'].includes(session.procedureState ?? session.status)) {
    issues.push(
      issue(
        'error',
        'judge_vote_requires_panel_posture',
        'Judge vote memos require submitted or panel-deliberation posture.',
        'Submit the case to the panel before judge voting.',
      ),
    )
  }

  if (
    kind === 'panel_disposition_draft' &&
    (session.actorWorkProducts?.filter(
      (product) => product.kind === 'judge_vote_memo' && product.status !== 'rejected',
    ).length ?? 0) < 3 &&
    (session.panelDeliberation?.votes.length ?? 0) < 3
  ) {
    issues.push(
      issue(
        'error',
        'three_votes_required_for_disposition',
        'A panel disposition draft requires three judge votes.',
        'Generate or record all three judge vote memos before drafting the disposition.',
      ),
    )
  }

  if (kind === 'assessment_feedback' && session.procedureState !== 'judgment_entered' && session.status !== 'closed') {
    issues.push(
      issue(
        'error',
        'assessment_requires_judgment',
        'Assessment feedback requires judgment or closed-case posture.',
        'Enter judgment before generating final assessment feedback.',
      ),
    )
  }

  return issues
}

function citationIssues(session: CaseSession, product: ActorWorkProduct) {
  const filings = sourceFilingIds(session)
  const analyses = sourceDocumentAnalysisIds(session)
  const recordExcerpts = sourceRecordExcerptIds(session)
  const docketEntries = sourceDocketEntryIds(session)
  const issues: ValidationIssue[] = []

  for (const filingId of product.sourceFilingIds) {
    if (!filings.has(filingId)) {
      issues.push(
        issue(
          'error',
          'source_filing_unavailable',
          `Source filing ${filingId} is not available in the current case session.`,
          'Cite only accepted filings in this session.',
        ),
      )
    }
  }

  for (const analysisId of product.sourceDocumentAnalysisIds) {
    if (!analyses.has(analysisId)) {
      issues.push(
        issue(
          'error',
          'source_document_analysis_unavailable',
          `Source document analysis ${analysisId} is not available in the current case session.`,
          'Cite only persisted or attached document analyses in this session.',
        ),
      )
    }
  }

  for (const citation of product.workProduct.citations) {
    if (citation.sourceType !== 'rule' && !citation.sourceId) {
      issues.push(
        issue(
          'error',
          'citation_source_id_missing',
          `Citation ${citation.label} does not identify a supported source.`,
          'Cite a filing, docket entry, record excerpt, or document analysis from the current session.',
        ),
      )
      continue
    }
    if (citation.sourceType === 'filing' && citation.sourceId && !filings.has(citation.sourceId)) {
      issues.push(
        issue(
          'error',
          'citation_filing_unavailable',
          `Citation ${citation.label} references an unavailable filing.`,
          'Ground citations in accepted filings already in the session.',
        ),
      )
    }
    if (
      citation.sourceType === 'document_analysis' &&
      citation.sourceId &&
      !analyses.has(citation.sourceId)
    ) {
      issues.push(
        issue(
          'error',
          'citation_document_analysis_unavailable',
          `Citation ${citation.label} references unavailable document analysis.`,
          'Use document analysis IDs attached to uploaded PDFs.',
        ),
      )
    }
    if (
      citation.sourceType === 'record_excerpt' &&
      citation.sourceId &&
      !recordExcerpts.has(citation.sourceId)
    ) {
      issues.push(
        issue(
          'error',
          'citation_record_excerpt_unavailable',
          `Citation ${citation.label} references an unavailable record excerpt.`,
          'Use record excerpts attached to the current scenario.',
        ),
      )
    }
    if (
      citation.sourceType === 'docket_entry' &&
      citation.sourceId &&
      !docketEntries.has(citation.sourceId)
    ) {
      issues.push(
        issue(
          'error',
          'citation_docket_entry_unavailable',
          `Citation ${citation.label} references an unavailable docket entry.`,
          'Use docket entry IDs from the current case session.',
        ),
      )
    }
    if (citation.sourceType === 'rule' && !citation.ruleRef) {
      issues.push(
        issue(
          'error',
          'citation_rule_ref_missing',
          `Citation ${citation.label} references a rule without a rule reference.`,
          'Attach the FRAP or Fourth Circuit rule reference supporting the claim.',
        ),
      )
    }
  }

  return issues
}

function ruleReferenceIssues(product: ActorWorkProduct) {
  if (isGeneratedFilingDraft(product.workProduct)) return []
  const memo = product.workProduct

  if (!memo.proceduralClaims?.length) return []
  if (memo.ruleRefs.length > 0) return []

  return [
    issue(
      'error',
      'procedural_claim_rule_refs_missing',
      'Procedural claims require supporting rule references.',
      'Add FRAP or Fourth Circuit rule references for procedural claims.',
    ),
  ]
}

function reliefIssues(session: CaseSession, product: ActorWorkProduct) {
  if (!isActorReasoningMemo(product.workProduct)) return []
  if (!['judge_vote_memo', 'panel_disposition_draft'].includes(product.kind)) return []

  const requested =
    product.workProduct.reliefOption ?? product.workProduct.requestedDisposition ?? ''
  if (!requested.trim()) return []

  const relief = evaluateRelief(session)
  const available = new Set(relief.availableRelief.map(normalizedRelief))
  const normalized = normalizedRelief(requested)

  if (available.has(normalized) || normalized.includes('affirm')) return []

  return [
    issue(
      'error',
      'barred_relief_requested',
      'AI work product requests relief barred by the deterministic relief evaluation.',
      'Revise the recommendation to use available relief or explain affirmance.',
    ),
  ]
}

function generatedFilingIssues(session: CaseSession, product: ActorWorkProduct) {
  if (!isGeneratedFilingDraft(product.workProduct)) return []
  const submission = generatedFilingToSubmission(session, product)
  if (!submission) {
    return [
      issue(
        'error',
        'generated_filing_conversion_failed',
        'Generated filing draft could not be converted to an ECF submission.',
        'Ensure the generated filing has a valid event, role, title, and document text.',
      ),
    ]
  }

  return preflightFilingSubmission(session, submission, session.simulatedDate).issues
}

function duplicateJudgeVoteIssues(session: CaseSession, product: ActorWorkProduct) {
  if (product.kind !== 'judge_vote_memo') return []
  const duplicateVote = session.panelDeliberation?.votes.some(
    (vote) => vote.judgeActorId === product.actorId,
  )
  const duplicateProduct = session.actorWorkProducts?.some(
    (candidate) =>
      candidate.id !== product.id &&
      candidate.kind === 'judge_vote_memo' &&
      candidate.actorId === product.actorId &&
      candidate.status !== 'rejected',
  )
  if (!duplicateVote && !duplicateProduct) return []
  return [
    issue(
      'error',
      'duplicate_judge_vote',
      'This judge has already recorded or proposed a vote in this panel deliberation.',
      'Use the next assigned judge who has not voted.',
    ),
  ]
}

function counterpartyFilingPostureIssues(session: CaseSession, product: ActorWorkProduct) {
  if (product.kind !== 'counterparty_filing_draft' || !isGeneratedFilingDraft(product.workProduct)) {
    return []
  }
  const filedEvents = activeFiledEventSet(session)
  const draft = product.workProduct
  const issues: ValidationIssue[] = []

  if (draft.eventId === 'appellee_brief') {
    if (filedEvents.has('appellee_brief')) {
      issues.push(
        issue(
          'error',
          'appellee_brief_already_filed',
          'The appellee brief has already been filed.',
          'Do not docket duplicate appellee merits briefing.',
        ),
      )
    }
    if (!session.deadlines.some((deadline) => deadline.targetEventId === 'appellee_brief' && deadline.status === 'open')) {
      issues.push(
        issue(
          'error',
          'appellee_brief_deadline_not_open',
          'The appellee brief draft is premature because no appellee-brief deadline is open.',
          'Wait for the opening brief and appendix posture to generate an appellee brief.',
        ),
      )
    }
  }

  return issues
}

function panelDispositionIssues(session: CaseSession, product: ActorWorkProduct) {
  if (product.kind !== 'panel_disposition_draft' || !isActorReasoningMemo(product.workProduct)) {
    return []
  }
  const memo = product.workProduct
  const validation = validatePanelDisposition(session, {
    disposition: memo.reliefOption ?? memo.requestedDisposition ?? memo.title,
    judgmentText: memo.summary || memo.recommendations.join(' '),
    ruleRefs: memo.ruleRefs,
  })

  return validation.issues.map((message) =>
    issue(
      'error',
      'panel_disposition_invalid',
      message,
      'Record three valid votes, confirm a two-judge majority, and include the required disposition rule references.',
    ),
  )
}

export function normalizeActorWorkProduct(
  input: Omit<
    ActorWorkProduct,
    | 'id'
    | 'status'
    | 'reviewStatus'
    | 'citations'
    | 'ruleRefs'
    | 'recordRefs'
    | 'confidence'
    | 'roleAuthority'
    | 'validationIssues'
  > & {
    id?: string
    status?: ActorWorkProduct['status']
    reviewStatus?: ActorWorkProduct['reviewStatus']
    citations?: ActorWorkProduct['citations']
    ruleRefs?: ActorWorkProduct['ruleRefs']
    recordRefs?: ActorWorkProduct['recordRefs']
    confidence?: ActorWorkProduct['confidence']
    roleAuthority?: ActorWorkProduct['roleAuthority']
  },
): ActorWorkProduct | null {
  if (!validateWorkProductPayload(input.kind, input.workProduct)) return null
  const citations = input.citations ?? input.workProduct.citations
  const ruleRefs = input.ruleRefs ?? input.workProduct.ruleRefs
  const recordRefs = input.recordRefs ?? input.workProduct.recordRefs ?? []
  const confidence = input.confidence ?? input.workProduct.confidence ?? 0.75
  const roleAuthority =
    input.roleAuthority ??
    input.workProduct.roleAuthority ??
    roleByKind[input.kind].join(',')

  return {
    id: input.id ?? `work_product_${input.createdAt.replace(/[^0-9]/g, '')}`,
    caseSessionId: input.caseSessionId,
    actorId: input.actorId,
    kind: input.kind,
    status: input.status ?? 'proposed',
    reviewStatus: input.reviewStatus ?? (input.status === 'accepted' ? 'accepted' : input.status === 'rejected' ? 'rejected' : 'proposed'),
    workProduct: input.workProduct,
    citations,
    ruleRefs,
    recordRefs,
    confidence,
    roleAuthority,
    sourceDocumentAnalysisIds: input.sourceDocumentAnalysisIds,
    sourceFilingIds: input.sourceFilingIds,
    createdAt: input.createdAt,
  }
}

export function validateActorWorkProduct(
  session: CaseSession,
  product: ActorWorkProduct,
): ValidationIssue[] {
  return [
    ...actorIssues(session, product),
    ...postureIssues(session, product.kind),
    ...citationIssues(session, product),
    ...ruleReferenceIssues(product),
    ...reliefIssues(session, product),
    ...duplicateJudgeVoteIssues(session, product),
    ...counterpartyFilingPostureIssues(session, product),
    ...panelDispositionIssues(session, product),
    ...generatedFilingIssues(session, product),
  ]
}

export function canAcceptActorWorkProduct(session: CaseSession, product: ActorWorkProduct) {
  const validationIssues = validateActorWorkProduct(session, product)
  return {
    accepted: validationIssues.every((validationIssue) => validationIssue.severity !== 'error'),
    validationIssues,
  }
}

function generatedDocumentId(session: CaseSession, draft: GeneratedFilingDraft) {
  return `generated_${draft.eventId}_${session.filings.length + 1}`
}

function generatedDocument(
  session: CaseSession,
  draft: GeneratedFilingDraft,
): UploadedDocument {
  return {
    id: generatedDocumentId(session, draft),
    fileName: draft.documentFileName || `${draft.eventId.replaceAll('_', '-')}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: Math.max(60_000, draft.documentText.length * 2),
    pageCount: Math.max(1, Math.ceil(draft.documentText.split(/\s+/).length / 450)),
    extractedText: draft.documentText,
    extractedSignals: [
      'argument',
      ...(draft.eventId.includes('brief') ? ['record citation', 'standard of review'] : []),
      ...draft.ruleRefs.map((ruleRef) => ruleRef.label.toLowerCase()),
    ],
    textExtractionStatus: 'extracted',
    wordCount: draft.documentText.split(/\s+/).filter(Boolean).length,
  }
}

function participantRoleForGeneratedDraft(draft: GeneratedFilingDraft): ParticipantRole {
  if (draft.participantRole === 'amicus') return 'amicus'
  if (draft.participantRole === 'appellee') return 'appellee'
  return draft.participantRole
}

export function generatedFilingToSubmission(
  session: CaseSession,
  workProduct: ActorWorkProduct,
): FilingSubmission | null {
  if (!isGeneratedFilingDraft(workProduct.workProduct)) return null
  const draft = workProduct.workProduct
  const event = getFilingEvent(session.courtPackId, draft.eventId)
  if (!event) return null

  return {
    eventId: draft.eventId,
    participantRole: participantRoleForGeneratedDraft(draft),
    title: draft.title,
    mainDocument: generatedDocument(session, draft),
    attachments:
      draft.attachmentTexts?.map((attachment, index) => ({
        id: `generated_attachment_${index + 1}`,
        label: attachment.label,
        document: {
          id: `generated_attachment_${index + 1}_${draft.eventId}`,
          fileName: attachment.fileName,
          mimeType: 'application/pdf',
          sizeBytes: Math.max(25_000, attachment.text.length * 2),
          extractedText: attachment.text,
          extractedSignals: [attachment.label.toLowerCase()],
          textExtractionStatus: 'extracted' as const,
          wordCount: attachment.text.split(/\s+/).filter(Boolean).length,
        },
        attachmentType: attachment.attachmentType,
      })) ?? [],
    metadata: {
      ...defaultFilingMetadata(draft.eventId, draft.sealed),
      representedPartyId: participantRoleForGeneratedDraft(draft),
      certificateOfService: draft.certificateOfService,
      certificateOfCompliance: draft.certificateOfCompliance,
      ...(draft.sealed
        ? {
            privacyAcknowledged: true,
            redactionAcknowledged: true,
            publicRedactedVersionIncluded: true,
            sealedDocumentType: 'sealed material',
          }
        : {}),
    },
    notes: draft.notes,
  }
}
