'use node'

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
import { v } from 'convex/values'

import { action, internalAction } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { AppErrorCode, ConvexError, validationError } from './errors'

const maxFileBytes = 25 * 1024 * 1024
const chunkBytes = 4 * 1024 * 1024

type CompletionPlan =
  | { state: 'existing'; sizeBytes: number; sha256: string }
  | {
      state: 'pending'
      sizeBytes: number
      sha256: string
      mimeType: string
      chunks: {
        index: number
        storageId: Id<'_storage'>
        sizeBytes: number
        sha256: string
      }[]
    }

const prepareCompletionRef = makeFunctionReference<
  'query',
  { intentId: Id<'documentUploadIntents'> },
  CompletionPlan
>('documentUploads:prepareCompletion')
const finalizeCompletionRef = makeFunctionReference<
  'mutation',
  {
    intentId: Id<'documentUploadIntents'>
    storageId: Id<'_storage'>
    sizeBytes: number
    sha256: string
  },
  { storageId: Id<'_storage'>; accepted: boolean; cancelled: boolean }
>('documentUploads:finalizeCompletion')
const cancelIntentRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'> },
  Id<'_storage'>[]
>('documentUploads:cancelIntent')
const takeChunksForCleanupRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'> },
  Id<'_storage'>[]
>('documentUploads:takeChunksForCleanup')
const expireIntentRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'> },
  Id<'_storage'>[]
>('documentUploads:expireIntent')
const forgetCleanedChunksRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'> },
  null
>('documentUploads:forgetCleanedChunks')
const storageObjectExistsRef = makeFunctionReference<
  'query',
  { storageId: Id<'_storage'> },
  boolean
>('documentUploads:storageObjectExists')

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertContentType(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'application/pdf') {
    if (
      bytes.length < 5 ||
      bytes[0] !== 0x25 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x44 ||
      bytes[3] !== 0x46 ||
      bytes[4] !== 0x2d
    ) {
      throw validationError('PDF content does not have a valid PDF signature.')
    }
    return
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw validationError('Text upload content is not valid UTF-8.')
  }
  if (mimeType === 'application/json') {
    try {
      JSON.parse(text)
    } catch {
      throw validationError('JSON upload content is not valid JSON.')
    }
  }
}

async function deleteUnreferenced(ctx: ActionCtx, ids: Id<'_storage'>[]) {
  for (const storageId of ids) {
    const exists = () => ctx.runQuery(storageObjectExistsRef, { storageId })
    if (!(await exists())) continue
    try {
      await ctx.storage.delete(storageId)
    } catch (error) {
      // A racing cleanup may already have removed this object. Treat that as
      // success, but surface errors while the system storage row is present.
      if (await exists()) throw error
    }
    if (await exists()) {
      throw new Error('Temporary upload storage cleanup did not complete.')
    }
  }
}

export const complete = action({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.object({
    intentId: v.id('documentUploadIntents'),
    sizeBytes: v.number(),
    sha256: v.string(),
  }),
  handler: async (ctx, { intentId }) => {
    const plan = await ctx.runQuery(prepareCompletionRef, { intentId })
    if (plan.state === 'existing')
      return { intentId, sizeBytes: plan.sizeBytes, sha256: plan.sha256 }
    if (
      !Number.isSafeInteger(plan.sizeBytes) ||
      plan.sizeBytes < 1 ||
      plan.sizeBytes > maxFileBytes
    ) {
      throw validationError('Completed file exceeds the 25 MiB limit.')
    }

    const parts: Uint8Array[] = []
    let assembled: Uint8Array | undefined
    let storedId: Id<'_storage'> | undefined
    try {
      let totalBytes = 0
      for (const chunk of plan.chunks) {
        if (chunk.index !== parts.length || chunk.sizeBytes > chunkBytes) {
          throw new ConvexError(
            AppErrorCode.CONFLICT,
            'Upload chunk order is invalid',
          )
        }
        const blob = await ctx.storage.get(chunk.storageId)
        if (!blob || blob.size !== chunk.sizeBytes) {
          throw new ConvexError(
            AppErrorCode.CONFLICT,
            'Upload chunk data is unavailable',
          )
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (sha256(bytes) !== chunk.sha256) {
          throw validationError(
            'Upload chunk checksum does not match its receipt.',
          )
        }
        totalBytes += bytes.byteLength
        if (totalBytes > maxFileBytes || totalBytes > plan.sizeBytes) {
          throw validationError('Completed file exceeds the 25 MiB limit.')
        }
        parts.push(bytes)
      }
      if (
        parts.length !== plan.chunks.length ||
        totalBytes !== plan.sizeBytes
      ) {
        throw validationError(
          'Completed upload size does not match its receipt.',
        )
      }

      // At most one 25 MiB file plus its <=25 MiB chunk buffers are resident.
      assembled = new Uint8Array(totalBytes)
      let offset = 0
      for (const part of parts) {
        assembled.set(part, offset)
        offset += part.byteLength
      }
      parts.length = 0

      const digest = sha256(assembled)
      if (digest !== plan.sha256)
        throw validationError(
          'Completed file checksum does not match its intent.',
        )
      assertContentType(assembled, plan.mimeType)

      storedId = await ctx.storage.store(
        new Blob([assembled.buffer as ArrayBuffer], { type: plan.mimeType }),
      )
      const result = await ctx.runMutation(finalizeCompletionRef, {
        intentId,
        storageId: storedId,
        sizeBytes: totalBytes,
        sha256: digest,
      })
      if (!result.accepted) await deleteUnreferenced(ctx, [storedId])
      storedId = undefined
      if (result.cancelled) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Upload was cancelled during completion',
        )
      }
      return { intentId, sizeBytes: totalBytes, sha256: digest }
    } catch (error) {
      if (storedId) await deleteUnreferenced(ctx, [storedId])
      if (
        error instanceof ConvexError &&
        error.code === AppErrorCode.VALIDATION_ERROR
      ) {
        try {
          const temporaryIds = await ctx.runMutation(cancelIntentRef, {
            intentId,
          })
          await deleteUnreferenced(ctx, temporaryIds)
          await ctx.runMutation(forgetCleanedChunksRef, { intentId })
        } catch {
          // Expiry cleanup is still scheduled and cannot remove referenced data.
        }
      }
      throw error
    } finally {
      parts.length = 0
      assembled = undefined
    }
  },
})

export const cancel = action({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    const storageIds = await ctx.runMutation(cancelIntentRef, { intentId })
    await deleteUnreferenced(ctx, storageIds)
    await ctx.runMutation(forgetCleanedChunksRef, { intentId })
    return null
  },
})

export const cleanupChunks = internalAction({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    const storageIds = await ctx.runMutation(takeChunksForCleanupRef, {
      intentId,
    })
    await deleteUnreferenced(ctx, storageIds)
    await ctx.runMutation(forgetCleanedChunksRef, { intentId })
    return null
  },
})

export const expireUpload = internalAction({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    const storageIds = await ctx.runMutation(expireIntentRef, { intentId })
    await deleteUnreferenced(ctx, storageIds)
    await ctx.runMutation(forgetCleanedChunksRef, { intentId })
    return null
  },
})
