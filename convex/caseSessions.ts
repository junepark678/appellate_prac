// TODO: Import from './errors' once error module is integrated
import { v } from 'convex/values'

import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { getCurrentUser, requireCurrentUser, requireIdentity, upsertCurrentUserDoc } from './authHelpers'
import {
  actorWorkProductKindValidator,
  actorWorkProductValidator,
  caseSessionSummaryValidator,
  caseSessionValidator,
  courtListenerSearchResultValidator,
  documentAnalysisValidator,
  documentAnalysisRecordValidator,
  ecfEventAvailabilityValidator,
  ecfReceiptValidator,
  filingDraftValidator,
  filingSubmissionValidator,
  preflightCheckResultValidator,
  toolCallValidator,
  trialDocketValidator,
  uploadedDocumentValidator,
  validationIssueValidator,
} from './validators'
import { generateActorWorkProductWithProvider } from '../src/domain/actors/orchestration'
import {
  canAcceptActorWorkProduct,
} from '../src/domain/actors/work-products'
import { applyAcceptedActorWorkProduct } from '../src/domain/actors/effects'
import {
  applyToolCall,
  createInitialSession,
  fileDraft,
  nextExpectedToolCall,
  validateFiling,
  validateToolCall,
} from '../src/domain/simulation'
import { requestProceduralToolCall } from '../src/integrations/openrouter'
import { OpenRouterProvider } from '../src/modules/ai-providers/openrouter'
import type {
  ActorWorkProduct,
  CaseSession,
  FilingRecord,
  FilingSubmission,
  DocumentAnalysis,
  PanelAssignment,
  ScenarioIssue,
  ScenarioRecordExcerpt,
  Scenario,
  TrialDocket,
  TrialDocketEntry,
  UploadedDocument,
} from '../src/domain/types'
import {
  getAvailableEcfEventDefinitions,
  preflightEcfFiling,
  submitEcfFiling as submitEcfFilingDomain,
} from '../src/domain/filing/ecf'
import {
  advanceProcedure as advanceProcedureStateMachine,
  inferProcedureState,
  transitionAfterFiling,
} from '../src/domain/procedure/state-machine'
import {
  advanceAutonomousSimulation as advanceAutonomousSimulationDomain,
  advanceSimulationTurn as advanceSimulationTurnDomain,
  snapshotHash,
} from '../src/domain/simulation/director'
import type { CourtListenerSearchResult } from '../src/integrations/courtlistener'
import scenarioSeed from '../src/domain/scenarios.seed.json'

type ReadCtx = QueryCtx | MutationCtx
type WriteCtx = MutationCtx
type EcfReceiptRecord = NonNullable<CaseSession['ecfReceipts']>[number]
type SimulationTurnRecord = NonNullable<CaseSession['simulationTurns']>[number]
type SimulationTurnPayload = {
  startedAt?: string
  completedAt?: string
  effects?: string[]
  inputSnapshotHash?: string
  outputSnapshotHash?: string
  validatorVersion?: string
  retryCount?: number
  stoppedReason?: string
}

const defaultScenarioKey = 'synthetic-employment-retaliation'
const openRouterCooldownMs = 10_000
const estimatedOpenRouterCostCents = 1
const AI_CALL_TIMEOUT_MS = 30_000
const seedScenarios = scenarioSeed as Scenario[]

// TODO: Wrap in withTimeout() from ai-resilience once module is integrated
function withAiTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${AI_CALL_TIMEOUT_MS}ms`)),
        AI_CALL_TIMEOUT_MS,
      ),
    ),
  ])
}

function createdMonth(isoDate: string) {
  return isoDate.slice(0, 7)
}

function makeRecordId(prefix: string, count: number) {
  return `${prefix}_${String(count + 1).padStart(4, '0')}`
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

const defaultTurnPolicy = {
  maxTurnsPerRun: 6,
  requireHumanApprovalFor: ['disposeCase', 'enterJudgment'],
  stopOnDeficiency: true,
}

function parseJsonField<T>(json: string, label: string): T {
  try {
    return JSON.parse(json) as T
  } catch {
    // ERROR_CODE: VALIDATION_ERROR
    throw new Error(`Invalid persisted JSON for ${label}.`)
  }
}

function parseOptionalJsonField<T>(json: string | undefined, label: string): T | undefined {
  return json ? parseJsonField<T>(json, label) : undefined
}

function scenarioFromDoc(
  doc: Doc<'scenarios'>,
  issues: ScenarioIssue[] = [],
  recordExcerpts: ScenarioRecordExcerpt[] = [],
): Scenario {
  const sourceCaseUrl = doc.sourceCaseUrl ? { sourceCaseUrl: doc.sourceCaseUrl } : {}
  const training = parseOptionalJsonField<Scenario['training']>(
    doc.trainingJson,
    `scenario ${doc._id} training`,
  )
  const trialDocket = parseOptionalJsonField<Scenario['trialDocket']>(
    doc.trialDocketJson,
    `scenario ${doc._id} trial docket`,
  )
  const documentAssets = parseOptionalJsonField<Scenario['documentAssets']>(
    doc.documentAssetsJson,
    `scenario ${doc._id} document assets`,
  )
  return {
    id: doc.scenarioKey,
    title: doc.title,
    source: doc.source,
    courtPackId: doc.courtPackId,
    shortCaption: doc.shortCaption,
    lowerTribunal: doc.lowerTribunal,
    natureOfSuit: doc.natureOfSuit,
    proceduralPosture: doc.proceduralPosture,
    issuesPresented: doc.issuesPresented,
    meritsRecord: doc.meritsRecord,
    ...(issues.length ? { issues } : {}),
    ...(recordExcerpts.length ? { recordExcerpts } : {}),
    ...(training ? { training } : {}),
    ...(trialDocket ? { trialDocket } : {}),
    ...(documentAssets ? { documentAssets } : {}),
    ...sourceCaseUrl,
  }
}

async function ensureScenarioDoc(ctx: WriteCtx, scenarioKey: string) {
  const existing = await ctx.db
    .query('scenarios')
    .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenarioKey))
    .unique()

  const bundled = seedScenarios.find((scenario) => scenario.id === scenarioKey)
  if (!bundled) {
    // ERROR_CODE: NOT_FOUND
    throw new Error(`Unknown scenario: ${scenarioKey}`)
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      title: bundled.title,
      source: bundled.source,
      courtPackId: bundled.courtPackId,
      shortCaption: bundled.shortCaption,
      lowerTribunal: bundled.lowerTribunal,
      natureOfSuit: bundled.natureOfSuit,
      proceduralPosture: bundled.proceduralPosture,
      issuesPresented: bundled.issuesPresented,
      meritsRecord: bundled.meritsRecord,
      ...(bundled.training ? { trainingJson: JSON.stringify(bundled.training) } : {}),
      ...(bundled.trialDocket ? { trialDocketJson: JSON.stringify(bundled.trialDocket) } : {}),
      ...(bundled.documentAssets
        ? { documentAssetsJson: JSON.stringify(bundled.documentAssets) }
        : {}),
      ...(bundled.sourceCaseUrl ? { sourceCaseUrl: bundled.sourceCaseUrl } : {}),
      published: true,
    })
    const [existingIssues, existingExcerpts] = await Promise.all([
      ctx.db
        .query('scenarioIssues')
        .withIndex('by_scenario', (index) => index.eq('scenarioId', existing._id))
        .collect(),
      ctx.db
        .query('scenarioRecordExcerpts')
        .withIndex('by_scenario', (index) => index.eq('scenarioId', existing._id))
        .collect(),
    ])
    if (existingIssues.length !== (bundled.issues?.length ?? 0)) {
      await Promise.all(existingIssues.map((issue) => ctx.db.delete(issue._id)))
      for (const issue of bundled.issues ?? []) {
        await ctx.db.insert('scenarioIssues', {
          scenarioId: existing._id,
          issueId: issue.id,
          label: issue.label,
          standardOfReview: issue.standardOfReview,
          preservationFacts: issue.preservationFacts,
          recordSupportFacts: issue.recordSupportFacts,
          likelyArgumentsForAppellant: issue.likelyArgumentsForAppellant,
          likelyArgumentsForAppellee: issue.likelyArgumentsForAppellee,
          possibleRelief: issue.possibleRelief,
        })
      }
    }
    if (existingExcerpts.length !== (bundled.recordExcerpts?.length ?? 0)) {
      await Promise.all(existingExcerpts.map((excerpt) => ctx.db.delete(excerpt._id)))
      for (const excerpt of bundled.recordExcerpts ?? []) {
        await ctx.db.insert('scenarioRecordExcerpts', {
          scenarioId: existing._id,
          excerptId: excerpt.id,
          label: excerpt.label,
          source: excerpt.source,
          text: excerpt.text,
          citedByIssueIds: excerpt.citedByIssueIds,
        })
      }
    }
    return existing
  }

  const scenarioId = await ctx.db.insert('scenarios', {
    scenarioKey: bundled.id,
    title: bundled.title,
    source: bundled.source,
    courtPackId: bundled.courtPackId,
    shortCaption: bundled.shortCaption,
    lowerTribunal: bundled.lowerTribunal,
    natureOfSuit: bundled.natureOfSuit,
    proceduralPosture: bundled.proceduralPosture,
    issuesPresented: bundled.issuesPresented,
    meritsRecord: bundled.meritsRecord,
    ...(bundled.training ? { trainingJson: JSON.stringify(bundled.training) } : {}),
    ...(bundled.trialDocket ? { trialDocketJson: JSON.stringify(bundled.trialDocket) } : {}),
    ...(bundled.documentAssets
      ? { documentAssetsJson: JSON.stringify(bundled.documentAssets) }
      : {}),
    ...(bundled.sourceCaseUrl ? { sourceCaseUrl: bundled.sourceCaseUrl } : {}),
    published: true,
  })
  for (const issue of bundled.issues ?? []) {
    await ctx.db.insert('scenarioIssues', {
      scenarioId,
      issueId: issue.id,
      label: issue.label,
      standardOfReview: issue.standardOfReview,
      preservationFacts: issue.preservationFacts,
      recordSupportFacts: issue.recordSupportFacts,
      likelyArgumentsForAppellant: issue.likelyArgumentsForAppellant,
      likelyArgumentsForAppellee: issue.likelyArgumentsForAppellee,
      possibleRelief: issue.possibleRelief,
    })
  }
  for (const excerpt of bundled.recordExcerpts ?? []) {
    await ctx.db.insert('scenarioRecordExcerpts', {
      scenarioId,
      excerptId: excerpt.id,
      label: excerpt.label,
      source: excerpt.source,
      text: excerpt.text,
      citedByIssueIds: excerpt.citedByIssueIds,
    })
  }
  const scenario = await ctx.db.get(scenarioId)
  if (!scenario) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Unable to seed scenario')
  }
  return scenario
}

async function requireAuthorizedSessionDoc(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
  userId: Id<'users'>,
) {
  const caseSession = await ctx.db.get(caseSessionId)
  if (!caseSession || caseSession.userId !== userId) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Case session not found')
  }
  return caseSession
}

async function requireWritableCaseSession(ctx: ReadCtx, caseSessionId: Id<'caseSessions'>) {
  const assignmentSessions = await ctx.db
    .query('assignmentSessions')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .collect()
  const isLocked = assignmentSessions.some(
    (assignmentSession) =>
      assignmentSession.submittedAt &&
      (!assignmentSession.reopenedAt ||
        assignmentSession.reopenedAt <= assignmentSession.submittedAt),
  )
  if (isLocked) {
    // ERROR_CODE: SESSION_LOCKED
    throw new Error('Submitted assignment sessions are locked until reopened by an instructor')
  }
}

function analysisFromDoc(doc: Doc<'documentAnalyses'>): DocumentAnalysis {
  if (doc.analysisJson) {
    return parseJsonField<DocumentAnalysis>(doc.analysisJson, `document analysis ${doc._id}`)
  }

  return {
    analyzerId: doc.analyzerId,
    ...(typeof doc.pageCount === 'number' ? { pageCount: doc.pageCount } : {}),
    fileSizeBytes: doc.fileSizeBytes,
    mimeType: doc.mimeType,
    searchableText: doc.searchableText,
    certificateOfServiceDetected: doc.certificateOfServiceDetected,
    certificateOfComplianceDetected: doc.certificateOfComplianceDetected,
    sealedOrRedactionWarning: doc.sealedOrRedactionWarning,
    warnings: doc.warnings,
  }
}

function documentFromDoc(
  doc: Doc<'documents'>,
  analysis?: Doc<'documentAnalyses'>,
): UploadedDocument {
  const parsedAnalysis = analysis ? analysisFromDoc(analysis) : undefined
  return {
    id: doc._id,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    ...(doc.storageId ? { storageId: doc.storageId } : {}),
    ...(doc.sha256 ? { sha256: doc.sha256 } : {}),
    ...(typeof doc.pageCount === 'number' ? { pageCount: doc.pageCount } : {}),
    ...(doc.extractedText ? { extractedText: doc.extractedText } : {}),
    ...(doc.textExtractionStatus ? { textExtractionStatus: doc.textExtractionStatus } : {}),
    ...(typeof doc.wordCount === 'number' ? { wordCount: doc.wordCount } : {}),
    ...(doc.analysisId ? { analysisId: doc.analysisId } : {}),
    ...(parsedAnalysis ? { analysis: parsedAnalysis } : {}),
    extractedSignals: doc.extractedSignals,
  }
}

function actorWorkProductFromDoc(product: Doc<'actorWorkProducts'>): ActorWorkProduct {
  const workProduct = parseJsonField<ActorWorkProduct['workProduct']>(
    product.workProductJson,
    `actor work product ${product._id}`,
  )
  const citations = parseOptionalJsonField<ActorWorkProduct['citations']>(
    product.citationsJson,
    `actor work product ${product._id} citations`,
  )

  return {
    id: product._id,
    caseSessionId: product.caseSessionId,
    actorId: product.actorId,
    kind: product.kind,
    status: product.status,
    reviewStatus:
      product.reviewStatus ??
      (product.status === 'accepted'
        ? 'accepted'
        : product.status === 'rejected'
          ? 'rejected'
          : 'proposed'),
    workProduct,
    citations: citations ?? workProduct.citations,
    ruleRefs: product.ruleRefs ?? workProduct.ruleRefs,
    recordRefs: product.recordRefs ?? workProduct.recordRefs ?? [],
    confidence: product.confidence ?? workProduct.confidence ?? 0.75,
    roleAuthority: product.roleAuthority ?? workProduct.roleAuthority ?? 'simulator_actor',
    sourceDocumentAnalysisIds: product.sourceDocumentAnalysisIds,
    sourceFilingIds: product.sourceFilingIds,
    createdAt: product.createdAt,
  }
}

function ecfReceiptFromDoc(receipt: Doc<'ecfReceipts'>): EcfReceiptRecord {
  const documentList = parseOptionalJsonField<EcfReceiptRecord['documentList']>(
    receipt.documentListJson,
    `ECF receipt ${receipt._id} document list`,
  )
  const nextExpectedDeadline = parseOptionalJsonField<
    NonNullable<EcfReceiptRecord['nextExpectedDeadline']>
  >(receipt.nextExpectedDeadlineJson, `ECF receipt ${receipt._id} next deadline`)

  return {
    id: receipt._id,
    caseSessionId: receipt.caseSessionId,
    filingId: receipt.filingId,
    receiptNumber: receipt.receiptNumber,
    ...(receipt.filedTimestamp ? { filedTimestamp: receipt.filedTimestamp } : {}),
    ...(receipt.filer ? { filer: receipt.filer } : {}),
    ...(receipt.eventId ? { eventId: receipt.eventId } : {}),
    ...(documentList ? { documentList } : {}),
    noticeOfDocketActivityText: receipt.noticeOfDocketActivityText,
    serviceList: parseJsonField<string[]>(
      receipt.serviceListJson,
      `ECF receipt ${receipt._id} service list`,
    ),
    ...(receipt.docketText ? { docketText: receipt.docketText } : {}),
    ...(receipt.warnings ? { warnings: receipt.warnings } : {}),
    ...(receipt.deficiencies ? { deficiencies: receipt.deficiencies } : {}),
    ...(nextExpectedDeadline ? { nextExpectedDeadline } : {}),
    createdAt: receipt.createdAt,
  }
}

function simulationTurnFromDoc(turn: Doc<'simulationTurns'>): SimulationTurnRecord {
  const payload = parseJsonField<SimulationTurnPayload>(
    turn.payloadJson,
    `simulation turn ${turn._id} payload`,
  )

  return {
    id: turn._id,
    caseSessionId: turn.caseSessionId,
    turnNumber: turn.turnNumber,
    actorId: turn.actorId,
    kind: turn.kind as SimulationTurnRecord['kind'],
    status: turn.status as SimulationTurnRecord['status'],
    startedAt: payload.startedAt ?? turn.createdAt,
    ...(payload.completedAt ? { completedAt: payload.completedAt } : {}),
    effects: payload.effects ?? [],
    inputSnapshotHash: turn.inputSnapshotHash ?? payload.inputSnapshotHash ?? 'legacy',
    outputSnapshotHash: turn.outputSnapshotHash ?? payload.outputSnapshotHash ?? 'legacy',
    validatorVersion: turn.validatorVersion ?? payload.validatorVersion ?? 'legacy',
    retryCount: turn.retryCount ?? payload.retryCount ?? 0,
    ...(turn.stoppedReason ?? payload.stoppedReason
      ? { stoppedReason: turn.stoppedReason ?? payload.stoppedReason }
      : {}),
    ...(turn.rawActorPacketStorageId
      ? { rawActorPacketStorageId: turn.rawActorPacketStorageId }
      : {}),
    ...(turn.rawProviderResultStorageId
      ? { rawProviderResultStorageId: turn.rawProviderResultStorageId }
      : {}),
  }
}

async function assembleCaseSession(
  ctx: ReadCtx,
  caseSession: Doc<'caseSessions'>,
): Promise<CaseSession> {
  const scenarioDoc = await ctx.db.get(caseSession.scenarioId)
  if (!scenarioDoc) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Scenario not found for case session')
  }

  const [
    scenarioIssues,
    scenarioRecordExcerpts,
    participants,
    filings,
    documentAnalyses,
    docketEntries,
    deadlines,
    receipts,
    counterpartyStrategies,
    amicusParticipations,
    panelDeliberations,
    panelDispositions,
    assessments,
    actorWorkProducts,
    simulationTurns,
  ] = await Promise.all([
    ctx.db
      .query('scenarioIssues')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', scenarioDoc._id))
      .collect(),
    ctx.db
      .query('scenarioRecordExcerpts')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', scenarioDoc._id))
      .collect(),
    ctx.db
      .query('participants')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('filings')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('documentAnalyses')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('docketEntries')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('deadlines')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('ecfReceipts')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('counterpartyStrategies')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('amicusParticipations')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('panelDeliberations')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('panelDispositions')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('assessments')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('actorWorkProducts')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
    ctx.db
      .query('simulationTurns')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSession._id))
      .collect(),
  ])
  const analysisByDocumentId = new Map(
    documentAnalyses
      .filter((analysis): analysis is Doc<'documentAnalyses'> & { documentId: Id<'documents'> } =>
        Boolean(analysis.documentId),
      )
      .map((analysis) => [analysis.documentId, analysis]),
  )

  const filingRecords = await Promise.all(
    filings
      .slice()
      .sort((a, b) => a.filedAt.localeCompare(b.filedAt))
      .map(async (filing): Promise<FilingRecord> => {
        const documents = await Promise.all(filing.documentIds.map((id) => ctx.db.get(id)))
        const persistedDocuments = documents.filter(
          (document): document is Doc<'documents'> => document !== null,
        )
        return {
          id: filing._id,
          eventId: filing.eventId,
          participantRole: filing.participantRole,
          title: filing.title,
          documents: persistedDocuments.map((document) =>
            documentFromDoc(document, analysisByDocumentId.get(document._id)),
          ),
          certificateOfService: filing.certificateOfService,
          certificateOfCompliance: filing.certificateOfCompliance,
          sealed: filing.sealed,
          notes: filing.notes,
          filedAt: filing.filedAt,
          outcome: filing.outcome,
          validationIssues: filing.validationIssues,
          ...(filing.submissionJson ? { submissionJson: filing.submissionJson } : {}),
          ...(filing.documentAnalysisIds
            ? { documentAnalysisIds: filing.documentAnalysisIds }
            : {}),
        }
      }),
  )

  const assessment = assessments[0]
  const latestStrategy = counterpartyStrategies.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestAmicus = amicusParticipations.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestPanel = panelDeliberations.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestDisposition = panelDispositions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const panelAssignment =
    latestPanel?.assignment && latestPanel.assignment.judgeActorIds.length >= 3
      ? {
          ...latestPanel.assignment,
          judgeActorIds: latestPanel.assignment.judgeActorIds.slice(0, 3) as PanelAssignment['judgeActorIds'],
        }
      : undefined

  return {
    id: caseSession._id,
    scenario: scenarioFromDoc(
      scenarioDoc,
      scenarioIssues.map((issue) => ({
        id: issue.issueId,
        label: issue.label,
        standardOfReview: issue.standardOfReview,
        preservationFacts: issue.preservationFacts,
        recordSupportFacts: issue.recordSupportFacts,
        likelyArgumentsForAppellant: issue.likelyArgumentsForAppellant,
        likelyArgumentsForAppellee: issue.likelyArgumentsForAppellee,
        possibleRelief: issue.possibleRelief,
      })),
      scenarioRecordExcerpts.map((excerpt) => ({
        id: excerpt.excerptId,
        label: excerpt.label,
        source: excerpt.source,
        text: excerpt.text,
        citedByIssueIds: excerpt.citedByIssueIds,
      })),
    ),
    courtPackId: caseSession.courtPackId,
    status: caseSession.status,
    ...(caseSession.procedureState ? { procedureState: caseSession.procedureState } : {}),
    autonomyMode: caseSession.autonomyMode ?? 'supervised',
    turnPolicy: caseSession.turnPolicy ?? defaultTurnPolicy,
    ...(caseSession.sourceProfileId ? { sourceProfileId: caseSession.sourceProfileId } : {}),
    qualityState: caseSession.qualityState ?? 'source_review_pending',
    ...(caseSession.legalTrainingDisclaimerAcceptedAt
      ? { legalTrainingDisclaimerAcceptedAt: caseSession.legalTrainingDisclaimerAcceptedAt }
      : {}),
    simulatedDate: caseSession.simulatedDate,
    participants: participants.map((participant) => ({
      id: participant._id,
      displayName: participant.displayName,
      role: participant.role,
    })),
    docketEntries: docketEntries
      .slice()
      .sort((a, b) => a.entryNumber - b.entryNumber)
      .map((entry) => ({
        id: entry._id,
        entryNumber: entry.entryNumber,
        filedAt: entry.filedAt,
        actorRole: entry.actorRole,
        title: entry.title,
        text: entry.text,
        ...(entry.filingId ? { filingId: entry.filingId } : {}),
        ruleRefs: entry.ruleRefs,
      })),
    deadlines: deadlines
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((deadline) => ({
        id: deadline._id,
        label: deadline.label,
        dueDate: deadline.dueDate,
        targetEventId: deadline.targetEventId,
        sourceEntryId: deadline.sourceEntryId ?? 'manual',
        status: deadline.status,
        sourceRuleRefs: deadline.sourceRuleRefs,
      })),
    filings: filingRecords,
    ecfReceipts: receipts
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(ecfReceiptFromDoc),
    ...(latestStrategy ? { counterpartyStrategy: latestStrategy.strategy } : {}),
    ...(latestAmicus ? { amicusParticipation: latestAmicus.participation } : {}),
    ...(panelAssignment ? { panelAssignment } : {}),
    ...(latestPanel?.benchMemo ? { benchMemo: latestPanel.benchMemo } : {}),
    ...(latestPanel?.deliberation ? { panelDeliberation: latestPanel.deliberation } : {}),
    ...(latestDisposition ? { panelDisposition: latestDisposition.disposition } : {}),
    ...(assessment
      ? {
          assessment: {
            disposition: assessment.disposition,
            score: assessment.score,
            proceduralFindings: assessment.proceduralFindings,
            meritsFindings: assessment.meritsFindings,
            nextPracticeTargets: assessment.nextPracticeTargets,
          },
        }
      : {}),
    actorWorkProducts: actorWorkProducts
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(actorWorkProductFromDoc),
    simulationTurns: simulationTurns
      .slice()
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .map(simulationTurnFromDoc),
  }
}

async function deleteExistingSessionState(
  ctx: WriteCtx,
  caseSessionId: Id<'caseSessions'>,
) {
  const [
    participants,
    documents,
    documentAnalyses,
    filings,
    docketEntries,
    deadlines,
    receipts,
    counterpartyStrategies,
    amicusCandidates,
    amicusParticipations,
    panelDeliberations,
    panelDispositions,
    panelVotes,
    assessments,
    simulationTurns,
    actorPackets,
    actorDecisions,
  ] =
    await Promise.all([
      ctx.db
        .query('participants')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('documents')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('documentAnalyses')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('filings')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('docketEntries')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('deadlines')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('ecfReceipts')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('counterpartyStrategies')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('amicusCandidates')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('amicusParticipations')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('panelDeliberations')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('panelDispositions')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('panelVotes')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('assessments')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('simulationTurns')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('actorPackets')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      ctx.db
        .query('actorDecisions')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
    ])

  await Promise.all(
    [
      ...participants,
      ...documents,
      ...documentAnalyses,
      ...filings,
      ...docketEntries,
      ...deadlines,
      ...receipts,
      ...counterpartyStrategies,
      ...amicusCandidates,
      ...amicusParticipations,
      ...panelDeliberations,
      ...panelDispositions,
      ...panelVotes,
      ...assessments,
      ...actorPackets,
      ...actorDecisions,
      ...simulationTurns,
    ].map((doc) => ctx.db.delete(doc._id)),
  )
}

async function replaceSessionState(
  ctx: WriteCtx,
  caseSessionId: Id<'caseSessions'>,
  session: CaseSession,
) {
  await ctx.db.patch(caseSessionId, {
    status: session.status,
    procedureState: session.procedureState ?? inferProcedureState(session),
    simulatedDate: session.simulatedDate,
    courtPackId: session.courtPackId,
    autonomyMode: session.autonomyMode,
    turnPolicy: session.turnPolicy,
    ...(session.sourceProfileId ? { sourceProfileId: session.sourceProfileId } : {}),
    qualityState: session.qualityState,
    ...(session.legalTrainingDisclaimerAcceptedAt
      ? { legalTrainingDisclaimerAcceptedAt: session.legalTrainingDisclaimerAcceptedAt }
      : {}),
  })
  await deleteExistingSessionState(ctx, caseSessionId)

  await Promise.all(
    session.participants.map((participant) =>
      ctx.db.insert('participants', {
        caseSessionId,
        displayName: participant.displayName,
        role: participant.role,
      }),
    ),
  )

  const filingIdMap = new Map<string, Id<'filings'>>()
  for (const filing of session.filings) {
    const documentIds: Array<Id<'documents'>> = []
    const documentAnalysisIds: Array<Id<'documentAnalyses'>> = []
    for (const document of filing.documents) {
      const documentId = await ctx.db.insert('documents', {
        caseSessionId,
        ...(document.storageId ? { storageId: document.storageId as Id<'_storage'> } : {}),
        ...(document.sha256 ? { sha256: document.sha256 } : {}),
        fileName: document.fileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        ...(typeof document.pageCount === 'number' ? { pageCount: document.pageCount } : {}),
        ...(document.extractedText ? { extractedText: document.extractedText } : {}),
        ...(document.textExtractionStatus
          ? { textExtractionStatus: document.textExtractionStatus }
          : {}),
        ...(typeof document.wordCount === 'number' ? { wordCount: document.wordCount } : {}),
        extractedSignals: document.extractedSignals,
        ...(document.analysis ? { validationJson: JSON.stringify(document.analysis) } : {}),
      })
      if (document.analysis) {
        const analysis = document.analysis
        const analysisId = await ctx.db.insert('documentAnalyses', {
          caseSessionId,
          documentId,
          analyzerId: analysis.analyzerId,
          ...(typeof analysis.pageCount === 'number' ? { pageCount: analysis.pageCount } : {}),
          fileSizeBytes: analysis.fileSizeBytes,
          mimeType: analysis.mimeType,
          searchableText: analysis.searchableText,
          certificateOfServiceDetected: analysis.certificateOfServiceDetected,
          certificateOfComplianceDetected: analysis.certificateOfComplianceDetected,
          sealedOrRedactionWarning: analysis.sealedOrRedactionWarning,
          warnings: analysis.warnings,
          analysisJson: JSON.stringify(analysis),
          ...(analysis.normalizedText ? { extractedTextHash: hashText(analysis.normalizedText) } : {}),
          ...(typeof analysis.wordCount === 'number' ? { wordCount: analysis.wordCount } : {}),
          ...(analysis.legalCitations
            ? { citationCount: analysis.legalCitations.length }
            : {}),
          ...(analysis.recordCitations
            ? { recordCitationCount: analysis.recordCitations.length }
            : {}),
          ...(analysis.appendixCitations
            ? { appendixCitationCount: analysis.appendixCitations.length }
            : {}),
          createdAt: filing.filedAt,
        })
        documentAnalysisIds.push(analysisId)
        await ctx.db.patch(documentId, { analysisId })
      }
      documentIds.push(documentId)
    }

    const filingId = await ctx.db.insert('filings', {
      caseSessionId,
      eventId: filing.eventId,
      participantRole: filing.participantRole,
      ...(filing.filerPartyId ? { filerPartyId: filing.filerPartyId } : {}),
      ...(filing.partyIds ? { partyIds: filing.partyIds } : {}),
      title: filing.title,
      documentIds,
      certificateOfService: filing.certificateOfService,
      certificateOfCompliance: filing.certificateOfCompliance,
      sealed: filing.sealed,
      notes: filing.notes,
      filedAt: filing.filedAt,
      outcome: filing.outcome,
      validationIssues: filing.validationIssues,
      ...(filing.submissionJson ? { submissionJson: filing.submissionJson } : {}),
      ...(documentAnalysisIds.length ? { documentAnalysisIds } : {}),
    })
    filingIdMap.set(filing.id, filingId)
  }

  const docketEntryIdMap = new Map<string, Id<'docketEntries'>>()
  for (const entry of session.docketEntries) {
    const filingId = entry.filingId ? filingIdMap.get(entry.filingId) : undefined
    const docketEntryId = await ctx.db.insert('docketEntries', {
      caseSessionId,
      entryNumber: entry.entryNumber,
      filedAt: entry.filedAt,
      actorRole: entry.actorRole,
      title: entry.title,
      text: entry.text,
      ...(filingId ? { filingId } : {}),
      ruleRefs: entry.ruleRefs,
    })
    docketEntryIdMap.set(entry.id, docketEntryId)
  }

  for (const deadline of session.deadlines) {
    const sourceEntryId = docketEntryIdMap.get(deadline.sourceEntryId)
    await ctx.db.insert('deadlines', {
      caseSessionId,
      label: deadline.label,
      dueDate: deadline.dueDate,
      targetEventId: deadline.targetEventId,
      ...(sourceEntryId ? { sourceEntryId } : {}),
      status: deadline.status,
      sourceRuleRefs: deadline.sourceRuleRefs,
    })
  }

  for (const receipt of session.ecfReceipts ?? []) {
    const filingId = filingIdMap.get(receipt.filingId)
    if (!filingId) continue
    await ctx.db.insert('ecfReceipts', {
      caseSessionId,
      filingId,
      receiptNumber: receipt.receiptNumber,
      ...(receipt.filedTimestamp ? { filedTimestamp: receipt.filedTimestamp } : {}),
      ...(receipt.filer ? { filer: receipt.filer } : {}),
      ...(receipt.eventId ? { eventId: receipt.eventId } : {}),
      ...(receipt.documentList
        ? { documentListJson: JSON.stringify(receipt.documentList) }
        : {}),
      noticeOfDocketActivityText: receipt.noticeOfDocketActivityText,
      serviceListJson: JSON.stringify(receipt.serviceList),
      ...(receipt.docketText ? { docketText: receipt.docketText } : {}),
      ...(receipt.warnings ? { warnings: receipt.warnings } : {}),
      ...(receipt.deficiencies ? { deficiencies: receipt.deficiencies } : {}),
      ...(receipt.nextExpectedDeadline
        ? { nextExpectedDeadlineJson: JSON.stringify(receipt.nextExpectedDeadline) }
        : {}),
      createdAt: receipt.createdAt,
    })
  }

  if (session.counterpartyStrategy) {
    await ctx.db.insert('counterpartyStrategies', {
      caseSessionId,
      strategy: session.counterpartyStrategy,
      createdAt: session.counterpartyStrategy.updatedAt ?? session.simulatedDate,
    })
  }

  if (session.amicusParticipation) {
    await ctx.db.insert('amicusParticipations', {
      caseSessionId,
      participation: session.amicusParticipation,
      createdAt: session.simulatedDate,
    })
    await Promise.all(
      session.amicusParticipation.candidates.map((candidate) =>
        ctx.db.insert('amicusCandidates', {
          caseSessionId,
          candidate,
          createdAt: session.simulatedDate,
        }),
      ),
    )
  }

  if (session.panelAssignment || session.benchMemo || session.panelDeliberation) {
    await ctx.db.insert('panelDeliberations', {
      caseSessionId,
      ...(session.panelAssignment ? { assignment: session.panelAssignment } : {}),
      ...(session.benchMemo ? { benchMemo: session.benchMemo } : {}),
      ...(session.panelDeliberation ? { deliberation: session.panelDeliberation } : {}),
      createdAt: session.simulatedDate,
    })
  }

  for (const vote of session.panelDeliberation?.votes ?? []) {
    await ctx.db.insert('panelVotes', {
      caseSessionId,
      actorModuleId: vote.judgeActorId,
      vote: vote.vote,
      reliefOption: vote.reliefOption,
      rationale: vote.rationale,
      voteRecord: vote,
      createdAt: vote.createdAt,
    })
  }

  if (session.panelDisposition) {
    await ctx.db.insert('panelDispositions', {
      caseSessionId,
      disposition: session.panelDisposition,
      createdAt: session.panelDisposition.createdAt,
    })
  }

  if (session.assessment) {
    await ctx.db.insert('assessments', {
      caseSessionId,
      disposition: session.assessment.disposition,
      score: session.assessment.score,
      proceduralFindings: session.assessment.proceduralFindings,
      meritsFindings: session.assessment.meritsFindings,
      nextPracticeTargets: session.assessment.nextPracticeTargets,
    })
  }

  for (const turn of session.simulationTurns ?? []) {
    await ctx.db.insert('simulationTurns', {
      caseSessionId,
      turnNumber: turn.turnNumber,
      actorId: turn.actorId,
      kind: turn.kind,
      status: turn.status,
      payloadJson: JSON.stringify({
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        effects: turn.effects,
        inputSnapshotHash: turn.inputSnapshotHash,
        outputSnapshotHash: turn.outputSnapshotHash,
        validatorVersion: turn.validatorVersion,
        retryCount: turn.retryCount,
        stoppedReason: turn.stoppedReason,
      }),
      inputSnapshotHash: turn.inputSnapshotHash,
      outputSnapshotHash: turn.outputSnapshotHash,
      validatorVersion: turn.validatorVersion,
      retryCount: turn.retryCount,
      ...(turn.stoppedReason ? { stoppedReason: turn.stoppedReason } : {}),
      ...(turn.rawActorPacketStorageId
        ? { rawActorPacketStorageId: turn.rawActorPacketStorageId as Id<'_storage'> }
        : {}),
      ...(turn.rawProviderResultStorageId
        ? { rawProviderResultStorageId: turn.rawProviderResultStorageId as Id<'_storage'> }
        : {}),
      createdAt: turn.startedAt,
    })
  }

  const updated = await ctx.db.get(caseSessionId)
  if (!updated) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Case session was removed while saving state')
  }
  return assembleCaseSession(ctx, updated)
}

async function appendCaseSessionEvent(
  ctx: WriteCtx,
  caseSessionId: Id<'caseSessions'>,
  eventType: string,
  payload: Record<string, unknown>,
  actorUserId?: Id<'users'>,
) {
  const existingEvents = await ctx.db
    .query('caseSessionEvents')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .collect()
  await ctx.db.insert('caseSessionEvents', {
    caseSessionId,
    sequence: existingEvents.length + 1,
    eventType,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    ...(actorUserId ? { actorUserId } : {}),
  })
}

async function persistTurnAudit(
  ctx: WriteCtx,
  caseSessionId: Id<'caseSessions'>,
  turnNumber: number,
  packet: unknown,
  decision: { actorId: string; validationIssues: Array<{ message: string }> } & Record<string, unknown>,
) {
  const turnDoc = await ctx.db
    .query('simulationTurns')
    .withIndex('by_case_turn', (index) =>
      index.eq('caseSessionId', caseSessionId).eq('turnNumber', turnNumber),
    )
    .unique()
  if (!turnDoc) return

  const packetJson = JSON.stringify(packet)
  const decisionJson = JSON.stringify(decision)
  await ctx.db.insert('actorPackets', {
    caseSessionId,
    turnId: turnDoc._id,
    actorId: decision.actorId,
    packetJson,
    packetHash: snapshotHash(packet),
    createdAt: new Date().toISOString(),
  })
  await ctx.db.insert('actorDecisions', {
    caseSessionId,
    turnId: turnDoc._id,
    actorId: decision.actorId,
    decisionJson,
    decisionHash: snapshotHash(decision),
    accepted: decision.validationIssues.length === 0,
    issues: decision.validationIssues.map((issue) => issue.message),
    createdAt: new Date().toISOString(),
  })
}

function withRejectedFilingAudit(
  previousSession: CaseSession,
  draft: Parameters<typeof fileDraft>[1],
  nextSession: CaseSession,
) {
  const validationIssues = validateFiling(previousSession, draft)
  if (!validationIssues.some((issue) => issue.severity === 'error')) {
    return nextSession
  }

  const rejectedFiling: FilingRecord = {
    ...draft,
    id: makeRecordId('filing', previousSession.filings.length),
    filedAt: nextSession.simulatedDate,
    outcome: 'rejected',
    validationIssues,
  }

  return {
    ...nextSession,
    filings: [...nextSession.filings, rejectedFiling],
  }
}

function sourceUrlForCourtListenerResult(result: CourtListenerSearchResult) {
  if (result.absolute_url) {
    return new URL(result.absolute_url, 'https://www.courtlistener.com').toString()
  }
  if (result.docket_id) {
    return `https://www.courtlistener.com/docket/${result.docket_id}/`
  }
  return 'https://www.courtlistener.com/'
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function createImportedTrialDocket(
  session: CaseSession,
  result: CourtListenerSearchResult,
  sourceUrl: string,
): TrialDocket {
  return {
    caption: result.caseNameFull ?? result.caseName ?? session.scenario.shortCaption,
    court: result.court ?? session.scenario.lowerTribunal,
    docketNumber: result.docketNumber ?? `CourtListener docket ${result.docket_id ?? result.id}`,
    sourceUrl,
    entries: [
      {
        id: `courtlistener-${result.docket_id ?? result.id}-entry-1`,
        entryNumber: 1,
        filedAt: result.dateFiled
          ? new Date(result.dateFiled).toISOString()
          : session.simulatedDate,
        title: 'Imported CourtListener Trial Docket',
        text: result.snippet
          ? stripHtml(result.snippet)
          : 'Public docket metadata imported from CourtListener. Open the source docket for the complete live docket sheet.',
        documents: [],
      },
    ],
  }
}

function normalizeTrialDocketEntries(entriesJson: string): TrialDocketEntry[] {
  const parsed = parseJsonField<Array<Partial<TrialDocketEntry>>>(
    entriesJson,
    'CourtListener trial docket entries',
  )
  return parsed.map((entry, index) => ({
    id: entry.id ?? `trial-docket-import-${String(index + 1).padStart(4, '0')}`,
    entryNumber: entry.entryNumber ?? index + 1,
    filedAt: entry.filedAt ?? new Date(0).toISOString(),
    title: entry.title ?? 'Imported CourtListener Trial Docket Entry',
    text: entry.text ?? '',
    documents: entry.documents ?? [],
  }))
}

function promptHashForSession(session: CaseSession) {
  return [
    session.id,
    session.status,
    session.docketEntries.length,
    session.deadlines.length,
    session.filings.length,
  ].join(':')
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    // ERROR_CODE: PROVIDER_ERROR
    throw new Error('Live AI is temporarily unavailable.')
  }
  return value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export const create = mutation({
  args: {
    scenarioId: v.optional(v.string()),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const user = await upsertCurrentUserDoc(ctx)
    const scenarioKey = args.scenarioId ?? defaultScenarioKey
    const scenario = await ensureScenarioDoc(ctx, scenarioKey)
    const initialSession = createInitialSession(scenario.scenarioKey)
    const initialProcedureState = inferProcedureState(initialSession)
    const caseSessionId = await ctx.db.insert('caseSessions', {
      scenarioId: scenario._id,
      userId: user._id,
      courtPackId: initialSession.courtPackId,
      status: initialSession.status,
      procedureState: initialProcedureState,
      autonomyMode: initialSession.autonomyMode,
      turnPolicy: initialSession.turnPolicy,
      ...(initialSession.sourceProfileId
        ? { sourceProfileId: initialSession.sourceProfileId }
        : {}),
      qualityState: initialSession.qualityState,
      simulatedDate: initialSession.simulatedDate,
    })

    const session = await replaceSessionState(ctx, caseSessionId, {
      ...initialSession,
      procedureState: initialProcedureState,
    })
    await appendCaseSessionEvent(ctx, caseSessionId, 'session_created', {
      scenarioKey,
      procedureState: initialProcedureState,
    }, user._id)
    return session
  },
})

export const getForCurrentUser = query({
  args: {
    caseSessionId: v.optional(v.id('caseSessions')),
  },
  returns: v.union(caseSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx)
    if (!user) return null

    if (args.caseSessionId) {
      const caseSession = await ctx.db.get(args.caseSessionId)
      if (!caseSession || caseSession.userId !== user._id) return null
      return assembleCaseSession(ctx, caseSession)
    }

    const sessions = await ctx.db
      .query('caseSessions')
      .withIndex('by_user', (index) => index.eq('userId', user._id))
      .collect()
    const latest = sessions.sort((a, b) => b._creationTime - a._creationTime)[0]
    return latest ? assembleCaseSession(ctx, latest) : null
  },
})

export const acceptLegalTrainingDisclaimer = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    version: v.string(),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const acceptedAt = new Date().toISOString()
    const existing = await ctx.db
      .query('userDisclaimers')
      .withIndex('by_user_version', (index) =>
        index.eq('userId', user._id).eq('version', args.version),
      )
      .unique()
    if (!existing) {
      await ctx.db.insert('userDisclaimers', {
        userId: user._id,
        version: args.version,
        acceptedAt,
        trainingOnly: true,
      })
    }
    await ctx.db.patch(caseSessionDoc._id, {
      legalTrainingDisclaimerAcceptedAt: existing?.acceptedAt ?? acceptedAt,
    })
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'legal_training_disclaimer_accepted',
      { version: args.version },
      user._id,
    )
    const updated = await ctx.db.get(caseSessionDoc._id)
    if (!updated) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Case session not found')
    }
    return assembleCaseSession(ctx, updated)
  },
})

export const listForCurrentUser = query({
  args: {},
  returns: v.array(caseSessionSummaryValidator),
  handler: async (ctx) => {
    const { user } = await getCurrentUser(ctx)
    if (!user) return []

    const sessions = await ctx.db
      .query('caseSessions')
      .withIndex('by_user', (index) => index.eq('userId', user._id))
      .collect()
    const scenarioIds = new Set(sessions.map((session) => session.scenarioId))
    const scenarios = new Map<Id<'scenarios'>, Doc<'scenarios'>>()
    await Promise.all(
      [...scenarioIds].map(async (scenarioId) => {
        const scenario = await ctx.db.get(scenarioId)
        if (scenario) scenarios.set(scenarioId, scenario)
      }),
    )

    return sessions
      .slice()
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((session) => {
        const scenario = scenarios.get(session.scenarioId)
        return {
          id: session._id,
          scenarioTitle: scenario?.title ?? 'Untitled scenario',
          shortCaption: scenario?.shortCaption ?? 'Untitled case',
          status: session.status,
          simulatedDate: session.simulatedDate,
          createdAt: session._creationTime,
        }
      })
  },
})

export const submitFiling = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    draft: filingDraftValidator,
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const nextSession = transitionAfterFiling(
      withRejectedFilingAudit(session, args.draft, fileDraft(session, args.draft)),
    )
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, nextSession)
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'filing_submitted_legacy',
      {
        eventId: args.draft.eventId,
        outcome: saved.filings.at(-1)?.outcome ?? 'rejected',
        procedureState: saved.procedureState,
      },
      user._id,
    )
    return saved
  },
})

export const preflightFiling = query({
  args: {
    caseSessionId: v.id('caseSessions'),
    submission: filingSubmissionValidator,
  },
  returns: preflightCheckResultValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    return preflightEcfFiling(session, args.submission as FilingSubmission)
  },
})

export const getAvailableEcfEvents = query({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.array(ecfEventAvailabilityValidator),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    return getAvailableEcfEventDefinitions(session)
  },
})

export const generateDocumentUploadUrl = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    return ctx.storage.generateUploadUrl()
  },
})

export const persistDocumentAnalysis = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    document: uploadedDocumentValidator,
    analysis: documentAnalysisValidator,
  },
  returns: v.object({
    document: uploadedDocumentValidator,
    analysisId: v.string(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const documentId = await ctx.db.insert('documents', {
      caseSessionId: args.caseSessionId,
      ...(args.document.storageId
        ? { storageId: args.document.storageId as Id<'_storage'> }
        : {}),
      ...(args.document.sha256 ? { sha256: args.document.sha256 } : {}),
      fileName: args.document.fileName,
      mimeType: args.document.mimeType,
      sizeBytes: args.document.sizeBytes,
      ...(typeof args.analysis.pageCount === 'number' ? { pageCount: args.analysis.pageCount } : {}),
      ...(args.analysis.normalizedText ? { extractedText: args.analysis.normalizedText } : {}),
      ...(args.analysis.textExtractionStatus
        ? { textExtractionStatus: args.analysis.textExtractionStatus }
        : {}),
      ...(typeof args.analysis.wordCount === 'number' ? { wordCount: args.analysis.wordCount } : {}),
      extractedSignals: args.document.extractedSignals,
      validationJson: JSON.stringify(args.analysis),
    })
    const analysisId = await ctx.db.insert('documentAnalyses', {
      caseSessionId: args.caseSessionId,
      documentId,
      analyzerId: args.analysis.analyzerId,
      ...(typeof args.analysis.pageCount === 'number' ? { pageCount: args.analysis.pageCount } : {}),
      fileSizeBytes: args.analysis.fileSizeBytes,
      mimeType: args.analysis.mimeType,
      searchableText: args.analysis.searchableText,
      certificateOfServiceDetected: args.analysis.certificateOfServiceDetected,
      certificateOfComplianceDetected: args.analysis.certificateOfComplianceDetected,
      sealedOrRedactionWarning: args.analysis.sealedOrRedactionWarning,
      warnings: args.analysis.warnings,
      analysisJson: JSON.stringify(args.analysis),
      ...(args.analysis.normalizedText
        ? { extractedTextHash: hashText(args.analysis.normalizedText) }
        : {}),
      ...(typeof args.analysis.wordCount === 'number' ? { wordCount: args.analysis.wordCount } : {}),
      ...(args.analysis.legalCitations
        ? { citationCount: args.analysis.legalCitations.length }
        : {}),
      ...(args.analysis.recordCitations
        ? { recordCitationCount: args.analysis.recordCitations.length }
        : {}),
      ...(args.analysis.appendixCitations
        ? { appendixCitationCount: args.analysis.appendixCitations.length }
        : {}),
      createdAt: new Date().toISOString(),
    })
    await ctx.db.patch(documentId, { analysisId })

    const document: UploadedDocument = {
      ...args.document,
      id: documentId,
      ...(typeof args.analysis.pageCount === 'number' ? { pageCount: args.analysis.pageCount } : {}),
      ...(args.analysis.normalizedText ? { extractedText: args.analysis.normalizedText } : {}),
      ...(args.analysis.textExtractionStatus
        ? { textExtractionStatus: args.analysis.textExtractionStatus }
        : {}),
      ...(typeof args.analysis.wordCount === 'number' ? { wordCount: args.analysis.wordCount } : {}),
      analysisId,
      analysis: args.analysis,
    }

    return { document, analysisId }
  },
})

export const getDocumentAnalysesForCurrentUser = query({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.array(documentAnalysisRecordValidator),
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx)
    if (!user) return []

    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const analyses = await ctx.db
      .query('documentAnalyses')
      .withIndex('by_case', (index) => index.eq('caseSessionId', args.caseSessionId))
      .collect()

    return analyses.map((analysis) => ({
      id: analysis._id,
      caseSessionId: analysis.caseSessionId,
      ...(analysis.documentId ? { documentId: analysis.documentId } : {}),
      analysis: analysisFromDoc(analysis),
      createdAt: analysis.createdAt,
    }))
  },
})

export const submitEcfFiling = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    submission: filingSubmissionValidator,
  },
  returns: v.object({
    session: caseSessionValidator,
    preflight: preflightCheckResultValidator,
    receipt: v.union(ecfReceiptValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const result = submitEcfFilingDomain(session, args.submission as FilingSubmission)
    const nextSession = transitionAfterFiling(result.session)
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, nextSession)

    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'ecf_filing_submitted',
      {
        eventId: args.submission.eventId,
        outcome: result.preflight.outcome,
        receiptNumber: result.receipt?.receiptNumber ?? null,
        issueCodes: result.preflight.issues.map((issue) => issue.code ?? issue.message),
        procedureState: saved.procedureState,
      },
      user._id,
    )

    return {
      session: saved,
      preflight: result.preflight,
      receipt: result.receipt,
    }
  },
})

export const advanceExpectedEvent = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const toolCall = nextExpectedToolCall(session)
    const nextSession = transitionAfterFiling(applyToolCall(session, toolCall))
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, nextSession)
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'expected_event_advanced_legacy',
      { tool: toolCall.tool, procedureState: saved.procedureState },
      user._id,
    )
    return saved
  },
})

export const advanceProcedure = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.object({
    session: caseSessionValidator,
    toolCall: toolCallValidator,
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const result = advanceProcedureStateMachine(session)
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, result.session)
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'procedure_advanced',
      {
        tool: result.toolCall.tool,
        fromState: result.transition.fromState,
        toState: result.transition.toState,
      },
      user._id,
    )
    return {
      session: saved,
      toolCall: result.toolCall,
    }
  },
})

export const advanceAutonomousSimulation = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    maxTurnsPerRun: v.optional(v.number()),
    maxCostCentsPerRun: v.optional(v.number()),
  },
  returns: v.object({
    session: caseSessionValidator,
    turnsRun: v.number(),
    stoppedReason: v.string(),
    budgetSpentCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const result = advanceAutonomousSimulationDomain(session, {
      ...(typeof args.maxTurnsPerRun === 'number'
        ? { maxTurnsPerRun: args.maxTurnsPerRun }
        : {}),
      ...(typeof args.maxCostCentsPerRun === 'number'
        ? { maxCostCentsPerRun: args.maxCostCentsPerRun }
        : {}),
    })
    const saved =
      result.turns.length > 0
        ? await replaceSessionState(ctx, caseSessionDoc._id, result.session)
        : session

    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'autonomous_simulation_advanced',
      {
        turnsRun: result.turns.length,
        stoppedReason: result.stoppedReason,
        budgetSpentCents: result.budgetSpentCents,
        procedureState: saved.procedureState,
      },
      user._id,
    )

    return {
      session: saved,
      turnsRun: result.turns.length,
      stoppedReason: result.stoppedReason,
      budgetSpentCents: result.budgetSpentCents,
    }
  },
})

export const advanceSimulationTurn = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    debugRejectedAttempts: v.optional(v.boolean()),
  },
  returns: v.object({
    session: caseSessionValidator,
    toolCall: toolCallValidator,
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const result = advanceSimulationTurnDomain(session, {
      debugRejectedAttempts: args.debugRejectedAttempts ?? false,
    })
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, result.session)
    await persistTurnAudit(
      ctx,
      caseSessionDoc._id,
      result.turn.turnNumber,
      result.packet,
      result.decision,
    )
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'simulation_turn_advanced',
      {
        turnNumber: result.turn.turnNumber,
        actorId: result.turn.actorId,
        kind: result.turn.kind,
        status: result.turn.status,
        tool: result.toolCall.tool,
      },
      user._id,
    )
    return {
      session: saved,
      toolCall: result.toolCall,
    }
  },
})

export const importCourtListenerSource = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    result: courtListenerSearchResultValidator,
  },
  returns: v.object({
    session: caseSessionValidator,
    trialDocket: trialDocketValidator,
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const sourceUrl = sourceUrlForCourtListenerResult(args.result)
    const trialDocket = createImportedTrialDocket(session, args.result, sourceUrl)
    const importedAt = new Date().toISOString()

    await ctx.db.insert('sourceCases', {
      scenarioId: caseSessionDoc.scenarioId,
      sourceSystem: 'courtlistener',
      externalId: String(args.result.docket_id ?? args.result.id),
      sourceUrl,
      importedAt,
      provenanceJson: JSON.stringify(args.result),
    })
    await ctx.db.insert('trialDocketImports', {
      caseSessionId: caseSessionDoc._id,
      caption: trialDocket.caption,
      court: trialDocket.court,
      docketNumber: trialDocket.docketNumber,
      ...(trialDocket.sourceUrl ? { sourceUrl: trialDocket.sourceUrl } : {}),
      entriesJson: JSON.stringify(trialDocket.entries),
      importedAt,
    })

    const nextSession = transitionAfterFiling(applyToolCall(session, {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'CourtListener Record Imported',
      text: `Imported ${args.result.caseNameFull ?? args.result.caseName ?? 'CourtListener docket'} (${args.result.docketNumber ?? 'no docket number'}) from ${args.result.court ?? 'CourtListener'}. Source: ${sourceUrl}`,
      ruleRefs: [
        {
          ruleId: `courtlistener-${args.result.docket_id ?? args.result.id}`,
          label: 'CourtListener source',
          sourceUrl,
        },
      ],
    }))

    const saved = await replaceSessionState(ctx, caseSessionDoc._id, nextSession)
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'courtlistener_source_imported',
      {
        externalId: String(args.result.docket_id ?? args.result.id),
        sourceUrl,
      },
      user._id,
    )

    return {
      session: saved,
      trialDocket,
    }
  },
})

export const getTrialDocketForCurrentUser = query({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.union(trialDocketValidator, v.null()),
  handler: async (ctx, args) => {
    const { user } = await getCurrentUser(ctx)
    if (!user) return null

    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const imports = await ctx.db
      .query('trialDocketImports')
      .withIndex('by_case', (index) => index.eq('caseSessionId', args.caseSessionId))
      .collect()
    const latest = imports.sort((a, b) => b._creationTime - a._creationTime)[0]
    if (!latest) return null

    return {
      caption: latest.caption,
      court: latest.court,
      docketNumber: latest.docketNumber,
      ...(latest.sourceUrl ? { sourceUrl: latest.sourceUrl } : {}),
      entries: normalizeTrialDocketEntries(latest.entriesJson),
    }
  },
})

export const getAiGateForCurrentUser = internalQuery({
  args: {
    nowIso: v.string(),
    cooldownMs: v.number(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    budgetCents: v.number(),
    spentCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const month = createdMonth(args.nowIso)
    const runs = await ctx.db
      .query('aiRuns')
      .withIndex('by_user_month', (index) =>
        index.eq('userId', user._id).eq('createdMonth', month),
      )
      .collect()
    const spentCents = runs.reduce((sum, run) => sum + run.costCents, 0)
    if (spentCents >= user.monthlyAiBudgetCents) {
      return {
        allowed: false,
        reason: 'Live AI budget exhausted.',
        budgetCents: user.monthlyAiBudgetCents,
        spentCents,
      }
    }

    const latestRun = runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (
      latestRun &&
      new Date(args.nowIso).getTime() - new Date(latestRun.createdAt).getTime() <
        args.cooldownMs
    ) {
      return {
        allowed: false,
        reason: 'Live AI cooldown is still active.',
        budgetCents: user.monthlyAiBudgetCents,
        spentCents,
      }
    }

    return {
      allowed: true,
      budgetCents: user.monthlyAiBudgetCents,
      spentCents,
    }
  },
})

export const recordAiRunForCurrentUser = internalMutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    actorId: v.string(),
    model: v.string(),
    promptHash: v.string(),
    toolCallJson: v.string(),
    accepted: v.boolean(),
    issues: v.array(v.string()),
    costCents: v.number(),
    latencyMs: v.number(),
    errorClass: v.optional(v.string()),
    createdAt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    await ctx.db.insert('aiRuns', {
      caseSessionId: args.caseSessionId,
      userId: user._id,
      actorId: args.actorId,
      model: args.model,
      provider: 'openrouter',
      promptHash: args.promptHash,
      toolCallJson: args.toolCallJson,
      accepted: args.accepted,
      issues: args.issues,
      costCents: args.costCents,
      latencyMs: args.latencyMs,
      ...(args.errorClass ? { errorClass: args.errorClass } : {}),
      createdMonth: createdMonth(args.createdAt),
      createdAt: args.createdAt,
    })
    return null
  },
})

export const applyLiveToolCallForCurrentUser = internalMutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    toolCall: toolCallValidator,
    model: v.string(),
    rawText: v.string(),
    latencyMs: v.number(),
    costCents: v.number(),
    createdAt: v.string(),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const validation = validateToolCall(session, args.toolCall)
    await ctx.db.insert('aiRuns', {
      caseSessionId: args.caseSessionId,
      userId: user._id,
      actorId: args.toolCall.actorId,
      model: args.model,
      provider: 'openrouter',
      promptHash: promptHashForSession(session),
      toolCallJson: args.rawText,
      accepted: validation.accepted,
      issues: validation.issues,
      costCents: args.costCents,
      latencyMs: args.latencyMs,
      ...(!validation.accepted ? { errorClass: 'tool_validation_rejected' } : {}),
      createdMonth: createdMonth(args.createdAt),
      createdAt: args.createdAt,
    })
    if (!validation.accepted) {
      console.warn('OpenRouter tool call rejected', {
        caseSessionId: args.caseSessionId,
        issues: validation.issues,
      })
      return session
    }
    const nextSession = transitionAfterFiling(applyToolCall(session, args.toolCall))
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, nextSession)
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'live_ai_tool_applied',
      {
        tool: args.toolCall.tool,
        actorId: args.toolCall.actorId,
        accepted: true,
        procedureState: saved.procedureState,
      },
      user._id,
    )
    return saved
  },
})

export const persistActorWorkProductForCurrentUser = internalMutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    actorId: v.string(),
    kind: actorWorkProductKindValidator,
    workProductJson: v.string(),
    sourceDocumentAnalysisIds: v.array(v.string()),
    sourceFilingIds: v.array(v.string()),
    validationIssues: v.array(validationIssueValidator),
    createdAt: v.string(),
  },
  returns: actorWorkProductValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const workProduct = parseJsonField<ActorWorkProduct['workProduct']>(
      args.workProductJson,
      'actor work product mutation payload',
    )
    const productId = await ctx.db.insert('actorWorkProducts', {
      caseSessionId: args.caseSessionId,
      actorId: args.actorId,
      kind: args.kind,
      status: 'proposed' as const,
      reviewStatus: 'proposed' as const,
      workProductJson: args.workProductJson,
      citationsJson: JSON.stringify(workProduct.citations),
      ruleRefs: workProduct.ruleRefs,
      recordRefs: workProduct.recordRefs ?? [],
      confidence: workProduct.confidence ?? 0.75,
      roleAuthority: workProduct.roleAuthority ?? 'simulator_actor',
      sourceDocumentAnalysisIds: args.sourceDocumentAnalysisIds,
      sourceFilingIds: args.sourceFilingIds,
      createdAt: args.createdAt,
    })

    return {
      id: productId,
      caseSessionId: args.caseSessionId,
      actorId: args.actorId,
      kind: args.kind,
      status: 'proposed' as const,
      reviewStatus: 'proposed' as const,
      workProduct,
      citations: workProduct.citations,
      ruleRefs: workProduct.ruleRefs,
      recordRefs: workProduct.recordRefs ?? [],
      confidence: workProduct.confidence ?? 0.75,
      roleAuthority: workProduct.roleAuthority ?? 'simulator_actor',
      sourceDocumentAnalysisIds: args.sourceDocumentAnalysisIds,
      sourceFilingIds: args.sourceFilingIds,
      createdAt: args.createdAt,
      validationIssues: args.validationIssues,
    }
  },
})

export const generateActorWorkProduct = action({
  args: {
    caseSessionId: v.id('caseSessions'),
    kind: v.optional(actorWorkProductKindValidator),
  },
  returns: actorWorkProductValidator,
  handler: async (ctx, args) => {
    await requireIdentity(ctx)
    const nowIso = new Date().toISOString()
    const session = (await ctx.runQuery(api.caseSessions.getForCurrentUser, {
      caseSessionId: args.caseSessionId,
    })) as CaseSession | null
    if (!session) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Case session not found')
    }

    const gate = (await ctx.runQuery(internal.caseSessions.getAiGateForCurrentUser, {
      nowIso,
      cooldownMs: openRouterCooldownMs,
    })) as { allowed: boolean; reason?: string }
    if (!gate.allowed) {
      // ERROR_CODE: RATE_LIMITED
      throw new Error(gate.reason ?? 'Live AI is temporarily unavailable.')
    }

    const model = requireEnv('OPENROUTER_MODEL')
    const provider = new OpenRouterProvider({
      apiKey: requireEnv('OPENROUTER_API_KEY'),
      model,
      appUrl: process.env.OPENROUTER_APP_URL,
      appTitle: process.env.OPENROUTER_APP_TITLE ?? 'Appellate Practice Simulator',
    })
    const startedAt = Date.now()

    try {
      // TODO: Wrap in withTimeout() from ai-resilience once module is integrated
      const product = await withAiTimeout(
        generateActorWorkProductWithProvider({
          session,
          provider,
          kind: args.kind,
          nowIso,
          model,
        }),
        'generateActorWorkProduct',
      )
      const persisted = (await ctx.runMutation(
        internal.caseSessions.persistActorWorkProductForCurrentUser,
        {
          caseSessionId: args.caseSessionId,
          actorId: product.actorId,
          kind: product.kind,
          workProductJson: JSON.stringify(product.workProduct),
          sourceDocumentAnalysisIds: product.sourceDocumentAnalysisIds,
          sourceFilingIds: product.sourceFilingIds,
          validationIssues: product.validationIssues ?? [],
          createdAt: product.createdAt,
        },
      )) as ActorWorkProduct
      await ctx.runMutation(internal.caseSessions.recordAiRunForCurrentUser, {
        caseSessionId: args.caseSessionId,
        actorId: product.actorId,
        model,
        promptHash: promptHashForSession(session),
        toolCallJson: JSON.stringify(product.workProduct),
        accepted: !(product.validationIssues ?? []).some((issue) => issue.severity === 'error'),
        issues: (product.validationIssues ?? []).map((issue) => issue.code ?? issue.message),
        costCents: estimatedOpenRouterCostCents,
        latencyMs: Date.now() - startedAt,
        createdAt: nowIso,
      })
      return persisted
    } catch (error) {
      const isTimeout = errorMessage(error).includes('timed out')
      await ctx.runMutation(internal.caseSessions.recordAiRunForCurrentUser, {
        caseSessionId: args.caseSessionId,
        actorId: 'openrouter',
        model,
        promptHash: promptHashForSession(session),
        toolCallJson: '',
        accepted: false,
        issues: [errorMessage(error)],
        costCents: 0,
        latencyMs: Date.now() - startedAt,
        errorClass: isTimeout ? 'timeout' : 'provider_error',
        createdAt: nowIso,
      })
      if (isTimeout) {
        // ERROR_CODE: PROVIDER_TIMEOUT
        throw new Error(
          `Actor work product generation timed out after ${AI_CALL_TIMEOUT_MS}ms. Please retry.`,
        )
      }
      // ERROR_CODE: PROVIDER_ERROR
      throw new Error('Actor work product generation is temporarily unavailable.')
    }
  },
})

export const acceptActorWorkProduct = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    workProductId: v.id('actorWorkProducts'),
  },
  returns: v.object({
    session: caseSessionValidator,
    workProduct: actorWorkProductValidator,
    receipt: v.union(ecfReceiptValidator, v.null()),
    validationReason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSessionDoc = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const productDoc = await ctx.db.get(args.workProductId)
    if (!productDoc || productDoc.caseSessionId !== args.caseSessionId) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Actor work product not found')
    }

    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const product = actorWorkProductFromDoc(productDoc)
    const acceptance = canAcceptActorWorkProduct(session, product)
    if (!acceptance.accepted) {
      await ctx.db.patch(productDoc._id, { status: 'rejected', reviewStatus: 'rejected' })
      const validationReason =
        acceptance.validationIssues.map((issue) => issue.message).join(' ') ||
        'Actor work product failed deterministic validation.'
      const rejectedSession = {
        ...session,
        actorWorkProducts: session.actorWorkProducts?.map((candidate) =>
          candidate.id === product.id ? { ...candidate, status: 'rejected' as const } : candidate,
        ),
      }
      return {
        session: rejectedSession,
        workProduct: {
          ...product,
          status: 'rejected' as const,
          reviewStatus: 'rejected' as const,
          validationIssues: acceptance.validationIssues,
        },
        receipt: null,
        validationReason,
      }
    }

    let effect: ReturnType<typeof applyAcceptedActorWorkProduct>
    try {
      effect = applyAcceptedActorWorkProduct(session, product)
    } catch (error) {
      await ctx.db.patch(productDoc._id, { status: 'rejected', reviewStatus: 'rejected' })
      const validationReason =
        error instanceof Error ? error.message : 'Actor work product effect failed.'
      const rejectedSession = {
        ...session,
        actorWorkProducts: session.actorWorkProducts?.map((candidate) =>
          candidate.id === product.id ? { ...candidate, status: 'rejected' as const } : candidate,
        ),
      }
      return {
        session: rejectedSession,
        workProduct: {
          ...product,
          status: 'rejected' as const,
          reviewStatus: 'rejected' as const,
          validationIssues: [
            {
              severity: 'error' as const,
              code: 'actor_effect_failed',
              message: validationReason,
              ruleRefs: [],
              cureSuggestion: 'Regenerate or edit the actor work product before accepting it.',
            },
          ],
        },
        receipt: null,
        validationReason,
      }
    }

    await ctx.db.patch(productDoc._id, { status: 'accepted', reviewStatus: 'accepted' })
    const saved = await replaceSessionState(ctx, caseSessionDoc._id, effect.session)
    await appendCaseSessionEvent(
      ctx,
      caseSessionDoc._id,
      'actor_work_product_accepted',
      {
        workProductId: productDoc._id,
        kind: productDoc.kind,
        actorId: productDoc.actorId,
        convertedToFiling: Boolean(effect.receipt),
      },
      user._id,
    )

    return {
      session: saved,
      workProduct: {
        ...product,
        status: 'accepted' as const,
        reviewStatus: 'accepted' as const,
        validationIssues: acceptance.validationIssues,
      },
      receipt: effect.receipt ?? null,
    }
  },
})

export const rejectActorWorkProduct = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    workProductId: v.id('actorWorkProducts'),
  },
  returns: actorWorkProductValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const productDoc = await ctx.db.get(args.workProductId)
    if (!productDoc || productDoc.caseSessionId !== args.caseSessionId) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Actor work product not found')
    }

    await ctx.db.patch(productDoc._id, { status: 'rejected', reviewStatus: 'rejected' })
    await appendCaseSessionEvent(
      ctx,
      args.caseSessionId,
      'actor_work_product_rejected',
      {
        workProductId: productDoc._id,
        kind: productDoc.kind,
        actorId: productDoc.actorId,
      },
      user._id,
    )

    return {
      ...actorWorkProductFromDoc(productDoc),
      status: 'rejected' as const,
      reviewStatus: 'rejected' as const,
    }
  },
})

export const advanceLiveEvent = action({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.object({
    session: caseSessionValidator,
    toolCall: v.union(toolCallValidator, v.null()),
    rawText: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireIdentity(ctx)
    const nowIso = new Date().toISOString()
    const session = (await ctx.runQuery(api.caseSessions.getForCurrentUser, {
      caseSessionId: args.caseSessionId,
    })) as CaseSession | null
    if (!session) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Case session not found')
    }

    const gate = (await ctx.runQuery(internal.caseSessions.getAiGateForCurrentUser, {
      nowIso,
      cooldownMs: openRouterCooldownMs,
    })) as { allowed: boolean; reason?: string }
    if (!gate.allowed) {
      // ERROR_CODE: RATE_LIMITED
      throw new Error(gate.reason ?? 'Live AI is temporarily unavailable.')
    }

    const model = requireEnv('OPENROUTER_MODEL')
    const startedAt = Date.now()

    try {
      // TODO: Wrap in withTimeout() from ai-resilience once module is integrated
      const result = await withAiTimeout(
        requestProceduralToolCall(session, {
          apiKey: requireEnv('OPENROUTER_API_KEY'),
          model,
          appUrl: process.env.OPENROUTER_APP_URL,
          appTitle: process.env.OPENROUTER_APP_TITLE ?? 'Appellate Practice Simulator',
        }),
        'advanceLiveEvent',
      )
      const latencyMs = Date.now() - startedAt

      if (!result.toolCall) {
        console.warn('OpenRouter returned an invalid procedural tool call', {
          caseSessionId: args.caseSessionId,
        })
        await ctx.runMutation(internal.caseSessions.recordAiRunForCurrentUser, {
          caseSessionId: args.caseSessionId,
          actorId: 'openrouter',
          model,
          promptHash: promptHashForSession(session),
          toolCallJson: result.rawText,
          accepted: false,
          issues: ['The AI service returned text, but no valid procedural event.'],
          costCents: estimatedOpenRouterCostCents,
          latencyMs,
          errorClass: 'tool_validation_rejected',
          createdAt: new Date().toISOString(),
        })
        return {
          session,
          toolCall: null,
          rawText: result.rawText,
        }
      }

      const validation = validateToolCall(session, result.toolCall)
      if (!validation.accepted) {
        console.warn('OpenRouter tool call rejected', {
          caseSessionId: args.caseSessionId,
          issues: validation.issues,
        })
        await ctx.runMutation(internal.caseSessions.recordAiRunForCurrentUser, {
          caseSessionId: args.caseSessionId,
          actorId: result.toolCall.actorId,
          model,
          promptHash: promptHashForSession(session),
          toolCallJson: result.rawText,
          accepted: false,
          issues: validation.issues.length
            ? validation.issues
            : ['Invalid procedural tool call.'],
          costCents: estimatedOpenRouterCostCents,
          latencyMs,
          errorClass: 'tool_validation_rejected',
          createdAt: new Date().toISOString(),
        })
        return {
          session,
          toolCall: null,
          rawText: result.rawText,
        }
      }

      const nextSession = (await ctx.runMutation(
        internal.caseSessions.applyLiveToolCallForCurrentUser,
        {
          caseSessionId: args.caseSessionId,
          toolCall: result.toolCall,
          model,
          rawText: result.rawText,
          latencyMs,
          costCents: estimatedOpenRouterCostCents,
          createdAt: new Date().toISOString(),
        },
      )) as CaseSession

      return {
        session: nextSession,
        toolCall: result.toolCall,
        rawText: result.rawText,
      }
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      const isTimeout = errorMessage(error).includes('timed out')
      console.error('OpenRouter action failed', {
        caseSessionId: args.caseSessionId,
        error: errorMessage(error),
        isTimeout,
      })
      await ctx.runMutation(internal.caseSessions.recordAiRunForCurrentUser, {
        caseSessionId: args.caseSessionId,
        actorId: 'openrouter',
        model,
        promptHash: promptHashForSession(session),
        toolCallJson: '',
        accepted: false,
        issues: [errorMessage(error)],
        costCents: 0,
        latencyMs,
        errorClass: isTimeout ? 'timeout' : 'provider_error',
        createdAt: new Date().toISOString(),
      })
      if (isTimeout) {
        return {
          session,
          toolCall: null,
          rawText: `AI provider call timed out after ${AI_CALL_TIMEOUT_MS}ms. The session is unchanged — please retry.`,
        }
      }
      // ERROR_CODE: PROVIDER_ERROR
      throw new Error('Live AI is temporarily unavailable.')
    }
  },
})
