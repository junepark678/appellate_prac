import type { AiProvider } from '../../modules/types'
import { evaluateRelief } from '../legal/evaluators'
import {
  normalizeActorWorkProduct,
  validateActorWorkProduct,
} from './work-products'
import {
  schemaForWorkProductKind,
  validateWorkProductPayload,
} from './schemas'
import type {
  ActorReasoningMemo,
  ActorWorkProduct,
  ActorWorkProductKind,
  CaseSession,
  GeneratedFilingDraft,
} from '../types'

export type ActorWorkProductTask = {
  kind: ActorWorkProductKind
  actorId: string
  label: string
  sourceFilingIds: string[]
  sourceDocumentAnalysisIds: string[]
}

function activeFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.eventId))
}

function sourceFilingIds(session: CaseSession) {
  return activeFilings(session).map((filing) => filing.id)
}

function sourceDocumentAnalysisIds(session: CaseSession) {
  return activeFilings(session)
    .flatMap((filing) => filing.documents)
    .flatMap((document) => [
      ...(document.analysisId ? [document.analysisId] : []),
      ...(document.analysis ? [`${document.id}:analysis`] : []),
    ])
}

function hasWorkProduct(session: CaseSession, kind: ActorWorkProductKind) {
  return session.actorWorkProducts?.some(
    (product) => product.kind === kind && product.status !== 'rejected',
  )
}

function hasJudgeVoteWorkProduct(session: CaseSession, actorId: string) {
  return session.actorWorkProducts?.some(
    (product) =>
      product.kind === 'judge_vote_memo' &&
      product.actorId === actorId &&
      product.status !== 'rejected',
  )
}

function broadLegalSignificance(session: CaseSession) {
  const text = [
    session.scenario.natureOfSuit,
    session.scenario.proceduralPosture,
    ...session.scenario.issuesPresented,
  ]
    .join(' ')
    .toLowerCase()

  return /(civil rights|constitutional|retaliation|discrimination|class|public|first amendment|title vii)/i.test(
    text,
  )
}

function briefingComplete(session: CaseSession) {
  const filedEvents = activeFiledEventSet(session)
  return ['opening_brief', 'joint_appendix', 'appellee_brief', 'reply_brief'].every(
    (eventId) => filedEvents.has(eventId),
  )
}

function baseTask(
  session: CaseSession,
  kind: ActorWorkProductKind,
  actorId: string,
  label: string,
): ActorWorkProductTask {
  return {
    kind,
    actorId,
    label,
    sourceFilingIds: sourceFilingIds(session),
    sourceDocumentAnalysisIds: sourceDocumentAnalysisIds(session),
  }
}

export function availableActorWorkProductTasks(session: CaseSession): ActorWorkProductTask[] {
  const tasks: ActorWorkProductTask[] = []
  const filedEvents = activeFiledEventSet(session)

  if (filedEvents.has('opening_brief') && !hasWorkProduct(session, 'counterparty_strategy')) {
    tasks.push(baseTask(session, 'counterparty_strategy', 'appellee_ai', 'Appellee strategy'))
  }

  if (
    filedEvents.has('opening_brief') &&
    filedEvents.has('joint_appendix') &&
    !hasWorkProduct(session, 'counterparty_filing_draft')
  ) {
    tasks.push(
      baseTask(session, 'counterparty_filing_draft', 'appellee_ai', 'Appellee brief draft'),
    )
  }

  if (
    filedEvents.has('opening_brief') &&
    broadLegalSignificance(session) &&
    !hasWorkProduct(session, 'amicus_recommendation')
  ) {
    tasks.push(
      baseTask(
        session,
        'amicus_recommendation',
        'public_interest_amicus',
        'Amicus participation recommendation',
      ),
    )
  }

  if (
    session.actorWorkProducts?.some(
      (product) => product.kind === 'amicus_recommendation' && product.status === 'accepted',
    ) &&
    !hasWorkProduct(session, 'amicus_filing_draft')
  ) {
    tasks.push(
      baseTask(session, 'amicus_filing_draft', 'public_interest_amicus', 'Amicus brief draft'),
    )
  }

  if (
    briefingComplete(session) &&
    ['submitted', 'panel_deliberation'].includes(session.procedureState ?? session.status) &&
    !hasWorkProduct(session, 'bench_memo')
  ) {
    tasks.push(baseTask(session, 'bench_memo', 'ca4_staff_attorney', 'Staff bench memo'))
  }

  if (['submitted', 'panel_deliberation'].includes(session.procedureState ?? session.status)) {
    for (const actorId of ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3']) {
      if (!hasJudgeVoteWorkProduct(session, actorId)) {
        tasks.push(baseTask(session, 'judge_vote_memo', actorId, `${actorId} vote memo`))
        break
      }
    }
  }

  const voteWorkProducts =
    session.actorWorkProducts?.filter(
      (product) => product.kind === 'judge_vote_memo' && product.status !== 'rejected',
    ).length ?? 0
  if (
    (voteWorkProducts >= 3 || (session.panelDeliberation?.votes.length ?? 0) >= 3) &&
    !hasWorkProduct(session, 'panel_disposition_draft')
  ) {
    tasks.push(baseTask(session, 'panel_disposition_draft', 'ca4_panel', 'Panel disposition draft'))
  }

  if (
    (session.status === 'closed' || session.procedureState === 'judgment_entered') &&
    !hasWorkProduct(session, 'assessment_feedback')
  ) {
    tasks.push(baseTask(session, 'assessment_feedback', 'ca4_staff_attorney', 'Assessment feedback'))
  }

  return tasks
}

export function nextActorWorkProductTask(
  session: CaseSession,
  requestedKind?: ActorWorkProductKind,
) {
  const tasks = availableActorWorkProductTasks(session)
  if (!requestedKind) return tasks[0] ?? null
  return tasks.find((task) => task.kind === requestedKind) ?? null
}

function filingSummary(session: CaseSession) {
  return activeFilings(session).map((filing) => ({
    id: filing.id,
    eventId: filing.eventId,
    title: filing.title,
    participantRole: filing.participantRole,
    outcome: filing.outcome,
    validationIssues: filing.validationIssues,
    documents: filing.documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      pageCount: document.pageCount,
      wordCount: document.wordCount ?? document.analysis?.wordCount,
      analysisId: document.analysisId ?? (document.analysis ? `${document.id}:analysis` : undefined),
      textExtractionStatus: document.textExtractionStatus ?? document.analysis?.textExtractionStatus,
      recordCitationCount: document.analysis?.recordCitations?.length ?? 0,
      appendixCitationCount: document.analysis?.appendixCitations?.length ?? 0,
      certificateOfServiceDetected: document.analysis?.certificateOfServiceDetected,
      certificateOfComplianceDetected: document.analysis?.certificateOfComplianceDetected,
      textSnippet: (document.analysis?.normalizedText ?? document.extractedText ?? '').slice(0, 1200),
    })),
  }))
}

function systemPrompt(task: ActorWorkProductTask) {
  return [
    'You are a constrained Fourth Circuit civil appeal simulator actor.',
    `Create only the requested ${task.kind.replaceAll('_', ' ')} work product as JSON.`,
    'Ground every material claim in the provided filings, document analyses, record excerpts, or rule references.',
    'Do not invent docketed filings, unavailable relief, party authority, or procedural rules.',
    'The simulator validators remain authoritative; draft and recommend only.',
  ].join(' ')
}

function userPrompt(session: CaseSession, task: ActorWorkProductTask) {
  return JSON.stringify({
    task,
    procedureState: session.procedureState,
    status: session.status,
    courtPackId: session.courtPackId,
    simulatedDate: session.simulatedDate,
    scenario: session.scenario,
    docketEntries: session.docketEntries.slice(-10),
    deadlines: session.deadlines,
    filings: filingSummary(session),
    existingWorkProducts: session.actorWorkProducts?.map((product) => ({
      id: product.id,
      kind: product.kind,
      actorId: product.actorId,
      status: product.status,
      createdAt: product.createdAt,
    })),
    reliefEvaluation: evaluateRelief(session),
  })
}

function defaultMemo(task: ActorWorkProductTask, session: CaseSession): ActorReasoningMemo {
  const relief = evaluateRelief(session)
  return {
    title: task.label,
    summary: `${task.label} based on accepted filings and available document analysis.`,
    reasoning: activeFilings(session).map(
      (filing) => `${filing.title} is available as source filing ${filing.id}.`,
    ),
    recommendations: [
      relief.availableRelief.includes('vacate in part')
        ? 'Address preserved record-supported issues before recommending vacatur.'
        : 'Available deterministic relief is limited; emphasize affirmance or procedural limits.',
    ],
    citations: task.sourceFilingIds.map((sourceId, index) => ({
      id: `source_${index + 1}`,
      label: `Source filing ${index + 1}`,
      sourceType: 'filing' as const,
      sourceId,
    })),
    ruleRefs: [],
    ...(task.kind === 'panel_disposition_draft'
      ? {
          requestedDisposition: relief.availableRelief[0] ?? 'affirm',
          reliefOption: relief.availableRelief[0] ?? 'affirm',
        }
      : {}),
    ...(task.kind === 'judge_vote_memo'
      ? {
          requestedDisposition: relief.availableRelief[0] ?? 'affirm',
          reliefOption: relief.availableRelief[0] ?? 'affirm',
          confidence: 0.72,
        }
      : {}),
  }
}

function defaultFilingDraft(task: ActorWorkProductTask): GeneratedFilingDraft {
  const isAmicus = task.kind === 'amicus_filing_draft'
  return {
    eventId: isAmicus ? 'amicus_brief' : 'appellee_brief',
    participantRole: isAmicus ? 'amicus' : 'appellee',
    title: isAmicus ? 'Amicus Brief' : 'Appellee Brief',
    documentFileName: isAmicus ? 'amicus-brief.pdf' : 'appellee-brief.pdf',
    documentText:
      'Argument. Standard of review. The brief relies on the opening brief, joint appendix, and record citation signals provided in the simulator record. Conclusion. The requested disposition follows available deterministic relief.',
    certificateOfService: true,
    certificateOfCompliance: true,
    sealed: false,
    notes: 'Generated draft requires explicit learner acceptance before ECF submission.',
    citations: task.sourceFilingIds.map((sourceId, index) => ({
      id: `source_${index + 1}`,
      label: `Source filing ${index + 1}`,
      sourceType: 'filing' as const,
      sourceId,
    })),
    ruleRefs: [],
  }
}

function defaultPayload(
  task: ActorWorkProductTask,
  session: CaseSession,
): ActorReasoningMemo | GeneratedFilingDraft {
  return ['counterparty_filing_draft', 'amicus_filing_draft'].includes(task.kind)
    ? defaultFilingDraft(task)
    : defaultMemo(task, session)
}

export async function generateActorWorkProductWithProvider(args: {
  session: CaseSession
  provider: AiProvider
  kind?: ActorWorkProductKind
  nowIso?: string
  model?: string
}): Promise<ActorWorkProduct> {
  const task = nextActorWorkProductTask(args.session, args.kind)
  if (!task) {
    throw new Error('No actor work product is available in the current posture.')
  }

  const result = await args.provider.completeStructured<ActorReasoningMemo | GeneratedFilingDraft>({
    schemaName: task.kind,
    schema: schemaForWorkProductKind(task.kind),
    messages: [
      { role: 'system', content: systemPrompt(task) },
      { role: 'user', content: userPrompt(args.session, task) },
    ],
    model: args.model,
    metadata: {
      caseSessionId: args.session.id,
      actorId: task.actorId,
      kind: task.kind,
    },
    validate: (value): value is ActorReasoningMemo | GeneratedFilingDraft =>
      validateWorkProductPayload(task.kind, value),
  })

  const payload = result.value ?? defaultPayload(task, args.session)
  const normalized = normalizeActorWorkProduct({
    caseSessionId: args.session.id,
    actorId: task.actorId,
    kind: task.kind,
    status: 'proposed',
    workProduct: payload,
    sourceDocumentAnalysisIds: task.sourceDocumentAnalysisIds,
    sourceFilingIds: task.sourceFilingIds,
    createdAt: args.nowIso ?? new Date().toISOString(),
  })

  if (!normalized) {
    throw new Error('AI returned malformed work product JSON.')
  }

  return {
    ...normalized,
    validationIssues: validateActorWorkProduct(args.session, normalized),
  }
}
