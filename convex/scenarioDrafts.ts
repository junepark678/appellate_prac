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

import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'

type ReadCtx = QueryCtx | MutationCtx

async function requireReviewer(ctx: ReadCtx) {
  const { user } = await requireCurrentUser(ctx)
  return user
}

export const list = query({
  args: {
    reviewStatus: v.optional(
      v.union(
        v.literal('draft'),
        v.literal('reviewed'),
        v.literal('published'),
        v.literal('rejected'),
      ),
    ),
  },
  returns: v.array(
    v.object({
      id: v.id('scenarioDrafts'),
      title: v.string(),
      courtPackId: v.string(),
      reviewStatus: v.union(
        v.literal('draft'),
        v.literal('reviewed'),
        v.literal('published'),
        v.literal('rejected'),
      ),
      sourceSystem: v.union(
        v.literal('courtlistener'),
        v.literal('recap'),
        v.literal('manual'),
      ),
      createdAt: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx)
    const reviewStatus = args.reviewStatus
    const drafts =
      reviewStatus !== undefined
        ? await ctx.db
          .query('scenarioDrafts')
          .withIndex('by_status', (index) => index.eq('reviewStatus', reviewStatus))
          .collect()
        : await ctx.db.query('scenarioDrafts').collect()
    return drafts.map((draft) => ({
      id: draft._id,
      title: draft.title,
      courtPackId: draft.courtPackId,
      reviewStatus: draft.reviewStatus,
      sourceSystem: draft.sourceSystem,
      createdAt: draft.createdAt,
    }))
  },
})

export const createManualDraft = mutation({
  args: {
    title: v.string(),
    courtPackId: v.string(),
    draftJson: v.string(),
    provenanceJson: v.string(),
  },
  returns: v.id('scenarioDrafts'),
  handler: async (ctx, args) => {
    await requireReviewer(ctx)
    return ctx.db.insert('scenarioDrafts', {
      sourceSystem: 'manual',
      importerId: 'manual-reviewer',
      title: args.title,
      courtPackId: args.courtPackId,
      draftJson: args.draftJson,
      provenanceJson: args.provenanceJson,
      reviewStatus: 'draft',
      createdAt: new Date().toISOString(),
    })
  },
})

export const setReviewStatus = mutation({
  args: {
    draftId: v.id('scenarioDrafts'),
    reviewStatus: v.union(
      v.literal('draft'),
      v.literal('reviewed'),
      v.literal('published'),
      v.literal('rejected'),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireReviewer(ctx)
    await ctx.db.patch(args.draftId, {
      reviewStatus: args.reviewStatus,
      reviewedByUserId: user._id,
      reviewedAt: new Date().toISOString(),
    })
    return null
  },
})
