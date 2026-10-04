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

import type { Id } from '../../convex/_generated/dataModel'
import type { DocumentAnalysis, UploadedDocument } from '../domain/types'
import { inferDocumentSignals } from '../domain/simulation'

export const documentUploadChunkBytes = 4 * 1024 * 1024
export const maxDocumentUploadBytes = 25 * 1024 * 1024
const maxCompletionBusyRetries = 4
const maxCompletionRetryDelayMs = 4_000

export type DocumentUploadIntentArgs = {
  scope: { kind: 'session'; caseSessionId: Id<'caseSessions'> }
  fileName: string
  sizeBytes: number
  sha256: string
  mimeType: 'application/pdf'
}

export type DocumentUploadIntent = {
  intentId: Id<'documentUploadIntents'>
  chunkBytes: number
  expiresAt: string
}

export type DocumentUploadReceipt = {
  intentId: Id<'documentUploadIntents'>
  sizeBytes: number
  sha256: string
}

export type DocumentHttpFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type PersistDocumentAnalysis = (args: {
  caseSessionId: Id<'caseSessions'>
  intentId: Id<'documentUploadIntents'>
  document: UploadedDocument
  analysis: DocumentAnalysis
}) => Promise<{ document: UploadedDocument; analysisId: string }>

export type DocumentUploadWorkflow = {
  siteUrl: string | undefined
  getAuthToken: () => Promise<string | null>
  beginUpload: (args: DocumentUploadIntentArgs) => Promise<DocumentUploadIntent>
  completeUpload: (args: {
    intentId: Id<'documentUploadIntents'>
  }) => Promise<DocumentUploadReceipt>
  cancelUpload?: (args: {
    intentId: Id<'documentUploadIntents'>
  }) => Promise<unknown>
  persistDocumentAnalysis: PersistDocumentAnalysis
  fetcher?: DocumentHttpFetcher
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

export type DocumentUploadOptions = {
  /** Stable Clerk user key. It prevents one account from reusing another's receipt. */
  userId: string
  signal?: AbortSignal
}

export type DocumentTransferFailureKind =
  | 'authentication'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'expired'
  | 'oversized'
  | 'integrity'
  | 'validation'
  | 'cors'
  | 'server'
  | 'cancelled'

export class DocumentTransferError extends Error {
  readonly kind: DocumentTransferFailureKind
  readonly retryable: boolean

  constructor(
    kind: DocumentTransferFailureKind,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'DocumentTransferError'
    this.kind = kind
    this.retryable = options.retryable ?? false
  }
}

export class DocumentUploadBatchError extends Error {
  readonly documents: UploadedDocument[]
  readonly failures: Array<{ fileName: string; error: unknown }>

  constructor(
    documents: UploadedDocument[],
    failures: Array<{ fileName: string; error: unknown }>,
  ) {
    super(
      failures.length === 1
        ? `${failures[0]!.fileName}: ${messageFor(failures[0]!.error)}`
        : `${failures.length} documents could not be attached: ${failures
            .map(({ fileName, error }) => `${fileName}: ${messageFor(error)}`)
            .join('; ')}`,
    )
    this.name = 'DocumentUploadBatchError'
    this.documents = documents
    this.failures = failures
  }
}

type StagedUpload = {
  userId: string
  caseSessionId: Id<'caseSessions'>
  intentId: Id<'documentUploadIntents'>
  state: 'pending' | 'stored' | 'consumed'
  document: UploadedDocument
  analysis: DocumentAnalysis
}

const stagedUploads = new Map<string, StagedUpload>()
const inFlightUploads = new Map<string, Promise<UploadedDocument>>()

export function inferUploadedDocuments(
  files: FileList | null,
): UploadedDocument[] {
  return Array.from(files ?? []).map(inferDocumentSignals)
}

/** Return only successfully consumed uploads retained by this browser session. */
export function getCachedConsumedDocuments(
  userId: string,
  caseSessionId: Id<'caseSessions'>,
): UploadedDocument[] {
  return [...stagedUploads.values()]
    .filter(
      (upload) =>
        upload.userId === userId &&
        upload.caseSessionId === caseSessionId &&
        upload.state === 'consumed',
    )
    .map((upload) => upload.document)
}

export async function analyzeUploadAndPersistDocuments(
  workflow: DocumentUploadWorkflow,
  caseSessionId: Id<'caseSessions'>,
  files: FileList | null,
  options: DocumentUploadOptions,
): Promise<UploadedDocument[]> {
  const selectedFiles = Array.from(files ?? [])
  const results = await Promise.allSettled(
    selectedFiles.map((file) =>
      analyzeUploadAndPersistDocument(
        workflow,
        options.userId,
        caseSessionId,
        file,
        options.signal,
      ),
    ),
  )
  const documents = new Map<string, UploadedDocument>()
  const failures: Array<{ fileName: string; error: unknown }> = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      documents.set(result.value.id, result.value)
    } else {
      failures.push({
        fileName: selectedFiles[index]?.name ?? 'Selected PDF',
        error: normalizeTransferError(result.reason),
      })
    }
  })
  const completed = [...documents.values()]
  if (failures.length) throw new DocumentUploadBatchError(completed, failures)
  return completed
}

async function analyzeUploadAndPersistDocument(
  workflow: DocumentUploadWorkflow,
  userId: string,
  caseSessionId: Id<'caseSessions'>,
  file: File,
  signal?: AbortSignal,
): Promise<UploadedDocument> {
  assertPdfMetadata(file)
  throwIfAborted(signal)
  const sha256 = await sha256File(file, signal)
  throwIfAborted(signal)

  const cacheKey = JSON.stringify([userId, caseSessionId, file.name, sha256])
  const existingFlight = inFlightUploads.get(cacheKey)
  if (existingFlight) return existingFlight

  const transfer = transferPreparedFile(
    workflow,
    userId,
    caseSessionId,
    file,
    sha256,
    cacheKey,
    signal,
  )
  inFlightUploads.set(cacheKey, transfer)
  try {
    return await transfer
  } finally {
    if (inFlightUploads.get(cacheKey) === transfer) {
      inFlightUploads.delete(cacheKey)
    }
  }
}

async function transferPreparedFile(
  workflow: DocumentUploadWorkflow,
  userId: string,
  caseSessionId: Id<'caseSessions'>,
  file: File,
  sha256: string,
  cacheKey: string,
  signal?: AbortSignal,
) {
  let staged = stagedUploads.get(cacheKey)
  if (staged?.state === 'consumed') return staged.document

  if (!staged) {
    const base = inferDocumentSignals(file)
    let analysis: DocumentAnalysis
    try {
      const { pdfJsAnalyzer } =
        await import('../modules/documents/pdfjs-analyzer')
      analysis = await raceWithSignal(
        pdfJsAnalyzer.analyze({
          fileName: file.name,
          mimeType: 'application/pdf',
          sizeBytes: file.size,
          extractedSignals: base.extractedSignals,
          arrayBuffer: () => file.arrayBuffer(),
        }),
        signal,
      )
    } catch (error) {
      throw normalizeTransferError(error)
    }
    throwIfAborted(signal)
    const document = documentFromAnalysis(base, analysis, sha256)
    let intent: DocumentUploadIntent
    try {
      intent = await raceWithSignal(
        workflow.beginUpload({
          scope: { kind: 'session', caseSessionId },
          fileName: file.name,
          sizeBytes: file.size,
          sha256,
          mimeType: 'application/pdf',
        }),
        signal,
      )
    } catch (error) {
      throw normalizeTransferError(error)
    }
    if (intent.chunkBytes !== documentUploadChunkBytes) {
      void workflow
        .cancelUpload?.({ intentId: intent.intentId })
        .catch(() => undefined)
      throw new DocumentTransferError(
        'validation',
        'The upload service returned an unsupported chunk size.',
      )
    }
    staged = {
      userId,
      caseSessionId,
      intentId: intent.intentId,
      state: 'pending',
      document,
      analysis,
    }
    stagedUploads.set(cacheKey, staged)
  }

  try {
    throwIfAborted(signal)
    if (staged.state === 'pending') {
      await uploadFileChunks(workflow, staged.intentId, file, signal)
      const receipt = await completeWithBoundedRetry(
        workflow,
        staged.intentId,
        signal,
      )
      if (receipt.intentId !== staged.intentId) {
        throw new DocumentTransferError(
          'integrity',
          'The upload receipt did not match this document.',
        )
      }
      if (receipt.sizeBytes !== file.size || receipt.sha256 !== sha256) {
        throw new DocumentTransferError(
          'integrity',
          'The uploaded document failed its size or SHA-256 check.',
        )
      }
      staged.state = 'stored'
    }

    throwIfAborted(signal)
    const persisted = await raceWithSignal(
      workflow.persistDocumentAnalysis({
        caseSessionId,
        intentId: staged.intentId,
        document: withoutStorageId(staged.document),
        analysis: staged.analysis,
      }),
      signal,
    )
    throwIfAborted(signal)
    staged.document = withoutStorageId(persisted.document)
    staged.state = 'consumed'
    return staged.document
  } catch (error) {
    const normalized = normalizeTransferError(error)
    if (normalized.kind === 'expired') {
      stagedUploads.delete(cacheKey)
    } else if (normalized.kind === 'cancelled') {
      try {
        await workflow.cancelUpload?.({ intentId: staged.intentId })
        stagedUploads.delete(cacheKey)
      } catch {
        // Keep an uncertain receipt available for an idempotent retry.
      }
    }
    throw normalized
  }
}

function assertPdfMetadata(file: File) {
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    throw new DocumentTransferError('validation', 'Choose a non-empty PDF.')
  }
  if (file.size > maxDocumentUploadBytes) {
    throw new DocumentTransferError(
      'oversized',
      'PDFs must be 25 MiB or smaller.',
    )
  }
  if (file.name.length > 200) {
    throw new DocumentTransferError(
      'validation',
      'The file name must be 200 characters or fewer.',
    )
  }
  if (file.type && file.type.toLowerCase() !== 'application/pdf') {
    throw new DocumentTransferError(
      'validation',
      'Case session uploads must be PDFs.',
    )
  }
}

async function uploadFileChunks(
  workflow: DocumentUploadWorkflow,
  intentId: Id<'documentUploadIntents'>,
  file: File,
  signal?: AbortSignal,
) {
  const fetcher: DocumentHttpFetcher =
    workflow.fetcher ?? ((input, init) => globalThis.fetch(input, init))
  const chunkCount = Math.ceil(file.size / documentUploadChunkBytes)
  if (chunkCount < 1 || chunkCount > 7) {
    throw new DocumentTransferError(
      'oversized',
      'PDFs must fit within seven 4 MiB upload chunks.',
    )
  }

  for (let index = 0; index < chunkCount; index += 1) {
    throwIfAborted(signal)
    const start = index * documentUploadChunkBytes
    const chunk = file.slice(
      start,
      Math.min(file.size, start + documentUploadChunkBytes),
    )
    const expectedSize = chunk.size
    const bytes = new Uint8Array(
      await raceWithSignal(chunk.arrayBuffer(), signal),
    )
    const chunkSha256 = await sha256Bytes(bytes, signal)
    const token = await raceWithSignal(workflow.getAuthToken(), signal)
    if (!token) {
      throw new DocumentTransferError(
        'authentication',
        'Your sign-in is no longer valid. Sign in again, then retry this PDF.',
      )
    }
    const url = documentEndpoint(workflow.siteUrl, '/documents/chunk')
    url.searchParams.set('intentId', String(intentId))
    url.searchParams.set('index', String(index))

    let response: Response
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: chunk,
        signal,
      })
    } catch (error) {
      throw normalizeFetchError(error, signal)
    }
    if (!response.ok) throw await responseError(response, signal)
    const result = (await response.json().catch(() => null)) as {
      intentId?: string
      index?: number
      sizeBytes?: number
      sha256?: string
    } | null
    if (
      !result ||
      result.intentId !== String(intentId) ||
      result.index !== index ||
      result.sizeBytes !== expectedSize ||
      result.sha256 !== chunkSha256
    ) {
      throw new DocumentTransferError(
        'integrity',
        'An uploaded chunk failed its receipt or SHA-256 check.',
      )
    }
  }
}

async function completeWithBoundedRetry(
  workflow: DocumentUploadWorkflow,
  intentId: Id<'documentUploadIntents'>,
  signal?: AbortSignal,
) {
  let retries = 0
  while (true) {
    throwIfAborted(signal)
    try {
      return await raceWithSignal(workflow.completeUpload({ intentId }), signal)
    } catch (error) {
      const busy = completionBusy(error)
      if (!busy || retries >= maxCompletionBusyRetries) {
        if (busy) {
          throw new DocumentTransferError(
            'conflict',
            'This PDF is still being finalized. Retry the same file shortly; its upload receipt is being kept.',
            { retryable: true, cause: error },
          )
        }
        throw normalizeTransferError(error)
      }
      const delay = completionRetryDelay(error, retries)
      retries += 1
      await (workflow.wait ?? abortableDelay)(delay, signal)
    }
  }
}

async function sha256File(file: File, signal?: AbortSignal) {
  const bytes = new Uint8Array(await raceWithSignal(file.arrayBuffer(), signal))
  return sha256Bytes(bytes, signal)
}

async function sha256Bytes(bytes: Uint8Array, signal?: AbortSignal) {
  throwIfAborted(signal)
  if (!globalThis.crypto?.subtle) {
    throw new DocumentTransferError(
      'validation',
      'This browser cannot verify document checksums.',
    )
  }
  const digest = await raceWithSignal(
    globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer),
    signal,
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function documentFromAnalysis(
  base: UploadedDocument,
  analysis: DocumentAnalysis,
  sha256: string,
): UploadedDocument {
  return withoutStorageId({
    ...base,
    sha256,
    ...(typeof analysis.pageCount === 'number'
      ? { pageCount: analysis.pageCount }
      : {}),
    ...(analysis.normalizedText
      ? { extractedText: analysis.normalizedText }
      : {}),
    ...(analysis.textExtractionStatus
      ? { textExtractionStatus: analysis.textExtractionStatus }
      : {}),
    ...(typeof analysis.wordCount === 'number'
      ? { wordCount: analysis.wordCount }
      : {}),
    extractedSignals: signalsFromAnalysis(base, analysis),
    analysis,
  })
}

function withoutStorageId(document: UploadedDocument): UploadedDocument {
  const { storageId: _storageId, ...safeDocument } = document
  return safeDocument
}

function signalsFromAnalysis(
  base: UploadedDocument,
  analysis: DocumentAnalysis,
) {
  return [
    ...base.extractedSignals,
    ...(analysis.sectionMap?.map((section) => section.label.toLowerCase()) ??
      []),
    ...(analysis.certificateOfServiceDetected
      ? ['certificate of service']
      : []),
    ...(analysis.certificateOfComplianceDetected
      ? ['certificate of compliance']
      : []),
    ...((analysis.recordCitations?.length ?? 0) > 0 ? ['record citation'] : []),
    ...((analysis.appendixCitations?.length ?? 0) > 0 ? ['appendix'] : []),
  ].filter((signal, index, values) => values.indexOf(signal) === index)
}

function documentEndpoint(siteUrl: string | undefined, path: string) {
  if (!siteUrl) {
    throw new DocumentTransferError(
      'server',
      'VITE_CONVEX_SITE_URL is not configured for document transport.',
    )
  }
  let base: URL
  try {
    base = new URL(siteUrl)
  } catch (error) {
    throw new DocumentTransferError(
      'server',
      'VITE_CONVEX_SITE_URL must be a valid Convex HTTP URL.',
      { cause: error },
    )
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password
  ) {
    throw new DocumentTransferError(
      'server',
      'VITE_CONVEX_SITE_URL must use HTTP or HTTPS without credentials.',
    )
  }
  return new URL(path, base.origin)
}

async function responseError(response: Response, signal?: AbortSignal) {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown
  } | null
  const serverMessage = typeof body?.error === 'string' ? body.error : ''
  if (response.status === 401) {
    return new DocumentTransferError(
      'authentication',
      'Your sign-in expired or is unavailable. Sign in again, then retry this document.',
    )
  }
  if (response.status === 403) {
    return new DocumentTransferError(
      'forbidden',
      'The document request was denied. Check organization access and the configured document origin.',
    )
  }
  if (response.status === 404) {
    return new DocumentTransferError(
      'not-found',
      'This document is no longer available.',
    )
  }
  if (response.status === 409) {
    return new DocumentTransferError(
      'conflict',
      serverMessage ||
        'The document transfer conflicts with its upload receipt.',
      { retryable: true },
    )
  }
  if (response.status === 410) {
    return new DocumentTransferError(
      'expired',
      'The upload receipt expired. Select the PDF again to start a new upload.',
    )
  }
  if (response.status === 413) {
    return new DocumentTransferError(
      'oversized',
      'The document exceeds the 25 MiB limit.',
    )
  }
  if (response.status === 422) {
    const isIntegrityError =
      /hash|checksum|size does not match|signature/i.test(serverMessage)
    return new DocumentTransferError(
      isIntegrityError ? 'integrity' : 'validation',
      serverMessage || 'The document failed server validation.',
    )
  }
  if (signal?.aborted) return cancelledError()
  return new DocumentTransferError(
    'server',
    'The private document service could not accept this request. Retry the same PDF.',
    { retryable: response.status >= 500 },
  )
}

function completionBusy(error: unknown) {
  const data = errorData(error)
  return (
    data?.metadata?.reason === 'UPLOAD_COMPLETION_BUSY' &&
    data.metadata.retryable === true
  )
}

function completionRetryDelay(error: unknown, retryIndex: number) {
  const retryAfter = errorData(error)?.metadata?.retryAfterMs
  const requested =
    typeof retryAfter === 'number' &&
    Number.isFinite(retryAfter) &&
    retryAfter > 0
      ? retryAfter
      : 0
  return Math.min(
    maxCompletionRetryDelayMs,
    Math.max(requested, 250 * 2 ** retryIndex),
  )
}

function errorData(error: unknown): {
  code?: string
  message?: string
  metadata?: Record<string, unknown>
} | null {
  if (!error || typeof error !== 'object') return null
  let value = (error as { data?: unknown }).data
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object'
    ? (value as {
        code?: string
        message?: string
        metadata?: Record<string, unknown>
      })
    : null
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The document transfer failed.'
}

function normalizeTransferError(error: unknown): DocumentTransferError {
  if (error instanceof DocumentTransferError) return error
  if (isAbortError(error)) return cancelledError(error)
  const data = errorData(error)
  const message = data?.message || messageFor(error)
  const lower = message.toLowerCase()
  if (data?.metadata?.reason === 'UPLOAD_EXPIRED') {
    return new DocumentTransferError(
      'expired',
      'The upload receipt expired. Select the PDF again to retry.',
      { cause: error },
    )
  }
  if (
    data?.code === 'AUTH_REQUIRED' ||
    data?.code === 'AUTH_USER_NOT_INITIALIZED'
  ) {
    return new DocumentTransferError(
      'authentication',
      'Your sign-in expired or is unavailable. Sign in again, then retry this document.',
      { cause: error },
    )
  }
  if (data?.code === 'AUTH_UNAUTHORIZED_ROLE') {
    return new DocumentTransferError('forbidden', message, { cause: error })
  }
  if (/case session .* admission limit|session admission limit/.test(lower)) {
    return new DocumentTransferError('validation', message, {
      retryable: true,
      cause: error,
    })
  }
  if (/oversize|25 mib|too large/.test(lower)) {
    return new DocumentTransferError('oversized', message, { cause: error })
  }
  if (/hash|checksum|signature|size does not match/.test(lower)) {
    return new DocumentTransferError('integrity', message, { cause: error })
  }
  if (data?.code === 'CONFLICT' || data?.code === 'SESSION_LOCKED') {
    return new DocumentTransferError('conflict', message, {
      retryable: true,
      cause: error,
    })
  }
  if (data?.code === 'VALIDATION_ERROR') {
    return new DocumentTransferError('validation', message, { cause: error })
  }
  return new DocumentTransferError('server', message, {
    retryable: true,
    cause: error,
  })
}

function normalizeFetchError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted || isAbortError(error)) return cancelledError(error)
  return new DocumentTransferError(
    'cors',
    'Could not reach the private document service. Check VITE_CONVEX_SITE_URL and the exact-origin DOCUMENT_ALLOWED_ORIGINS setting.',
    { retryable: true, cause: error },
  )
}

function cancelledError(cause?: unknown) {
  return new DocumentTransferError(
    'cancelled',
    'Document transfer was cancelled.',
    {
      cause,
    },
  )
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'CanceledError')
  )
}

function throwIfAborted(
  signal?: AbortSignal,
): asserts signal is AbortSignal | undefined {
  if (signal?.aborted) throw cancelledError(signal.reason)
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(cancelledError(signal.reason))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelledError(signal.reason))
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!signal)
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  if (signal.aborted) return Promise.reject(cancelledError(signal.reason))
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(cancelledError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
