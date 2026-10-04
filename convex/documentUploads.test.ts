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

import { createHash, randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Id } from './_generated/dataModel'
import { AppErrorCode, type AppErrorData } from './errors'
import { deleteOrRetryCleanup } from './documentUploadActions'
import type {
  CaseSession,
  DocumentAnalysis,
  EcfReceipt,
  FilingSubmission,
  PreflightCheckResult,
  UploadedDocument,
} from '../src/domain/types'
import { defaultFilingMetadata } from '../src/domain/filing/ecf'
import {
  fitsSessionDocumentAnalysisReadBudget,
  maxSessionDocumentAnalysisReadBytes,
} from './documentAnalysisBudget'
import schema from './schema'

const chunkBytes = 4 * 1024 * 1024
const maxFileBytes = 25 * 1024 * 1024
const appOrigin = 'https://app.example.test'

const modules = {
  './_generated/api.ts': () => import('./_generated/api'),
  './_generated/server.ts': () => import('./_generated/server'),
  './authHelpers.ts': () => import('./authHelpers'),
  './authz.ts': () => import('./authz'),
  './caseSessionEventLog.ts': () => import('./caseSessionEventLog'),
  './caseSessions.ts': () => import('./caseSessions'),
  './documentUploadActions.ts': () => import('./documentUploadActions'),
  './documentUploads.ts': () => import('./documentUploads'),
  './errors.ts': () => import('./errors'),
  './http.ts': () => import('./http'),
  './organizationContracts.ts': () => import('./organizationContracts'),
}

type TestIdentity = {
  issuer: string
  subject: string
  tokenIdentifier: string
  name: string
}

const identity = (subject: string): TestIdentity => ({
  issuer: 'https://identity.example.test',
  subject,
  tokenIdentifier: `https://identity.example.test|${subject}`,
  name: subject,
})

type Scope =
  | { kind: 'session'; caseSessionId: Id<'caseSessions'> }
  | { kind: 'dataset'; versionId: Id<'organizationDatasetVersions'> }

type BeginArgs = {
  scope: Scope
  fileName: string
  sizeBytes: number
  sha256: string
  mimeType: 'application/pdf' | 'text/plain' | 'application/json'
}

type BeginResult = {
  intentId: Id<'documentUploadIntents'>
  chunkBytes: number
  expiresAt: string
}

type PersistArgs = {
  caseSessionId: Id<'caseSessions'>
  intentId?: Id<'documentUploadIntents'>
  document: UploadedDocument
  analysis: DocumentAnalysis
}

type PersistResult = { document: UploadedDocument; analysisId: string }

type AdvanceProcedureResult = {
  session: { filings: Array<{ documents: UploadedDocument[] }> }
  toolCall: { tool: string }
}

type SubmitFilingResult = {
  filings: Array<{
    documents: UploadedDocument[]
    outcome: string
  }>
}

const beginRef = makeFunctionReference<'mutation', BeginArgs, BeginResult>(
  'documentUploads:begin',
)
const completeRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  { intentId: Id<'documentUploadIntents'>; sizeBytes: number; sha256: string }
>('documentUploadActions:complete')
const claimCompletionRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'>; claimToken: string },
  | { state: 'claimed' }
  | { state: 'busy' }
  | { state: 'existing'; sizeBytes: number; sha256: string }
>('documentUploads:claimCompletion')
const releaseCompletionClaimRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'>; claimToken: string },
  null
>('documentUploads:releaseCompletionClaim')
const finalizeCompletionRef = makeFunctionReference<
  'mutation',
  {
    intentId: Id<'documentUploadIntents'>
    claimToken?: string
    storageId: Id<'_storage'>
    sizeBytes: number
    sha256: string
  },
  {
    storageId: Id<'_storage'>
    accepted: boolean
    cancelled: boolean
    stale: boolean
  }
>('documentUploads:finalizeCompletion')
const cleanupUploadStorageRef = makeFunctionReference<
  'action',
  { storageId: Id<'_storage'> },
  null
>('documentUploadActions:cleanupUploadStorage')
const queueUploadCleanupRef = makeFunctionReference<
  'mutation',
  {
    storageIds: Id<'_storage'>[]
    intentId?: Id<'documentUploadIntents'>
  },
  Id<'_storage'>[]
>('documentUploads:queueUploadCleanup')
const retryUploadStorageCleanupRef = makeFunctionReference<
  'mutation',
  { storageId: Id<'_storage'> },
  null
>('documentUploads:retryUploadStorageCleanup')
const cancelRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  null
>('documentUploadActions:cancel')
const persistRef = makeFunctionReference<
  'mutation',
  PersistArgs,
  PersistResult
>('caseSessions:persistDocumentAnalysis')
const getSessionRef = makeFunctionReference<
  'query',
  { caseSessionId: Id<'caseSessions'> },
  CaseSession | null
>('caseSessions:getForCurrentUser')
const preflightFilingRef = makeFunctionReference<
  'query',
  { caseSessionId: Id<'caseSessions'>; submission: FilingSubmission },
  PreflightCheckResult
>('caseSessions:preflightFiling')
const submitEcfFilingRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'>; submission: FilingSubmission },
  {
    session: CaseSession
    preflight: PreflightCheckResult
    receipt: EcfReceipt | null
  }
>('caseSessions:submitEcfFiling')
const advanceProcedureRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'> },
  AdvanceProcedureResult
>('caseSessions:advanceProcedure')
const submitFilingRef = makeFunctionReference<
  'mutation',
  {
    caseSessionId: Id<'caseSessions'>
    draft: {
      eventId: string
      participantRole: 'appellant'
      title: string
      documents: UploadedDocument[]
      certificateOfService: boolean
      certificateOfCompliance: boolean
      sealed: boolean
      notes: string
    }
  },
  SubmitFilingResult
>('caseSessions:submitFiling')
const recordChunkRef = makeFunctionReference<
  'mutation',
  {
    intentId: Id<'documentUploadIntents'>
    index: number
    storageId: Id<'_storage'>
    sizeBytes: number
    sha256: string
  },
  { accepted: boolean }
>('documentUploads:recordChunk')
const expireRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  null
>('documentUploadActions:expireUpload')

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function textHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function makePdf(sizeBytes: number) {
  const bytes = new Uint8Array(sizeBytes)
  bytes.set(new TextEncoder().encode('%PDF-').subarray(0, sizeBytes))
  return bytes
}

function makeEmptyObjectArrayJson(sizeBytes: number) {
  if (!Number.isInteger((sizeBytes - 1) / 3)) {
    throw new Error('This fixture size must fit a flat array of empty objects.')
  }
  const objectCount = (sizeBytes - 1) / 3
  const bytes = new Uint8Array(sizeBytes)
  let offset = 0
  bytes[offset++] = 0x5b
  for (let index = 0; index < objectCount; index += 1) {
    bytes[offset++] = 0x7b
    bytes[offset++] = 0x7d
    if (index + 1 < objectCount) bytes[offset++] = 0x2c
  }
  bytes[offset] = 0x5d
  return bytes
}

async function measurePeakRss<T>(task: () => Promise<T>) {
  const sampler = new Worker(
    `const { parentPort } = require('node:worker_threads');
let peak = 0;
let timer;
parentPort.on('message', (command) => {
  if (command === 'start') {
    peak = process.memoryUsage().rss;
    timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 1);
    parentPort.postMessage({ baselineRssBytes: peak });
  } else if (command === 'stop') {
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    parentPort.postMessage({ peakRssBytes: peak });
  }
});`,
    { eval: true },
  )
  const nextMessage = <TMessage>() =>
    new Promise<TMessage>((resolve, reject) => {
      sampler.once('message', resolve)
      sampler.once('error', reject)
    })
  try {
    await new Promise<void>((resolve, reject) => {
      sampler.once('online', resolve)
      sampler.once('error', reject)
    })
    sampler.postMessage('start')
    const baseline = await nextMessage<{ baselineRssBytes: number }>()
    let value: T | undefined
    let failure: unknown
    try {
      value = await task()
    } catch (error) {
      failure = error
    }
    sampler.postMessage('stop')
    const peak = await nextMessage<{ peakRssBytes: number }>()
    if (failure !== undefined) throw failure
    return { value: value as T, ...baseline, ...peak }
  } finally {
    await sampler.terminate()
  }
}

function analysisFor(
  sizeBytes: number,
  mimeType = 'application/pdf',
): DocumentAnalysis {
  return {
    analyzerId: 'fixture-analyzer',
    fileSizeBytes: sizeBytes,
    mimeType,
    searchableText: true,
    certificateOfServiceDetected: false,
    certificateOfComplianceDetected: false,
    sealedOrRedactionWarning: false,
    warnings: [],
  }
}

function analysisRowPayload(
  analysis: DocumentAnalysis,
  caseSessionId: Id<'caseSessions'>,
) {
  const serializedAnalysis = JSON.stringify(analysis)
  return {
    caseSessionId,
    documentId: 'x'.repeat(128),
    analyzerId: analysis.analyzerId,
    ...(typeof analysis.pageCount === 'number'
      ? { pageCount: analysis.pageCount }
      : {}),
    fileSizeBytes: analysis.fileSizeBytes,
    mimeType: analysis.mimeType,
    searchableText: analysis.searchableText,
    certificateOfServiceDetected: analysis.certificateOfServiceDetected,
    certificateOfComplianceDetected: analysis.certificateOfComplianceDetected,
    sealedOrRedactionWarning: analysis.sealedOrRedactionWarning,
    warnings: [],
    analysisJson: serializedAnalysis,
    ...(analysis.normalizedText ? { extractedTextHash: '00000000' } : {}),
    ...(typeof analysis.wordCount === 'number'
      ? { wordCount: analysis.wordCount }
      : {}),
    ...(analysis.legalCitations
      ? { citationCount: analysis.legalCitations.length }
      : {}),
    ...(analysis.recordCitations
      ? { recordCitationCount: analysis.recordCitations.length }
      : {}),
    ...(analysis.appendixCitations
      ? { appendixCitationCount: analysis.appendixCitations.length }
      : {}),
    createdAt: '2000-01-01T00:00:00.000Z',
  }
}

function documentRowPayload(
  document: UploadedDocument,
  caseSessionId: Id<'caseSessions'>,
  storageId: Id<'_storage'>,
) {
  return {
    caseSessionId,
    storageId,
    analysisId: 'x'.repeat(128),
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
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
  }
}

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

async function expectErrorCode(promise: Promise<unknown>, code: AppErrorCode) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeDefined()
  expect((caught as { data?: AppErrorData }).data?.code).toBe(code)
}

async function seedFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const createdAt = new Date().toISOString()
    const aliceId = await ctx.db.insert('users', {
      authSubject: identity('alice').tokenIdentifier,
      displayName: 'Alice',
      monthlyAiBudgetCents: 0,
    })
    const bobId = await ctx.db.insert('users', {
      authSubject: identity('bob').tokenIdentifier,
      displayName: 'Bob',
      monthlyAiBudgetCents: 0,
    })
    const institutionId = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt,
      name: 'Fixture org',
      slug: 'fixture-org',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: aliceId,
      role: 'instructor',
      status: 'active',
      createdAt,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: bobId,
      role: 'learner',
      status: 'active',
      createdAt,
    })
    const scenarioId = await ctx.db.insert('scenarios', {
      scenarioKey: 'upload-fixture-scenario',
      visibility: 'public_template',
      revisionStatus: 'published',
      title: 'Upload fixture',
      source: 'synthetic',
      courtPackId: 'us-federal-ca4-civil-appeal',
      shortCaption: 'Fixture v. Test',
      lowerTribunal: 'Fixture court',
      natureOfSuit: 'civil',
      proceduralPosture: 'appeal',
      issuesPresented: [],
      meritsRecord: [],
      published: true,
    })
    const aliceSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
      scenarioId,
      userId: aliceId,
      courtPackId: 'us-federal-ca4-civil-appeal',
      status: 'active',
      simulatedDate: createdAt,
    })
    const bobSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
      scenarioId,
      userId: bobId,
      courtPackId: 'us-federal-ca4-civil-appeal',
      status: 'active',
      simulatedDate: createdAt,
    })
    const datasetId = await ctx.db.insert('organizationDatasets', {
      institutionId,
      createdByUserId: aliceId,
      title: 'Draft fixture',
      description: '',
      kind: 'source_data',
      createdAt,
      updatedAt: createdAt,
    })
    const versionId = await ctx.db.insert('organizationDatasetVersions', {
      datasetId,
      institutionId,
      version: 1,
      createdByUserId: aliceId,
      state: 'draft',
      title: 'Draft fixture',
      description: '',
      tags: [],
      draftRevision: 0,
      manifestJson: '{}',
      reviewStatus: 'unreviewed',
      createdAt,
    })
    return {
      aliceId,
      bobId,
      institutionId,
      aliceSessionId,
      bobSessionId,
      versionId,
    }
  })
}

function uploadClient(t: TestConvex<typeof schema>, subject = 'alice') {
  const client = t.withIdentity(identity(subject))
  return {
    begin: (args: BeginArgs) => client.mutation(beginRef, args),
    complete: (intentId: Id<'documentUploadIntents'>) =>
      client.action(completeRef, { intentId }),
    cancel: (intentId: Id<'documentUploadIntents'>) =>
      client.action(cancelRef, { intentId }),
    persist: (args: PersistArgs) => client.mutation(persistRef, args),
    mutation: client.mutation,
    action: client.action,
    query: client.query,
    fetch: client.fetch,
  }
}

async function postChunk(
  client: ReturnType<typeof uploadClient>,
  intentId: Id<'documentUploadIntents'>,
  index: number,
  bytes: Uint8Array,
) {
  return client.fetch(
    `/documents/chunk?intentId=${encodeURIComponent(intentId)}&index=${index}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ephemeral-test-token',
        Origin: appOrigin,
        'Content-Type': 'application/octet-stream',
      },
      body: new Blob([bytes.slice().buffer as ArrayBuffer]),
    },
  )
}

async function uploadBytes(
  client: ReturnType<typeof uploadClient>,
  intentId: Id<'documentUploadIntents'>,
  bytes: Uint8Array,
  order?: number[],
) {
  const chunks = Array.from(
    { length: Math.ceil(bytes.byteLength / chunkBytes) },
    (_, index) => index,
  )
  for (const index of order ?? chunks) {
    const start = index * chunkBytes
    const response = await postChunk(
      client,
      intentId,
      index,
      bytes.subarray(start, start + chunkBytes),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
  }
}

async function uploadReceiptDocument(
  alice: ReturnType<typeof uploadClient>,
  caseSessionId: Id<'caseSessions'>,
  extractedText: string,
) {
  const bytes = makePdf(128)
  const fileName = 'receipt-backed.pdf'
  const intent = await alice.begin({
    scope: { kind: 'session', caseSessionId },
    fileName,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    mimeType: 'application/pdf',
  })
  await uploadBytes(alice, intent.intentId, bytes)
  await alice.complete(intent.intentId)
  const persisted = await alice.persist({
    caseSessionId,
    intentId: intent.intentId,
    document: {
      id: 'client-receipt-document',
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      extractedText,
      extractedSignals: ['source document'],
    },
    analysis: {
      ...analysisFor(bytes.byteLength),
      normalizedText: extractedText,
    },
  })
  return { intent, persisted }
}

async function failNextUploadStorageDelete(
  t: TestConvex<typeof schema>,
  storageId: Id<'_storage'>,
) {
  return deleteOrRetryCleanup({
    objectExists: () =>
      t.run(async (ctx) =>
        Boolean(await ctx.db.system.get('_storage', storageId)),
      ),
    deleteObject: async () => {
      throw new Error('temporary storage outage')
    },
    markDeleted: async () => undefined,
    scheduleRetry: () =>
      t.mutation(retryUploadStorageCleanupRef, { storageId }),
  })
}

async function runQueuedUploadCleanup(t: TestConvex<typeof schema>) {
  const queued = await t.run((ctx) =>
    ctx.db.query('documentUploadCleanup').collect(),
  )
  for (const item of queued) {
    await t.action(cleanupUploadStorageRef, { storageId: item.storageId })
  }
}

beforeEach(() => {
  vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('document upload receipts', () => {
  it('uses an inclusive 12 MiB session document analysis read boundary', () => {
    expect(fitsSessionDocumentAnalysisReadBudget(0)).toBe(true)
    expect(
      fitsSessionDocumentAnalysisReadBudget(
        maxSessionDocumentAnalysisReadBytes - 1,
      ),
    ).toBe(true)
    expect(
      fitsSessionDocumentAnalysisReadBudget(
        maxSessionDocumentAnalysisReadBytes,
      ),
    ).toBe(true)
    expect(
      fitsSessionDocumentAnalysisReadBudget(
        maxSessionDocumentAnalysisReadBytes + 1,
      ),
    ).toBe(false)
  })

  it('keeps ten large receipt analyses readable, then fences concurrent consumption at the session budget', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const largeWarning = 'x'.repeat(850_000)
    const largeAnalysis: DocumentAnalysis = {
      ...analysisFor(bytes.byteLength),
      warnings: [largeWarning],
    }
    const pending: Array<{
      intentId: Id<'documentUploadIntents'>
      document: UploadedDocument
    }> = []
    for (let index = 0; index < 10; index += 1) {
      const fileName = `large-analysis-${index}.pdf`
      const intent = await alice.begin({
        scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
        fileName,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        mimeType: 'application/pdf',
      })
      await uploadBytes(alice, intent.intentId, bytes)
      await alice.complete(intent.intentId)
      pending.push({
        intentId: intent.intentId,
        document: {
        id: `client-${fileName}`,
        fileName,
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        extractedSignals: [],
        },
      })
    }
    for (const { intentId, document } of pending) {
      const persisted = await alice.persist({
        caseSessionId: fixture.aliceSessionId,
        intentId,
        document,
        analysis: largeAnalysis,
      })
      expect(persisted.document.id).toBeDefined()
    }

    const restoredSession = await alice.query(getSessionRef, {
      caseSessionId: fixture.aliceSessionId,
    })
    expect(restoredSession?.id).toBe(fixture.aliceSessionId)
    const tenRows = await t.run(async (ctx) => ({
      documents: await ctx.db
        .query('documents')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect(),
      analyses: await ctx.db
        .query('documentAnalyses')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect(),
    }))
    expect(tenRows.documents).toHaveLength(10)
    expect(
      tenRows.documents.every((document) => !document.validationJson),
    ).toBe(true)
    expect(tenRows.analyses).toHaveLength(10)
    expect(
      tenRows.analyses.every((analysis) => analysis.warnings.length === 0),
    ).toBe(true)
    expect(tenRows.analyses[0]?.analysisJson).toContain(largeWarning)
  })

  it('accounts legacy rows and serializes concurrent receipt consumption against the session budget', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const largeWarning = 'x'.repeat(850_000)
    const largeAnalysis: DocumentAnalysis = {
      ...analysisFor(bytes.byteLength),
      warnings: [largeWarning],
    }
    // Existing pre-receipt legacy document rows consume the same per-session
    // budget even though they have not yet been rewritten through replaceSessionState.
    const legacyWarning = 'x'.repeat(457_000)
    const legacyAnalysis: DocumentAnalysis = {
      ...analysisFor(bytes.byteLength),
      warnings: [legacyWarning],
    }
    const legacyAnalysisJson = JSON.stringify(legacyAnalysis)
    expect(
      serializedBytes(analysisRowPayload(legacyAnalysis, fixture.aliceSessionId)),
    ).toBeLessThanOrEqual(960 * 1024)
    await t.run(async (ctx) => {
      for (let index = 0; index < 8; index += 1) {
        const documentId = await ctx.db.insert('documents', {
          caseSessionId: fixture.aliceSessionId,
          fileName: `legacy-${index}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: bytes.byteLength,
          extractedSignals: [],
          validationJson: legacyAnalysisJson,
        })
        const analysisId = await ctx.db.insert('documentAnalyses', {
          caseSessionId: fixture.aliceSessionId,
          documentId,
          analyzerId: legacyAnalysis.analyzerId,
          fileSizeBytes: legacyAnalysis.fileSizeBytes,
          mimeType: legacyAnalysis.mimeType,
          searchableText: legacyAnalysis.searchableText,
          certificateOfServiceDetected:
            legacyAnalysis.certificateOfServiceDetected,
          certificateOfComplianceDetected:
            legacyAnalysis.certificateOfComplianceDetected,
          sealedOrRedactionWarning: legacyAnalysis.sealedOrRedactionWarning,
          warnings: legacyAnalysis.warnings,
          analysisJson: legacyAnalysisJson,
          createdAt: new Date().toISOString(),
        })
        await ctx.db.patch(documentId, { analysisId })
      }
    })
    const legacyBytes = await t.run(async (ctx) => {
      const documents = await ctx.db
        .query('documents')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect()
      const analyses = await ctx.db
        .query('documentAnalyses')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect()
      return documents
        .filter((document) => document.validationJson === legacyAnalysisJson)
        .reduce(
          (sum, document) =>
            sum + new TextEncoder().encode(JSON.stringify(document)).byteLength,
          0,
        ) + analyses
        .filter((analysis) => analysis.analysisJson === legacyAnalysisJson)
        .reduce(
          (sum, analysis) =>
            sum + new TextEncoder().encode(JSON.stringify(analysis)).byteLength,
          0,
        )
    })
    expect(legacyBytes).toBeGreaterThan(10 * 1024 * 1024)
    expect(legacyBytes).toBeLessThan(maxSessionDocumentAnalysisReadBytes)

    const concurrentReceipts = await Promise.all(
      [0, 1].map(async (index) => {
        const fileName = `budget-race-${index}.pdf`
        const intent = await alice.begin({
          scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
          fileName,
          sizeBytes: bytes.byteLength,
          sha256: sha256(bytes),
          mimeType: 'application/pdf',
        })
        await uploadBytes(alice, intent.intentId, bytes)
        await alice.complete(intent.intentId)
        return {
          intentId: intent.intentId,
          document: {
            id: `client-${fileName}`,
            fileName,
            mimeType: 'application/pdf',
            sizeBytes: bytes.byteLength,
            sha256: sha256(bytes),
            extractedSignals: [],
          } satisfies UploadedDocument,
        }
      }),
    )
    const consumed = await Promise.allSettled(
      concurrentReceipts.map(({ intentId, document }) =>
        alice.persist({
          caseSessionId: fixture.aliceSessionId,
          intentId,
          document,
          analysis: largeAnalysis,
        }),
      ),
    )
    expect(
      consumed.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      consumed.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const states = await t.run(async (ctx) =>
      Promise.all(
        concurrentReceipts.map(
          async ({ intentId }) => (await ctx.db.get(intentId))?.state,
        ),
      ),
    )
    expect(states.filter((state) => state === 'consumed')).toHaveLength(1)
    expect(states.filter((state) => state === 'stored')).toHaveLength(1)

    const successfulIndex = consumed.findIndex(
      (result) => result.status === 'fulfilled',
    )
    const successfulReceipt = concurrentReceipts[successfulIndex]!
    const successfulResult = (
      consumed[successfulIndex] as PromiseFulfilledResult<PersistResult>
    ).value
    const idempotentRetry = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: successfulReceipt.intentId,
      document: successfulReceipt.document,
      analysis: largeAnalysis,
    })
    expect(idempotentRetry.document.id).toBe(successfulResult.document.id)
    expect(idempotentRetry.analysisId).toBe(successfulResult.analysisId)

    // The state replacement removes unreachable legacy rows and preserves the
    // consumed receipt rows, then checks the post-replacement read shape.
    await alice.mutation(submitFilingRef, {
      caseSessionId: fixture.aliceSessionId,
      draft: {
        eventId: 'notice_of_appeal',
        participantRole: 'appellant',
        title: 'Notice of Appeal',
        documents: [],
        certificateOfService: true,
        certificateOfCompliance: true,
        sealed: false,
        notes: 'Fixture replacement pass',
      },
    })
    const replacedRows = await t.run(async (ctx) => ({
      legacy: await ctx.db
        .query('documents')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .filter((query) => query.eq(query.field('fileName'), 'legacy-0.pdf'))
        .collect(),
      analyses: await ctx.db
        .query('documentAnalyses')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect(),
    }))
    expect(replacedRows.legacy).toHaveLength(0)
    expect(replacedRows.analyses).toHaveLength(1)
    expect(
      replacedRows.analyses.every((analysis) => analysis.analysisJson),
    ).toBe(true)
  })

  it('accepts a seven-chunk 25 MiB upload through the authenticated route and Node action, then consumes it exactly once', async () => {
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(maxFileBytes)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'maximum.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    expect(intent.chunkBytes).toBe(chunkBytes)
    expect(new Date(intent.expiresAt).getTime()).toBeGreaterThan(Date.now())

    await uploadBytes(alice, intent.intentId, bytes, [5, 1, 6, 0, 4, 2, 3])
    const duplicate = await postChunk(
      alice,
      intent.intentId,
      3,
      bytes.subarray(3 * chunkBytes, 4 * chunkBytes),
    )
    expect(duplicate.status).toBe(200)
    const conflicting = await postChunk(
      alice,
      intent.intentId,
      3,
      makePdf(chunkBytes),
    )
    expect(conflicting.status).toBe(409)
    expect(conflicting.headers.get('Cache-Control')).toBe('no-store')

    const measuredCompletion = await measurePeakRss(() =>
      alice.complete(intent.intentId),
    )
    const completed = measuredCompletion.value
    expect(completed).toEqual({
      intentId: intent.intentId,
      sizeBytes: maxFileBytes,
      sha256: sha256(bytes),
    })
    expect(completed).not.toHaveProperty('storageId')
    expect(
      measuredCompletion.peakRssBytes - measuredCompletion.baselineRssBytes,
    ).toBeLessThan(256 * 1024 * 1024)
    console.info(
      `[upload-memory] 25 MiB PDF complete: baseline ${(measuredCompletion.baselineRssBytes / 1024 / 1024).toFixed(1)} MiB, peak ${(measuredCompletion.peakRssBytes / 1024 / 1024).toFixed(1)} MiB RSS`,
    )
    await t.finishInProgressScheduledFunctions()

    const rawStorage = 'caller-supplied-storage-id'
    const document: UploadedDocument = {
      id: 'untrusted-client-id',
      fileName: 'maximum.pdf',
      mimeType: 'application/pdf',
      sizeBytes: maxFileBytes,
      storageId: rawStorage,
      sha256: sha256(bytes),
      extractedSignals: [],
    }
    const analysis = analysisFor(maxFileBytes)
    await expectErrorCode(
      alice.persist({
        caseSessionId: fixture.aliceSessionId,
        intentId: intent.intentId,
        document,
        analysis,
      }),
      AppErrorCode.VALIDATION_ERROR,
    )
    const acceptedDocument: UploadedDocument = {
      id: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      extractedSignals: document.extractedSignals,
    }
    const first = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document: acceptedDocument,
      analysis,
    })
    const retry = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document: acceptedDocument,
      analysis,
    })
    expect(retry.document.id).toBe(first.document.id)
    expect(retry.analysisId).toBe(first.analysisId)
    expect(first.document.storageId).toBeUndefined()
    expect(retry.document.storageId).toBeUndefined()
    await t.action(expireRef, { intentId: intent.intentId })

    const saved = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      documents: await ctx.db.query('documents').collect(),
      analyses: await ctx.db.query('documentAnalyses').collect(),
      storedFileSize: (
        await ctx.storage.get((await ctx.db.get(intent.intentId))!.storageId!)
      )?.size,
      chunks: await ctx.db.query('documentUploadChunks').collect(),
    }))
    expect(saved.intent?.state).toBe('consumed')
    expect(saved.intent?.documentId).toBe(first.document.id)
    expect(saved.intent?.analysisId).toBe(first.analysisId)
    expect(saved.documents).toHaveLength(1)
    expect(saved.analyses).toHaveLength(1)
    expect(saved.storedFileSize).toBe(maxFileBytes)
    expect(saved.chunks).toHaveLength(0)
  })

  it('allows only one active assembly and returns the same receipt on retry', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'singleflight.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const chunkIds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('documentUploadChunks')
          .withIndex('by_intent_index', (index) =>
            index.eq('intentId', intent.intentId),
          )
          .collect()
      ).map((chunk) => chunk.storageId),
    )

    let releaseFirstRead = () => {}
    let signalFirstRead = () => {}
    const readEntered = new Promise<void>((resolve) => {
      signalFirstRead = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const originalArrayBuffer = Blob.prototype.arrayBuffer
    let isFirstRead = true
    const arrayBufferSpy = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockImplementation(async function (this: Blob) {
        if (isFirstRead) {
          isFirstRead = false
          signalFirstRead()
          await readGate
        }
        return originalArrayBuffer.call(this)
      })

    const activeCompletion = alice.complete(intent.intentId)
    try {
      await readEntered
      const concurrent = await Promise.allSettled(
        Array.from({ length: 8 }, () => alice.complete(intent.intentId)),
      )
      expect(concurrent).toHaveLength(8)
      expect(
        concurrent.every((result) => {
          if (result.status !== 'rejected') return false
          const data = (result.reason as { data?: AppErrorData }).data
          return (
            data?.code === AppErrorCode.CONFLICT &&
            data.metadata?.reason === 'UPLOAD_COMPLETION_BUSY' &&
            data.metadata?.retryable === true &&
            data.metadata?.retryAfterMs === 1000
          )
        }),
      ).toBe(true)
      expect(arrayBufferSpy).toHaveBeenCalledTimes(1)
    } finally {
      releaseFirstRead()
      arrayBufferSpy.mockRestore()
    }

    const completed = await activeCompletion
    expect(completed).toEqual({
      intentId: intent.intentId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    expect(await alice.complete(intent.intentId)).toEqual(completed)
    const saved = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      storageIds: (await ctx.db.system.query('_storage').collect()).map(
        (item) => item._id,
      ),
    }))
    expect(saved.intent?.state).toBe('stored')
    expect(saved.intent?.completionClaimToken).toBeUndefined()
    expect(saved.intent?.completionClaimExpiresAt).toBeUndefined()
    expect(saved.storageIds).toHaveLength(chunkIds.length + 1)
    expect(saved.storageIds).toContain(saved.intent?.storageId)
    expect(saved.storageIds).toEqual(expect.arrayContaining(chunkIds))
  })

  it('releases a known-failed completion claim so the receipt can be retried', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'retry-completion.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })

    await expectErrorCode(
      alice.complete(intent.intentId),
      AppErrorCode.CONFLICT,
    )
    const afterFailure = await t.run((ctx) => ctx.db.get(intent.intentId))
    expect(afterFailure?.state).toBe('pending')
    expect(afterFailure?.completionClaimToken).toBeUndefined()
    expect(afterFailure?.completionClaimExpiresAt).toBeUndefined()

    await uploadBytes(alice, intent.intentId, bytes)
    const completed = await alice.complete(intent.intentId)
    expect(completed.sha256).toBe(sha256(bytes))
    expect(await alice.complete(intent.intentId)).toEqual(completed)
  })

  it('takes over a stale claim and queues only the stale worker blob', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'claim-takeover.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const staleToken = randomUUID()
    expect(
      await alice.mutation(claimCompletionRef, {
        intentId: intent.intentId,
        claimToken: staleToken,
      }),
    ).toEqual({ state: 'claimed' })
    const firstClaim = await t.run((ctx) => ctx.db.get(intent.intentId))
    expect(firstClaim?.completionClaimExpiresAt).toBeDefined()
    expect(Date.parse(firstClaim!.completionClaimExpiresAt!)).toBeLessThan(
      Date.parse(intent.expiresAt),
    )

    vi.setSystemTime(Date.parse(firstClaim!.completionClaimExpiresAt!) + 1)
    expect(Date.now()).toBeLessThan(Date.parse(intent.expiresAt))
    const winnerToken = randomUUID()
    expect(
      await alice.mutation(claimCompletionRef, {
        intentId: intent.intentId,
        claimToken: winnerToken,
      }),
    ).toEqual({ state: 'claimed' })
    await alice.mutation(releaseCompletionClaimRef, {
      intentId: intent.intentId,
      claimToken: staleToken,
    })
    expect(
      (await t.run((ctx) => ctx.db.get(intent.intentId)))?.completionClaimToken,
    ).toBe(winnerToken)

    const staleStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
      ),
    )
    const winnerStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
      ),
    )
    const staleFinalization = await alice.mutation(finalizeCompletionRef, {
      intentId: intent.intentId,
      claimToken: staleToken,
      storageId: staleStorageId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    expect(staleFinalization.stale).toBe(true)
    const afterStaleFinalization = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      cleanup: await ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', staleStorageId),
        )
        .unique(),
    }))
    expect(afterStaleFinalization.intent?.state).toBe('pending')
    expect(afterStaleFinalization.intent?.completionClaimToken).toBe(
      winnerToken,
    )
    expect(afterStaleFinalization.cleanup).not.toBeNull()

    const winner = await alice.mutation(finalizeCompletionRef, {
      intentId: intent.intentId,
      claimToken: winnerToken,
      storageId: winnerStorageId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    expect(winner.accepted).toBe(true)
    expect(winner.storageId).toBe(winnerStorageId)
    await t.action(cleanupUploadStorageRef, { storageId: staleStorageId })
    const afterCleanup = await t.run(async (ctx) => ({
      receipt: await ctx.db.get(intent.intentId),
      stale: await ctx.db.system.get('_storage', staleStorageId),
      winner: await ctx.db.system.get('_storage', winnerStorageId),
      cleanupWinner: await ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', winnerStorageId),
        )
        .unique(),
    }))
    expect(afterCleanup.receipt?.storageId).toBe(winnerStorageId)
    expect(afterCleanup.receipt?.completionClaimToken).toBeUndefined()
    expect(afterCleanup.stale).toBeNull()
    expect(afterCleanup.winner).not.toBeNull()
    expect(afterCleanup.cleanupWinner).toBeNull()
    const retried = await alice.complete(intent.intentId)
    expect(retried.sha256).toBe(sha256(bytes))
    expect(retried.sizeBytes).toBe(bytes.byteLength)
  })

  it('rejects one byte over the file cap, old raw endpoint calls, anonymous chunks, and foreign receipts', async () => {
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bob = uploadClient(t, 'bob')
    const overSize = makePdf(1)
    await expectErrorCode(
      alice.begin({
        scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
        fileName: 'large.pdf',
        sizeBytes: maxFileBytes + 1,
        sha256: sha256(overSize),
        mimeType: 'application/pdf',
      }),
      AppErrorCode.VALIDATION_ERROR,
    )
    await expectErrorCode(
      t
        .withIdentity(identity('alice'))
        .mutation(
          makeFunctionReference<
            'mutation',
            { caseSessionId: Id<'caseSessions'> },
            string
          >('caseSessions:generateDocumentUploadUrl'),
          { caseSessionId: fixture.aliceSessionId },
        ),
      AppErrorCode.VALIDATION_ERROR,
    )

    const anonymous = convexTest(schema, modules)
    const denied = await anonymous.fetch(
      '/documents/chunk?intentId=missing&index=0',
      {
        method: 'POST',
        headers: {
          Origin: appOrigin,
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([new Uint8Array([1]).buffer as ArrayBuffer]),
      },
    )
    expect(denied.status).toBe(401)
    expect(denied.headers.get('Cache-Control')).toBe('no-store')
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
    const disallowedOrigin = await alice.fetch(
      '/documents/chunk?intentId=missing&index=0',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-test-token',
          Origin: 'https://attacker.example.test',
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([new Uint8Array([1]).buffer as ArrayBuffer]),
      },
    )
    expect(disallowedOrigin.status).toBe(403)
    expect(disallowedOrigin.headers.get('Cache-Control')).toBe('no-store')

    const bytes = makePdf(12)
    const bobIntent = await bob.begin({
      scope: { kind: 'session', caseSessionId: fixture.bobSessionId },
      fileName: 'foreign.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await expectErrorCode(
      alice.complete(bobIntent.intentId),
      AppErrorCode.NOT_FOUND,
    )
    await expectErrorCode(
      alice.cancel(bobIntent.intentId),
      AppErrorCode.NOT_FOUND,
    )
    const foreignChunk = await alice.fetch(
      `/documents/chunk?intentId=${encodeURIComponent(bobIntent.intentId)}&index=0`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-test-token',
          Origin: appOrigin,
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([bytes.buffer as ArrayBuffer]),
      },
    )
    expect(foreignChunk.status).toBe(404)
    expect(foreignChunk.headers.get('Cache-Control')).toBe('no-store')
    const foreign = await t.run(async (ctx) => ctx.db.get(bobIntent.intentId))
    expect(foreign?.state).toBe('pending')
  })

  it('returns an authentication status for an uninitialized identity on the registered chunk route', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const uninitialized = uploadClient(t, 'uninitialized-user')
    const bytes = makePdf(12)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'uninitialized-caller.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })

    const response = await uninitialized.fetch(
      `/documents/chunk?intentId=${encodeURIComponent(intent.intentId)}&index=0`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-test-token',
          Origin: appOrigin,
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([bytes.buffer as ArrayBuffer]),
      },
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
    const saved = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      chunks: await ctx.db.query('documentUploadChunks').collect(),
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(saved.intent?.state).toBe('pending')
    expect(saved.chunks).toHaveLength(0)
    expect(saved.storage).toHaveLength(0)
  })

  it('returns validation status for malformed intent IDs on the registered chunk route', async () => {
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
    const t = convexTest(schema, modules)
    const alice = uploadClient(t)
    const bytes = makePdf(12)

    const response = await alice.fetch(
      '/documents/chunk?intentId=not-a-convex-id&index=0',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-test-token',
          Origin: appOrigin,
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([bytes.buffer as ArrayBuffer]),
      },
    )

    expect(response.status).toBe(422)
    const saved = await t.run(async (ctx) => ({
      chunks: await ctx.db.query('documentUploadChunks').collect(),
      cleanup: await ctx.db.query('documentUploadCleanup').collect(),
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(saved.chunks).toHaveLength(0)
    expect(saved.cleanup).toHaveLength(0)
    expect(saved.storage).toHaveLength(0)
  })

  it('avoids storing accepted identical chunk retries and cleans a concurrent loser', async () => {
    vi.useFakeTimers()
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'duplicate-chunk.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })

    const first = await postChunk(alice, intent.intentId, 0, bytes)
    const acceptedChunk = await t.run(async (ctx) =>
      ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .unique(),
    )
    expect(acceptedChunk).not.toBeNull()
    expect(
      await t.run((ctx) => ctx.db.system.query('_storage').collect()),
    ).toHaveLength(1)
    expect(
      await t.mutation(queueUploadCleanupRef, {
        storageIds: [acceptedChunk!.storageId],
      }),
    ).toEqual([])
    const retry = await postChunk(alice, intent.intentId, 0, bytes)
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(
      await t.run((ctx) => ctx.db.system.query('_storage').collect()),
    ).toHaveLength(1)

    const differentBytes = bytes.slice()
    differentBytes[0] = 1
    const conflictingRetry = await postChunk(
      alice,
      intent.intentId,
      0,
      differentBytes,
    )
    expect(conflictingRetry.status).toBe(409)
    expect(
      await t.run((ctx) => ctx.db.system.query('_storage').collect()),
    ).toHaveLength(1)

    // Model two requests which both authorized before either recorded the
    // index: recordChunk remains the final race check and the loser is cleaned.
    const concurrentLoserStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes], { type: 'application/octet-stream' }),
      ),
    )
    expect(
      await alice.mutation(recordChunkRef, {
        intentId: intent.intentId,
        index: 0,
        storageId: concurrentLoserStorageId,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      }),
    ).toEqual({ accepted: false })
    await t.mutation(queueUploadCleanupRef, {
      storageIds: [concurrentLoserStorageId],
    })

    const queued = await t.run(async (ctx) =>
      ctx.db.query('documentUploadCleanup').collect(),
    )
    expect(queued).toHaveLength(1)
    let failDelete = true
    const cleanupAttempt = await deleteOrRetryCleanup({
      objectExists: () =>
        t.run(async (ctx) =>
          Boolean(await ctx.db.system.get('_storage', queued[0]!.storageId)),
        ),
      deleteObject: async () => {
        if (failDelete) {
          failDelete = false
          throw new Error('temporary storage outage')
        }
        await t.run((ctx) => ctx.storage.delete(queued[0]!.storageId))
      },
      markDeleted: async () => undefined,
      scheduleRetry: () =>
        t.mutation(retryUploadStorageCleanupRef, {
          storageId: queued[0]!.storageId,
        }),
    })
    expect(cleanupAttempt).toBe('retry')
    const retained = await t.run(async (ctx) => ({
      cleanup: await ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', queued[0]!.storageId),
        )
        .unique(),
      tempStorage: await ctx.db.system.get('_storage', queued[0]!.storageId),
    }))
    expect(retained.cleanup?.attempts).toBe(1)
    expect(retained.tempStorage).not.toBeNull()
    await t.run(async (ctx) => {
      await ctx.db.patch(retained.cleanup!._id, {
        nextAttemptAt: Date.now() - 1,
      })
    })
    await t.action(cleanupUploadStorageRef, {
      storageId: queued[0]!.storageId,
    })

    const saved = await t.run(async (ctx) => ({
      chunks: await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .collect(),
      cleanup: await ctx.db.query('documentUploadCleanup').collect(),
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(saved.chunks).toHaveLength(1)
    expect(saved.cleanup).toHaveLength(0)
    expect(saved.storage).toHaveLength(1)
    expect(saved.storage[0]?._id).toBe(saved.chunks[0]?.storageId)
    await vi.advanceTimersByTimeAsync(0)
    await t.finishInProgressScheduledFunctions()
  })

  it('validates 25 MiB adversarial JSON in the Node action without a parsed object tree', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makeEmptyObjectArrayJson(maxFileBytes)
    const intent = await alice.begin({
      scope: { kind: 'dataset', versionId: fixture.versionId },
      fileName: 'many-empty-objects.json',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/json',
    })
    await uploadBytes(alice, intent.intentId, bytes)

    const measuredCompletion = await measurePeakRss(() =>
      alice.complete(intent.intentId),
    )
    expect(measuredCompletion.value).toEqual({
      intentId: intent.intentId,
      sizeBytes: maxFileBytes,
      sha256: sha256(bytes),
    })
    expect(
      measuredCompletion.peakRssBytes - measuredCompletion.baselineRssBytes,
    ).toBeLessThan(256 * 1024 * 1024)
    console.info(
      `[upload-memory] 25 MiB empty-object JSON complete: baseline ${(measuredCompletion.baselineRssBytes / 1024 / 1024).toFixed(1)} MiB, peak ${(measuredCompletion.peakRssBytes / 1024 / 1024).toFixed(1)} MiB RSS`,
    )
    const stored = await t.run(async (ctx) => {
      const receipt = await ctx.db.get(intent.intentId)
      return {
        state: receipt?.state,
        storageSize: receipt?.storageId
          ? (await ctx.storage.get(receipt.storageId))?.size
          : undefined,
      }
    })
    expect(stored).toEqual({ state: 'stored', storageSize: maxFileBytes })
  })

  it('uses the shared organization contract for dataset drafts and locks session scopes', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bob = uploadClient(t, 'bob')
    const data = new TextEncoder().encode('{"fixture":true}')
    const datasetIntent = await alice.begin({
      scope: { kind: 'dataset', versionId: fixture.versionId },
      fileName: 'draft.json',
      sizeBytes: data.byteLength,
      sha256: sha256(data),
      mimeType: 'application/json',
    })
    expect(datasetIntent.chunkBytes).toBe(chunkBytes)
    await expectErrorCode(
      bob.begin({
        scope: { kind: 'dataset', versionId: fixture.versionId },
        fileName: 'draft.json',
        sizeBytes: data.byteLength,
        sha256: sha256(data),
        mimeType: 'application/json',
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    )

    await t.run(async (ctx) => {
      const createdAt = new Date().toISOString()
      const cohortId = await ctx.db.insert('cohorts', {
        institutionId: fixture.institutionId,
        title: 'Locked fixture',
        term: 'test',
        startsAt: createdAt,
        endsAt: createdAt,
        archived: false,
      })
      const scenarioId = (await ctx.db.query('caseSessions').first())!
        .scenarioId
      const assignmentId = await ctx.db.insert('assignments', {
        cohortId,
        scenarioId,
        title: 'Locked assignment',
        published: true,
        createdByUserId: fixture.aliceId,
        createdAt,
      })
      await ctx.db.insert('assignmentSessions', {
        assignmentId,
        caseSessionId: fixture.aliceSessionId,
        userId: fixture.aliceId,
        submittedAt: createdAt,
      })
    })
    await expectErrorCode(
      alice.begin({
        scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
        fileName: 'locked.pdf',
        sizeBytes: 5,
        sha256: sha256(new TextEncoder().encode('%PDF-')),
        mimeType: 'application/pdf',
      }),
      AppErrorCode.SESSION_LOCKED,
    )
    const intents = await t.run(async (ctx) =>
      ctx.db.query('documentUploadIntents').collect(),
    )
    expect(intents).toHaveLength(1)
    expect(intents[0]?.scopeKind).toBe('dataset')
  })

  it('cleans a request-owned chunk when organization authorization is revoked after storage.store', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(8)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'revoked.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    const temporaryId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes], { type: 'application/octet-stream' }),
      ),
    )
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query('institutionMemberships')
        .withIndex('by_institution_user', (index) =>
          index
            .eq('institutionId', fixture.institutionId)
            .eq('userId', fixture.aliceId),
        )
        .unique()
      await ctx.db.patch(membership!._id, { status: 'suspended' })
    })
    await expectErrorCode(
      alice.mutation(recordChunkRef, {
        intentId: intent.intentId,
        index: 0,
        storageId: temporaryId,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      }),
      AppErrorCode.NOT_FOUND,
    )
    await t.run((ctx) => ctx.storage.delete(temporaryId))
    const after = await t.run(async (ctx) => ({
      chunks: await ctx.db.query('documentUploadChunks').collect(),
      stored: await ctx.db.system.get('_storage', temporaryId),
      documents: await ctx.db.query('documents').collect(),
    }))
    expect(after.chunks).toHaveLength(0)
    expect(after.stored).toBeNull()
    expect(after.documents).toHaveLength(0)
  })

  it('cancellation and expired cleanup do not remove a consumed final document', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'retained.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await alice.complete(intent.intentId)
    const document = {
      id: 'fixture-document',
      fileName: 'retained.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      extractedSignals: [],
    } satisfies UploadedDocument
    const persisted = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document,
      analysis: analysisFor(bytes.byteLength),
    })
    await expectErrorCode(alice.cancel(intent.intentId), AppErrorCode.CONFLICT)
    await t.withIdentity(identity('alice')).run(async (ctx) => {
      await ctx.db.patch(intent.intentId, {
        expiresAt: new Date(Date.now() - 1).toISOString(),
      })
    })
    await t.action(expireRef, { intentId: intent.intentId })
    const retained = await t.run(async (ctx) => {
      const receipt = await ctx.db.get(intent.intentId)
      const document = await ctx.db.get(
        persisted.document.id as Id<'documents'>,
      )
      return {
        receipt,
        document,
        storedSize: receipt?.storageId
          ? (await ctx.storage.get(receipt.storageId))?.size
          : undefined,
      }
    })
    expect(retained.receipt?.state).toBe('consumed')
    expect(retained.document?._id).toBe(persisted.document.id)
    expect(retained.storedSize).toBe(bytes.byteLength)
  })

  it('preserves consumed document and analysis IDs, actor sources, and storage through a procedure transition and retry', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'transition.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await alice.complete(intent.intentId)
    const document: UploadedDocument = {
      id: 'client-document-id',
      fileName: 'transition.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      extractedSignals: [],
    }
    const analysis = analysisFor(bytes.byteLength)
    const persisted = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document,
      analysis,
    })
    const storageId = await t.run(async (ctx) => {
      const receipt = await ctx.db.get(intent.intentId)
      await ctx.db.insert('actorWorkProducts', {
        caseSessionId: fixture.aliceSessionId,
        actorId: 'fixture-actor',
        kind: 'counterparty_filing_draft',
        status: 'proposed',
        reviewStatus: 'proposed',
        workProductJson: JSON.stringify({
          eventId: 'notice_of_appeal',
          participantRole: 'appellant',
          title: 'Notice of Appeal',
          documentFileName: 'notice-of-appeal.pdf',
          documentText: 'Notice of appeal',
          certificateOfService: true,
          certificateOfCompliance: true,
          sealed: false,
          notes: '',
          citations: [
            {
              id: 'source-1',
              label: 'Uploaded document analysis',
              sourceType: 'document_analysis',
              sourceId: persisted.analysisId,
            },
          ],
          ruleRefs: [],
        }),
        sourceDocumentAnalysisIds: [persisted.analysisId],
        sourceFilingIds: [],
        createdAt: new Date().toISOString(),
      })
      return receipt!.storageId!
    })

    await alice.mutation(advanceProcedureRef, {
      caseSessionId: fixture.aliceSessionId,
    })
    const retry = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document,
      analysis,
    })
    await t.finishInProgressScheduledFunctions()

    const saved = await t.run(async (ctx) => {
      const receipt = await ctx.db.get(intent.intentId)
      const documentRecord = await ctx.db.get(
        persisted.document.id as Id<'documents'>,
      )
      const analysisRecord = await ctx.db.get(
        persisted.analysisId as Id<'documentAnalyses'>,
      )
      const product = await ctx.db
        .query('actorWorkProducts')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .unique()
      return {
        receipt,
        documentRecord,
        analysisRecord,
        product,
        documentCount: (
          await ctx.db
            .query('documents')
            .withIndex('by_case', (index) =>
              index.eq('caseSessionId', fixture.aliceSessionId),
            )
            .collect()
        ).length,
        storageSize: (await ctx.storage.get(storageId))?.size,
      }
    })
    expect(retry.document.id).toBe(persisted.document.id)
    expect(retry.analysisId).toBe(persisted.analysisId)
    expect(saved.receipt?.state).toBe('consumed')
    expect(saved.receipt?.storageId).toBe(storageId)
    expect(saved.receipt?.documentId).toBe(persisted.document.id)
    expect(saved.receipt?.analysisId).toBe(persisted.analysisId)
    expect(saved.documentRecord?._id).toBe(persisted.document.id)
    expect(saved.documentRecord?.analysisId).toBe(persisted.analysisId)
    expect(saved.analysisRecord?.documentId).toBe(persisted.document.id)
    expect(saved.documentCount).toBe(1)
    expect(saved.product?.sourceDocumentAnalysisIds).toEqual([
      persisted.analysisId,
    ])
    expect(
      JSON.parse(saved.product!.workProductJson).citations[0].sourceId,
    ).toBe(persisted.analysisId)
    expect(saved.storageSize).toBe(bytes.byteLength)
  })

  it('keeps an attached receipt-backed document across filing, procedure transition, and retry', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'notice-of-appeal.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await alice.complete(intent.intentId)
    const analysis = analysisFor(bytes.byteLength)
    const persisted = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document: {
        id: 'client-notice-id',
        fileName: 'notice-of-appeal.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        pageCount: 1,
        extractedText: 'Notice of appeal from a final civil judgment.',
        extractedSignals: ['notice of appeal'],
      },
      analysis: { ...analysis, pageCount: 1 },
    })
    expect(persisted.document.storageId).toBeUndefined()
    const receiptStorageId = await t.run(
      async (ctx) => (await ctx.db.get(intent.intentId))!.storageId!,
    )

    const filed = await alice.mutation(submitFilingRef, {
      caseSessionId: fixture.aliceSessionId,
      draft: {
        eventId: 'notice_of_appeal',
        participantRole: 'appellant',
        title: 'Notice of Appeal',
        documents: [persisted.document],
        certificateOfService: true,
        certificateOfCompliance: true,
        sealed: false,
        notes: 'Synthetic fixture filing',
      },
    })
    expect(filed.filings.at(-1)?.outcome).not.toBe('rejected')
    expect(filed.filings.at(-1)?.documents[0]?.id).toBe(persisted.document.id)
    await alice.mutation(advanceProcedureRef, {
      caseSessionId: fixture.aliceSessionId,
    })
    const retry = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document: persisted.document,
      analysis: persisted.document.analysis!,
    })
    await t.finishInProgressScheduledFunctions()

    const saved = await t.run(async (ctx) => {
      const receipt = await ctx.db.get(intent.intentId)
      const filings = await ctx.db
        .query('filings')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect()
      const documentRecord = await ctx.db.get(
        persisted.document.id as Id<'documents'>,
      )
      const analysisRecord = await ctx.db.get(
        persisted.analysisId as Id<'documentAnalyses'>,
      )
      return {
        receipt,
        filings,
        documentRecord,
        analysisRecord,
        storageSize: (await ctx.storage.get(receiptStorageId))?.size,
        documentCount: (
          await ctx.db
            .query('documents')
            .withIndex('by_case', (index) =>
              index.eq('caseSessionId', fixture.aliceSessionId),
            )
            .collect()
        ).length,
      }
    })
    expect(retry.document.id).toBe(persisted.document.id)
    expect(retry.analysisId).toBe(persisted.analysisId)
    expect(saved.filings).toHaveLength(1)
    expect(saved.filings[0]?.documentIds).toEqual([persisted.document.id])
    expect(saved.filings[0]?.documentAnalysisIds).toEqual([
      persisted.analysisId,
    ])
    expect(saved.receipt?.storageId).toBe(receiptStorageId)
    expect(saved.documentRecord?._id).toBe(persisted.document.id)
    expect(saved.documentRecord?.analysisId).toBe(persisted.analysisId)
    expect(saved.analysisRecord?.documentId).toBe(persisted.document.id)
    expect(saved.documentCount).toBe(1)
    expect(saved.storageSize).toBe(bytes.byteLength)
  })

  it('binds legacy filing validation to persisted receipt analysis despite altered client fields', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'legacy-bound.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await alice.complete(intent.intentId)
    const storedAnalysis: DocumentAnalysis = {
      ...analysisFor(bytes.byteLength),
      pageCount: 1,
      warnings: ['Persisted analysis warning.'],
    }
    const persisted = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: intent.intentId,
      document: {
        id: 'client-legacy-bound',
        fileName: 'legacy-bound.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        pageCount: 1,
        extractedSignals: ['notice of appeal'],
      },
      analysis: storedAnalysis,
    })
    const forgedDocument: UploadedDocument = {
      ...persisted.document,
      pageCount: 501,
      extractedSignals: ['forged filing signal'],
      analysis: {
        ...storedAnalysis,
        pageCount: 501,
        fileSizeBytes: 1,
        mimeType: 'text/plain',
        warnings: ['forged analysis'],
      },
    }

    const filed = await alice.mutation(submitFilingRef, {
      caseSessionId: fixture.aliceSessionId,
      draft: {
        eventId: 'notice_of_appeal',
        participantRole: 'appellant',
        title: 'Notice of Appeal',
        documents: [forgedDocument],
        certificateOfService: true,
        certificateOfCompliance: true,
        sealed: false,
        notes: 'Synthetic fixture filing',
      },
    })
    const filedDocument = filed.filings.at(-1)?.documents[0]
    expect(filed.filings.at(-1)?.outcome).not.toBe('rejected')
    expect(filedDocument?.pageCount).toBe(1)
    expect(filedDocument?.extractedSignals).toEqual(['notice of appeal'])
    expect(filedDocument?.analysis).toEqual(storedAnalysis)
  })

  it('uses the persisted receipt-backed report for ECF preflight and submission', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const { persisted } = await uploadReceiptDocument(
      alice,
      fixture.aliceSessionId,
      'Uploaded source document without writ petition signals.',
    )
    const storedAnalysis = await t.run((ctx) =>
      ctx.db.get(persisted.analysisId as Id<'documentAnalyses'>),
    )
    expect(storedAnalysis?.extractedTextHash).toBe(
      textHash(persisted.document.analysis!.normalizedText!),
    )
    const submission: FilingSubmission = {
      eventId: 'joint_appendix',
      participantRole: 'appellant',
      title: 'Joint Appendix',
      mainDocument: persisted.document,
      attachments: [],
      metadata: {
        ...defaultFilingMetadata('joint_appendix'),
        representedPartyId: 'appellant',
      },
      notes: '',
    }
    const args = { caseSessionId: fixture.aliceSessionId, submission }
    const storedReportPreflight = await alice.query(preflightFilingRef, args)
    expect(
      storedReportPreflight.issues.some(
        (issue) => issue.code === 'appendix_pagination_signal_missing',
      ),
    ).toBe(true)

    const alteredSubmission: FilingSubmission = {
      ...submission,
      mainDocument: {
        ...persisted.document,
        extractedText: 'Joint appendix pagination. Appendix page J.A. 1.',
        extractedSignals: [
          ...persisted.document.extractedSignals,
          'pagination appendix page ja',
        ],
        analysis: {
          ...persisted.document.analysis!,
          normalizedText: 'Joint appendix pagination. Appendix page J.A. 1.',
          certificateOfServiceDetected: true,
          certificateOfComplianceDetected: true,
        },
      },
    }
    const alteredArgs = { ...args, submission: alteredSubmission }
    const alteredPreflight = await alice.query(preflightFilingRef, alteredArgs)
    expect(alteredPreflight).toEqual(storedReportPreflight)

    const submitted = await alice.mutation(submitEcfFilingRef, alteredArgs)
    expect(submitted.preflight).toEqual(storedReportPreflight)
    const filing = submitted.session.filings.find(
      (candidate) => candidate.eventId === submission.eventId,
    )
    expect(filing).toBeDefined()
    expect(filing!.documents[0]?.extractedText).toBe(
      persisted.document.extractedText,
    )
    expect(filing!.documents[0]?.extractedSignals).toEqual(
      persisted.document.extractedSignals,
    )
    const savedSubmission = JSON.parse(
      filing!.submissionJson!,
    ) as FilingSubmission
    expect(savedSubmission.mainDocument).toEqual(persisted.document)
  })

  it('submits an unchanged receipt-backed document through the ECF workflow', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const { persisted } = await uploadReceiptDocument(
      alice,
      fixture.aliceSessionId,
      'Notice of appeal from a final civil judgment.',
    )
    const submission: FilingSubmission = {
      eventId: 'notice_of_appeal',
      participantRole: 'appellant',
      title: 'Notice of Appeal',
      mainDocument: persisted.document,
      attachments: [],
      metadata: {
        ...defaultFilingMetadata('notice_of_appeal'),
        representedPartyId: 'appellant',
      },
      notes: '',
    }
    const args = { caseSessionId: fixture.aliceSessionId, submission }
    const preflight = await alice.query(preflightFilingRef, args)
    expect(preflight.accepted).toBe(true)

    const submitted = await alice.mutation(submitEcfFilingRef, args)
    expect(submitted.preflight).toEqual(preflight)
    expect(submitted.receipt).not.toBeNull()
    const filing = submitted.session.filings.at(-1)
    expect(filing?.outcome).not.toBe('rejected')
    expect(filing?.documents[0]).toMatchObject(persisted.document)
    expect(
      JSON.parse(filing!.submissionJson!) as FilingSubmission,
    ).toMatchObject({ mainDocument: persisted.document })
  })

  it('enforces the aggregate 960 KiB UTF-8 row budget exactly before consuming an upload', async () => {
    const rowLimitBytes = 960 * 1024
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(16)
    const upload = async (fileName: string) => {
      const intent = await alice.begin({
        scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
        fileName,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        mimeType: 'application/pdf',
      })
      await uploadBytes(alice, intent.intentId, bytes)
      const storageId = await t.run((ctx) =>
        ctx.storage.store(
          new Blob([bytes.buffer as ArrayBuffer], {
            type: 'application/pdf',
          }),
        ),
      )
      const claimToken = randomUUID()
      expect(
        await alice.mutation(claimCompletionRef, {
          intentId: intent.intentId,
          claimToken,
        }),
      ).toEqual({ state: 'claimed' })
      await alice.mutation(finalizeCompletionRef, {
        intentId: intent.intentId,
        claimToken,
        storageId,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      })
      return intent
    }
    const document = (fileName: string): UploadedDocument => ({
      id: `client-${fileName}`,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      extractedSignals: [],
    })
    const exactIntent = await upload('exact-row.pdf')
    const exactAnalysis = (asciiLength: number) => ({
      ...analysisFor(bytes.byteLength),
      legalCitations: [`${'é'.repeat(100_000)}${'x'.repeat(asciiLength)}`],
    })
    let low = 0
    let high = 850_000
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (
        serializedBytes(
          analysisRowPayload(exactAnalysis(middle), fixture.aliceSessionId),
        ) <= rowLimitBytes
      ) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    const exact = exactAnalysis(low)
    expect(
      serializedBytes(analysisRowPayload(exact, fixture.aliceSessionId)),
    ).toBe(rowLimitBytes)
    expect(JSON.stringify(exact).length).toBeLessThan(900_000)
    const exactDocument = document('exact-row.pdf')
    const exactStorageId = await t.run(
      async (ctx) => (await ctx.db.get(exactIntent.intentId))!.storageId!,
    )
    expect(
      serializedBytes(
        documentRowPayload(
          exactDocument,
          fixture.aliceSessionId,
          exactStorageId,
        ),
      ),
    ).toBeLessThanOrEqual(rowLimitBytes)
    const exactPersisted = await alice.persist({
      caseSessionId: fixture.aliceSessionId,
      intentId: exactIntent.intentId,
      document: exactDocument,
      analysis: exact,
    })

    const overIntent = await upload('over-row.pdf')
    const overAnalysis = exactAnalysis(low + 1)
    expect(
      serializedBytes(analysisRowPayload(overAnalysis, fixture.aliceSessionId)),
    ).toBe(rowLimitBytes + 1)
    await expectErrorCode(
      alice.persist({
        caseSessionId: fixture.aliceSessionId,
        intentId: overIntent.intentId,
        document: document('over-row.pdf'),
        analysis: overAnalysis,
      }),
      AppErrorCode.VALIDATION_ERROR,
    )

    const unicodeIntent = await upload('unicode-row.pdf')
    const unicodeAnalysis = {
      ...analysisFor(bytes.byteLength),
      legalCitations: ['é'.repeat(492_000)],
    }
    expect(JSON.stringify(unicodeAnalysis).length).toBeLessThan(900_000)
    expect(
      serializedBytes(
        analysisRowPayload(unicodeAnalysis, fixture.aliceSessionId),
      ),
    ).toBeGreaterThan(rowLimitBytes)
    await expectErrorCode(
      alice.persist({
        caseSessionId: fixture.aliceSessionId,
        intentId: unicodeIntent.intentId,
        document: document('unicode-row.pdf'),
        analysis: unicodeAnalysis,
      }),
      AppErrorCode.VALIDATION_ERROR,
    )

    const after = await t.run(async (ctx) => ({
      exact: await ctx.db.get(exactIntent.intentId),
      over: await ctx.db.get(overIntent.intentId),
      unicode: await ctx.db.get(unicodeIntent.intentId),
      documents: await ctx.db
        .query('documents')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect(),
      analyses: await ctx.db
        .query('documentAnalyses')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect(),
    }))
    expect(exactPersisted.document.id).toBe(after.exact?.documentId)
    expect(after.exact?.state).toBe('consumed')
    expect(after.over?.state).toBe('stored')
    expect(after.over?.documentId).toBeUndefined()
    expect(after.over?.analysisId).toBeUndefined()
    expect(after.unicode?.state).toBe('stored')
    expect(after.unicode?.documentId).toBeUndefined()
    expect(after.unicode?.analysisId).toBeUndefined()
    expect(after.documents).toHaveLength(1)
    expect(after.analyses).toHaveLength(1)
  })

  it('copies fragmented chunk streams into one bounded buffer and rejects a 4 MiB plus one byte body', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(16 * 1024)
    const fragmentedIntent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'fragmented.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    let offset = 0
    const fragmentedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.byteLength) {
          controller.close()
          return
        }
        controller.enqueue(bytes.subarray(offset, offset + 1))
        offset += 1
      },
    })
    const fragmentedResponse = await alice.fetch(
      `/documents/chunk?intentId=${encodeURIComponent(fragmentedIntent.intentId)}&index=0`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-test-token',
          Origin: appOrigin,
          'Content-Type': 'application/octet-stream',
        },
        body: fragmentedBody,
        duplex: 'half',
      } as RequestInit,
    )
    expect(fragmentedResponse.status).toBe(200)

    const oversizeIntent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'oversize-stream.pdf',
      sizeBytes: chunkBytes,
      sha256: '0'.repeat(64),
      mimeType: 'application/pdf',
    })
    const overChunk = new Uint8Array(chunkBytes + 1)
    overChunk.set(new TextEncoder().encode('%PDF-'))
    const oversizeBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(overChunk.subarray(0, chunkBytes))
        controller.enqueue(overChunk.subarray(chunkBytes))
        controller.close()
      },
    })
    const oversizeResponse = await alice.fetch(
      `/documents/chunk?intentId=${encodeURIComponent(oversizeIntent.intentId)}&index=0`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-test-token',
          Origin: appOrigin,
          'Content-Type': 'application/octet-stream',
        },
        body: oversizeBody,
        duplex: 'half',
      } as RequestInit,
    )
    expect(oversizeResponse.status).toBe(413)
    const saved = await t.run(async (ctx) => ({
      fragmentedChunks: await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', fragmentedIntent.intentId),
        )
        .collect(),
      oversizeChunks: await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', oversizeIntent.intentId),
        )
        .collect(),
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(saved.fragmentedChunks).toHaveLength(1)
    expect(saved.oversizeChunks).toHaveLength(0)
    expect(saved.storage).toHaveLength(1)
  })

  it('cancel removes pending chunk objects and rows', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(256)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'cancel-pending.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const chunk = await t.run(async (ctx) =>
      ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .unique(),
    )
    expect(chunk).not.toBeNull()
    await alice.cancel(intent.intentId)
    const queued = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', chunk!.storageId),
        )
        .unique(),
    )
    expect(queued?.intentId).toBe(intent.intentId)
    expect(await failNextUploadStorageDelete(t, chunk!.storageId)).toBe('retry')
    const retried = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', chunk!.storageId),
        )
        .unique(),
    )
    expect(retried?.attempts).toBe(1)
    await t.run((ctx) =>
      ctx.db.patch(retried!._id, { nextAttemptAt: Date.now() - 1 }),
    )
    await t.action(cleanupUploadStorageRef, { storageId: chunk!.storageId })
    const after = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      chunks: await ctx.db.query('documentUploadChunks').collect(),
      storedSize: (await ctx.storage.get(chunk!.storageId))?.size,
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(after.intent?.state).toBe('cancelled')
    expect(after.chunks).toHaveLength(0)
    expect(after.storedSize).toBeUndefined()
    expect(after.storage).toHaveLength(0)
  })

  it('retries expiry cleanup for both a chunk and an unreferenced final blob', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'expired-stored.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await alice.complete(intent.intentId)
    const stored = await t.run(async (ctx) => ({
      receipt: (await ctx.db.get(intent.intentId))!,
      chunk: (await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .unique())!,
    }))
    await t.run((ctx) =>
      ctx.db.patch(intent.intentId, {
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    )

    await t.action(expireRef, { intentId: intent.intentId })
    const queued = await t.run((ctx) =>
      ctx.db.query('documentUploadCleanup').collect(),
    )
    expect(queued).toHaveLength(2)
    expect(queued.map((item) => item.storageId)).toContain(
      stored.receipt.storageId,
    )
    expect(queued.map((item) => item.storageId)).toContain(
      stored.chunk.storageId,
    )
    expect(queued.every((item) => item.intentId === intent.intentId)).toBe(true)

    expect(
      await failNextUploadStorageDelete(t, stored.receipt.storageId!),
    ).toBe('retry')
    const delayedFinal = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', stored.receipt.storageId!),
        )
        .unique(),
    )
    expect(delayedFinal?.attempts).toBe(1)
    expect(
      await t.run((ctx) =>
        ctx.db.system.get('_storage', stored.receipt.storageId!),
      ),
    ).not.toBeNull()

    await t.action(cleanupUploadStorageRef, {
      storageId: stored.chunk.storageId,
    })
    await t.run((ctx) =>
      ctx.db.patch(delayedFinal!._id, { nextAttemptAt: Date.now() - 1 }),
    )
    await t.action(cleanupUploadStorageRef, {
      storageId: stored.receipt.storageId!,
    })

    const after = await t.run(async (ctx) => ({
      receipt: await ctx.db.get(intent.intentId),
      chunks: await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .collect(),
      cleanup: await ctx.db.query('documentUploadCleanup').collect(),
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(after.receipt?.state).toBe('cancelled')
    expect(after.chunks).toHaveLength(0)
    expect(after.cleanup).toHaveLength(0)
    expect(after.storage).toHaveLength(0)
  })

  it('retains invalid-completion chunk cleanup across a transient delete failure', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = new TextEncoder().encode('not a PDF')
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'invalid-completion.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const chunk = await t.run(async (ctx) =>
      ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .unique(),
    )
    expect(chunk).not.toBeNull()
    await expectErrorCode(
      alice.complete(intent.intentId),
      AppErrorCode.VALIDATION_ERROR,
    )
    const queued = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      chunk: await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', intent.intentId),
        )
        .collect(),
      cleanup: await ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', chunk!.storageId),
        )
        .unique(),
    }))
    expect(queued.intent?.state).toBe('cancelled')
    expect(queued.chunk).toHaveLength(0)
    expect(queued.cleanup?.intentId).toBe(intent.intentId)

    expect(await failNextUploadStorageDelete(t, chunk!.storageId)).toBe('retry')
    const delayed = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', chunk!.storageId),
        )
        .unique(),
    )
    expect(delayed?.attempts).toBe(1)
    await t.run((ctx) =>
      ctx.db.patch(delayed!._id, { nextAttemptAt: Date.now() - 1 }),
    )
    await t.action(cleanupUploadStorageRef, { storageId: chunk!.storageId })
    const after = await t.run(async (ctx) => ({
      storage: await ctx.db.system.get('_storage', chunk!.storageId),
      cleanup: await ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', chunk!.storageId),
        )
        .unique(),
    }))
    expect(after.storage).toBeNull()
    expect(after.cleanup).toBeNull()
  })

  it('preserves a finalized winner and retries an unreferenced completion loser', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'completion-race.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const winnerId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
      ),
    )
    const loserId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
      ),
    )
    const winnerClaimToken = randomUUID()
    expect(
      await alice.mutation(claimCompletionRef, {
        intentId: intent.intentId,
        claimToken: winnerClaimToken,
      }),
    ).toEqual({ state: 'claimed' })
    const winner = await alice.mutation(finalizeCompletionRef, {
      intentId: intent.intentId,
      claimToken: winnerClaimToken,
      storageId: winnerId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    const loser = await alice.mutation(finalizeCompletionRef, {
      intentId: intent.intentId,
      storageId: loserId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    expect(winner.accepted).toBe(true)
    expect(loser.accepted).toBe(false)
    expect(loser.storageId).toBe(winnerId)

    expect(
      await t.mutation(queueUploadCleanupRef, {
        storageIds: [winnerId],
        intentId: intent.intentId,
      }),
    ).toEqual([])
    expect(
      await t.mutation(queueUploadCleanupRef, {
        storageIds: [loserId],
        intentId: intent.intentId,
      }),
    ).toEqual([loserId])
    expect(await failNextUploadStorageDelete(t, loserId)).toBe('retry')
    const delayed = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) => index.eq('storageId', loserId))
        .unique(),
    )
    expect(delayed?.attempts).toBe(1)
    await t.run((ctx) =>
      ctx.db.patch(delayed!._id, { nextAttemptAt: Date.now() - 1 }),
    )
    await t.action(cleanupUploadStorageRef, { storageId: loserId })

    const after = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      winner: await ctx.db.system.get('_storage', winnerId),
      loser: await ctx.db.system.get('_storage', loserId),
      cleanup: await ctx.db.query('documentUploadCleanup').collect(),
    }))
    expect(after.intent?.storageId).toBe(winnerId)
    expect(after.winner).not.toBeNull()
    expect(after.loser).toBeNull()
    expect(after.cleanup).toHaveLength(0)
  })

  it('queues a late final blob for cleanup inside cancelled completion finalization', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'late-finalization.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const claimToken = randomUUID()
    expect(
      await alice.mutation(claimCompletionRef, {
        intentId: intent.intentId,
        claimToken,
      }),
    ).toEqual({ state: 'claimed' })
    await t.run((ctx) =>
      ctx.db.patch(intent.intentId, {
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    )
    await t.action(expireRef, { intentId: intent.intentId })
    const expiredIntent = await t.run((ctx) => ctx.db.get(intent.intentId))
    expect(expiredIntent?.state).toBe('cancelled')
    expect(expiredIntent?.completionClaimToken).toBeUndefined()
    expect(expiredIntent?.completionClaimExpiresAt).toBeUndefined()

    const finalStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
      ),
    )
    const finalized = await alice.mutation(finalizeCompletionRef, {
      intentId: intent.intentId,
      claimToken,
      storageId: finalStorageId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    expect(finalized).toEqual({
      storageId: finalStorageId,
      accepted: false,
      cancelled: true,
      stale: false,
    })

    const queued = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', finalStorageId),
        )
        .unique(),
    )
    expect(queued?.intentId).toBe(intent.intentId)
    expect(
      await t.run((ctx) => ctx.db.system.get('_storage', finalStorageId)),
    ).not.toBeNull()

    await t.action(cleanupUploadStorageRef, { storageId: finalStorageId })
    const afterFinalCleanup = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      storage: await ctx.db.system.get('_storage', finalStorageId),
      cleanup: await ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', finalStorageId),
        )
        .unique(),
    }))
    expect(afterFinalCleanup.intent?.state).toBe('cancelled')
    expect(afterFinalCleanup.intent?.storageId).toBe(finalStorageId)
    expect(afterFinalCleanup.storage).toBeNull()
    expect(afterFinalCleanup.cleanup).toBeNull()
    await runQueuedUploadCleanup(t)
  })

  it('cancels an active claim and atomically cleans its late final blob', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(128)
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'cancelled-claim.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    const claimToken = randomUUID()
    expect(
      await alice.mutation(claimCompletionRef, {
        intentId: intent.intentId,
        claimToken,
      }),
    ).toEqual({ state: 'claimed' })

    await alice.cancel(intent.intentId)
    const cancelledIntent = await t.run((ctx) => ctx.db.get(intent.intentId))
    expect(cancelledIntent?.state).toBe('cancelled')
    expect(cancelledIntent?.completionClaimToken).toBeUndefined()
    expect(cancelledIntent?.completionClaimExpiresAt).toBeUndefined()

    const lateStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
      ),
    )
    const finalized = await alice.mutation(finalizeCompletionRef, {
      intentId: intent.intentId,
      claimToken,
      storageId: lateStorageId,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
    expect(finalized.cancelled).toBe(true)
    const cleanup = await t.run((ctx) =>
      ctx.db
        .query('documentUploadCleanup')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', lateStorageId),
        )
        .unique(),
    )
    expect(cleanup?.intentId).toBe(intent.intentId)
    await t.action(cleanupUploadStorageRef, { storageId: lateStorageId })
    expect(
      await t.run((ctx) => ctx.db.system.get('_storage', lateStorageId)),
    ).toBeNull()
    await runQueuedUploadCleanup(t)
  })

  it('keeps dataset asset storage referenced during expired receipt cleanup', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = new TextEncoder().encode('draft asset')
    const intent = await alice.begin({
      scope: { kind: 'dataset', versionId: fixture.versionId },
      fileName: 'draft-asset.txt',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'text/plain',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await alice.complete(intent.intentId)
    const finalStorageId = await t.run(async (ctx) => {
      const receipt = await ctx.db.get(intent.intentId)
      expect(receipt?.storageId).toBeDefined()
      await ctx.db.insert('organizationDatasetAssets', {
        versionId: fixture.versionId,
        institutionId: fixture.institutionId,
        fileName: 'draft-asset.txt',
        normalizedFileName: 'draft-asset.txt',
        mediaType: 'text/plain',
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        storageId: receipt!.storageId!,
      })
      await ctx.db.patch(intent.intentId, {
        expiresAt: new Date(Date.now() - 1).toISOString(),
      })
      return receipt!.storageId!
    })

    await t.action(expireRef, { intentId: intent.intentId })
    await runQueuedUploadCleanup(t)
    const after = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      asset: await ctx.db
        .query('organizationDatasetAssets')
        .withIndex('by_storage', (index) =>
          index.eq('storageId', finalStorageId),
        )
        .unique(),
      file: await ctx.db.system.get('_storage', finalStorageId),
    }))
    expect(after.intent?.state).toBe('cancelled')
    expect(after.asset?.storageId).toBe(finalStorageId)
    expect(after.file).not.toBeNull()
  })

  it('serializes cancel against complete and against exactly-once consumption', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = makePdf(256)
    const cancelVsComplete = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'cancel-complete.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, cancelVsComplete.intentId, bytes)
    const uploadedChunkStorageId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query('documentUploadChunks')
          .withIndex('by_intent_index', (index) =>
            index.eq('intentId', cancelVsComplete.intentId),
          )
          .unique())!.storageId,
    )
    const [cancelResult, completeResult] = await Promise.allSettled([
      alice.cancel(cancelVsComplete.intentId),
      alice.complete(cancelVsComplete.intentId),
    ])
    if (cancelResult.status === 'rejected') throw cancelResult.reason
    if (completeResult.status === 'rejected') {
      expect(
        (completeResult.reason as { data?: AppErrorData }).data?.code,
      ).toBe(AppErrorCode.CONFLICT)
    }
    expect(['fulfilled', 'rejected']).toContain(cancelResult.status)
    expect(['fulfilled', 'rejected']).toContain(completeResult.status)
    await t.action(expireRef, { intentId: cancelVsComplete.intentId })
    await runQueuedUploadCleanup(t)
    const cancelledState = await t.run(async (ctx) => ({
      intent: await ctx.db.get(cancelVsComplete.intentId),
      chunks: await ctx.db.query('documentUploadChunks').collect(),
      documents: await ctx.db.query('documents').collect(),
      storage: await ctx.db.system.query('_storage').collect(),
    }))
    expect(cancelledState.intent?.state).toBe('cancelled')
    expect(cancelledState.chunks).toEqual([])
    expect(cancelledState.documents).toHaveLength(0)
    expect(cancelledState.storage.map((item) => item._id)).not.toContain(
      uploadedChunkStorageId,
    )
    if (cancelledState.intent?.storageId) {
      expect(cancelledState.storage.map((item) => item._id)).not.toContain(
        cancelledState.intent.storageId,
      )
    }
    expect(cancelledState.storage).toEqual([])

    const cancelVsConsume = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'cancel-consume.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, cancelVsConsume.intentId, bytes)
    await alice.complete(cancelVsConsume.intentId)
    const document: UploadedDocument = {
      id: 'retry-id-is-ignored',
      fileName: 'cancel-consume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      extractedSignals: [],
    }
    const [cancelAttempt, consumeAttempt] = await Promise.allSettled([
      alice.cancel(cancelVsConsume.intentId),
      alice.persist({
        caseSessionId: fixture.aliceSessionId,
        intentId: cancelVsConsume.intentId,
        document,
        analysis: analysisFor(bytes.byteLength),
      }),
    ])
    await t.action(expireRef, { intentId: cancelVsConsume.intentId })
    await runQueuedUploadCleanup(t)
    const consumedState = await t.run(async (ctx) => {
      const intent = await ctx.db.get(cancelVsConsume.intentId)
      const documents = await ctx.db
        .query('documents')
        .withIndex('by_case', (index) =>
          index.eq('caseSessionId', fixture.aliceSessionId),
        )
        .collect()
      return {
        intent,
        documents,
        finalSize:
          intent?.storageId && (await ctx.storage.get(intent.storageId))
            ? (await ctx.storage.get(intent.storageId))!.size
            : undefined,
      }
    })
    if (consumedState.intent?.state === 'consumed') {
      expect(consumeAttempt.status).toBe('fulfilled')
      expect(cancelAttempt.status).toBe('rejected')
      expect(consumedState.documents).toHaveLength(1)
      expect(consumedState.documents[0]?._id).toBe(
        consumedState.intent.documentId,
      )
      expect(consumedState.finalSize).toBe(bytes.byteLength)
    } else {
      expect(consumedState.intent?.state).toBe('cancelled')
      expect(consumeAttempt.status).toBe('rejected')
      expect(cancelAttempt.status).toBe('fulfilled')
      expect(consumedState.documents).toHaveLength(0)
      expect(consumedState.finalSize).toBeUndefined()
    }
  })

  it('rejects invalid PDF signatures, full hashes, chunk hashes, UTF-8 and JSON without documents', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const alice = uploadClient(t)
    const bytes = new TextEncoder().encode('not a PDF')
    const intent = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'invalid.pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, intent.intentId, bytes)
    await expectErrorCode(
      alice.complete(intent.intentId),
      AppErrorCode.VALIDATION_ERROR,
    )
    const saved = await t.run(async (ctx) => ({
      intent: await ctx.db.get(intent.intentId),
      documents: await ctx.db.query('documents').collect(),
    }))
    expect(saved.intent?.state).toBe('cancelled')
    expect(saved.documents).toHaveLength(0)

    const pdf = makePdf(16)
    const wrongFullHash = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'wrong-full-hash.pdf',
      sizeBytes: pdf.byteLength,
      sha256: '0'.repeat(64),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, wrongFullHash.intentId, pdf)
    await expectErrorCode(
      alice.complete(wrongFullHash.intentId),
      AppErrorCode.VALIDATION_ERROR,
    )

    const wrongChunkHash = await alice.begin({
      scope: { kind: 'session', caseSessionId: fixture.aliceSessionId },
      fileName: 'wrong-chunk-hash.pdf',
      sizeBytes: pdf.byteLength,
      sha256: sha256(pdf),
      mimeType: 'application/pdf',
    })
    await uploadBytes(alice, wrongChunkHash.intentId, pdf)
    await t.run(async (ctx) => {
      const chunk = await ctx.db
        .query('documentUploadChunks')
        .withIndex('by_intent_index', (index) =>
          index.eq('intentId', wrongChunkHash.intentId),
        )
        .unique()
      await ctx.db.patch(chunk!._id, { sha256: 'f'.repeat(64) })
    })
    await expectErrorCode(
      alice.complete(wrongChunkHash.intentId),
      AppErrorCode.VALIDATION_ERROR,
    )

    const invalidText = new Uint8Array([0xff])
    const textIntent = await alice.begin({
      scope: { kind: 'dataset', versionId: fixture.versionId },
      fileName: 'invalid.txt',
      sizeBytes: invalidText.byteLength,
      sha256: sha256(invalidText),
      mimeType: 'text/plain',
    })
    await uploadBytes(alice, textIntent.intentId, invalidText)
    await expectErrorCode(
      alice.complete(textIntent.intentId),
      AppErrorCode.VALIDATION_ERROR,
    )

    const invalidJson = new TextEncoder().encode('{broken')
    const jsonIntent = await alice.begin({
      scope: { kind: 'dataset', versionId: fixture.versionId },
      fileName: 'invalid.json',
      sizeBytes: invalidJson.byteLength,
      sha256: sha256(invalidJson),
      mimeType: 'application/json',
    })
    await uploadBytes(alice, jsonIntent.intentId, invalidJson)
    await expectErrorCode(
      alice.complete(jsonIntent.intentId),
      AppErrorCode.VALIDATION_ERROR,
    )

    const all = await t.run(async (ctx) => ({
      documents: await ctx.db.query('documents').collect(),
      receipts: await ctx.db.query('documentUploadIntents').collect(),
    }))
    expect(all.documents).toHaveLength(0)
    expect(
      all.receipts.filter((receipt) => receipt.state !== 'cancelled'),
    ).toHaveLength(0)
  })
})
