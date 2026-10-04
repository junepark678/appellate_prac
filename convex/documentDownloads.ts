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

import { v } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import { internalQuery } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { requireCohortRole } from './authz'
import { requireOwnedSession } from './caseSessions'
import { requireAssignmentSessionBinding } from './assignments'
import { AppErrorCode, ConvexError, notFound, validationError } from './errors'

const chunkBytes = 4 * 1024 * 1024
const maxDocumentBytes = 25 * 1024 * 1024

function linkageConflict(): never {
  throw new ConvexError(
    AppErrorCode.CONFLICT,
    'Document session linkage is inconsistent',
  )
}

async function requireExplicitInstructorAccess(
  ctx: QueryCtx,
  caseSessionId: Id<'caseSessions'>,
  session: Doc<'caseSessions'>,
  requesterUserId: Id<'users'>,
) {
  if (!session.institutionId) throw notFound('Document')

  const institution = await ctx.db.get(session.institutionId)
  if (!institution) throw notFound('Document')
  // Personal organizations are owner-only in v1. An assignment or staff role
  // cannot make another user's personal session readable.
  if (
    (institution.kind ?? 'shared') === 'personal' &&
    institution.personalOwnerUserId !== session.userId
  ) {
    throw notFound('Document')
  }

  const links = await ctx.db
    .query('assignmentSessions')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .take(2)
  if (links.length > 1) linkageConflict()
  const link = links[0]
  if (!link) throw notFound('Document')
  if (link.caseSessionId !== caseSessionId || link.userId !== session.userId) {
    linkageConflict()
  }

  const assignment = await ctx.db.get(link.assignmentId)
  const cohort = assignment ? await ctx.db.get(assignment.cohortId) : null
  if (!assignment || !cohort || assignment.archivedAt)
    throw notFound('Document')
  if (
    assignment.scenarioId !== session.scenarioId ||
    cohort.institutionId !== session.institutionId
  ) {
    linkageConflict()
  }
  if (!(await ctx.db.get(session.userId))) throw notFound('Document')

  // This shared validator checks the session owner, organization, scenario,
  // owner membership, reciprocal assignment links, and duplicate cardinality.
  const boundSession = await requireAssignmentSessionBinding(
    ctx,
    link,
    assignment,
    cohort,
    institution,
  )
  if (
    boundSession._id !== caseSessionId ||
    boundSession.userId !== session.userId ||
    boundSession.institutionId !== session.institutionId ||
    boundSession.scenarioId !== session.scenarioId
  ) {
    linkageConflict()
  }

  const access = await requireCohortRole(ctx, cohort._id, [
    'instructor',
    'admin',
  ])
  if (
    access.user._id !== requesterUserId ||
    access.institution._id !== session.institutionId ||
    access.cohort._id !== cohort._id
  ) {
    throw notFound('Document')
  }
}

async function requireDocumentReadAccess(
  ctx: QueryCtx,
  caseSessionId: Id<'caseSessions'>,
  session: Doc<'caseSessions'>,
  requesterUserId: Id<'users'>,
) {
  if (session._id !== caseSessionId) throw notFound('Document')
  if (session.userId === requesterUserId) {
    const owned = await requireOwnedSession(ctx, caseSessionId)
    if (owned.session.userId !== requesterUserId) throw notFound('Document')
    return
  }
  await requireExplicitInstructorAccess(
    ctx,
    caseSessionId,
    session,
    requesterUserId,
  )
}

/**
 * Authorize and describe one bounded private document slice for the HTTP
 * action. The storage ID stays inside the server-to-server query result.
 */
export const authorizeChunk = internalQuery({
  args: {
    documentId: v.string(),
    chunk: v.number(),
  },
  returns: v.object({
    storageId: v.id('_storage'),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    startBytes: v.number(),
    chunkSizeBytes: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    if (!Number.isSafeInteger(args.chunk) || args.chunk < 0) {
      throw validationError('Document chunk must be a non-negative integer.')
    }
    const documentId = ctx.db.normalizeId('documents', args.documentId)
    if (!documentId) throw notFound('Document')
    const document = await ctx.db.get(documentId)
    if (!document) throw notFound('Document')
    const session = await ctx.db.get(document.caseSessionId)
    if (!session) throw notFound('Document')
    await requireDocumentReadAccess(
      ctx,
      document.caseSessionId,
      session,
      user._id,
    )
    if (!document.storageId) throw notFound('Document')

    if (!Number.isSafeInteger(document.sizeBytes) || document.sizeBytes < 1) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        'Document size metadata is inconsistent',
      )
    }
    if (document.sizeBytes > maxDocumentBytes) {
      throw new ConvexError(
        AppErrorCode.VALIDATION_ERROR,
        'Document exceeds the 25 MiB download limit.',
        { reason: 'DOCUMENT_OVERSIZE' },
      )
    }
    const chunkCount = Math.ceil(document.sizeBytes / chunkBytes)
    if (args.chunk >= chunkCount) {
      throw validationError('Document chunk is outside the document size.')
    }

    const startBytes = args.chunk * chunkBytes
    return {
      storageId: document.storageId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      startBytes,
      chunkSizeBytes: Math.min(chunkBytes, document.sizeBytes - startBytes),
    }
  },
})
