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

import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Id } from '../../convex/_generated/dataModel'
import type { DocumentAnalysis, UploadedDocument } from '../domain/types'
import {
  analyzeUploadAndPersistDocuments,
  DocumentTransferError,
  DocumentUploadBatchError,
  maxDocumentUploadBytes,
} from './document-upload'
import type {
  DocumentUploadIntent,
  DocumentUploadIntentArgs,
  DocumentUploadReceipt,
  DocumentHttpFetcher,
  DocumentUploadWorkflow,
} from './document-upload'
import schema from '../../convex/schema'

const pdfMock = vi.hoisted(() => ({ analyze: vi.fn() }))

vi.mock('../modules/documents/pdfjs-analyzer', () => ({
  pdfJsAnalyzer: pdfMock,
}))

const chunkBytes = 4 * 1024 * 1024
const appOrigin = 'https://app.example.test'

const modules = {
  './_generated/api.ts': () => import('../../convex/_generated/api'),
  './_generated/server.ts': () => import('../../convex/_generated/server'),
  './authHelpers.ts': () => import('../../convex/authHelpers'),
  './authz.ts': () => import('../../convex/authz'),
  './caseSessionEventLog.ts': () => import('../../convex/caseSessionEventLog'),
  './caseSessions.ts': () => import('../../convex/caseSessions'),
  './documentUploadActions.ts': () =>
    import('../../convex/documentUploadActions'),
  './documentUploads.ts': () => import('../../convex/documentUploads'),
  './errors.ts': () => import('../../convex/errors'),
  './http.ts': () => import('../../convex/http'),
  './organizationContracts.ts': () =>
    import('../../convex/organizationContracts'),
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

const beginRef = makeFunctionReference<
  'mutation',
  DocumentUploadIntentArgs,
  DocumentUploadIntent
>('documentUploads:begin')
const completeRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  DocumentUploadReceipt
>('documentUploadActions:complete')
const cancelRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  null
>('documentUploadActions:cancel')
const persistRef = makeFunctionReference<
  'mutation',
  {
    caseSessionId: Id<'caseSessions'>
    intentId: Id<'documentUploadIntents'>
    document: UploadedDocument
    analysis: DocumentAnalysis
  },
  { document: UploadedDocument; analysisId: string }
>('caseSessions:persistDocumentAnalysis')

beforeEach(() => {
  pdfMock.analyze.mockReset()
  pdfMock.analyze.mockImplementation(
    async (file: { fileName: string; mimeType: string; sizeBytes: number }) =>
      ({
        analyzerId: 'test-analyzer',
        fileSizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        searchableText: true,
        normalizedText: `analysis for ${file.fileName}`,
        certificateOfServiceDetected: false,
        certificateOfComplianceDetected: false,
        sealedOrRedactionWarning: false,
        warnings: [],
      }) satisfies DocumentAnalysis,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('authenticated browser document upload', () => {
  it('sends fixed 4 MiB authenticated chunks, completes, and persists only an intent receipt', async () => {
    const file = pdfFile('%PDF-1.7\nsmall filing', 'opening.pdf')
    const workflow = browserWorkflow(file)
    const result = await analyzeUploadAndPersistDocuments(
      workflow,
      sessionId('session-basic'),
      fileList(file),
      { userId: 'clerk-user-basic' },
    )

    expect(workflow.beginUpload).toHaveBeenCalledWith({
      scope: { kind: 'session', caseSessionId: sessionId('session-basic') },
      fileName: 'opening.pdf',
      sizeBytes: file.size,
      sha256: await digest(new Uint8Array(await file.arrayBuffer())),
      mimeType: 'application/pdf',
    })
    expect(workflow.fetcher).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = vi.mocked(workflow.fetcher!).mock
      .calls[0]!
    const url = new URL(String(requestUrl))
    const chunk = requestInit?.body as Blob
    expect(url.pathname).toBe('/documents/chunk')
    expect(url.searchParams.get('intentId')).toBe('intent-opening')
    expect(url.searchParams.get('index')).toBe('0')
    expect(requestInit?.headers).toEqual({
      Authorization: 'Bearer convex-jwt',
      'Content-Type': 'application/octet-stream',
    })
    expect(chunk.size).toBe(file.size)
    expect(workflow.completeUpload).toHaveBeenCalledWith({
      intentId: intentId('intent-opening'),
    })
    expect(workflow.persistDocumentAnalysis).toHaveBeenCalledTimes(1)
    const persistence = vi.mocked(workflow.persistDocumentAnalysis).mock
      .calls[0]![0]
    expect(persistence.intentId).toBe(intentId('intent-opening'))
    expect(persistence.document).not.toHaveProperty('storageId')
    expect(result[0]).toMatchObject({
      id: 'document-intent-opening',
      fileName: 'opening.pdf',
      sha256: await digest(new Uint8Array(await file.arrayBuffer())),
    })
    expect(result[0]).not.toHaveProperty('storageId')
  })

  it('retries structured completion-busy responses with bounded cancelable backoff', async () => {
    const file = pdfFile('%PDF-1.4\nbusy', 'busy.pdf')
    const waits: number[] = []
    let completionCalls = 0
    const workflow = browserWorkflow(file, {
      wait: async (milliseconds, signal) => {
        expect(signal?.aborted ?? false).toBe(false)
        waits.push(milliseconds)
      },
      completeUpload: async ({ intentId }) => {
        completionCalls += 1
        if (completionCalls < 3) throw busyCompletionError()
        return {
          intentId,
          sizeBytes: file.size,
          sha256: await digest(new Uint8Array(await file.arrayBuffer())),
        }
      },
    })

    await expect(
      analyzeUploadAndPersistDocuments(
        workflow,
        sessionId('session-busy'),
        fileList(file),
        { userId: 'clerk-user-busy' },
      ),
    ).resolves.toHaveLength(1)
    expect(completionCalls).toBe(3)
    expect(waits).toEqual([1000, 1000])

    const exhaustFile = pdfFile('%PDF-1.4\nbusy-exhaust', 'busy-exhaust.pdf')
    const exhausted: number[] = []
    const busyWorkflow = browserWorkflow(exhaustFile, {
      completeUpload: async () => {
        exhausted.push(1)
        throw busyCompletionError()
      },
      wait: async () => undefined,
    })
    const failure = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        busyWorkflow,
        sessionId('session-busy-exhaust'),
        fileList(exhaustFile),
        { userId: 'clerk-user-busy-exhaust' },
      ),
    )
    expect(exhausted).toHaveLength(5)
    expect(
      (failure.failures[0]!.error as DocumentTransferError).retryable,
    ).toBe(true)
    expect(busyWorkflow.persistDocumentAnalysis).not.toHaveBeenCalled()
  })

  it('retains a completed receipt and analysis after session-admission rejection for a same-file retry', async () => {
    const file = pdfFile('%PDF-1.7\nretry after compact', 'retry.pdf')
    let persistCalls = 0
    const workflow = browserWorkflow(file, {
      persistDocumentAnalysis: async (args) => {
        persistCalls += 1
        if (persistCalls === 1) {
          throw Object.assign(
            new Error(
              'Case session resulting row material or full CaseSession projection exceed the 4 MiB admission limit.',
            ),
            {
              data: {
                code: 'VALIDATION_ERROR',
                message:
                  'Case session resulting row material or full CaseSession projection exceed the 4 MiB admission limit.',
              },
            },
          )
        }
        return {
          document: { ...args.document, id: 'document-retried' },
          analysisId: 'analysis-retried',
        }
      },
    })
    const list = fileList(file)
    const user = { userId: 'clerk-user-admission' }
    const first = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        workflow,
        sessionId('session-admission'),
        list,
        user,
      ),
    )
    expect(first.documents).toEqual([])
    expect(first.failures[0]!.error).toMatchObject({
      kind: 'validation',
      retryable: true,
    })

    const retried = await analyzeUploadAndPersistDocuments(
      workflow,
      sessionId('session-admission'),
      list,
      user,
    )
    expect(retried[0]?.id).toBe('document-retried')
    expect(pdfMock.analyze).toHaveBeenCalledTimes(1)
    expect(workflow.beginUpload).toHaveBeenCalledTimes(1)
    expect(workflow.fetcher).toHaveBeenCalledTimes(1)
    expect(workflow.completeUpload).toHaveBeenCalledTimes(1)
    expect(persistCalls).toBe(2)
  })

  it('reuses the same consumed document after repeated completion or file selection', async () => {
    const file = pdfFile('%PDF-1.5\nsame upload', 'repeat.pdf')
    const workflow = browserWorkflow(file)
    const args = [
      workflow,
      sessionId('session-repeat'),
      fileList(file),
      { userId: 'clerk-user-repeat' },
    ] as const
    const first = await analyzeUploadAndPersistDocuments(...args)
    const second = await analyzeUploadAndPersistDocuments(...args)
    expect(second).toEqual(first)
    expect(workflow.beginUpload).toHaveBeenCalledTimes(1)
    expect(workflow.completeUpload).toHaveBeenCalledTimes(1)
    expect(workflow.persistDocumentAnalysis).toHaveBeenCalledTimes(1)
  })

  it('rejects oversize PDFs before creating an intent', async () => {
    const file = fakeFile({
      name: 'oversize.pdf',
      type: 'application/pdf',
      size: maxDocumentUploadBytes + 1,
    })
    const workflow = browserWorkflow(pdfFile('%PDF-', 'unused.pdf'))
    const failure = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        workflow,
        sessionId('session-oversize'),
        fileList(file),
        { userId: 'clerk-user-oversize' },
      ),
    )
    expect((failure.failures[0]!.error as DocumentTransferError).kind).toBe(
      'oversized',
    )
    expect(workflow.beginUpload).not.toHaveBeenCalled()
    expect(pdfMock.analyze).not.toHaveBeenCalled()
  })

  it('reports an expired token and can resume the same pending receipt after sign-in', async () => {
    const file = pdfFile('%PDF-1.4\nexpired token', 'token.pdf')
    let tokenCalls = 0
    let httpCalls = 0
    const workflow = browserWorkflow(file, {
      getAuthToken: async () =>
        ++tokenCalls === 1 ? 'expired-jwt' : 'fresh-jwt',
      fetcher: async (input, init) => {
        httpCalls += 1
        if (httpCalls === 1) return new Response(null, { status: 401 })
        return validChunkResponse(input, init)
      },
    })
    const first = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        workflow,
        sessionId('session-token-refresh'),
        fileList(file),
        { userId: 'clerk-user-token-refresh' },
      ),
    )
    expect((first.failures[0]!.error as DocumentTransferError).kind).toBe(
      'authentication',
    )
    const retried = await analyzeUploadAndPersistDocuments(
      workflow,
      sessionId('session-token-refresh'),
      fileList(file),
      { userId: 'clerk-user-token-refresh' },
    )
    expect(retried).toHaveLength(1)
    expect(workflow.beginUpload).toHaveBeenCalledTimes(1)
    expect(httpCalls).toBe(2)
  })

  it('cancels an interrupted transfer and suppresses persistence', async () => {
    const file = pdfFile('%PDF-1.7\ninterrupt', 'interrupt.pdf')
    const controller = new AbortController()
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => (requestStarted = resolve))
    const workflow = browserWorkflow(file, {
      fetcher: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestStarted()
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    })
    const operation = analyzeUploadAndPersistDocuments(
      workflow,
      sessionId('session-interrupt'),
      fileList(file),
      { userId: 'clerk-user-interrupt', signal: controller.signal },
    )
    await started
    controller.abort('session switched')
    const failure = await captureBatchError(operation)
    expect((failure.failures[0]!.error as DocumentTransferError).kind).toBe(
      'cancelled',
    )
    expect(workflow.cancelUpload).toHaveBeenCalledWith({
      intentId: intentId('intent-interrupt'),
    })
    expect(workflow.persistDocumentAnalysis).not.toHaveBeenCalled()
  })

  it('rejects sign-out, checksum mismatch, and browser CORS failures without persistence', async () => {
    const signedOutFile = pdfFile('%PDF-1.4\nsigned out', 'signed-out.pdf')
    const signedOut = browserWorkflow(signedOutFile, {
      getAuthToken: async () => null,
    })
    const signedOutError = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        signedOut,
        sessionId('session-signed-out'),
        fileList(signedOutFile),
        { userId: 'clerk-user-signed-out' },
      ),
    )
    expect(
      (signedOutError.failures[0]!.error as DocumentTransferError).kind,
    ).toBe('authentication')
    expect(signedOut.persistDocumentAnalysis).not.toHaveBeenCalled()

    const hashFile = pdfFile('%PDF-1.4\nwrong digest', 'hash.pdf')
    const hashWorkflow = browserWorkflow(hashFile, {
      completeUpload: async ({ intentId }) => ({
        intentId,
        sizeBytes: hashFile.size,
        sha256: '0'.repeat(64),
      }),
    })
    const hashError = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        hashWorkflow,
        sessionId('session-hash'),
        fileList(hashFile),
        { userId: 'clerk-user-hash' },
      ),
    )
    expect((hashError.failures[0]!.error as DocumentTransferError).kind).toBe(
      'integrity',
    )
    expect(hashWorkflow.persistDocumentAnalysis).not.toHaveBeenCalled()

    const corsFile = pdfFile('%PDF-1.4\ncors', 'cors.pdf')
    const corsWorkflow = browserWorkflow(corsFile, {
      fetcher: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const corsError = await captureBatchError(
      analyzeUploadAndPersistDocuments(
        corsWorkflow,
        sessionId('session-cors'),
        fileList(corsFile),
        { userId: 'clerk-user-cors' },
      ),
    )
    expect((corsError.failures[0]!.error as DocumentTransferError).kind).toBe(
      'cors',
    )
    expect(corsWorkflow.persistDocumentAnalysis).not.toHaveBeenCalled()
  })

  it('persists analysis through the actual registered HTTP, action, and mutation handlers', async () => {
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
    const t = convexTest(schema, modules)
    const fixture = await seedSession(t)
    const client = t.withIdentity(identity('upload-owner'))
    const file = pdfFile(
      '%PDF-1.7\nregistered handler upload',
      'registered.pdf',
    )
    const fetcher: DocumentHttpFetcher = (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      headers.set('Origin', appOrigin)
      return client.fetch(`${url.pathname}${url.search}`, { ...init, headers })
    }
    const workflow: DocumentUploadWorkflow = {
      siteUrl: 'https://fixture.convex.site',
      getAuthToken: async () => 'ephemeral-convex-jwt',
      beginUpload: (args) => client.mutation(beginRef, args),
      completeUpload: (args) => client.action(completeRef, args),
      cancelUpload: (args) => client.action(cancelRef, args),
      persistDocumentAnalysis: (args) => client.mutation(persistRef, args),
      fetcher,
    }
    const result = await analyzeUploadAndPersistDocuments(
      workflow,
      fixture.caseSessionId,
      fileList(file),
      { userId: 'upload-owner' },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      fileName: 'registered.pdf',
      mimeType: 'application/pdf',
    })
    expect(result[0]).not.toHaveProperty('storageId')
    expect(result[0]?.analysisId).toBeDefined()
    const persisted = await t.run(async (ctx) => {
      const intent = await ctx.db
        .query('documentUploadIntents')
        .collect()
        .then(
          (rows) =>
            rows.find((row) => row.caseSessionId === fixture.caseSessionId) ??
            null,
        )
      const document = result[0]?.id
        ? await ctx.db.get(result[0].id as Id<'documents'>)
        : null
      const analysis = result[0]?.analysisId
        ? await ctx.db.get(result[0].analysisId as Id<'documentAnalyses'>)
        : null
      const storedBlob = document?.storageId
        ? await ctx.storage.get(document.storageId)
        : null
      const storedBytes = storedBlob
        ? Array.from(new Uint8Array(await storedBlob.arrayBuffer()))
        : null
      return { intent, document, analysis, storedBytes }
    })
    expect(persisted.intent?.state).toBe('consumed')
    expect(persisted.intent?.documentId).toBe(result[0]?.id)
    expect(persisted.intent?.analysisId).toBe(result[0]?.analysisId)
    expect(persisted.document?.caseSessionId).toBe(fixture.caseSessionId)
    expect(persisted.document?.sha256).toBe(
      await digest(new Uint8Array(await file.arrayBuffer())),
    )
    expect(persisted.analysis?.documentId).toBe(result[0]?.id)
    expect(persisted.storedBytes).toEqual(
      Array.from(new Uint8Array(await file.arrayBuffer())),
    )

    const repeatedCompletion = await client.action(completeRef, {
      intentId: persisted.intent!._id,
    })
    expect(repeatedCompletion).toEqual({
      intentId: persisted.intent!._id,
      sizeBytes: file.size,
      sha256: await digest(new Uint8Array(await file.arrayBuffer())),
    })
    const selectedAgain = await analyzeUploadAndPersistDocuments(
      workflow,
      fixture.caseSessionId,
      fileList(file),
      { userId: 'upload-owner' },
    )
    expect(selectedAgain[0]?.id).toBe(result[0]?.id)
    expect(
      await t.run((ctx) => ctx.db.query('documentUploadIntents').collect()),
    ).toHaveLength(1)
    expect(
      await t.run((ctx) => ctx.db.query('documents').collect()),
    ).toHaveLength(1)
  })
})

function browserWorkflow(
  file: File,
  overrides: Partial<DocumentUploadWorkflow> = {},
): DocumentUploadWorkflow {
  const stagedIntentId = intentId(`intent-${file.name.replace(/\.pdf$/i, '')}`)
  return {
    siteUrl: 'https://fixture.convex.site',
    getAuthToken: async () => 'convex-jwt',
    beginUpload: vi.fn(async () => ({
      intentId: stagedIntentId,
      chunkBytes,
      expiresAt: '2099-01-01T00:00:00.000Z',
    })),
    completeUpload: vi.fn(async ({ intentId: completedId }) => ({
      intentId: completedId,
      sizeBytes: file.size,
      sha256: await digest(new Uint8Array(await file.arrayBuffer())),
    })),
    cancelUpload: vi.fn(async () => null),
    persistDocumentAnalysis: vi.fn(async (args) => ({
      document: { ...args.document, id: `document-${String(args.intentId)}` },
      analysisId: `analysis-${String(args.intentId)}`,
    })),
    fetcher: vi.fn(validChunkResponse) as unknown as DocumentHttpFetcher,
    ...overrides,
  }
}

async function validChunkResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const url = input instanceof URL ? input : new URL(String(input))
  const blob = init?.body as Blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return Response.json({
    intentId: url.searchParams.get('intentId'),
    index: Number(url.searchParams.get('index')),
    sizeBytes: bytes.byteLength,
    sha256: await digest(bytes),
  })
}

function busyCompletionError() {
  return Object.assign(
    new Error('Upload completion is already in progress. Retry shortly.'),
    {
      data: {
        code: 'CONFLICT',
        message: 'Upload completion is already in progress. Retry shortly.',
        metadata: {
          reason: 'UPLOAD_COMPLETION_BUSY',
          retryable: true,
          retryAfterMs: 1000,
        },
      },
    },
  )
}

async function captureBatchError(promise: Promise<UploadedDocument[]>) {
  let error: unknown
  try {
    await promise
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(DocumentUploadBatchError)
  return error as DocumentUploadBatchError
}

function pdfFile(text: string, name: string) {
  return new File([text], name, { type: 'application/pdf' })
}

function fakeFile(file: { name: string; type: string; size: number }) {
  return {
    ...file,
    lastModified: 0,
    slice: () => new Blob([]),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as File
}

function fileList(...files: File[]): FileList {
  const list = {
    length: files.length,
    item(index: number) {
      return files[index] ?? null
    },
    *[Symbol.iterator]() {
      yield* files
    },
  } as FileList
  files.forEach((file, index) =>
    Object.defineProperty(list, index, { value: file, enumerable: true }),
  )
  return list
}

function sessionId(value: string) {
  return value as Id<'caseSessions'>
}

function intentId(value: string) {
  return value as Id<'documentUploadIntents'>
}

async function digest(bytes: Uint8Array) {
  const result = await crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer,
  )
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function seedSession(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const createdAt = new Date().toISOString()
    const ownerUserId = await ctx.db.insert('users', {
      authSubject: identity('upload-owner').tokenIdentifier,
      displayName: 'Upload owner',
      monthlyAiBudgetCents: 0,
    })
    const institutionId = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt,
      name: 'Upload fixture organization',
      slug: 'upload-fixture-organization',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: ownerUserId,
      role: 'learner',
      status: 'active',
      createdAt,
    })
    const scenarioId = await ctx.db.insert('scenarios', {
      scenarioKey: 'browser-upload-fixture',
      visibility: 'public_template',
      revisionStatus: 'published',
      title: 'Browser upload fixture',
      source: 'synthetic',
      courtPackId: 'us-federal-ca4-civil-appeal',
      shortCaption: 'Upload Fixture v. Test',
      lowerTribunal: 'Fixture court',
      natureOfSuit: 'civil',
      proceduralPosture: 'appeal',
      issuesPresented: [],
      meritsRecord: [],
      published: true,
    })
    const caseSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
      scenarioId,
      userId: ownerUserId,
      courtPackId: 'us-federal-ca4-civil-appeal',
      status: 'active',
      simulatedDate: createdAt,
    })
    return { caseSessionId }
  })
}
