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

import { httpRouter, makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { httpAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { enqueueCleanupWithBoundedRetry } from './documentUploadCleanup'
import { AppErrorCode, ConvexError, validationError } from './errors'

const maxChunkBytes = 4 * 1024 * 1024
const maxDocumentBytes = 25 * 1024 * 1024

type CorsPolicy = {
  methods: string
  allowedHeaders: string
  exposedHeaders?: string
  nosniff?: boolean
}

const uploadCors: CorsPolicy = {
  methods: 'POST, OPTIONS',
  allowedHeaders: 'Authorization, Content-Type',
}
const downloadCors: CorsPolicy = {
  methods: 'GET, OPTIONS',
  allowedHeaders: 'Authorization',
  exposedHeaders: 'Content-Disposition, Content-Type, X-Document-Size',
  nosniff: true,
}

const authorizeChunkRef = makeFunctionReference<
  'query',
  { intentId: string; index: number },
  {
    expectedSize: number
    existingChunk?: { sizeBytes: number; sha256: string }
  }
>('documentUploads:authorizeChunk')
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
const queueUploadCleanupRef = makeFunctionReference<
  'mutation',
  { storageIds: Id<'_storage'>[] },
  Id<'_storage'>[]
>('documentUploads:queueUploadCleanup')
const authorizeDocumentChunkRef = makeFunctionReference<
  'query',
  { documentId: string; chunk: number },
  {
    storageId: Id<'_storage'>
    fileName: string
    mimeType: string
    sizeBytes: number
    startBytes: number
    chunkSizeBytes: number
  }
>('documentDownloads:authorizeChunk')

async function queueTemporaryChunkCleanup(
  ctx: ActionCtx,
  storageId: Id<'_storage'>,
) {
  try {
    await enqueueCleanupWithBoundedRetry(() =>
      ctx.runMutation(queueUploadCleanupRef, { storageIds: [storageId] }),
    )
  } catch (error) {
    // The record mutation may have committed despite an ambiguous transport
    // failure. Leave the object untouched when cleanup cannot be durably queued.
    console.error('Unable to queue temporary upload cleanup', error)
  }
}

function allowedOrigins() {
  return new Set(
    (process.env.DOCUMENT_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => {
        if (!value) return false
        try {
          const url = new URL(value)
          return (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            url.origin === value
          )
        } catch {
          return false
        }
      }),
  )
}

function responseHeaders(
  request: Request,
  policy: CorsPolicy = uploadCors,
): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  })
  if (policy.nosniff) {
    headers.set('X-Content-Type-Options', 'nosniff')
  }
  const origin = request.headers.get('Origin')
  if (origin && allowedOrigins().has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', policy.methods)
    headers.set('Access-Control-Allow-Headers', policy.allowedHeaders)
    if (policy.exposedHeaders) {
      headers.set('Access-Control-Expose-Headers', policy.exposedHeaders)
    }
    headers.set('Access-Control-Max-Age', '600')
  }
  return headers
}

function errorStatus(error: unknown) {
  const data =
    error instanceof ConvexError
      ? error.data
      : (
          error as {
            data?: {
              code?: string
              message?: string
              metadata?: { reason?: string }
            }
          }
        )?.data
  if (data?.metadata?.reason === 'UPLOAD_EXPIRED') return 410
  if (data?.metadata?.reason === 'DOCUMENT_OVERSIZE') return 413
  switch (data?.code) {
    case AppErrorCode.AUTH_REQUIRED:
    case AppErrorCode.AUTH_USER_NOT_INITIALIZED:
      return 401
    case AppErrorCode.NOT_FOUND:
      return 404
    case AppErrorCode.AUTH_UNAUTHORIZED_ROLE:
      return 403
    case AppErrorCode.CONFLICT:
    case AppErrorCode.SESSION_LOCKED:
      return 409
    case AppErrorCode.VALIDATION_ERROR:
      return 422
    default:
      return 500
  }
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const data = (
      error as Error & { data?: { code?: string; message?: string } }
    ).data
    if (data?.message) return data.message
    if (error instanceof ConvexError) return error.message
  }
  return 'Upload request failed.'
}

function errorResponse(request: Request, error: unknown) {
  const headers = responseHeaders(request)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({ error: publicErrorMessage(error) }), {
    status: errorStatus(error),
    headers,
  })
}

function downloadErrorResponse(request: Request, error: unknown) {
  const headers = responseHeaders(request, downloadCors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  const status =
    (error as { httpStatus?: number })?.httpStatus ?? errorStatus(error)
  return new Response(
    JSON.stringify({ error: 'Document content request failed.' }),
    {
      status,
      headers,
    },
  )
}

function sanitizeAttachmentFilename(value: string) {
  const cleaned = Array.from(
    value
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim(),
  )
    .slice(0, 200)
    .join('')
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'document.pdf'
  return cleaned
}

function attachmentDisposition(value: string) {
  const filename = sanitizeAttachmentFilename(value)
  const fallback =
    filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .replace(/[^A-Za-z0-9._ -]/g, '_')
      .trim()
      .replace(/^[. ]+|[. ]+$/g, '') || 'document.pdf'
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

async function readBoundedBody(request: Request, expectedBytes: number) {
  if (expectedBytes < 1 || expectedBytes > maxChunkBytes) {
    throw validationError('Upload chunk exceeds the 4 MiB request limit.')
  }
  if (!request.body) throw validationError('Upload chunk body is required.')

  const bytes = new Uint8Array(expectedBytes)
  let received = 0
  const reader = request.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (
        value.byteLength > expectedBytes - received ||
        value.byteLength > maxChunkBytes - received
      ) {
        await reader.cancel()
        const error = validationError('Upload chunk exceeds its expected size.')
        throw Object.assign(error, { httpStatus: 413 })
      }
      bytes.set(value, received)
      received += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (received !== expectedBytes)
    throw validationError('Upload chunk size does not match its intent.')
  return bytes
}

async function digest(bytes: Uint8Array) {
  const result = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer as ArrayBuffer,
  )
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

const chunkRoute = httpAction(async (ctx, request) => {
  const headers = responseHeaders(request)
  const origin = request.headers.get('Origin')
  if (origin && !allowedOrigins().has(origin)) {
    return new Response(null, { status: 403, headers })
  }
  if (!origin && request.method === 'OPTIONS') {
    return new Response(null, { status: 403, headers })
  }
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers })
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers })
  if (!(await ctx.auth.getUserIdentity())) {
    return new Response(null, { status: 401, headers })
  }

  let storageId: Id<'_storage'> | undefined
  try {
    const url = new URL(request.url)
    const rawIntentId = url.searchParams.get('intentId')
    const rawIndex = url.searchParams.get('index')
    const index = rawIndex === null ? Number.NaN : Number(rawIndex)
    if (!rawIntentId || !Number.isSafeInteger(index)) {
      throw validationError(
        'An upload intent and integer chunk index are required.',
      )
    }
    const authorization = await ctx.runQuery(authorizeChunkRef, {
      intentId: rawIntentId,
      index,
    })
    const intentId = rawIntentId as Id<'documentUploadIntents'>
    const contentType = request.headers
      .get('Content-Type')
      ?.trim()
      .toLowerCase()
    if (contentType !== 'application/octet-stream') {
      throw validationError(
        'Chunk content type must be application/octet-stream.',
      )
    }
    const contentLength = request.headers.get('Content-Length')
    if (contentLength !== null) {
      const length = Number(contentLength)
      if (!Number.isSafeInteger(length) || length < 0) {
        throw validationError('Invalid Content-Length header.')
      }
      if (length > authorization.expectedSize || length > maxChunkBytes) {
        return new Response(
          JSON.stringify({ error: 'Upload chunk exceeds its expected size.' }),
          {
            status: 413,
            headers,
          },
        )
      }
      if (length !== authorization.expectedSize) {
        throw validationError('Upload chunk size does not match its intent.')
      }
    }

    const bytes = await readBoundedBody(request, authorization.expectedSize)
    const sha256 = await digest(bytes)
    if (authorization.existingChunk) {
      const current = await ctx.runQuery(authorizeChunkRef, {
        intentId: rawIntentId,
        index,
      })
      if (
        authorization.existingChunk.sizeBytes !== bytes.byteLength ||
        authorization.existingChunk.sha256 !== sha256 ||
        current.existingChunk?.sizeBytes !==
          authorization.existingChunk.sizeBytes ||
        current.existingChunk.sha256 !== authorization.existingChunk.sha256
      ) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Conflicting retry for upload chunk',
        )
      }
      headers.set('Content-Type', 'application/json; charset=utf-8')
      return new Response(
        JSON.stringify({
          intentId,
          index,
          sizeBytes: bytes.byteLength,
          sha256,
        }),
        { status: 200, headers },
      )
    }
    storageId = await ctx.storage.store(
      new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/octet-stream',
      }),
    )
    const record = await ctx.runMutation(recordChunkRef, {
      intentId,
      index,
      storageId,
      sizeBytes: bytes.byteLength,
      sha256,
    })
    if (!record.accepted) {
      await queueTemporaryChunkCleanup(ctx, storageId)
      storageId = undefined
    } else {
      storageId = undefined
    }
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(
      JSON.stringify({ intentId, index, sizeBytes: bytes.byteLength, sha256 }),
      {
        status: 200,
        headers,
      },
    )
  } catch (error) {
    if (storageId) {
      await queueTemporaryChunkCleanup(ctx, storageId)
      storageId = undefined
    }
    const response = errorResponse(request, error)
    if ((error as { httpStatus?: number })?.httpStatus === 413) {
      return new Response(response.body, {
        status: 413,
        headers: response.headers,
      })
    }
    return response
  }
})

const documentContentRoute = httpAction(async (ctx, request) => {
  const headers = responseHeaders(request, downloadCors)
  const origin = request.headers.get('Origin')
  if (origin && !allowedOrigins().has(origin)) {
    return new Response(null, { status: 403, headers })
  }
  if (!origin && request.method === 'OPTIONS') {
    return new Response(null, { status: 403, headers })
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'GET') {
    headers.set('Allow', 'GET, OPTIONS')
    return new Response(null, { status: 405, headers })
  }
  if (!(await ctx.auth.getUserIdentity())) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(
      JSON.stringify({ error: 'Document content request failed.' }),
      { status: 401, headers },
    )
  }

  try {
    const url = new URL(request.url)
    const documentIds = url.searchParams.getAll('documentId')
    const chunks = url.searchParams.getAll('chunk')
    if (
      documentIds.length !== 1 ||
      !documentIds[0] ||
      chunks.length !== 1 ||
      !/^(0|[1-9]\d*)$/.test(chunks[0] ?? '')
    ) {
      throw validationError(
        'A document ID and non-negative chunk index are required.',
      )
    }
    const chunk = Number(chunks[0])
    if (!Number.isSafeInteger(chunk)) {
      throw validationError(
        'Document chunk index is outside the supported range.',
      )
    }
    const args = { documentId: documentIds[0], chunk }
    const authorized = await ctx.runQuery(authorizeDocumentChunkRef, args)
    if (
      !Number.isSafeInteger(authorized.sizeBytes) ||
      authorized.sizeBytes < 1 ||
      authorized.sizeBytes > maxDocumentBytes ||
      authorized.chunkSizeBytes < 1 ||
      authorized.chunkSizeBytes > maxChunkBytes
    ) {
      const error = validationError(
        'Document exceeds the supported download size.',
      )
      throw Object.assign(error, { httpStatus: 413 })
    }

    const blob = await ctx.storage.get(authorized.storageId)
    if (!blob)
      throw new ConvexError(AppErrorCode.NOT_FOUND, 'Document not found')
    if (blob.size !== authorized.sizeBytes) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Document storage metadata is inconsistent',
      )
    }
    const bytes = await blob
      .slice(
        authorized.startBytes,
        authorized.startBytes + authorized.chunkSizeBytes,
      )
      .arrayBuffer()
    if (bytes.byteLength !== authorized.chunkSizeBytes) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Document storage metadata is inconsistent',
      )
    }

    // Recheck authorization after loading the bytes so a revoked reader cannot
    // receive this slice if membership or the document link changed mid-request.
    const finalAuthorization = await ctx.runQuery(
      authorizeDocumentChunkRef,
      args,
    )
    if (
      finalAuthorization.storageId !== authorized.storageId ||
      finalAuthorization.sizeBytes !== authorized.sizeBytes ||
      finalAuthorization.startBytes !== authorized.startBytes ||
      finalAuthorization.chunkSizeBytes !== authorized.chunkSizeBytes ||
      finalAuthorization.fileName !== authorized.fileName ||
      finalAuthorization.mimeType !== authorized.mimeType
    ) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Document changed during download',
      )
    }

    const contentType =
      authorized.mimeType === 'application/pdf'
        ? 'application/pdf'
        : 'application/octet-stream'
    headers.set('Content-Type', contentType)
    headers.set('Content-Length', String(bytes.byteLength))
    headers.set(
      'Content-Disposition',
      attachmentDisposition(authorized.fileName),
    )
    headers.set('X-Document-Size', String(authorized.sizeBytes))
    return new Response(bytes, { status: 200, headers })
  } catch (error) {
    return downloadErrorResponse(request, error)
  }
})

const http = httpRouter()
http.route({ path: '/documents/chunk', method: 'POST', handler: chunkRoute })
http.route({
  path: '/documents/chunk',
  method: 'OPTIONS',
  handler: chunkRoute,
})
http.route({
  path: '/documents/content',
  method: 'GET',
  handler: documentContentRoute,
})
http.route({
  path: '/documents/content',
  method: 'OPTIONS',
  handler: documentContentRoute,
})

export default http
