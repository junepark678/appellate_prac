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

import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import schema from '../../convex/schema'
import {
  DocumentDownloadManager,
  documentDownloadObjectUrlLifetimeMs,
} from './document-download'
import type { DownloadableDocument } from './document-download'
import {
  documentUploadChunkBytes,
  maxDocumentUploadBytes,
} from './document-upload'
import type { DocumentHttpFetcher } from './document-upload'

const appBytes = new Uint8Array(documentUploadChunkBytes + 37)
appBytes.set(new TextEncoder().encode('%PDF-1.7\nprivate document'))
const appOrigin = 'https://fixture.convex.site'
const appWebOrigin = 'https://app.example.test'
const registeredModules = {
  './_generated/api.ts': () => import('../../convex/_generated/api'),
  './_generated/server.ts': () => import('../../convex/_generated/server'),
  './assignments.ts': () => import('../../convex/assignments'),
  './authHelpers.ts': () => import('../../convex/authHelpers'),
  './authz.ts': () => import('../../convex/authz'),
  './caseSessionEventLog.ts': () => import('../../convex/caseSessionEventLog'),
  './caseSessions.ts': () => import('../../convex/caseSessions'),
  './documentDownloads.ts': () => import('../../convex/documentDownloads'),
  './documentUploadActions.ts': () =>
    import('../../convex/documentUploadActions'),
  './documentUploads.ts': () => import('../../convex/documentUploads'),
  './errors.ts': () => import('../../convex/errors'),
  './http.ts': () => import('../../convex/http'),
  './organizationContracts.ts': () =>
    import('../../convex/organizationContracts'),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guarded document download', () => {
  it('checks private response headers, size, and SHA-256 before creating a local Blob URL', async () => {
    const document = await downloadable(appBytes)
    const fixture = downloadWorkflow(document, appBytes)
    const manager = new DocumentDownloadManager(fixture.workflow)

    const url = await manager.download(document)
    expect(url).toBe('blob:fixture-1')
    expect(fixture.requests).toHaveLength(2)
    expect(fixture.requests[0]?.url.origin).toBe(appOrigin)
    expect(fixture.requests[0]?.url.pathname).toBe('/documents/content')
    expect(fixture.requests[0]?.url.searchParams.get('documentId')).toBe(
      document.id,
    )
    expect(fixture.requests[0]?.url.searchParams.has('storageId')).toBe(false)
    expect(fixture.requests[0]?.init?.headers).toEqual({
      Authorization: 'Bearer download-jwt',
    })
    expect(fixture.blobs).toHaveLength(1)
    expect(fixture.blobs[0]?.type).toBe('application/pdf')
    expect(fixture.blobs[0]?.size).toBe(appBytes.byteLength)
    expect(new Uint8Array(await fixture.blobs[0]!.arrayBuffer())).toEqual(
      appBytes,
    )

    manager.dispose()
    expect(fixture.objectUrls.revokeObjectURL).toHaveBeenCalledWith(url)
  }, 30_000)

  it('downloads bytes through the actual registered authenticated Convex HTTP handler', async () => {
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appWebOrigin)
    const t = convexTest(schema, registeredModules)
    const fixture = await seedStoredDocument(
      t,
      new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]),
    )
    const bytes = new Uint8Array(fixture.bytes)
    const client = t.withIdentity(testIdentity('download-owner'))
    const fetcher: DocumentHttpFetcher = (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      headers.set('Origin', appWebOrigin)
      return client
        .fetch(`${url.pathname}${url.search}`, { ...init, headers })
        .then(async (response) => {
          // Browser CORS exposes only the server's declared headers plus the
          // safelisted response headers. X-Content-Type-Options stays server-side.
          const exposedHeaders = new Headers()
          for (const name of [
            'Cache-Control',
            'Content-Disposition',
            'Content-Length',
            'Content-Type',
            'X-Document-Size',
          ]) {
            const value = response.headers.get(name)
            if (value !== null) exposedHeaders.set(name, value)
          }
          return new Response(await response.arrayBuffer(), {
            status: response.status,
            headers: exposedHeaders,
          })
        })
    }
    const fixtureWorkflow = downloadWorkflow(fixture.document, bytes)
    const manager = new DocumentDownloadManager({
      ...fixtureWorkflow.workflow,
      fetcher,
    })

    const objectUrl = await manager.download(fixture.document)
    expect(objectUrl).toBe('blob:fixture-1')
    expect(fixtureWorkflow.blobs).toHaveLength(1)
    expect(
      new Uint8Array(await fixtureWorkflow.blobs[0]!.arrayBuffer()),
    ).toEqual(bytes)
    manager.dispose()
  })

  it('revokes the prior object URL on replacement and all remaining URLs on unmount', async () => {
    const document = await downloadable(
      new Uint8Array([37, 80, 68, 70, 45, 49]),
    )
    const fixture = downloadWorkflow(
      document,
      new Uint8Array([37, 80, 68, 70, 45, 49]),
    )
    const manager = new DocumentDownloadManager(fixture.workflow)
    const first = await manager.download(document)
    const second = await manager.download(document)

    expect(first).toBe('blob:fixture-1')
    expect(second).toBe('blob:fixture-2')
    expect(fixture.objectUrls.revokeObjectURL).toHaveBeenNthCalledWith(1, first)
    manager.dispose()
    expect(fixture.objectUrls.revokeObjectURL).toHaveBeenNthCalledWith(
      2,
      second,
    )
  })

  it('expires dispatched URLs for distinct documents and clears timers on unmount', async () => {
    vi.useFakeTimers()
    try {
      const bytes = new Uint8Array([37, 80, 68, 70, 45, 49])
      const baseDocument = await downloadable(bytes)
      const fixture = downloadWorkflow(baseDocument, bytes)
      const manager = new DocumentDownloadManager(fixture.workflow)
      const documents = ['one', 'two', 'three'].map((id) => ({
        ...baseDocument,
        id,
      }))

      const urls = []
      for (const document of documents) {
        const url = await manager.download(document)
        urls.push(url)
        manager.revokeAfterDispatch(document.id)
      }
      expect(fixture.objectUrls.createObjectURL).toHaveBeenCalledTimes(3)
      expect(fixture.objectUrls.revokeObjectURL).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(documentDownloadObjectUrlLifetimeMs - 1)
      expect(fixture.objectUrls.revokeObjectURL).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(fixture.objectUrls.revokeObjectURL).toHaveBeenCalledTimes(3)
      for (const url of urls) {
        expect(fixture.objectUrls.revokeObjectURL).toHaveBeenCalledWith(url)
      }

      const unmountDocument = { ...baseDocument, id: 'unmount' }
      const unmountUrl = await manager.download(unmountDocument)
      manager.revokeAfterDispatch(unmountDocument.id)
      manager.dispose()
      expect(fixture.objectUrls.revokeObjectURL).toHaveBeenCalledTimes(4)
      expect(fixture.objectUrls.revokeObjectURL).toHaveBeenLastCalledWith(
        unmountUrl,
      )
      await vi.advanceTimersByTimeAsync(documentDownloadObjectUrlLifetimeMs)
      expect(fixture.objectUrls.revokeObjectURL).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight request and revokes on explicit cancellation', async () => {
    const document = await downloadable(new Uint8Array([37, 80, 68, 70, 45]))
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => (requestStarted = resolve))
    let requestSignal: AbortSignal | null | undefined
    const fixture = downloadWorkflow(
      document,
      new Uint8Array([37, 80, 68, 70, 45]),
      {
        fetcher: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal
            requestStarted()
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            )
          }),
      },
    )
    const manager = new DocumentDownloadManager(fixture.workflow)
    const operation = manager.download(document)
    await started
    manager.revoke(document.id)

    await expect(operation).rejects.toMatchObject({ kind: 'cancelled' })
    expect(requestSignal?.aborted).toBe(true)
    expect(fixture.objectUrls.createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects missing or incorrect size, content type, attachment, cache, and checksum headers', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49])
    const document = await downloadable(bytes)

    for (const headers of [
      { ...privateHeaders(bytes, document), 'X-Document-Size': '999' },
      { ...privateHeaders(bytes, document), 'Content-Length': '3' },
      { ...privateHeaders(bytes, document), 'Content-Type': 'text/html' },
      {
        ...privateHeaders(bytes, document),
        'Content-Disposition': 'inline; filename="brief.pdf"',
      },
      {
        ...privateHeaders(bytes, document),
        'Cache-Control': 'public, max-age=60',
      },
    ]) {
      const fixture = downloadWorkflow(document, bytes, {
        responseHeaders: headers,
      })
      const manager = new DocumentDownloadManager(fixture.workflow)
      await expect(manager.download(document)).rejects.toMatchObject({
        kind: 'integrity',
      })
      expect(fixture.objectUrls.createObjectURL).not.toHaveBeenCalled()
      manager.dispose()
    }

    const wrongBytes = bytes.slice()
    wrongBytes[wrongBytes.length - 1] = 0
    const hashFixture = downloadWorkflow(document, wrongBytes)
    const hashManager = new DocumentDownloadManager(hashFixture.workflow)
    await expect(hashManager.download(document)).rejects.toMatchObject({
      kind: 'integrity',
    })
    expect(hashFixture.objectUrls.createObjectURL).not.toHaveBeenCalled()
  })

  it('handles expired authentication, oversize metadata, and CORS errors without creating URLs', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49])
    const document = await downloadable(bytes)

    const expired = downloadWorkflow(document, bytes, {
      getAuthToken: async () => null,
    })
    const expiredManager = new DocumentDownloadManager(expired.workflow)
    await expect(expiredManager.download(document)).rejects.toMatchObject({
      kind: 'authentication',
    })
    expect(expired.requests).toHaveLength(0)

    const oversizedDocument = {
      ...document,
      sizeBytes: maxDocumentUploadBytes + 1,
    }
    const oversized = downloadWorkflow(oversizedDocument, bytes)
    const oversizedManager = new DocumentDownloadManager(oversized.workflow)
    await expect(
      oversizedManager.download(oversizedDocument),
    ).rejects.toMatchObject({ kind: 'oversized' })
    expect(oversized.requests).toHaveLength(0)

    const cors = downloadWorkflow(document, bytes, {
      fetcher: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const corsManager = new DocumentDownloadManager(cors.workflow)
    await expect(corsManager.download(document)).rejects.toMatchObject({
      kind: 'cors',
    })
    expect(cors.objectUrls.createObjectURL).not.toHaveBeenCalled()
  })

  it('cancels downloads when the caller signs out or changes session scope', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49])
    const document = await downloadable(bytes)
    const controller = new AbortController()
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => (started = resolve))
    const fixture = downloadWorkflow(document, bytes, {
      fetcher: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          started()
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    })
    const manager = new DocumentDownloadManager(fixture.workflow)
    const operation = manager.download(document, { signal: controller.signal })
    await requestStarted
    controller.abort('signed out')
    await expect(operation).rejects.toMatchObject({ kind: 'cancelled' })
    expect(fixture.objectUrls.createObjectURL).not.toHaveBeenCalled()
  })
})

function downloadWorkflow(
  document: DownloadableDocument,
  bytes: Uint8Array,
  overrides: {
    fetcher?: DocumentHttpFetcher
    getAuthToken?: () => Promise<string | null>
    responseHeaders?: Record<string, string>
  } = {},
) {
  const requests: Array<{ url: URL; init?: RequestInit }> = []
  const blobs: Blob[] = []
  let objectUrlSequence = 0
  const objectUrls = {
    createObjectURL: vi.fn((blob: Blob) => {
      blobs.push(blob)
      objectUrlSequence += 1
      return `blob:fixture-${objectUrlSequence}`
    }),
    revokeObjectURL: vi.fn(),
  }
  const fetcher: DocumentHttpFetcher =
    overrides.fetcher ??
    (async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input))
      requests.push({ url, init })
      const index = Number(url.searchParams.get('chunk'))
      const start = index * documentUploadChunkBytes
      const slice = bytes.slice(
        start,
        Math.min(bytes.length, start + documentUploadChunkBytes),
      )
      return new Response(slice, {
        status: 200,
        headers:
          overrides.responseHeaders ?? privateHeaders(bytes, document, index),
      })
    })

  return {
    requests,
    blobs,
    objectUrls,
    workflow: {
      siteUrl: appOrigin,
      getAuthToken: overrides.getAuthToken ?? (async () => 'download-jwt'),
      fetcher,
      objectUrls,
    },
  }
}

function privateHeaders(
  bytes: Uint8Array,
  document: DownloadableDocument,
  index = 0,
) {
  const indexLength = Math.min(
    documentUploadChunkBytes,
    Math.max(0, bytes.length - index * documentUploadChunkBytes),
  )
  return {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${document.fileName}"`,
    'Content-Length': String(indexLength),
    'Content-Type': 'application/pdf',
    'X-Content-Type-Options': 'nosniff',
    'X-Document-Size': String(document.sizeBytes),
  }
}

async function downloadable(bytes: Uint8Array): Promise<DownloadableDocument> {
  return {
    id: 'documents_private_fixture',
    fileName: 'brief.pdf',
    mimeType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    sha256: await digest(bytes),
  }
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

function testIdentity(subject: string) {
  return {
    issuer: 'https://identity.example.test',
    subject,
    tokenIdentifier: `https://identity.example.test|${subject}`,
    name: subject,
  }
}

async function seedStoredDocument(
  t: TestConvex<typeof schema>,
  bytes: Uint8Array,
) {
  const sha256 = await digest(bytes)
  return t.run(async (ctx) => {
    const createdAt = new Date().toISOString()
    const userId = await ctx.db.insert('users', {
      authSubject: testIdentity('download-owner').tokenIdentifier,
      displayName: 'Download owner',
      monthlyAiBudgetCents: 0,
    })
    const institutionId = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt,
      name: 'Download fixture organization',
      slug: 'download-fixture-organization',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId,
      role: 'learner',
      status: 'active',
      createdAt,
    })
    const scenarioId = await ctx.db.insert('scenarios', {
      scenarioKey: 'browser-download-fixture',
      visibility: 'public_template',
      revisionStatus: 'published',
      title: 'Browser download fixture',
      source: 'synthetic',
      courtPackId: 'us-federal-ca4-civil-appeal',
      shortCaption: 'Download Fixture v. Test',
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
      userId,
      courtPackId: 'us-federal-ca4-civil-appeal',
      status: 'active',
      simulatedDate: createdAt,
    })
    const storageId = await ctx.storage.store(
      new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: 'application/pdf',
      }),
    )
    const documentId = await ctx.db.insert('documents', {
      caseSessionId,
      storageId,
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256,
      extractedSignals: [],
    })
    return {
      bytes: Array.from(bytes),
      document: {
        id: documentId,
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        sha256,
      },
    }
  })
}
