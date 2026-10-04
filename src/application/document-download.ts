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

import {
  DocumentTransferError,
  type DocumentHttpFetcher,
  documentUploadChunkBytes,
  maxDocumentUploadBytes,
} from './document-upload'

export type DownloadableDocument = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256?: string
}

export const documentDownloadObjectUrlLifetimeMs = 60_000

export type DocumentDownloadWorkflow = {
  siteUrl: string | undefined
  getAuthToken: () => Promise<string | null>
  fetcher?: DocumentHttpFetcher
  objectUrls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

type DownloadEntry = {
  controller: AbortController
  objectUrl?: string
}

export class DocumentDownloadManager {
  private readonly entries = new Map<string, DownloadEntry>()
  private readonly revokeTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private readonly fetcher: DocumentHttpFetcher
  private readonly objectUrls: Pick<
    typeof URL,
    'createObjectURL' | 'revokeObjectURL'
  >
  private disposed = false

  constructor(private readonly workflow: DocumentDownloadWorkflow) {
    this.fetcher =
      workflow.fetcher ?? ((input, init) => globalThis.fetch(input, init))
    this.objectUrls = workflow.objectUrls ?? URL
  }

  async download(
    document: DownloadableDocument,
    options: { signal?: AbortSignal } = {},
  ) {
    if (this.disposed) {
      throw new DocumentTransferError(
        'cancelled',
        'Document downloads have been closed.',
      )
    }
    validateDocument(document)
    this.revoke(document.id)

    const controller = new AbortController()
    const entry: DownloadEntry = { controller }
    this.entries.set(document.id, entry)
    const signal = controller.signal
    const externalSignal = options.signal
    const onExternalAbort = () => {
      if (this.entries.get(document.id) === entry) this.revoke(document.id)
      else controller.abort(externalSignal?.reason)
    }
    if (externalSignal?.aborted) onExternalAbort()
    else
      externalSignal?.addEventListener('abort', onExternalAbort, {
        once: true,
      })

    try {
      const bytes = await this.fetchDocumentBytes(document, signal, entry)
      if (!this.isCurrent(document.id, entry)) {
        throw new DocumentTransferError(
          'cancelled',
          'Document download was cancelled.',
        )
      }
      const digest = await sha256(bytes, signal)
      if (digest !== document.sha256) {
        throw new DocumentTransferError(
          'integrity',
          'The downloaded document failed its SHA-256 check.',
        )
      }
      if (bytes.byteLength !== document.sizeBytes) {
        throw new DocumentTransferError(
          'integrity',
          'The downloaded document failed its size check.',
        )
      }
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: document.mimeType,
      })
      if (blob.size !== document.sizeBytes) {
        throw new DocumentTransferError(
          'integrity',
          'The downloaded document failed its Blob size check.',
        )
      }
      const objectUrl = this.objectUrls.createObjectURL(blob)
      if (!this.isCurrent(document.id, entry)) {
        this.objectUrls.revokeObjectURL(objectUrl)
        throw new DocumentTransferError(
          'cancelled',
          'Document download was cancelled.',
        )
      }
      entry.objectUrl = objectUrl
      return objectUrl
    } catch (error) {
      if (this.entries.get(document.id) === entry && !entry.objectUrl) {
        this.entries.delete(document.id)
      }
      throw normalizeDownloadError(error, signal)
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  revoke(documentId: string) {
    const timer = this.revokeTimers.get(documentId)
    if (timer !== undefined) clearTimeout(timer)
    this.revokeTimers.delete(documentId)
    const entry = this.entries.get(documentId)
    if (!entry) return
    this.entries.delete(documentId)
    entry.controller.abort()
    if (entry.objectUrl) this.objectUrls.revokeObjectURL(entry.objectUrl)
  }

  revokeAfterDispatch(documentId: string) {
    const entry = this.entries.get(documentId)
    if (!entry?.objectUrl || this.disposed) return
    const previousTimer = this.revokeTimers.get(documentId)
    if (previousTimer !== undefined) clearTimeout(previousTimer)
    const timer = setTimeout(() => {
      this.revokeTimers.delete(documentId)
      if (this.entries.get(documentId) === entry) this.revoke(documentId)
    }, documentDownloadObjectUrlLifetimeMs)
    this.revokeTimers.set(documentId, timer)
  }

  revokeAll() {
    for (const documentId of [...this.entries.keys()]) this.revoke(documentId)
  }

  dispose() {
    this.disposed = true
    this.revokeAll()
  }

  private isCurrent(documentId: string, entry: DownloadEntry) {
    return (
      !this.disposed &&
      !entry.controller.signal.aborted &&
      this.entries.get(documentId) === entry
    )
  }

  private async fetchDocumentBytes(
    document: DownloadableDocument,
    signal: AbortSignal,
    entry: DownloadEntry,
  ) {
    const assembled = new Uint8Array(document.sizeBytes)
    const chunkCount = Math.ceil(document.sizeBytes / documentUploadChunkBytes)
    for (let index = 0; index < chunkCount; index += 1) {
      if (!this.isCurrent(document.id, entry)) {
        throw new DocumentTransferError(
          'cancelled',
          'Document download was cancelled.',
        )
      }
      const token = await raceWithSignal(this.workflow.getAuthToken(), signal)
      if (!token) {
        throw new DocumentTransferError(
          'authentication',
          'Your sign-in expired or is unavailable. Sign in again, then retry this download.',
        )
      }
      const url = documentEndpoint(this.workflow.siteUrl)
      url.searchParams.set('documentId', document.id)
      url.searchParams.set('chunk', String(index))

      let response: Response
      try {
        response = await this.fetcher(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal,
        })
      } catch (error) {
        throw normalizeFetchError(error, signal)
      }
      if (!response.ok) throw await responseError(response)

      const start = index * documentUploadChunkBytes
      const expectedChunkSize = Math.min(
        documentUploadChunkBytes,
        document.sizeBytes - start,
      )
      assertResponseHeaders(response, document, expectedChunkSize)
      const chunk = new Uint8Array(
        await raceWithSignal(response.arrayBuffer(), signal),
      )
      if (chunk.byteLength !== expectedChunkSize) {
        throw new DocumentTransferError(
          'integrity',
          'A downloaded chunk failed its Content-Length check.',
        )
      }
      assembled.set(chunk, start)
    }
    return assembled
  }
}

function validateDocument(document: DownloadableDocument) {
  if (!document.id || !document.fileName || !document.mimeType) {
    throw new DocumentTransferError(
      'validation',
      'Document metadata is incomplete.',
    )
  }
  if (
    !Number.isSafeInteger(document.sizeBytes) ||
    document.sizeBytes < 1 ||
    document.sizeBytes > maxDocumentUploadBytes
  ) {
    throw new DocumentTransferError(
      'oversized',
      'Downloads must be between 1 byte and 25 MiB.',
    )
  }
  if (!document.sha256 || !/^[0-9a-f]{64}$/.test(document.sha256)) {
    throw new DocumentTransferError(
      'integrity',
      'A trusted SHA-256 checksum is required before downloading this document.',
    )
  }
}

function assertResponseHeaders(
  response: Response,
  document: DownloadableDocument,
  expectedChunkSize: number,
) {
  const documentSize = response.headers.get('X-Document-Size')
  const contentLength = response.headers.get('Content-Length')
  const contentType = response.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  const disposition = response.headers
    .get('Content-Disposition')
    ?.trim()
    .toLowerCase()
  const expectedContentType =
    document.mimeType.toLowerCase() === 'application/pdf'
      ? 'application/pdf'
      : 'application/octet-stream'

  if (
    !documentSize ||
    !/^\d+$/.test(documentSize) ||
    Number(documentSize) !== document.sizeBytes
  ) {
    throw new DocumentTransferError(
      'integrity',
      'The download response did not match the expected document size.',
    )
  }
  if (
    !contentLength ||
    !/^\d+$/.test(contentLength) ||
    Number(contentLength) !== expectedChunkSize
  ) {
    throw new DocumentTransferError(
      'integrity',
      'The download response did not match the expected chunk size.',
    )
  }
  if (contentType !== expectedContentType) {
    throw new DocumentTransferError(
      'integrity',
      'The download response has an unexpected content type.',
    )
  }
  if (!disposition?.startsWith('attachment;')) {
    throw new DocumentTransferError(
      'integrity',
      'The download response is missing its safe attachment header.',
    )
  }
  if (
    response.headers
      .get('Cache-Control')
      ?.toLowerCase()
      .includes('no-store') !== true
  ) {
    throw new DocumentTransferError(
      'integrity',
      'The download response is missing its private cache protection.',
    )
  }
}

function documentEndpoint(siteUrl: string | undefined) {
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
  return new URL('/documents/content', base.origin)
}

async function responseError(response: Response) {
  if (response.status === 401) {
    return new DocumentTransferError(
      'authentication',
      'Your sign-in expired or is unavailable. Sign in again, then retry this download.',
    )
  }
  if (response.status === 403) {
    return new DocumentTransferError(
      'forbidden',
      'You no longer have access to this document or its configured origin.',
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
      'The document changed while it was being downloaded.',
      { retryable: true },
    )
  }
  if (response.status === 413) {
    return new DocumentTransferError(
      'oversized',
      'The document exceeds the 25 MiB limit.',
    )
  }
  if (response.status === 422) {
    return new DocumentTransferError(
      'validation',
      'The document request is invalid.',
    )
  }
  return new DocumentTransferError(
    'server',
    'The private document service could not return this file. Retry the download.',
    { retryable: response.status >= 500 },
  )
}

async function sha256(bytes: Uint8Array, signal: AbortSignal) {
  if (!globalThis.crypto?.subtle) {
    throw new DocumentTransferError(
      'integrity',
      'This browser cannot verify downloaded document checksums.',
    )
  }
  const digest = await raceWithSignal(
    globalThis.crypto.subtle.digest(
      'SHA-256',
      bytes.slice().buffer as ArrayBuffer,
    ),
    signal,
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function normalizeFetchError(error: unknown, signal: AbortSignal) {
  if (
    signal.aborted ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new DocumentTransferError(
      'cancelled',
      'Document download was cancelled.',
      {
        cause: error,
      },
    )
  }
  return new DocumentTransferError(
    'cors',
    'Could not reach the private document service. Check VITE_CONVEX_SITE_URL and the exact-origin DOCUMENT_ALLOWED_ORIGINS setting.',
    { retryable: true, cause: error },
  )
}

function normalizeDownloadError(error: unknown, signal: AbortSignal) {
  if (error instanceof DocumentTransferError) return error
  if (
    signal.aborted ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new DocumentTransferError(
      'cancelled',
      'Document download was cancelled.',
      {
        cause: error,
      },
    )
  }
  return new DocumentTransferError(
    'server',
    error instanceof Error ? error.message : 'Document download failed.',
    { retryable: true, cause: error },
  )
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      new DocumentTransferError(
        'cancelled',
        'Document download was cancelled.',
      ),
    )
  }
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(
        new DocumentTransferError(
          'cancelled',
          'Document download was cancelled.',
        ),
      )
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}
