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

// TODO: Import from './errors' once error module is integrated
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser, requireIdentity, upsertCurrentUserDoc } from './authHelpers'
import { requireInstitutionRole } from './authz'
import { appendCaseSessionEvent } from './caseSessionEventLog'
import {
  AppErrorCode,
  ConvexError,
  notFound,
  sessionLocked,
  validationError,
} from './errors'
import {
  isOrganizationMembershipActive,
  validateUploadIntentTransition,
} from './organizationContracts'
import {
  fitsSessionDocumentAnalysisReadBudget,
  maxSessionDocumentAnalysisReadBytes,
} from './documentAnalysisBudget'
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
  createInitialSessionForScenario,
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
  ScenarioDocumentAsset,
  TrialDocket,
  TrialDocketEntry,
  UploadedDocument,
} from '../src/domain/types'
import { createTrialDocket } from '../src/domain/trial-docket'
import {
  aiSpentCents,
  billableAiRuns,
  isStaleAiReservation,
} from '../src/domain/ai-budget'
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
const maxDocumentRowBytes = 960 * 1024
const documentRowEncoder = new TextEncoder()
// Sizing runs before inserts, so reserve room for each generated Convex ID.
const generatedDocumentIdBudgetPlaceholder = 'x'.repeat(128)
const seedScenarios = scenarioSeed as Scenario[]

function fitsDocumentRowByteBudget(payload: unknown) {
  const serialized = JSON.stringify(payload)
  if (serialized === undefined) return false
  const boundedBytes = new Uint8Array(maxDocumentRowBytes + 1)
  const encoded = documentRowEncoder.encodeInto(serialized, boundedBytes)
  return (
    encoded.read === serialized.length &&
    encoded.written <= maxDocumentRowBytes
  )
}

function sessionDocumentAnalysisBudgetError() {
  return validationError(
    `Case session document analyses exceed the ${maxSessionDocumentAnalysisReadBytes / (1024 * 1024)} MiB read budget.`,
  )
}

async function assertSessionDocumentAnalysisReadBudget(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
) {
  let readBytes = 0
  const addRow = (row: unknown) => {
    const serialized = JSON.stringify(row)
    if (serialized === undefined) return
    readBytes += documentRowEncoder.encode(serialized).byteLength
    if (!fitsSessionDocumentAnalysisReadBudget(readBytes)) {
      throw sessionDocumentAnalysisBudgetError()
    }
  }

  const documents = await ctx.db
    .query('documents')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .collect()
  const analyses = await ctx.db
    .query('documentAnalyses')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .collect()
  for (const document of documents) addRow(document)
  for (const analysis of analyses) addRow(analysis)
}

function rejectClientStorageClaims(documents: UploadedDocument[]) {
  if (documents.some((document) => document.storageId !== undefined)) {
    throw validationError('Use document upload intents')
  }
}

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

async function expireStaleAiReservations(
  ctx: WriteCtx,
  runs: Doc<'aiRuns'>[],
  nowIso: string,
) {
  await Promise.all(
    runs
      .filter((run) => isStaleAiReservation(run, nowIso))
      .map((run) =>
        ctx.db.patch(run._id, {
          costCents: 0,
          errorClass: 'reservation_expired',
          issues: run.issues.includes('AI reservation expired before completion.')
            ? run.issues
            : [...run.issues, 'AI reservation expired before completion.'],
        }),
      ),
  )
}

function requireActiveAiReservation(run: Doc<'aiRuns'>) {
  if (
    run.errorClass !== 'in_flight' ||
    isStaleAiReservation(run, new Date().toISOString())
  ) {
    throw new ConvexError(AppErrorCode.CONFLICT, 'AI run reservation is no longer active')
  }
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

function scenarioDocumentAssetFromDoc(doc: Doc<'scenarioDocumentAssets'>): ScenarioDocumentAsset {
  return {
    id: doc.assetKey,
    label: doc.label,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    source: doc.source,
    storageId: doc.storageId,
    ...(doc.sha256 ? { sha256: doc.sha256 } : {}),
    sizeBytes: doc.sizeBytes,
    pageCount: doc.pageCount,
    ...(doc.extractedText ? { extractedText: doc.extractedText } : {}),
    ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
  }
}

function bundledDocumentAssetsForScenario(scenarioKey: string) {
  return seedScenarios.find((scenario) => scenario.id === scenarioKey)?.documentAssets ?? []
}

function mergeDocumentAssets(
  bundledAssets: ScenarioDocumentAsset[],
  persistedAssets: ScenarioDocumentAsset[] | undefined,
) {
  const assetById = new Map(bundledAssets.map((asset) => [asset.id, asset]))
  for (const asset of persistedAssets ?? []) {
    assetById.set(asset.id, asset)
  }
  return assetById.size ? [...assetById.values()] : undefined
}

function scenarioFromDoc(
  doc: Doc<'scenarios'>,
  issues: ScenarioIssue[] = [],
  recordExcerpts: ScenarioRecordExcerpt[] = [],
  assets: ScenarioDocumentAsset[] = [],
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
  )?.map((asset) => {
    const { publicUrl: _publicUrl, fileUrl: _fileUrl, ...assetWithoutUrls } =
      asset as ScenarioDocumentAsset & { publicUrl?: string }
    return assetWithoutUrls
  })
  const mergedDocumentAssets = mergeDocumentAssets(
    bundledDocumentAssetsForScenario(doc.scenarioKey),
    assets.length ? assets : documentAssets,
  )
  return {
    id: doc.scenarioKey,
    visibility: doc.visibility ?? (doc.ownerUserId ? 'private' : 'public_template'),
    ...(doc.ownerUserId ? { ownerUserId: doc.ownerUserId } : {}),
    scenarioFamilyKey: doc.scenarioFamilyKey ?? doc.scenarioKey,
    revision: doc.revision ?? 1,
    revisionStatus: doc.revisionStatus ?? (doc.published ? 'published' : 'draft'),
    ...(doc.createdFromScenarioId ? { createdFromScenarioId: doc.createdFromScenarioId } : {}),
    ...(doc.supersededByScenarioId ? { supersededByScenarioId: doc.supersededByScenarioId } : {}),
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
    ...(mergedDocumentAssets ? { documentAssets: mergedDocumentAssets } : {}),
    ...sourceCaseUrl,
  }
}

async function ensureScenarioDoc(
  ctx: WriteCtx,
  scenarioKey: string,
  userId: Id<'users'>,
  institutionId: Id<'institutions'>,
) {
  const existing = await ctx.db
    .query('scenarios')
    .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenarioKey))
    .unique()

  if (existing) {
    const visibility = existing.visibility ?? (existing.ownerUserId ? 'private' : 'public_template')
    if (
      visibility === 'private' &&
      (existing.ownerUserId !== userId || existing.institutionId !== institutionId)
    ) {
      throw notFound('Scenario')
    }
    if (
      visibility === 'public_template' &&
      (
        (existing.revisionStatus ?? (existing.published ? 'published' : 'draft')) !== 'published' ||
        (existing.institutionId !== undefined && existing.institutionId !== institutionId)
      )
    ) {
      throw notFound('Scenario')
    }

    // A public template is an immutable catalog entry. Deployment-only seed
    // utilities own reconciliation; a learner session must never rewrite it.
    return existing
  }

  const bundled = seedScenarios.find((scenario) => scenario.id === scenarioKey)
  if (!bundled) {
    throw notFound('Scenario')
  }

  const scenarioId = await ctx.db.insert('scenarios', {
    scenarioKey: bundled.id,
    visibility: 'public_template',
    scenarioFamilyKey: bundled.id,
    revision: 1,
    revisionStatus: 'published',
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

async function requireSessionScenarioLink(
  ctx: ReadCtx,
  session: Doc<'caseSessions'>,
  userId: Id<'users'>,
) {
  const scenario = await ctx.db.get(session.scenarioId)
  if (!scenario) throw notFound('Case session')
  const visibility = scenario.visibility ?? (scenario.ownerUserId ? 'private' : 'public_template')
  if (visibility === 'private') {
    if (
      !scenario.ownerUserId ||
      !session.institutionId ||
      scenario.institutionId !== session.institutionId
    ) {
      throw notFound('Case session')
    }
    if (scenario.ownerUserId !== userId) {
      const links = await ctx.db
        .query('assignmentSessions')
        .withIndex('by_case', (index) => index.eq('caseSessionId', session._id))
        .collect()
      const authorizedAssignment = await Promise.all(links.map(async (link) => {
        if (link.userId !== userId) return false
        const assignment = await ctx.db.get(link.assignmentId)
        const cohort = assignment ? await ctx.db.get(assignment.cohortId) : null
        return Boolean(
          assignment &&
          cohort &&
          assignment.scenarioId === scenario._id &&
          cohort.institutionId === session.institutionId,
        )
      }))
      if (!authorizedAssignment.some(Boolean)) throw notFound('Case session')
      const institution = await ctx.db.get(session.institutionId)
      if (
        !institution ||
        institution.status !== 'active' ||
        ((institution.kind ?? 'shared') === 'personal' &&
          institution.personalOwnerUserId !== scenario.ownerUserId)
      ) {
        throw notFound('Case session')
      }
      const ownerMemberships = await ctx.db
        .query('institutionMemberships')
        .withIndex('by_institution_user', (index) =>
          index.eq('institutionId', session.institutionId!).eq('userId', scenario.ownerUserId!),
        )
        .collect()
      if (ownerMemberships.length > 1) {
        throw new ConvexError(AppErrorCode.CONFLICT, 'Organization membership is ambiguous')
      }
      if (!isOrganizationMembershipActive(institution, ownerMemberships[0] ?? null, Date.now())) {
        throw notFound('Case session')
      }
    }
    return scenario
  }
  if (
    (scenario.revisionStatus ?? (scenario.published ? 'published' : 'draft')) !== 'published'
  ) {
    throw notFound('Case session')
  }
  if (scenario.institutionId && scenario.institutionId !== session.institutionId) {
    throw notFound('Case session')
  }
  return scenario
}

function sessionLinkConflict(): never {
  throw new ConvexError(AppErrorCode.CONFLICT, 'Session linkage is inconsistent')
}

async function requireSessionAssignmentLinks(
  ctx: ReadCtx,
  session: Doc<'caseSessions'>,
) {
  const links = await ctx.db
    .query('assignmentSessions')
    .withIndex('by_case', (index) => index.eq('caseSessionId', session._id))
    .collect()
  if (links.length > 1) sessionLinkConflict()
  for (const link of links) {
    if (link.caseSessionId !== session._id || link.userId !== session.userId) {
      sessionLinkConflict()
    }
    const assignment = await ctx.db.get(link.assignmentId)
    const cohort = assignment ? await ctx.db.get(assignment.cohortId) : null
    if (
      !assignment ||
      !cohort ||
      assignment.scenarioId !== session.scenarioId ||
      cohort.institutionId !== session.institutionId
    ) {
      sessionLinkConflict()
    }
    const assignmentUserLinks = await ctx.db
      .query('assignmentSessions')
      .withIndex('by_assignment_user', (index) =>
        index.eq('assignmentId', assignment._id).eq('userId', link.userId),
      )
      .collect()
    if (
      assignmentUserLinks.length !== 1 ||
      assignmentUserLinks[0]?._id !== link._id
    ) {
      sessionLinkConflict()
    }
  }
}

/** Resolve the caller's own session and its active organization context. */
export async function requireOwnedSession(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
) {
  const { user } = await requireCurrentUser(ctx)
  const session = await ctx.db.get(caseSessionId)
  if (
    !session ||
    session.userId !== user._id ||
    !session.institutionId
  ) {
    throw notFound('Case session')
  }
  const { institution, membership } = await requireInstitutionRole(
    ctx,
    session.institutionId,
    ['learner'],
  )
  await requireSessionScenarioLink(ctx, session, user._id)
  await requireSessionAssignmentLinks(ctx, session)
  return { user, session, institution, membership }
}

async function requireAuthorizedSessionDoc(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
  userId: Id<'users'>,
) {
  const { user, session } = await requireOwnedSession(ctx, caseSessionId)
  if (user._id !== userId) throw notFound('Case session')
  return session
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
    throw sessionLocked()
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

async function requireDocumentAnalysisBinding(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
  document: Doc<'documents'>,
) {
  if (!document.analysisId) return null
  const analysis = await ctx.db.get(document.analysisId)
  if (
    !analysis ||
    analysis.caseSessionId !== caseSessionId ||
    analysis.documentId !== document._id
  ) {
    throw notFound('Document analysis')
  }
  return analysis
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

async function requireActorWorkProductSources(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
  sourceDocumentAnalysisIds: string[],
  sourceFilingIds: string[],
) {
  const canonicalAnalysisIds = new Set<string>()
  for (const rawId of sourceDocumentAnalysisIds) {
    if (rawId.endsWith(':analysis')) {
      const rawDocumentId = rawId.slice(0, -':analysis'.length)
      const documentId = ctx.db.normalizeId('documents', rawDocumentId)
      const document = documentId ? await ctx.db.get(documentId) : null
      if (!document || document.caseSessionId !== caseSessionId) {
        throw notFound('Document analysis')
      }

      let analysis: Doc<'documentAnalyses'> | null = null
      if (document.analysisId) {
        analysis = await ctx.db.get(document.analysisId)
      } else {
        const analyses = await ctx.db
          .query('documentAnalyses')
          .withIndex('by_document', (index) => index.eq('documentId', document._id))
          .collect()
        if (analyses.length > 1) {
          throw new ConvexError(AppErrorCode.CONFLICT, 'Document analysis linkage is ambiguous')
        }
        analysis = analyses[0] ?? null
      }
      if (
        analysis &&
        (analysis.caseSessionId !== caseSessionId ||
          analysis.documentId !== document._id ||
          document.analysisId !== analysis._id)
      ) {
        throw notFound('Document analysis')
      }
      if (!analysis) throw notFound('Document analysis')
      canonicalAnalysisIds.add(analysis?._id ?? `${document._id}:analysis`)
      continue
    }

    const analysisId = ctx.db.normalizeId('documentAnalyses', rawId)
    const analysis = analysisId ? await ctx.db.get(analysisId) : null
    if (!analysis || analysis.caseSessionId !== caseSessionId) {
      throw notFound('Document analysis')
    }
    if (analysis.documentId) {
      const document = await ctx.db.get(analysis.documentId)
      if (
        !document ||
        document.caseSessionId !== caseSessionId ||
        document.analysisId !== analysis._id
      ) {
        throw notFound('Document analysis')
      }
    } else {
      const documents = await ctx.db
        .query('documents')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect()
      if (documents.some((document) => document.analysisId === analysis._id)) {
        throw notFound('Document analysis')
      }
    }
    canonicalAnalysisIds.add(analysis._id)
  }

  const canonicalFilingIds = new Set<string>()
  for (const rawId of sourceFilingIds) {
    const filingId = ctx.db.normalizeId('filings', rawId)
    const filing = filingId ? await ctx.db.get(filingId) : null
    if (!filing || filing.caseSessionId !== caseSessionId) throw notFound('Filing')
    canonicalFilingIds.add(filing._id)
  }
  return {
    sourceDocumentAnalysisIds: [...canonicalAnalysisIds],
    sourceFilingIds: [...canonicalFilingIds],
  }
}

function remapActorSourceId(
  sourceType: unknown,
  sourceId: unknown,
  maps: {
    analysisIds: Map<string, Id<'documentAnalyses'>>
    documentIds: Map<string, Id<'documents'>>
    filingIds: Map<string, Id<'filings'>>
    docketEntryIds: Map<string, Id<'docketEntries'>>
  },
) {
  if (typeof sourceId !== 'string') return sourceId
  if (sourceType === 'filing') return maps.filingIds.get(sourceId) ?? sourceId
  if (sourceType === 'document_analysis') {
    const analysisId = maps.analysisIds.get(sourceId)
    if (analysisId) return analysisId
    if (sourceId.endsWith(':analysis')) {
      const oldDocumentId = sourceId.slice(0, -':analysis'.length)
      const documentId = maps.documentIds.get(oldDocumentId)
      if (documentId) return `${documentId}:analysis`
    }
    return sourceId
  }
  if (sourceType === 'docket_entry') return maps.docketEntryIds.get(sourceId) ?? sourceId
  return sourceId
}

function remapWorkProductJson(
  json: string,
  maps: Parameters<typeof remapActorSourceId>[2],
) {
  const workProduct = parseJsonField<ActorWorkProduct['workProduct']>(json, 'actor work product')
  return JSON.stringify({
    ...workProduct,
    citations: workProduct.citations.map((citation) => ({
      ...citation,
      ...(citation.sourceId
        ? {
            sourceId: remapActorSourceId(citation.sourceType, citation.sourceId, maps) as string,
          }
        : {}),
    })),
    ...(workProduct.recordRefs
      ? {
          recordRefs: workProduct.recordRefs.map(
            (sourceId) => maps.docketEntryIds.get(sourceId) ?? sourceId,
          ),
        }
      : {}),
  })
}

function remapCitationsJson(
  json: string,
  maps: Parameters<typeof remapActorSourceId>[2],
) {
  const citations = parseJsonField<ActorWorkProduct['citations']>(json, 'actor work product citations')
  return JSON.stringify(
    citations.map((citation) => ({
      ...citation,
      ...(citation.sourceId
        ? {
            sourceId: remapActorSourceId(citation.sourceType, citation.sourceId, maps) as string,
          }
        : {}),
    })),
  )
}

async function assembleCaseSession(
  ctx: ReadCtx,
  caseSession: Doc<'caseSessions'>,
): Promise<CaseSession> {
  if (!caseSession.institutionId) throw notFound('Case session')
  await requireSessionScenarioLink(ctx, caseSession, caseSession.userId)
  const scenarioDoc = await ctx.db.get(caseSession.scenarioId)
  if (!scenarioDoc) {
    throw notFound('Case session')
  }

  const [
    scenarioIssues,
    scenarioRecordExcerpts,
    scenarioDocumentAssets,
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
      .query('scenarioDocumentAssets')
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
  const filingIds = new Set(filings.map((filing) => filing._id))
  const docketEntryIds = new Set(docketEntries.map((entry) => entry._id))

  for (const analysis of documentAnalyses) {
    if (!analysis.documentId) continue
    const document = await ctx.db.get(analysis.documentId)
    if (
      !document ||
      document.caseSessionId !== caseSession._id ||
      document.analysisId !== analysis._id
    ) {
      throw notFound('Document analysis')
    }
  }
  for (const filing of filings) {
    const documents = await Promise.all(filing.documentIds.map((id) => ctx.db.get(id)))
    if (documents.some((document) => !document || document.caseSessionId !== caseSession._id)) {
      throw notFound('Filing')
    }
    for (const document of documents) {
      if (document) await requireDocumentAnalysisBinding(ctx, caseSession._id, document)
    }
    for (const analysisId of filing.documentAnalysisIds ?? []) {
      const analysis = await ctx.db.get(analysisId)
      if (
        !analysis ||
        analysis.caseSessionId !== caseSession._id ||
        (analysis.documentId && !filing.documentIds.includes(analysis.documentId))
      ) {
        throw notFound('Filing')
      }
    }
  }
  for (const receipt of receipts) {
    const filing = await ctx.db.get(receipt.filingId)
    if (!filing || filing.caseSessionId !== caseSession._id) {
      throw notFound('ECF receipt')
    }
  }
  for (const entry of docketEntries) {
    if (entry.filingId && !filingIds.has(entry.filingId)) throw notFound('Docket entry')
  }
  for (const deadline of deadlines) {
    if (deadline.sourceEntryId && !docketEntryIds.has(deadline.sourceEntryId)) {
      throw notFound('Deadline')
    }
  }
  for (const product of actorWorkProducts) {
    await requireActorWorkProductSources(
      ctx,
      caseSession._id,
      product.sourceDocumentAnalysisIds,
      product.sourceFilingIds,
    )
  }
  if (simulationTurns.some((turn) => turn.caseSessionId !== caseSession._id)) {
    throw notFound('Simulation turn')
  }
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
    institutionId: caseSession.institutionId,
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
      scenarioDocumentAssets.map(scenarioDocumentAssetFromDoc),
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
  preservedDocuments: Map<
    string,
    {
      document: Doc<'documents'>
      analysis: Doc<'documentAnalyses'>
    }
  >,
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

  const preservedAnalysisIds = new Set(
    [...preservedDocuments.values()].map((preserved) => preserved.analysis._id),
  )
  await Promise.all(
    [
      ...participants,
      ...documents.filter((document) => !preservedDocuments.has(document._id)),
      ...documentAnalyses.filter((analysis) => !preservedAnalysisIds.has(analysis._id)),
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

async function loadReceiptBackedDocuments(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
) {
  const receipts = await ctx.db
    .query('documentUploadIntents')
    .withIndex('by_case_state', (index) =>
      index.eq('caseSessionId', caseSessionId).eq('state', 'consumed'),
    )
    .collect()
  const preserved = new Map<
    string,
    { document: Doc<'documents'>; analysis: Doc<'documentAnalyses'> }
  >()
  for (const receipt of receipts) {
    if (
      receipt.scopeKind !== 'session' ||
      !receipt.caseSessionId ||
      !receipt.storageId ||
      !receipt.documentId ||
      !receipt.analysisId
    ) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Consumed upload linkage is incomplete',
      )
    }
    const document = await ctx.db.get(receipt.documentId)
    const analysis = await ctx.db.get(receipt.analysisId)
    if (
      !document ||
      !analysis ||
      document.caseSessionId !== caseSessionId ||
      document.storageId !== receipt.storageId ||
      document.analysisId !== analysis._id ||
      analysis.caseSessionId !== caseSessionId ||
      analysis.documentId !== document._id
    ) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Consumed upload linkage is invalid',
      )
    }
    preserved.set(String(document._id), { document, analysis })
  }
  return preserved
}

async function bindReceiptBackedFilingSubmission(
  ctx: ReadCtx,
  caseSessionId: Id<'caseSessions'>,
  submission: FilingSubmission,
): Promise<FilingSubmission> {
  const receiptBackedDocuments = await loadReceiptBackedDocuments(
    ctx,
    caseSessionId,
  )

  return {
    ...submission,
    mainDocument: bindReceiptBackedDocument(
      submission.mainDocument,
      receiptBackedDocuments,
    ),
    attachments: submission.attachments.map((attachment) => ({
      ...attachment,
      document: bindReceiptBackedDocument(
        attachment.document,
        receiptBackedDocuments,
      ),
    })),
  }
}

function bindReceiptBackedDocument(
  document: UploadedDocument,
  receiptBackedDocuments: Map<
    string,
    { document: Doc<'documents'>; analysis: Doc<'documentAnalyses'> }
  >,
) {
  const receiptBacked = receiptBackedDocuments.get(document.id)
  if (!receiptBacked) return document
  const canonical = documentFromDoc(
    receiptBacked.document,
    receiptBacked.analysis,
  )
  delete canonical.storageId
  return canonical
}

async function replaceSessionState(
  ctx: WriteCtx,
  caseSessionId: Id<'caseSessions'>,
  session: CaseSession,
) {
  const receiptBackedDocuments = await loadReceiptBackedDocuments(
    ctx,
    caseSessionId,
  )
  const actorWorkProducts = await ctx.db
    .query('actorWorkProducts')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .collect()
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
  await deleteExistingSessionState(
    ctx,
    caseSessionId,
    receiptBackedDocuments,
  )

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
  const documentIdMap = new Map<string, Id<'documents'>>()
  const analysisIdMap = new Map<string, Id<'documentAnalyses'>>()
  for (const filing of session.filings) {
    const documentIds: Array<Id<'documents'>> = []
    const documentAnalysisIds: Array<Id<'documentAnalyses'>> = []
    for (const document of filing.documents) {
      const receiptBacked = receiptBackedDocuments.get(document.id)
      let documentId: Id<'documents'>
      if (receiptBacked) {
        if (
          document.fileName !== receiptBacked.document.fileName ||
          document.mimeType !== receiptBacked.document.mimeType ||
          document.sizeBytes !== receiptBacked.document.sizeBytes ||
          (document.sha256 !== undefined &&
            document.sha256 !== receiptBacked.document.sha256) ||
          (document.storageId !== undefined &&
            document.storageId !== receiptBacked.document.storageId) ||
          (document.analysisId !== undefined &&
            document.analysisId !== receiptBacked.analysis._id)
        ) {
          throw new ConvexError(
            AppErrorCode.CONFLICT,
            'Receipt-backed document does not match its stored record',
          )
        }
        documentId = receiptBacked.document._id
        documentAnalysisIds.push(receiptBacked.analysis._id)
        analysisIdMap.set(
          String(receiptBacked.analysis._id),
          receiptBacked.analysis._id,
        )
        analysisIdMap.set(
          `${document.id}:analysis`,
          receiptBacked.analysis._id,
        )
      } else {
        documentId = await ctx.db.insert('documents', {
          caseSessionId,
          ...(document.storageId
            ? { storageId: document.storageId as Id<'_storage'> }
            : {}),
          ...(document.sha256 ? { sha256: document.sha256 } : {}),
          fileName: document.fileName,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          ...(typeof document.pageCount === 'number'
            ? { pageCount: document.pageCount }
            : {}),
          ...(document.extractedText
            ? { extractedText: document.extractedText }
            : {}),
          ...(document.textExtractionStatus
            ? { textExtractionStatus: document.textExtractionStatus }
            : {}),
          ...(typeof document.wordCount === 'number'
            ? { wordCount: document.wordCount }
            : {}),
          extractedSignals: document.extractedSignals,
        })
      }
      documentIdMap.set(document.id, documentId)
      if (receiptBacked) {
        // The consumed receipt owns these rows; preserve their IDs and blob link.
      } else if (document.analysis) {
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
          // analysisJson is canonical. Keep this compatibility field small;
          // analysisFromDoc reads the complete warnings from analysisJson.
          warnings: [],
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
        if (document.analysisId) analysisIdMap.set(document.analysisId, analysisId)
        analysisIdMap.set(`${document.id}:analysis`, analysisId)
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

  const sourceMaps = {
    analysisIds: analysisIdMap,
    documentIds: documentIdMap,
    filingIds: filingIdMap,
    docketEntryIds: docketEntryIdMap,
  }
  await Promise.all(
    actorWorkProducts.map((product) =>
      ctx.db.patch(product._id, {
        sourceDocumentAnalysisIds: product.sourceDocumentAnalysisIds.map((sourceId) =>
          remapActorSourceId('document_analysis', sourceId, sourceMaps) as string,
        ),
        sourceFilingIds: product.sourceFilingIds.map((sourceId) =>
          remapActorSourceId('filing', sourceId, sourceMaps) as string,
        ),
        workProductJson: remapWorkProductJson(product.workProductJson, sourceMaps),
        ...(product.citationsJson
          ? { citationsJson: remapCitationsJson(product.citationsJson, sourceMaps) }
          : {}),
        ...(product.recordRefs
          ? {
              recordRefs: product.recordRefs.map(
                (sourceId) => docketEntryIdMap.get(sourceId) ?? sourceId,
              ),
            }
          : {}),
      }),
    ),
  )

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
  await assertSessionDocumentAnalysisReadBudget(ctx, caseSessionId)
  return assembleCaseSession(ctx, updated)
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
    try {
      return new URL(result.absolute_url, 'https://www.courtlistener.com').toString()
    } catch {
      return 'https://www.courtlistener.com/'
    }
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

async function withAuthorizedTrialDocketFileUrls(
  ctx: ReadCtx,
  trialDocket: TrialDocket,
): Promise<TrialDocket> {
  return {
    ...trialDocket,
    entries: await Promise.all(
      trialDocket.entries.map(async (entry) => ({
        ...entry,
        documents: await Promise.all(
          entry.documents.map(async (document) => {
            const {
              fileUrl: _fileUrl,
              publicUrl: _publicUrl,
              ...documentWithoutUrl
            } = document as typeof document & { publicUrl?: string }
            const storageId = document.storageId as Id<'_storage'> | undefined
            if (!storageId) return documentWithoutUrl
            const fileUrl = await ctx.storage.getUrl(storageId)
            return fileUrl ? { ...documentWithoutUrl, fileUrl } : documentWithoutUrl
          }),
        ),
      })),
    ),
  }
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
    institutionId: v.optional(v.id('institutions')),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const user = args.institutionId
      ? (await requireCurrentUser(ctx)).user
      : await upsertCurrentUserDoc(ctx)
    if (args.institutionId) {
      await requireInstitutionRole(ctx, args.institutionId, ['learner'])
    }
    const institutionId = args.institutionId ?? (
      await ctx.runMutation(internal.organizations.ensurePersonalForTrustedUser, {
        userId: user._id,
      })
    ).institutionId
    if (!args.institutionId) {
      await requireInstitutionRole(ctx, institutionId, ['learner'])
    }
    const scenarioKey = args.scenarioId ?? defaultScenarioKey
    const scenario = await ensureScenarioDoc(ctx, scenarioKey, user._id, institutionId)
    const [scenarioIssues, scenarioRecordExcerpts, scenarioDocumentAssets] = await Promise.all([
      ctx.db
        .query('scenarioIssues')
        .withIndex('by_scenario', (index) => index.eq('scenarioId', scenario._id))
        .collect(),
      ctx.db
        .query('scenarioRecordExcerpts')
        .withIndex('by_scenario', (index) => index.eq('scenarioId', scenario._id))
        .collect(),
      ctx.db
        .query('scenarioDocumentAssets')
        .withIndex('by_scenario', (index) => index.eq('scenarioId', scenario._id))
        .collect(),
    ])
    const scenarioModel = scenarioFromDoc(
      scenario,
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
      scenarioDocumentAssets.map(scenarioDocumentAssetFromDoc),
    )
    const bundledScenario = seedScenarios.some((candidate) => candidate.id === scenario.scenarioKey)
    const initialSession = bundledScenario
      ? createInitialSession(scenario.scenarioKey)
      : createInitialSessionForScenario(scenarioModel)
    const initialProcedureState = inferProcedureState(initialSession)
    const caseSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
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
      nextEventSequence: 1,
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
    institutionId: v.optional(v.id('institutions')),
  },
  returns: v.union(caseSessionValidator, v.null()),
  handler: async (ctx, args) => {
    if (args.caseSessionId) {
      const { session } = await requireOwnedSession(ctx, args.caseSessionId)
      if (args.institutionId && session.institutionId !== args.institutionId) {
        throw notFound('Case session')
      }
      return assembleCaseSession(ctx, session)
    }
    const { sessions } = await readableSessionsForCurrentUser(ctx, args.institutionId)
    const latest = sessions.sort((a, b) => b._creationTime - a._creationTime)[0]
    return latest ? assembleCaseSession(ctx, latest) : null
  },
})

async function readableSessionsForCurrentUser(
  ctx: ReadCtx,
  institutionId?: Id<'institutions'>,
) {
  const { user } = await requireCurrentUser(ctx)
  if (institutionId) await requireInstitutionRole(ctx, institutionId, ['learner'])
  const candidates = institutionId
    ? await ctx.db
        .query('caseSessions')
        .withIndex('by_institution', (index) => index.eq('institutionId', institutionId))
        .collect()
    : await ctx.db
        .query('caseSessions')
        .withIndex('by_user', (index) => index.eq('userId', user._id))
        .collect()
  const sessions: Doc<'caseSessions'>[] = []
  for (const candidate of candidates) {
    if (candidate.userId !== user._id) continue
    try {
      const { session } = await requireOwnedSession(ctx, candidate._id)
      if (!institutionId || session.institutionId === institutionId) {
        sessions.push(session)
      }
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data.code === AppErrorCode.NOT_FOUND
      ) {
        continue
      }
      throw error
    }
  }
  return { user, sessions }
}

export const getWritableForCurrentUser = internalQuery({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const caseSession = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    return assembleCaseSession(ctx, caseSession)
  },
})

export const acceptLegalTrainingDisclaimer = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    version: v.string(),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user, session: caseSessionDoc } = await requireOwnedSession(ctx, args.caseSessionId)
    await requireWritableCaseSession(ctx, args.caseSessionId)
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
  args: {
    institutionId: v.optional(v.id('institutions')),
  },
  returns: v.array(caseSessionSummaryValidator),
  handler: async (ctx, args) => {
    const { sessions } = await readableSessionsForCurrentUser(ctx, args.institutionId)
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
        if (!session.institutionId) throw notFound('Case session')
        return {
          id: session._id,
          institutionId: session.institutionId,
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
    rejectClientStorageClaims(args.draft.documents)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const receiptBackedDocuments = await loadReceiptBackedDocuments(
      ctx,
      caseSessionDoc._id,
    )
    const draft = {
      ...args.draft,
      documents: args.draft.documents.map((document) =>
        bindReceiptBackedDocument(document, receiptBackedDocuments),
      ),
    }
    const nextSession = transitionAfterFiling(
      withRejectedFilingAudit(session, draft, fileDraft(session, draft)),
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
    rejectClientStorageClaims([
      args.submission.mainDocument,
      ...args.submission.attachments.map((attachment) => attachment.document),
    ])
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const submission = await bindReceiptBackedFilingSubmission(
      ctx,
      caseSessionDoc._id,
      args.submission as FilingSubmission,
    )
    return preflightEcfFiling(session, submission)
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
    throw validationError('Use document upload intents')
  },
})

export const persistDocumentAnalysis = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    intentId: v.optional(v.id('documentUploadIntents')),
    document: uploadedDocumentValidator,
    analysis: documentAnalysisValidator,
  },
  returns: v.object({
    document: uploadedDocumentValidator,
    analysisId: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!args.intentId)
      throw validationError(
        'Use an authenticated document upload intent.',
        'intentId',
      )
    const { user } = await requireCurrentUser(ctx)
    const { session } = await requireOwnedSession(ctx, args.caseSessionId)
    const receipt = await ctx.db.get(args.intentId)
    if (!receipt || receipt.userId !== user._id)
      throw notFound('Upload receipt')
    if (
      receipt.scopeKind !== 'session' ||
      receipt.caseSessionId !== session._id ||
      receipt.institutionId !== session.institutionId ||
      receipt.datasetVersionId !== undefined
    ) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload receipt scope mismatch',
      )
    }

    if (receipt.state === 'consumed') {
      if (!receipt.documentId || !receipt.analysisId) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Consumed upload linkage is incomplete',
        )
      }
      const existingDocument = await ctx.db.get(receipt.documentId)
      const existingAnalysis = await ctx.db.get(receipt.analysisId)
      if (
        !existingDocument ||
        !existingAnalysis ||
        existingDocument.caseSessionId !== session._id ||
        existingDocument.analysisId !== existingAnalysis._id ||
        existingAnalysis.caseSessionId !== session._id ||
        existingAnalysis.documentId !== existingDocument._id
      ) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Consumed upload linkage is invalid',
        )
      }
      const existing: UploadedDocument = {
        id: existingDocument._id,
        ...(existingDocument.sha256 ? { sha256: existingDocument.sha256 } : {}),
        fileName: existingDocument.fileName,
        mimeType: existingDocument.mimeType,
        sizeBytes: existingDocument.sizeBytes,
        ...(typeof existingDocument.pageCount === 'number'
          ? { pageCount: existingDocument.pageCount }
          : {}),
        ...(existingDocument.extractedText
          ? { extractedText: existingDocument.extractedText }
          : {}),
        ...(existingDocument.textExtractionStatus
          ? { textExtractionStatus: existingDocument.textExtractionStatus }
          : {}),
        ...(typeof existingDocument.wordCount === 'number'
          ? { wordCount: existingDocument.wordCount }
          : {}),
        analysisId: existingAnalysis._id,
        analysis: analysisFromDoc(existingAnalysis),
        extractedSignals: existingDocument.extractedSignals,
      }
      return { document: existing, analysisId: existingAnalysis._id }
    }

    await requireWritableCaseSession(ctx, args.caseSessionId)
    if (receipt.state !== 'stored' || !receipt.storageId) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload receipt is not ready for consumption',
      )
    }
    const expiresAt = Date.parse(receipt.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new ConvexError(AppErrorCode.CONFLICT, 'Upload receipt expired', {
        reason: 'UPLOAD_EXPIRED',
      })
    }
    if (args.document.storageId !== undefined) {
      throw validationError(
        'Document storage IDs must come from an upload receipt.',
        'storageId',
      )
    }
    if (
      args.document.fileName !== receipt.fileName ||
      args.document.mimeType !== receipt.mimeType ||
      args.document.sizeBytes !== receipt.sizeBytes ||
      (args.document.sha256 !== undefined &&
        args.document.sha256 !== receipt.sha256) ||
      args.analysis.fileSizeBytes !== receipt.sizeBytes ||
      args.analysis.mimeType !== receipt.mimeType
    ) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Document metadata does not match upload receipt',
      )
    }

    if (args.document.fileName.length > 200) {
      throw validationError(
        'File name exceeds the simulator storage limit.',
        'fileName',
      )
    }
    if ((args.analysis.normalizedText?.length ?? 0) > 200_000) {
      throw validationError(
        'Extracted PDF text exceeds the simulator storage limit.',
      )
    }
    if ((args.document.extractedText?.length ?? 0) > 200_000) {
      throw validationError(
        'Extracted PDF text exceeds the simulator storage limit.',
      )
    }
    if (args.document.extractedSignals.length > 80) {
      throw validationError(
        'Document signal count exceeds the simulator storage limit.',
      )
    }
    for (const pageCount of [
      args.document.pageCount,
      args.analysis.pageCount,
    ]) {
      if (
        typeof pageCount === 'number' &&
        (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 500)
      ) {
        throw validationError('PDF page count must be between 1 and 500.')
      }
    }
    if (
      args.document.pageCount !== undefined &&
      args.analysis.pageCount !== undefined &&
      args.document.pageCount !== args.analysis.pageCount
    ) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Document page count does not match analysis',
      )
    }
    const serializedAnalysis = JSON.stringify(args.analysis)
    if (serializedAnalysis.length > 900_000) {
      throw validationError('PDF analysis exceeds the simulator storage limit.')
    }
    const createdAt = new Date().toISOString()
    const documentRowPayload = {
      caseSessionId: args.caseSessionId,
      storageId: receipt.storageId,
      analysisId: generatedDocumentIdBudgetPlaceholder,
      fileName: args.document.fileName,
      mimeType: args.document.mimeType,
      sizeBytes: args.document.sizeBytes,
      sha256: receipt.sha256,
      ...(typeof args.document.pageCount === 'number'
        ? { pageCount: args.document.pageCount }
        : {}),
      ...(args.document.extractedText
        ? { extractedText: args.document.extractedText }
        : {}),
      ...(args.document.textExtractionStatus
        ? { textExtractionStatus: args.document.textExtractionStatus }
        : {}),
      ...(typeof args.document.wordCount === 'number'
        ? { wordCount: args.document.wordCount }
        : {}),
      extractedSignals: args.document.extractedSignals,
    }
    const analysisRowPayload = {
      caseSessionId: args.caseSessionId,
      documentId: generatedDocumentIdBudgetPlaceholder,
      analyzerId: args.analysis.analyzerId,
      ...(typeof args.analysis.pageCount === 'number'
        ? { pageCount: args.analysis.pageCount }
        : {}),
      fileSizeBytes: args.analysis.fileSizeBytes,
      mimeType: args.analysis.mimeType,
      searchableText: args.analysis.searchableText,
      certificateOfServiceDetected: args.analysis.certificateOfServiceDetected,
      certificateOfComplianceDetected:
        args.analysis.certificateOfComplianceDetected,
      sealedOrRedactionWarning: args.analysis.sealedOrRedactionWarning,
      // analysisJson is canonical; keep the fallback warnings field small.
      warnings: [],
      analysisJson: serializedAnalysis,
      ...(args.analysis.normalizedText
        ? { extractedTextHash: hashText(args.analysis.normalizedText) }
        : {}),
      ...(typeof args.analysis.wordCount === 'number'
        ? { wordCount: args.analysis.wordCount }
        : {}),
      ...(args.analysis.legalCitations
        ? { citationCount: args.analysis.legalCitations.length }
        : {}),
      ...(args.analysis.recordCitations
        ? { recordCitationCount: args.analysis.recordCitations.length }
        : {}),
      ...(args.analysis.appendixCitations
        ? { appendixCitationCount: args.analysis.appendixCitations.length }
        : {}),
      createdAt,
    }
    if (
      !fitsDocumentRowByteBudget(documentRowPayload) ||
      !fitsDocumentRowByteBudget(analysisRowPayload)
    ) {
      throw validationError(
        'Document analysis exceeds the simulator per-record storage limit.',
      )
    }
    const storageId = receipt.storageId
    const metadata = await ctx.db.system.get('_storage', storageId)
    if (!metadata) throw notFound('Uploaded PDF storage')
    if (metadata.size > 25 * 1024 * 1024) {
      throw validationError('PDF exceeds the simulator upload size limit.')
    }
    if (
      metadata.contentType &&
      !metadata.contentType.toLowerCase().startsWith('application/pdf')
    ) {
      throw validationError('Uploaded file storage is not a PDF.')
    }
    if (
      metadata.size !== receipt.sizeBytes ||
      args.document.sizeBytes !== metadata.size ||
      args.analysis.fileSizeBytes !== metadata.size
    ) {
      throw validationError(
        'Uploaded PDF metadata does not match stored file metadata.',
      )
    }
    const existingDocument = await ctx.db
      .query('documents')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .first()
    if (existingDocument) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Uploaded PDF storage is already associated with a document',
      )
    }
    const verified = { storageId, sha256: receipt.sha256 }

    const documentId = await ctx.db.insert('documents', {
      caseSessionId: args.caseSessionId,
      storageId: verified.storageId,
      ...(verified.sha256 ? { sha256: verified.sha256 } : {}),
      fileName: args.document.fileName,
      mimeType: args.document.mimeType,
      sizeBytes: args.document.sizeBytes,
      ...(typeof args.document.pageCount === 'number'
        ? { pageCount: args.document.pageCount }
        : {}),
      ...(args.document.extractedText
        ? { extractedText: args.document.extractedText }
        : {}),
      ...(args.document.textExtractionStatus
        ? { textExtractionStatus: args.document.textExtractionStatus }
        : {}),
      ...(typeof args.document.wordCount === 'number'
        ? { wordCount: args.document.wordCount }
        : {}),
      extractedSignals: args.document.extractedSignals,
    })
    const analysisId = await ctx.db.insert('documentAnalyses', {
      caseSessionId: args.caseSessionId,
      documentId,
      analyzerId: args.analysis.analyzerId,
      ...(typeof args.analysis.pageCount === 'number'
        ? { pageCount: args.analysis.pageCount }
        : {}),
      fileSizeBytes: args.analysis.fileSizeBytes,
      mimeType: args.analysis.mimeType,
      searchableText: args.analysis.searchableText,
      certificateOfServiceDetected: args.analysis.certificateOfServiceDetected,
      certificateOfComplianceDetected:
        args.analysis.certificateOfComplianceDetected,
      sealedOrRedactionWarning: args.analysis.sealedOrRedactionWarning,
      warnings: [],
      analysisJson: serializedAnalysis,
      ...(args.analysis.normalizedText
        ? { extractedTextHash: hashText(args.analysis.normalizedText) }
        : {}),
      ...(typeof args.analysis.wordCount === 'number'
        ? { wordCount: args.analysis.wordCount }
        : {}),
      ...(args.analysis.legalCitations
        ? { citationCount: args.analysis.legalCitations.length }
        : {}),
      ...(args.analysis.recordCitations
        ? { recordCitationCount: args.analysis.recordCitations.length }
        : {}),
      ...(args.analysis.appendixCitations
        ? { appendixCitationCount: args.analysis.appendixCitations.length }
        : {}),
      createdAt,
    })
    await ctx.db.patch(documentId, { analysisId })

    // Throwing here rolls the tentative rows back atomically and keeps the
    // receipt stored for a corrected retry.
    await assertSessionDocumentAnalysisReadBudget(ctx, args.caseSessionId)

    const receiptFields = {
      institutionId: receipt.institutionId,
      scopeKind: receipt.scopeKind,
      ...(receipt.caseSessionId
        ? { caseSessionId: receipt.caseSessionId }
        : {}),
      ...(receipt.datasetVersionId
        ? { datasetVersionId: receipt.datasetVersionId }
        : {}),
      userId: receipt.userId,
      fileName: receipt.fileName,
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      mimeType: receipt.mimeType,
      chunkCount: receipt.chunkCount,
      state: receipt.state,
      expiresAt: receipt.expiresAt,
      createdAt: receipt.createdAt,
      ...(receipt.storageId ? { storageId: receipt.storageId } : {}),
      ...(receipt.documentId ? { documentId: receipt.documentId } : {}),
      ...(receipt.analysisId ? { analysisId: receipt.analysisId } : {}),
      ...(receipt.datasetAssetId
        ? { datasetAssetId: receipt.datasetAssetId }
        : {}),
    }
    const nextReceiptFields = {
      ...receiptFields,
      state: 'consumed' as const,
      documentId,
      analysisId,
    }
    validateUploadIntentTransition(receiptFields, nextReceiptFields)
    await ctx.db.patch(receipt._id, {
      state: 'consumed',
      documentId,
      analysisId,
    })

    const cleanupConsumedChunksRef = makeFunctionReference<
      'action',
      { intentId: Id<'documentUploadIntents'> },
      null
    >('documentUploadActions:cleanupChunks')
    await ctx.scheduler.runAfter(0, cleanupConsumedChunksRef, {
      intentId: receipt._id,
    })

    const document: UploadedDocument = {
      ...args.document,
      id: documentId,
      ...(verified.sha256 ? { sha256: verified.sha256 } : {}),
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
    const { user } = await requireCurrentUser(ctx)
    await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const analyses = await ctx.db
      .query('documentAnalyses')
      .withIndex('by_case', (index) => index.eq('caseSessionId', args.caseSessionId))
      .collect()

    for (const analysis of analyses) {
      if (!analysis.documentId) continue
      const document = await ctx.db.get(analysis.documentId)
      if (!document || document.caseSessionId !== args.caseSessionId) {
        throw notFound('Document analysis')
      }
      if (document.analysisId !== analysis._id) {
        throw notFound('Document analysis')
      }
    }

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
    rejectClientStorageClaims([
      args.submission.mainDocument,
      ...args.submission.attachments.map((attachment) => attachment.document),
    ])
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const submission = await bindReceiptBackedFilingSubmission(
      ctx,
      caseSessionDoc._id,
      args.submission as FilingSubmission,
    )
    const result = submitEcfFilingDomain(session, submission)
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
    const evidenceNotice = 'Caller-reported metadata; not verified court evidence.'
    const addEvidenceNotice = (text: string) =>
      text.startsWith(evidenceNotice)
        ? text
        : [evidenceNotice, text].join('\n\n')
    const serverLabeledResult = {
      ...args.result,
      ...(args.result.snippet !== undefined
        ? { snippet: addEvidenceNotice(args.result.snippet) }
        : {}),
      evidenceStatus: 'caller_reported_metadata',
      evidenceNotice,
    }
    const derivedTrialDocket = createImportedTrialDocket(
      session,
      serverLabeledResult,
      sourceUrl,
    )
    const trialDocket: TrialDocket = {
      ...derivedTrialDocket,
      entries: derivedTrialDocket.entries.map((entry) => ({
        ...entry,
        text: addEvidenceNotice(entry.text),
      })),
    }
    const importedAt = new Date().toISOString()
    const provenance = {
      ...args.result,
      evidenceStatus: 'caller_reported_metadata',
      evidenceNotice,
    }

    await ctx.db.insert('sourceCases', {
      caseSessionId: caseSessionDoc._id,
      scenarioId: caseSessionDoc.scenarioId,
      sourceSystem: 'courtlistener',
      externalId: String(args.result.docket_id ?? args.result.id),
      sourceUrl,
      importedAt,
      provenanceJson: JSON.stringify(provenance),
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
      text: `Imported ${args.result.caseNameFull ?? args.result.caseName ?? 'CourtListener docket'} (${args.result.docketNumber ?? 'no docket number'}) from ${args.result.court ?? 'CourtListener'}. Source: ${sourceUrl}\n\n${evidenceNotice}`,
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
    const { user } = await requireCurrentUser(ctx)
    const caseSession = await requireAuthorizedSessionDoc(ctx, args.caseSessionId, user._id)
    const imports = await ctx.db
      .query('trialDocketImports')
      .withIndex('by_case', (index) => index.eq('caseSessionId', args.caseSessionId))
      .collect()
    const latest = imports.sort((a, b) => b._creationTime - a._creationTime)[0]
    if (latest) {
      return withAuthorizedTrialDocketFileUrls(ctx, {
        caption: latest.caption,
        court: latest.court,
        docketNumber: latest.docketNumber,
        ...(latest.sourceUrl ? { sourceUrl: latest.sourceUrl } : {}),
        entries: normalizeTrialDocketEntries(latest.entriesJson),
      })
    }

    const session = await assembleCaseSession(ctx, caseSession)
    return withAuthorizedTrialDocketFileUrls(ctx, createTrialDocket(session))
  },
})

export const getAiGateForCurrentUser = internalQuery({
  args: {
    caseSessionId: v.id('caseSessions'),
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
    const { user } = await requireOwnedSession(ctx, args.caseSessionId)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const month = createdMonth(args.nowIso)
    const runs = await ctx.db
      .query('aiRuns')
      .withIndex('by_user_month', (index) =>
        index.eq('userId', user._id).eq('createdMonth', month),
      )
      .collect()
    const spentCents = aiSpentCents(runs, args.nowIso)
    if (spentCents >= user.monthlyAiBudgetCents) {
      return {
        allowed: false,
        reason: 'Live AI budget exhausted.',
        budgetCents: user.monthlyAiBudgetCents,
        spentCents,
      }
    }

    const latestRun = billableAiRuns(runs, args.nowIso).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]
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

export const reserveAiRunForCurrentUser = internalMutation({
  args: {
    caseSessionId: v.id('caseSessions'),
    actorId: v.string(),
    model: v.string(),
    promptHash: v.string(),
    nowIso: v.string(),
    cooldownMs: v.number(),
    estimatedCostCents: v.number(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    aiRunId: v.optional(v.id('aiRuns')),
    budgetCents: v.number(),
    spentCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireOwnedSession(ctx, args.caseSessionId)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const month = createdMonth(args.nowIso)
    const runs = await ctx.db
      .query('aiRuns')
      .withIndex('by_user_month', (index) =>
        index.eq('userId', user._id).eq('createdMonth', month),
      )
      .collect()
    await expireStaleAiReservations(ctx, runs, args.nowIso)

    const spentCents = aiSpentCents(runs, args.nowIso)
    if (spentCents + args.estimatedCostCents > user.monthlyAiBudgetCents) {
      return {
        allowed: false,
        reason: 'Live AI budget exhausted.',
        budgetCents: user.monthlyAiBudgetCents,
        spentCents,
      }
    }

    const latestRun = billableAiRuns(runs, args.nowIso).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]
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

    const aiRunId = await ctx.db.insert('aiRuns', {
      caseSessionId: args.caseSessionId,
      userId: user._id,
      actorId: args.actorId,
      model: args.model,
      provider: 'openrouter',
      promptHash: args.promptHash,
      toolCallJson: '',
      accepted: false,
      issues: ['AI request in flight.'],
      costCents: args.estimatedCostCents,
      latencyMs: 0,
      errorClass: 'in_flight',
      createdMonth: month,
      createdAt: args.nowIso,
    })
    return {
      allowed: true,
      aiRunId,
      budgetCents: user.monthlyAiBudgetCents,
      spentCents: spentCents + args.estimatedCostCents,
    }
  },
})

export const finalizeAiRunForCurrentUser = internalMutation({
  args: {
    aiRunId: v.id('aiRuns'),
    actorId: v.string(),
    toolCallJson: v.string(),
    accepted: v.boolean(),
    issues: v.array(v.string()),
    costCents: v.number(),
    latencyMs: v.number(),
    errorClass: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const run = await ctx.db.get(args.aiRunId)
    if (!run || run.userId !== user._id) {
      throw notFound('AI run')
    }
    const { session } = await requireOwnedSession(ctx, run.caseSessionId)
    if (session.userId !== run.userId) throw notFound('AI run')
    await requireWritableCaseSession(ctx, session._id)
    requireActiveAiReservation(run)
    await ctx.db.patch(args.aiRunId, {
      actorId: args.actorId,
      toolCallJson: args.toolCallJson,
      accepted: args.accepted,
      issues: args.issues,
      costCents: args.costCents,
      latencyMs: args.latencyMs,
      errorClass: args.errorClass,
    })
    return null
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
    aiRunId: v.optional(v.id('aiRuns')),
  },
  returns: caseSessionValidator,
  handler: async (ctx, args) => {
    const { user, session: authorizedSession } = await requireOwnedSession(ctx, args.caseSessionId)
    const caseSessionDoc = authorizedSession
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const validation = validateToolCall(session, args.toolCall)
    if (args.aiRunId) {
      const run = await ctx.db.get(args.aiRunId)
      if (
        !run ||
        run.userId !== user._id ||
        run.caseSessionId !== authorizedSession._id
      ) {
        throw notFound('AI run')
      }
      requireActiveAiReservation(run)
      await ctx.db.patch(args.aiRunId, {
        actorId: args.toolCall.actorId,
        toolCallJson: args.rawText,
        accepted: validation.accepted,
        issues: validation.issues,
        costCents: args.costCents,
        latencyMs: args.latencyMs,
        errorClass: validation.accepted ? undefined : 'tool_validation_rejected',
      })
    } else {
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
    }
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
    aiRunId: v.id('aiRuns'),
    actorId: v.string(),
    kind: actorWorkProductKindValidator,
    workProductJson: v.string(),
    sourceDocumentAnalysisIds: v.array(v.string()),
    sourceFilingIds: v.array(v.string()),
    validationIssues: v.array(validationIssueValidator),
    createdAt: v.string(),
    costCents: v.number(),
    latencyMs: v.number(),
  },
  returns: actorWorkProductValidator,
  handler: async (ctx, args) => {
    const { user, session } = await requireOwnedSession(ctx, args.caseSessionId)
    await requireWritableCaseSession(ctx, args.caseSessionId)
    const run = await ctx.db.get(args.aiRunId)
    if (
      !run ||
      run.userId !== user._id ||
      run.caseSessionId !== session._id
    ) {
      throw notFound('AI run')
    }
    requireActiveAiReservation(run)
    const trustedSources = await requireActorWorkProductSources(
      ctx,
      session._id,
      args.sourceDocumentAnalysisIds,
      args.sourceFilingIds,
    )
    const workProduct = parseJsonField<ActorWorkProduct['workProduct']>(
      args.workProductJson,
      'actor work product mutation payload',
    )
    const validationAccepted = !args.validationIssues.some((issue) => issue.severity === 'error')
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
      sourceDocumentAnalysisIds: trustedSources.sourceDocumentAnalysisIds,
      sourceFilingIds: trustedSources.sourceFilingIds,
      createdAt: args.createdAt,
    })
    await ctx.db.patch(args.aiRunId, {
      actorId: args.actorId,
      toolCallJson: args.workProductJson,
      accepted: validationAccepted,
      issues: args.validationIssues.map((issue) => issue.code ?? issue.message),
      costCents: args.costCents,
      latencyMs: args.latencyMs,
      errorClass: validationAccepted ? undefined : 'actor_validation_rejected',
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
      sourceDocumentAnalysisIds: trustedSources.sourceDocumentAnalysisIds,
      sourceFilingIds: trustedSources.sourceFilingIds,
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
    const session = (await ctx.runQuery(internal.caseSessions.getWritableForCurrentUser, {
      caseSessionId: args.caseSessionId,
    })) as CaseSession

    const model = requireEnv('OPENROUTER_MODEL')
    const promptHash = promptHashForSession(session)
    const reservation = (await ctx.runMutation(internal.caseSessions.reserveAiRunForCurrentUser, {
      caseSessionId: args.caseSessionId,
      actorId: 'openrouter',
      model,
      promptHash,
      nowIso,
      cooldownMs: openRouterCooldownMs,
      estimatedCostCents: estimatedOpenRouterCostCents,
    })) as { allowed: boolean; reason?: string; aiRunId?: Id<'aiRuns'> }
    if (!reservation.allowed || !reservation.aiRunId) {
      // ERROR_CODE: RATE_LIMITED
      throw new Error(reservation.reason ?? 'Live AI is temporarily unavailable.')
    }

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
          aiRunId: reservation.aiRunId,
          actorId: product.actorId,
          kind: product.kind,
          workProductJson: JSON.stringify(product.workProduct),
          sourceDocumentAnalysisIds: product.sourceDocumentAnalysisIds,
          sourceFilingIds: product.sourceFilingIds,
          validationIssues: product.validationIssues ?? [],
          createdAt: product.createdAt,
          costCents: estimatedOpenRouterCostCents,
          latencyMs: Date.now() - startedAt,
        },
      )) as ActorWorkProduct
      return persisted
    } catch (error) {
      const isTimeout = errorMessage(error).includes('timed out')
      await ctx.runMutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
        aiRunId: reservation.aiRunId,
        actorId: 'openrouter',
        toolCallJson: '',
        accepted: false,
        issues: [errorMessage(error)],
        costCents: 0,
        latencyMs: Date.now() - startedAt,
        errorClass: isTimeout ? 'timeout' : 'provider_error',
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
      throw notFound('Actor work product')
    }

    const session = await assembleCaseSession(ctx, caseSessionDoc)
    const product = actorWorkProductFromDoc(productDoc)
    if (productDoc.status !== 'proposed') {
      return {
        session,
        workProduct: product,
        receipt: null,
        validationReason: 'Actor work product has already been reviewed.',
      }
    }
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
    const remappedProductDoc = await ctx.db.get(productDoc._id)
    if (!remappedProductDoc) throw notFound('Actor work product')
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
        ...actorWorkProductFromDoc(remappedProductDoc),
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
      throw notFound('Actor work product')
    }
    await requireActorWorkProductSources(
      ctx,
      args.caseSessionId,
      productDoc.sourceDocumentAnalysisIds,
      productDoc.sourceFilingIds,
    )

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
    const session = (await ctx.runQuery(internal.caseSessions.getWritableForCurrentUser, {
      caseSessionId: args.caseSessionId,
    })) as CaseSession

    const model = requireEnv('OPENROUTER_MODEL')
    const promptHash = promptHashForSession(session)
    const reservation = (await ctx.runMutation(internal.caseSessions.reserveAiRunForCurrentUser, {
      caseSessionId: args.caseSessionId,
      actorId: 'openrouter',
      model,
      promptHash,
      nowIso,
      cooldownMs: openRouterCooldownMs,
      estimatedCostCents: estimatedOpenRouterCostCents,
    })) as { allowed: boolean; reason?: string; aiRunId?: Id<'aiRuns'> }
    if (!reservation.allowed || !reservation.aiRunId) {
      // ERROR_CODE: RATE_LIMITED
      throw new Error(reservation.reason ?? 'Live AI is temporarily unavailable.')
    }

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
        await ctx.runMutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
          aiRunId: reservation.aiRunId,
          actorId: 'openrouter',
          toolCallJson: result.rawText,
          accepted: false,
          issues: ['The AI service returned text, but no valid procedural event.'],
          costCents: estimatedOpenRouterCostCents,
          latencyMs,
          errorClass: 'tool_validation_rejected',
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
        await ctx.runMutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
          aiRunId: reservation.aiRunId,
          actorId: result.toolCall.actorId,
          toolCallJson: result.rawText,
          accepted: false,
          issues: validation.issues.length
            ? validation.issues
            : ['Invalid procedural tool call.'],
          costCents: estimatedOpenRouterCostCents,
          latencyMs,
          errorClass: 'tool_validation_rejected',
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
          aiRunId: reservation.aiRunId,
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
      await ctx.runMutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
        aiRunId: reservation.aiRunId,
        actorId: 'openrouter',
        toolCallJson: '',
        accepted: false,
        issues: [errorMessage(error)],
        costCents: 0,
        latencyMs,
        errorClass: isTimeout ? 'timeout' : 'provider_error',
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
