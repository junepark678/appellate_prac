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

import { createHash } from 'node:crypto'
import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Id } from './_generated/dataModel'
import { AppErrorCode, type AppErrorData } from './errors'
import type { DocumentAnalysis, UploadedDocument } from '../src/domain/types'
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

const beginRef = makeFunctionReference<'mutation', BeginArgs, BeginResult>(
  'documentUploads:begin',
)
const completeRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  { intentId: Id<'documentUploadIntents'>; sizeBytes: number; sha256: string }
>('documentUploadActions:complete')
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

function makePdf(sizeBytes: number) {
  const bytes = new Uint8Array(sizeBytes)
  bytes.set(new TextEncoder().encode('%PDF-').subarray(0, sizeBytes))
  return bytes
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
      courtPackId: 'upload-fixture-pack',
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
      courtPackId: 'upload-fixture-pack',
      status: 'active',
      simulatedDate: createdAt,
    })
    const bobSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
      scenarioId,
      userId: bobId,
      courtPackId: 'upload-fixture-pack',
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

beforeEach(() => {
  vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('document upload receipts', () => {
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

    const completed = await alice.complete(intent.intentId)
    expect(completed).toEqual({
      intentId: intent.intentId,
      sizeBytes: maxFileBytes,
      sha256: sha256(bytes),
    })
    expect(completed).not.toHaveProperty('storageId')
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

  it('cancel removes pending chunk objects and rows', async () => {
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
