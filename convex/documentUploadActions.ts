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

import { createHash, randomUUID } from 'node:crypto'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'

import { action, internalAction } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { enqueueCleanupWithBoundedRetry } from './documentUploadCleanup'
import { AppErrorCode, ConvexError, validationError } from './errors'

const maxFileBytes = 25 * 1024 * 1024
const chunkBytes = 4 * 1024 * 1024
const completionRetryAfterMs = 1000

type CompletionClaimResult =
  | { state: 'claimed' }
  | { state: 'busy' }
  | { state: 'existing'; sizeBytes: number; sha256: string }

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

const claimCompletionRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'>; claimToken: string },
  CompletionClaimResult
>('documentUploads:claimCompletion')
const releaseCompletionClaimRef = makeFunctionReference<
  'mutation',
  { intentId: Id<'documentUploadIntents'>; claimToken: string },
  null
>('documentUploads:releaseCompletionClaim')
const prepareCompletionRef = makeFunctionReference<
  'query',
  { intentId: Id<'documentUploadIntents'>; claimToken: string },
  CompletionPlan
>('documentUploads:prepareCompletion')
const finalizeCompletionRef = makeFunctionReference<
  'mutation',
  {
    intentId: Id<'documentUploadIntents'>
    claimToken: string
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
const storageObjectExistsRef = makeFunctionReference<
  'query',
  { storageId: Id<'_storage'> },
  boolean
>('documentUploads:storageObjectExists')
const queueUploadCleanupRef = makeFunctionReference<
  'mutation',
  { storageIds: Id<'_storage'>[]; intentId?: Id<'documentUploadIntents'> },
  Id<'_storage'>[]
>('documentUploads:queueUploadCleanup')
const beginUploadStorageCleanupRef = makeFunctionReference<
  'mutation',
  { storageId: Id<'_storage'> },
  boolean
>('documentUploads:beginUploadStorageCleanup')
const finishUploadStorageCleanupRef = makeFunctionReference<
  'mutation',
  { storageId: Id<'_storage'> },
  boolean
>('documentUploads:finishUploadStorageCleanup')
const retryUploadStorageCleanupRef = makeFunctionReference<
  'mutation',
  { storageId: Id<'_storage'> },
  null
>('documentUploads:retryUploadStorageCleanup')

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function uploadCompletionBusy() {
  return new ConvexError(
    AppErrorCode.CONFLICT,
    'Upload completion is already in progress. Retry shortly.',
    {
      reason: 'UPLOAD_COMPLETION_BUSY',
      retryable: true,
      retryAfterMs: completionRetryAfterMs,
    },
  )
}

function uploadCompletionClaimLost() {
  return new ConvexError(
    AppErrorCode.CONFLICT,
    'Upload completion claim is no longer active. Retry completion.',
    {
      reason: 'UPLOAD_COMPLETION_CLAIM_LOST',
      retryable: true,
      retryAfterMs: completionRetryAfterMs,
    },
  )
}

function hasValidUtf8(bytes: Uint8Array) {
  const isContinuation = (value: number | undefined) =>
    value !== undefined && value >= 0x80 && value <= 0xbf
  let index = 0
  while (index < bytes.length) {
    const first = bytes[index]!
    if (first <= 0x7f) {
      index += 1
      continue
    }
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const fourth = bytes[index + 3]
    if (first >= 0xc2 && first <= 0xdf) {
      if (!isContinuation(second)) return false
      index += 2
      continue
    }
    if (first === 0xe0) {
      if (
        second === undefined ||
        second < 0xa0 ||
        second > 0xbf ||
        !isContinuation(third)
      ) {
        return false
      }
      index += 3
      continue
    }
    if ((first >= 0xe1 && first <= 0xec) || (first >= 0xee && first <= 0xef)) {
      if (!isContinuation(second) || !isContinuation(third)) return false
      index += 3
      continue
    }
    if (first === 0xed) {
      if (
        second === undefined ||
        second < 0x80 ||
        second > 0x9f ||
        !isContinuation(third)
      ) {
        return false
      }
      index += 3
      continue
    }
    if (first === 0xf0) {
      if (
        second === undefined ||
        second < 0x90 ||
        second > 0xbf ||
        !isContinuation(third) ||
        !isContinuation(fourth)
      ) {
        return false
      }
      index += 4
      continue
    }
    if (first >= 0xf1 && first <= 0xf3) {
      if (
        !isContinuation(second) ||
        !isContinuation(third) ||
        !isContinuation(fourth)
      ) {
        return false
      }
      index += 4
      continue
    }
    if (first === 0xf4) {
      if (
        second === undefined ||
        second < 0x80 ||
        second > 0x8f ||
        !isContinuation(third) ||
        !isContinuation(fourth)
      ) {
        return false
      }
      index += 4
      continue
    }
    return false
  }
  return true
}

const jsonWhitespace = (byte: number | undefined) =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d

function skipJsonWhitespace(bytes: Uint8Array, start: number) {
  let index = start
  while (jsonWhitespace(bytes[index])) index += 1
  return index
}

function scanJsonString(bytes: Uint8Array, start: number): number | undefined {
  if (bytes[start] !== 0x22) return undefined
  let index = start + 1
  while (index < bytes.length) {
    const byte = bytes[index]!
    if (byte === 0x22) return index + 1
    if (byte < 0x20) return undefined
    if (byte !== 0x5c) {
      index += 1
      continue
    }
    index += 1
    const escaped = bytes[index]
    if (
      escaped === 0x22 ||
      escaped === 0x5c ||
      escaped === 0x2f ||
      escaped === 0x62 ||
      escaped === 0x66 ||
      escaped === 0x6e ||
      escaped === 0x72 ||
      escaped === 0x74
    ) {
      index += 1
      continue
    }
    if (escaped !== 0x75 || index + 4 >= bytes.length) return undefined
    for (let digit = 1; digit <= 4; digit += 1) {
      const hex = bytes[index + digit]!
      if (
        !(
          (hex >= 0x30 && hex <= 0x39) ||
          (hex >= 0x41 && hex <= 0x46) ||
          (hex >= 0x61 && hex <= 0x66)
        )
      ) {
        return undefined
      }
    }
    index += 5
  }
  return undefined
}

function scanJsonNumber(bytes: Uint8Array, start: number): number | undefined {
  let index = start
  if (bytes[index] === 0x2d) index += 1
  const firstDigit = bytes[index]
  if (firstDigit === 0x30) {
    index += 1
  } else if (
    firstDigit !== undefined &&
    firstDigit >= 0x31 &&
    firstDigit <= 0x39
  ) {
    index += 1
    while (
      bytes[index] !== undefined &&
      bytes[index]! >= 0x30 &&
      bytes[index]! <= 0x39
    ) {
      index += 1
    }
  } else {
    return undefined
  }
  if (bytes[index] === 0x2e) {
    index += 1
    if (
      bytes[index] === undefined ||
      bytes[index]! < 0x30 ||
      bytes[index]! > 0x39
    ) {
      return undefined
    }
    while (
      bytes[index] !== undefined &&
      bytes[index]! >= 0x30 &&
      bytes[index]! <= 0x39
    ) {
      index += 1
    }
  }
  if (bytes[index] === 0x65 || bytes[index] === 0x45) {
    index += 1
    if (bytes[index] === 0x2b || bytes[index] === 0x2d) index += 1
    if (
      bytes[index] === undefined ||
      bytes[index]! < 0x30 ||
      bytes[index]! > 0x39
    ) {
      return undefined
    }
    while (
      bytes[index] !== undefined &&
      bytes[index]! >= 0x30 &&
      bytes[index]! <= 0x39
    ) {
      index += 1
    }
  }
  return index
}

function scanJsonValue(bytes: Uint8Array, start: number): number | undefined {
  const byte = bytes[start]
  if (byte === 0x22) return scanJsonString(bytes, start)
  if (byte === 0x5b || byte === 0x7b) return start + 1
  if (byte === 0x2d || (byte !== undefined && byte >= 0x30 && byte <= 0x39)) {
    return scanJsonNumber(bytes, start)
  }
  const literal =
    byte === 0x74
      ? 'true'
      : byte === 0x66
        ? 'false'
        : byte === 0x6e
          ? 'null'
          : undefined
  if (!literal || start + literal.length > bytes.length) return undefined
  for (let offset = 0; offset < literal.length; offset += 1) {
    if (bytes[start + offset] !== literal.charCodeAt(offset)) return undefined
  }
  return start + literal.length
}

function hasValidJson(bytes: Uint8Array) {
  const arrayFirst = 1
  const arrayValue = 2
  const arrayAfterValue = 3
  const objectFirst = 4
  const objectKey = 5
  const objectColon = 6
  const objectValue = 7
  const objectAfterValue = 8
  const maxDepth = Math.floor(bytes.length / 2)
  let frames = new Uint8Array(Math.min(maxDepth, 32))
  let depth = 0
  let rootState = 0
  let index = skipJsonWhitespace(
    bytes,
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0,
  )

  const pushFrame = (state: number) => {
    if (depth === maxDepth) return false
    if (depth === frames.length) {
      const nextCapacity = Math.min(maxDepth, Math.max(1, frames.length * 2))
      const next = new Uint8Array(nextCapacity)
      next.set(frames)
      frames = next
    }
    frames[depth] = state
    depth += 1
    return true
  }

  while (true) {
    index = skipJsonWhitespace(bytes, index)
    if (rootState === 0) {
      const next = scanJsonValue(bytes, index)
      if (next === undefined) return false
      rootState = 1
      index = next
      const first = bytes[index - 1]
      if (first === 0x5b) {
        if (!pushFrame(arrayFirst)) return false
      } else if (first === 0x7b) {
        if (!pushFrame(objectFirst)) return false
      } else {
        rootState = 2
      }
      continue
    }
    if (rootState === 2) return index === bytes.length
    if (depth === 0) {
      rootState = 2
      continue
    }

    const frameIndex = depth - 1
    const state = frames[frameIndex]!
    const byte = bytes[index]
    if (state === arrayFirst || state === arrayValue) {
      if (state === arrayFirst && byte === 0x5d) {
        depth -= 1
        index += 1
        if (depth === 0) rootState = 2
        continue
      }
      const next = scanJsonValue(bytes, index)
      if (next === undefined) return false
      frames[frameIndex] = arrayAfterValue
      index = next
      const first = bytes[index - 1]
      if (first === 0x5b) {
        if (!pushFrame(arrayFirst)) return false
      } else if (first === 0x7b) {
        if (!pushFrame(objectFirst)) return false
      }
      continue
    }
    if (state === arrayAfterValue) {
      if (byte === 0x2c) {
        frames[frameIndex] = arrayValue
        index += 1
      } else if (byte === 0x5d) {
        depth -= 1
        index += 1
        if (depth === 0) rootState = 2
      } else {
        return false
      }
      continue
    }
    if (state === objectFirst || state === objectKey) {
      if (state === objectFirst && byte === 0x7d) {
        depth -= 1
        index += 1
        if (depth === 0) rootState = 2
        continue
      }
      const next = scanJsonString(bytes, index)
      if (next === undefined) return false
      frames[frameIndex] = objectColon
      index = next
      continue
    }
    if (state === objectColon) {
      if (byte !== 0x3a) return false
      frames[frameIndex] = objectValue
      index += 1
      continue
    }
    if (state === objectValue) {
      const next = scanJsonValue(bytes, index)
      if (next === undefined) return false
      frames[frameIndex] = objectAfterValue
      index = next
      const first = bytes[index - 1]
      if (first === 0x5b) {
        if (!pushFrame(arrayFirst)) return false
      } else if (first === 0x7b) {
        if (!pushFrame(objectFirst)) return false
      }
      continue
    }
    if (byte === 0x2c) {
      frames[frameIndex] = objectKey
      index += 1
    } else if (byte === 0x7d) {
      depth -= 1
      index += 1
      if (depth === 0) rootState = 2
    } else {
      return false
    }
  }
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
  if (!hasValidUtf8(bytes)) {
    throw validationError('Text upload content is not valid UTF-8.')
  }
  if (mimeType === 'application/json' && !hasValidJson(bytes)) {
    throw validationError('JSON upload content is not valid JSON.')
  }
}

async function queueStorageCleanup(
  ctx: ActionCtx,
  storageIds: Id<'_storage'>[],
  intentId?: Id<'documentUploadIntents'>,
) {
  return enqueueCleanupWithBoundedRetry(() =>
    ctx.runMutation(queueUploadCleanupRef, {
      storageIds,
      ...(intentId ? { intentId } : {}),
    }),
  )
}

export async function deleteOrRetryCleanup(operations: {
  objectExists: () => Promise<boolean>
  deleteObject: () => Promise<void>
  markDeleted: () => Promise<unknown>
  scheduleRetry: () => Promise<unknown>
}): Promise<'deleted' | 'retry'> {
  let deleted = false
  try {
    if (!(await operations.objectExists())) {
      deleted = true
    } else {
      await operations.deleteObject()
      deleted = !(await operations.objectExists())
    }
  } catch {
    deleted = false
  }

  if (deleted) {
    try {
      await operations.markDeleted()
      return 'deleted'
    } catch {
      await operations.scheduleRetry()
      return 'retry'
    }
  }
  await operations.scheduleRetry()
  return 'retry'
}

export const complete = action({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.object({
    intentId: v.id('documentUploadIntents'),
    sizeBytes: v.number(),
    sha256: v.string(),
  }),
  handler: async (ctx, { intentId }) => {
    const claimToken = randomUUID()
    const claim = await ctx.runMutation(claimCompletionRef, {
      intentId,
      claimToken,
    })
    if (claim.state === 'existing')
      return { intentId, sizeBytes: claim.sizeBytes, sha256: claim.sha256 }
    if (claim.state === 'busy') throw uploadCompletionBusy()

    let assembled: Uint8Array | undefined
    let storedId: Id<'_storage'> | undefined
    try {
      const plan = await ctx.runQuery(prepareCompletionRef, {
        intentId,
        claimToken,
      })
      if (plan.state === 'existing')
        return { intentId, sizeBytes: plan.sizeBytes, sha256: plan.sha256 }
      if (
        !Number.isSafeInteger(plan.sizeBytes) ||
        plan.sizeBytes < 1 ||
        plan.sizeBytes > maxFileBytes
      ) {
        throw validationError('Completed file exceeds the 25 MiB limit.')
      }

      let totalBytes = 0
      // Keep the assembled payload and one <=4 MiB chunk buffer resident.
      assembled = new Uint8Array(plan.sizeBytes)
      for (let index = 0; index < plan.chunks.length; index += 1) {
        const chunk = plan.chunks[index]!
        if (chunk.index !== index || chunk.sizeBytes > chunkBytes) {
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
        assembled.set(bytes, totalBytes - bytes.byteLength)
      }
      if (totalBytes !== plan.sizeBytes) {
        throw validationError(
          'Completed upload size does not match its receipt.',
        )
      }

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
        claimToken,
        storageId: storedId,
        sizeBytes: totalBytes,
        sha256: digest,
      })
      storedId = undefined
      if (result.stale) throw uploadCompletionClaimLost()
      if (result.cancelled) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          'Upload was cancelled during completion',
        )
      }
      return { intentId, sizeBytes: totalBytes, sha256: digest }
    } catch (error) {
      if (storedId) {
        try {
          // Finalization may have committed even when its response was lost.
          // Queueing is idempotent and rechecks references transactionally;
          // after the bounded retries, leave any uncertain blob untouched.
          await queueStorageCleanup(ctx, [storedId], intentId)
        } catch {
          // A process loss or sustained database outage can leave an
          // unreferenced orphan. Never compensate with an unfenced delete.
        }
      }
      if (
        error instanceof ConvexError &&
        error.code === AppErrorCode.VALIDATION_ERROR
      ) {
        try {
          await ctx.runMutation(cancelIntentRef, { intentId })
        } catch {
          // Expiry cleanup is still scheduled and cannot remove referenced data.
        }
      }
      throw error
    } finally {
      assembled = undefined
      await ctx.runMutation(releaseCompletionClaimRef, {
        intentId,
        claimToken,
      })
    }
  },
})

export const cancel = action({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    await ctx.runMutation(cancelIntentRef, { intentId })
    return null
  },
})

export const cleanupChunks = internalAction({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    await ctx.runMutation(takeChunksForCleanupRef, { intentId })
    return null
  },
})

export const cleanupUploadStorage = internalAction({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    let shouldDelete: boolean
    try {
      shouldDelete = await ctx.runMutation(beginUploadStorageCleanupRef, {
        storageId,
      })
    } catch {
      await ctx.runMutation(retryUploadStorageCleanupRef, { storageId })
      return null
    }
    if (!shouldDelete) return null

    await deleteOrRetryCleanup({
      objectExists: () => ctx.runQuery(storageObjectExistsRef, { storageId }),
      deleteObject: () => ctx.storage.delete(storageId),
      markDeleted: () =>
        ctx.runMutation(finishUploadStorageCleanupRef, { storageId }),
      scheduleRetry: () =>
        ctx.runMutation(retryUploadStorageCleanupRef, { storageId }),
    })
    return null
  },
})

export const expireUpload = internalAction({
  args: { intentId: v.id('documentUploadIntents') },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    await ctx.runMutation(expireIntentRef, { intentId })
    return null
  },
})
