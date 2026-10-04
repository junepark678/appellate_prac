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
import { v } from 'convex/values'

import { internalMutation, internalQuery, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { requireInstitutionRole } from './authz'
import { requireOwnedSession } from './caseSessions'
import {
  AppErrorCode,
  ConvexError,
  notFound,
  sessionLocked,
  validationError,
} from './errors'
import {
  uploadScopeValidator,
  validateUploadIntentTransition,
} from './organizationContracts'
import type { UploadScope } from './organizationContracts'

const maxFileBytes = 25 * 1024 * 1024
const chunkBytes = 4 * 1024 * 1024
const maxChunks = 7
const intentLifetimeMs = 15 * 60 * 1000

const expireUploadRef = makeFunctionReference<
  'action',
  { intentId: Id<'documentUploadIntents'> },
  null
>('documentUploadActions:expireUpload')
const cleanupOrphanedChunkRef = makeFunctionReference<
  'action',
  { storageId: Id<'_storage'> },
  null
>('documentUploadActions:cleanupOrphanedChunk')
const maxCleanupRetryDelayMs = 60 * 60 * 1000

function uploadExpired(): ConvexError {
  return new ConvexError(AppErrorCode.CONFLICT, 'Upload intent expired', {
    reason: 'UPLOAD_EXPIRED',
  })
}

function expectedChunkSize(sizeBytes: number, index: number) {
  return Math.min(chunkBytes, sizeBytes - index * chunkBytes)
}

function intentContractRow(
  intent: Omit<Doc<'documentUploadIntents'>, '_id' | '_creationTime'>,
) {
  return {
    institutionId: intent.institutionId,
    scopeKind: intent.scopeKind,
    ...(intent.caseSessionId ? { caseSessionId: intent.caseSessionId } : {}),
    ...(intent.datasetVersionId
      ? { datasetVersionId: intent.datasetVersionId }
      : {}),
    userId: intent.userId,
    fileName: intent.fileName,
    sizeBytes: intent.sizeBytes,
    sha256: intent.sha256,
    mimeType: intent.mimeType,
    chunkCount: intent.chunkCount,
    state: intent.state,
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
    ...(intent.storageId ? { storageId: intent.storageId } : {}),
    ...(intent.documentId ? { documentId: intent.documentId } : {}),
    ...(intent.analysisId ? { analysisId: intent.analysisId } : {}),
    ...(intent.datasetAssetId ? { datasetAssetId: intent.datasetAssetId } : {}),
  }
}

function assertFileMetadata(file: {
  fileName: string
  sizeBytes: number
  sha256: string
}) {
  if (!file.fileName.trim() || file.fileName.length > 200) {
    throw validationError(
      'File name must be between 1 and 200 characters.',
      'fileName',
    )
  }
  if (
    !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes < 1 ||
    file.sizeBytes > maxFileBytes
  ) {
    throw validationError(
      'File size must be between 1 byte and 25 MiB.',
      'sizeBytes',
    )
  }
  if (!/^[0-9a-f]{64}$/.test(file.sha256)) {
    throw validationError(
      'SHA-256 must be 64 lowercase hexadecimal characters.',
      'sha256',
    )
  }
}

async function assertSessionWritable(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'caseSessions'>,
) {
  const assignmentSessions = await ctx.db
    .query('assignmentSessions')
    .withIndex('by_case', (index) => index.eq('caseSessionId', sessionId))
    .collect()
  const isLocked = assignmentSessions.some(
    (link) =>
      link.submittedAt &&
      (!link.reopenedAt || link.reopenedAt <= link.submittedAt),
  )
  if (isLocked) throw sessionLocked()
}

async function requireMutableScope(
  ctx: QueryCtx | MutationCtx,
  scope: UploadScope,
) {
  if (scope.kind === 'session') {
    const { user, session } = await requireOwnedSession(
      ctx,
      scope.caseSessionId,
    )
    await assertSessionWritable(ctx, session._id)
    if (!session.institutionId) throw notFound('Case session')
    return { user, institutionId: session.institutionId }
  }

  const version = await ctx.db.get(scope.versionId)
  if (!version || version.state !== 'draft') throw notFound('Dataset version')
  const { user, institution } = await requireInstitutionRole(
    ctx,
    version.institutionId,
    ['instructor'],
  )
  const dataset = await ctx.db.get(version.datasetId)
  if (!dataset || dataset.institutionId !== institution._id)
    throw notFound('Dataset version')
  return { user, institutionId: institution._id }
}

async function requireOwnedIntent(
  ctx: QueryCtx | MutationCtx,
  intent: Doc<'documentUploadIntents'>,
  requireMutableParent: boolean,
) {
  const { user } = await requireCurrentUser(ctx)
  if (intent.userId !== user._id) throw notFound('Upload intent')

  if (intent.scopeKind === 'session') {
    if (!intent.caseSessionId || intent.datasetVersionId)
      throw notFound('Upload intent')
    const { session, institution } = await requireOwnedSession(
      ctx,
      intent.caseSessionId,
    )
    if (
      session.institutionId !== intent.institutionId ||
      institution._id !== intent.institutionId
    ) {
      throw notFound('Upload intent')
    }
    if (requireMutableParent) await assertSessionWritable(ctx, session._id)
    return { user, parentId: session._id }
  }

  if (!intent.datasetVersionId || intent.caseSessionId)
    throw notFound('Upload intent')
  const version = await ctx.db.get(intent.datasetVersionId)
  if (!version || version.institutionId !== intent.institutionId)
    throw notFound('Upload intent')
  const { user: authorizedUser, institution } = await requireInstitutionRole(
    ctx,
    intent.institutionId,
    ['instructor'],
  )
  if (
    authorizedUser._id !== user._id ||
    institution._id !== intent.institutionId
  ) {
    throw notFound('Upload intent')
  }
  const dataset = await ctx.db.get(version.datasetId)
  if (!dataset || dataset.institutionId !== institution._id)
    throw notFound('Upload intent')
  if (requireMutableParent && version.state !== 'draft')
    throw notFound('Dataset version')
  return { user, parentId: version._id }
}

function assertNotExpired(intent: Doc<'documentUploadIntents'>) {
  const expiresAt = Date.parse(intent.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw uploadExpired()
}

async function listChunkStorageIds(
  ctx: QueryCtx | MutationCtx,
  intentId: Id<'documentUploadIntents'>,
) {
  const chunks = await ctx.db
    .query('documentUploadChunks')
    .withIndex('by_intent_index', (index) => index.eq('intentId', intentId))
    .collect()
  return chunks.map((chunk) => chunk.storageId)
}

async function removeChunkRows(
  ctx: MutationCtx,
  intentId: Id<'documentUploadIntents'>,
) {
  const chunks = await ctx.db
    .query('documentUploadChunks')
    .withIndex('by_intent_index', (index) => index.eq('intentId', intentId))
    .collect()
  for (const chunk of chunks) await ctx.db.delete(chunk._id)
}

async function finalStorageIsReferenced(
  ctx: QueryCtx | MutationCtx,
  intent: Doc<'documentUploadIntents'>,
) {
  if (!intent.storageId) return false
  const document = await ctx.db
    .query('documents')
    .withIndex('by_storage', (index) =>
      index.eq('storageId', intent.storageId!),
    )
    .first()
  if (document) return true
  if (intent.scopeKind === 'dataset' && intent.datasetVersionId) {
    const assets = await ctx.db
      .query('organizationDatasetAssets')
      .withIndex('by_version', (index) =>
        index.eq('versionId', intent.datasetVersionId!),
      )
      .collect()
    return assets.some((asset) => asset.storageId === intent.storageId)
  }
  return false
}

export const begin = mutation({
  args: {
    scope: uploadScopeValidator,
    fileName: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    mimeType: v.union(
      v.literal('application/pdf'),
      v.literal('text/plain'),
      v.literal('application/json'),
    ),
  },
  returns: v.object({
    intentId: v.id('documentUploadIntents'),
    chunkBytes: v.number(),
    expiresAt: v.string(),
  }),
  handler: async (ctx, args) => {
    assertFileMetadata(args)
    if (args.scope.kind === 'session' && args.mimeType !== 'application/pdf') {
      throw validationError('Case session uploads must be PDFs.', 'mimeType')
    }
    const { user, institutionId } = await requireMutableScope(ctx, args.scope)
    const now = Date.now()
    const expiresAt = new Date(now + intentLifetimeMs).toISOString()
    const chunkCount = Math.ceil(args.sizeBytes / chunkBytes)
    if (chunkCount < 1 || chunkCount > maxChunks) {
      throw validationError(
        'File has an unsupported number of chunks.',
        'sizeBytes',
      )
    }
    const intentId = await ctx.db.insert('documentUploadIntents', {
      institutionId,
      scopeKind: args.scope.kind,
      ...(args.scope.kind === 'session'
        ? { caseSessionId: args.scope.caseSessionId }
        : { datasetVersionId: args.scope.versionId }),
      userId: user._id,
      fileName: args.fileName,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      mimeType: args.mimeType,
      chunkCount,
      state: 'pending',
      expiresAt,
      createdAt: new Date(now).toISOString(),
    })
    await ctx.scheduler.runAt(Date.parse(expiresAt), expireUploadRef, {
      intentId,
    })
    return { intentId, chunkBytes, expiresAt }
  },
})

export const authorizeChunk = internalQuery({
  args: { intentId: v.string(), index: v.number() },
  returns: v.object({ expectedSize: v.number() }),
  handler: async (ctx, { intentId: rawIntentId, index }) => {
    const intentId = ctx.db.normalizeId(
      'documentUploadIntents',
      rawIntentId,
    )
    if (!intentId) throw validationError('Invalid upload intent ID.')
    const intent = await ctx.db.get(intentId)
    if (!intent) throw notFound('Upload intent')
    await requireOwnedIntent(ctx, intent, true)
    if (intent.state !== 'pending') {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload intent is not pending',
      )
    }
    assertNotExpired(intent)
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= intent.chunkCount ||
      intent.chunkCount > maxChunks
    ) {
      throw validationError('Invalid upload chunk index.', 'index')
    }
    const size = expectedChunkSize(intent.sizeBytes, index)
    if (size < 1 || size > chunkBytes)
      throw validationError('Invalid upload chunk size.')
    return { expectedSize: size }
  },
})

export const recordChunk = internalMutation({
  args: {
    intentId: v.id('documentUploadIntents'),
    index: v.number(),
    storageId: v.id('_storage'),
    sizeBytes: v.number(),
    sha256: v.string(),
  },
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId)
    if (!intent) throw notFound('Upload intent')
    await requireOwnedIntent(ctx, intent, true)
    if (intent.state !== 'pending') {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload intent is not pending',
      )
    }
    assertNotExpired(intent)
    if (
      !Number.isSafeInteger(args.index) ||
      args.index < 0 ||
      args.index >= intent.chunkCount ||
      intent.chunkCount > maxChunks
    ) {
      throw validationError('Invalid upload chunk index.', 'index')
    }
    const sizeBytes = expectedChunkSize(intent.sizeBytes, args.index)
    if (args.sizeBytes !== sizeBytes || !/^[0-9a-f]{64}$/.test(args.sha256)) {
      throw validationError('Upload chunk size or checksum is invalid.')
    }
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata || metadata.size !== sizeBytes) {
      throw validationError('Uploaded chunk size does not match its receipt.')
    }
    const existing = await ctx.db
      .query('documentUploadChunks')
      .withIndex('by_intent_index', (index) =>
        index.eq('intentId', intent._id).eq('index', args.index),
      )
      .unique()
    if (existing) {
      if (existing.sizeBytes !== sizeBytes || existing.sha256 !== args.sha256) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Conflicting retry for upload chunk',
        )
      }
      return { accepted: false }
    }
    const cleanup = await ctx.db
      .query('documentUploadCleanup')
      .withIndex('by_storage', (index) => index.eq('storageId', args.storageId))
      .unique()
    if (cleanup) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload chunk storage is queued for cleanup',
      )
    }
    await ctx.db.insert('documentUploadChunks', {
      intentId: intent._id,
      index: args.index,
      storageId: args.storageId,
      sizeBytes,
      sha256: args.sha256,
    })
    return { accepted: true }
  },
})

export const queueOrphanedChunkCleanup = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.union(v.literal('queued'), v.literal('referenced')),
  handler: async (ctx, { storageId }) => {
    const chunk = await ctx.db
      .query('documentUploadChunks')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .first()
    if (chunk) return 'referenced' as const

    const queued = await ctx.db
      .query('documentUploadCleanup')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .unique()
    if (queued) return 'queued' as const

    await ctx.db.insert('documentUploadCleanup', {
      storageId,
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: new Date().toISOString(),
    })
    await ctx.scheduler.runAfter(0, cleanupOrphanedChunkRef, { storageId })
    return 'queued' as const
  },
})

export const beginOrphanedChunkCleanup = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.boolean(),
  handler: async (ctx, { storageId }) => {
    const cleanup = await ctx.db
      .query('documentUploadCleanup')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .unique()
    if (!cleanup || cleanup.nextAttemptAt > Date.now()) return false

    const chunk = await ctx.db
      .query('documentUploadChunks')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .first()
    if (chunk) {
      await ctx.db.delete(cleanup._id)
      return false
    }
    return true
  },
})

export const finishOrphanedChunkCleanup = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.boolean(),
  handler: async (ctx, { storageId }) => {
    const cleanup = await ctx.db
      .query('documentUploadCleanup')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .unique()
    if (!cleanup) return true
    const chunk = await ctx.db
      .query('documentUploadChunks')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .first()
    if (chunk) return false
    await ctx.db.delete(cleanup._id)
    return true
  },
})

export const retryOrphanedChunkCleanup = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const cleanup = await ctx.db
      .query('documentUploadCleanup')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .unique()
    if (!cleanup) return null
    const chunk = await ctx.db
      .query('documentUploadChunks')
      .withIndex('by_storage', (index) => index.eq('storageId', storageId))
      .first()
    if (chunk) {
      await ctx.db.delete(cleanup._id)
      return null
    }

    const attempts = Math.min(cleanup.attempts + 1, 31)
    const delayMs = Math.min(
      maxCleanupRetryDelayMs,
      1000 * 2 ** Math.min(attempts - 1, 12),
    )
    const nextAttemptAt = Date.now() + delayMs
    await ctx.db.patch(cleanup._id, { attempts, nextAttemptAt })
    await ctx.scheduler.runAt(nextAttemptAt, cleanupOrphanedChunkRef, {
      storageId,
    })
    return null
  },
})

export const prepareCompletion = internalQuery({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.union(
    v.object({
      state: v.literal('existing'),
      sizeBytes: v.number(),
      sha256: v.string(),
    }),
    v.object({
      state: v.literal('pending'),
      sizeBytes: v.number(),
      sha256: v.string(),
      mimeType: v.string(),
      chunks: v.array(
        v.object({
          index: v.number(),
          storageId: v.id('_storage'),
          sizeBytes: v.number(),
          sha256: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.db.get(intentId)
    if (!intent) throw notFound('Upload intent')
    await requireOwnedIntent(ctx, intent, intent.state === 'pending')
    if (intent.state === 'stored' || intent.state === 'consumed') {
      return {
        state: 'existing' as const,
        sizeBytes: intent.sizeBytes,
        sha256: intent.sha256,
      }
    }
    if (intent.state !== 'pending') {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload intent is not completable',
      )
    }
    assertNotExpired(intent)
    const chunks = await ctx.db
      .query('documentUploadChunks')
      .withIndex('by_intent_index', (index) => index.eq('intentId', intent._id))
      .collect()
    if (chunks.length !== intent.chunkCount) {
      throw new ConvexError(AppErrorCode.CONFLICT, 'Upload is incomplete')
    }
    chunks.sort((a, b) => a.index - b.index)
    for (let index = 0; index < intent.chunkCount; index += 1) {
      const chunk = chunks[index]
      if (
        !chunk ||
        chunk.index !== index ||
        chunk.sizeBytes !== expectedChunkSize(intent.sizeBytes, index)
      ) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Upload chunks are incomplete',
        )
      }
    }
    return {
      state: 'pending' as const,
      sizeBytes: intent.sizeBytes,
      sha256: intent.sha256,
      mimeType: intent.mimeType,
      chunks: chunks.map(({ index, storageId, sizeBytes, sha256 }) => ({
        index,
        storageId,
        sizeBytes,
        sha256,
      })),
    }
  },
})

export const finalizeCompletion = internalMutation({
  args: {
    intentId: v.id('documentUploadIntents'),
    storageId: v.id('_storage'),
    sizeBytes: v.number(),
    sha256: v.string(),
  },
  returns: v.object({
    storageId: v.id('_storage'),
    accepted: v.boolean(),
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId)
    if (!intent) throw notFound('Upload intent')
    await requireOwnedIntent(ctx, intent, intent.state === 'pending')
    if (intent.state === 'stored' || intent.state === 'consumed') {
      if (
        intent.storageId &&
        intent.sizeBytes === args.sizeBytes &&
        intent.sha256 === args.sha256
      ) {
        return {
          storageId: intent.storageId,
          accepted: false,
          cancelled: false,
        }
      }
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Conflicting upload completion',
      )
    }
    if (intent.state === 'cancelled') {
      if (
        args.sizeBytes !== intent.sizeBytes ||
        args.sha256 !== intent.sha256
      ) {
        throw validationError(
          'Completed upload metadata does not match its intent.',
        )
      }
      const metadata = await ctx.db.system.get('_storage', args.storageId)
      if (!metadata || metadata.size !== intent.sizeBytes) {
        throw validationError(
          'Completed upload size does not match stored data.',
        )
      }
      if (intent.storageId && intent.storageId !== args.storageId) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Conflicting cancelled upload completion',
        )
      }
      if (!intent.storageId) {
        validateUploadIntentTransition(
          intentContractRow(intent),
          intentContractRow({ ...intent, storageId: args.storageId }),
        )
        await ctx.db.patch(intent._id, { storageId: args.storageId })
      }
      return { storageId: args.storageId, accepted: false, cancelled: true }
    }
    if (intent.state !== 'pending') {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload intent is not completable',
      )
    }
    assertNotExpired(intent)
    if (args.sizeBytes !== intent.sizeBytes || args.sha256 !== intent.sha256) {
      throw validationError(
        'Completed upload metadata does not match its intent.',
      )
    }
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata || metadata.size !== intent.sizeBytes) {
      throw validationError('Completed upload size does not match stored data.')
    }
    const next = {
      ...intent,
      state: 'stored' as const,
      storageId: args.storageId,
    }
    validateUploadIntentTransition(
      intentContractRow(intent),
      intentContractRow(next),
    )
    await ctx.db.patch(intent._id, {
      state: 'stored',
      storageId: args.storageId,
    })
    return { storageId: args.storageId, accepted: true, cancelled: false }
  },
})

export const cancelIntent = internalMutation({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.array(v.id('_storage')),
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.db.get(intentId)
    if (!intent) throw notFound('Upload intent')
    await requireOwnedIntent(ctx, intent, false)
    if (intent.state === 'consumed') {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Consumed uploads cannot be cancelled',
      )
    }
    const referenced = await finalStorageIsReferenced(ctx, intent)
    if (referenced) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Upload storage is already referenced',
      )
    }
    if (intent.state !== 'cancelled')
      await ctx.db.patch(intent._id, { state: 'cancelled' })
    const chunkStorageIds = await listChunkStorageIds(ctx, intent._id)
    return intent.storageId
      ? [...chunkStorageIds, intent.storageId]
      : chunkStorageIds
  },
})

export const takeChunksForCleanup = internalMutation({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.array(v.id('_storage')),
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.db.get(intentId)
    if (!intent) return []
    if (intent.state === 'pending') {
      const expiresAt = Date.parse(intent.expiresAt)
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return []
      await ctx.db.patch(intent._id, { state: 'cancelled' })
    }
    return listChunkStorageIds(ctx, intent._id)
  },
})

export const expireIntent = internalMutation({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.array(v.id('_storage')),
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.db.get(intentId)
    if (!intent) return []
    const now = Date.now()
    const expired =
      !Number.isFinite(Date.parse(intent.expiresAt)) ||
      Date.parse(intent.expiresAt) <= now
    if ((intent.state === 'pending' || intent.state === 'stored') && expired) {
      const referenced = await finalStorageIsReferenced(ctx, intent)
      await ctx.db.patch(intent._id, { state: 'cancelled' })
      const chunkStorageIds = await listChunkStorageIds(ctx, intent._id)
      return !referenced && intent.storageId
        ? [...chunkStorageIds, intent.storageId]
        : chunkStorageIds
    }
    if (
      intent.state === 'consumed' ||
      intent.state === 'cancelled' ||
      intent.state === 'stored'
    ) {
      const chunkStorageIds = await listChunkStorageIds(ctx, intent._id)
      if (
        intent.state === 'cancelled' &&
        intent.storageId &&
        !(await finalStorageIsReferenced(ctx, intent))
      ) {
        return [...chunkStorageIds, intent.storageId]
      }
      return chunkStorageIds
    }
    return []
  },
})

export const forgetCleanedChunks = internalMutation({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.db.get(intentId)
    if (!intent) return null
    if (intent.state === 'pending') {
      const expiresAt = Date.parse(intent.expiresAt)
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return null
      await ctx.db.patch(intent._id, { state: 'cancelled' })
    }
    await removeChunkRows(ctx, intent._id)
    return null
  },
})

export const storageObjectExists = internalQuery({
  args: { storageId: v.id('_storage') },
  returns: v.boolean(),
  handler: async (ctx, { storageId }) =>
    Boolean(await ctx.db.system.get('_storage', storageId)),
})
