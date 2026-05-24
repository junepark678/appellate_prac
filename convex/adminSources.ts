import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { fourthCircuitCivilAppealSourceManifest } from '../src/domain/rules/source-manifest'
import {
  ca4CourtSourceVersions,
  ca4DeadlineRules,
  ca4SourceBackedConstraints,
} from '../src/domain/rules/ca4-source-profile'
import { ca4EcfCatalogEvents } from '../src/domain/filing/ca4-ecf-catalog'

function simpleHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

async function requireAdmin(ctx: any) {
  const { user } = await requireCurrentUser(ctx)
  if (user.role !== 'admin') {
    throw new Error('Admin role required')
  }
  return user
}

export const seedSourceManifest = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    let count = 0
    for (const source of fourthCircuitCivilAppealSourceManifest) {
      const existing = await ctx.db
        .query('legalSourceVersions')
        .withIndex('by_source_version', (index) =>
          index.eq('sourceVersionId', source.sourceVersionId),
        )
        .unique()
      const doc = {
        sourceVersionId: source.sourceVersionId,
        moduleId: source.moduleId,
        label: source.label,
        jurisdiction: source.jurisdiction,
        version: source.version,
        effectiveFrom: source.effectiveFrom,
        sourceUrl: source.sourceUrl,
        sourceSystem: source.sourceSystem,
        reviewed: false,
        metadataJson: JSON.stringify({
          parserVersion: source.parserVersion,
          ruleRefs: source.ruleRefs,
        }),
      }
      if (existing) {
        await ctx.db.patch(existing._id, doc)
      } else {
        await ctx.db.insert('legalSourceVersions', doc)
      }
      count += 1
    }
    return count
  },
})

export const storeSnapshot = mutation({
  args: {
    sourceVersionId: v.string(),
    rawText: v.string(),
    parserVersion: v.string(),
  },
  returns: v.id('legalSourceSnapshots'),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    return ctx.db.insert('legalSourceSnapshots', {
      sourceVersionId: args.sourceVersionId,
      fetchedAt: new Date().toISOString(),
      contentHash: simpleHash(args.rawText),
      rawText: args.rawText,
      parserVersion: args.parserVersion,
      reviewStatus: 'draft',
    })
  },
})

export const publishSourceSnapshot = mutation({
  args: {
    sourceVersionId: v.string(),
    reviewStatus: v.union(
      v.literal('reviewed'),
      v.literal('published'),
      v.literal('rejected'),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const snapshot = await ctx.db
      .query('legalSourceSnapshots')
      .withIndex('by_source_version', (index) =>
        index.eq('sourceVersionId', args.sourceVersionId),
      )
      .order('desc')
      .first()
    if (!snapshot) {
      throw new Error('No source snapshot exists for this source version.')
    }
    await ctx.db.patch(snapshot._id, { reviewStatus: args.reviewStatus })
    const source = await ctx.db
      .query('legalSourceVersions')
      .withIndex('by_source_version', (index) =>
        index.eq('sourceVersionId', args.sourceVersionId),
      )
      .unique()
    if (source) {
      await ctx.db.patch(source._id, { reviewed: args.reviewStatus !== 'rejected' })
    }
    return null
  },
})

async function requireReviewedSources(ctx: any, sourceVersionIds: string[]) {
  const uniqueIds = [...new Set(sourceVersionIds)]
  for (const sourceVersionId of uniqueIds) {
    const snapshot = await ctx.db
      .query('legalSourceSnapshots')
      .withIndex('by_source_version', (index: any) =>
        index.eq('sourceVersionId', sourceVersionId),
      )
      .order('desc')
      .first()
    const bundledReviewed = ca4CourtSourceVersions.some(
      (source) =>
        source.sourceVersionId === sourceVersionId &&
        ['reviewed', 'published'].includes(source.reviewStatus),
    )
    if (!bundledReviewed && snapshot?.reviewStatus !== 'published') {
      throw new Error(`Source ${sourceVersionId} must be reviewed before publication.`)
    }
  }
}

export const publishEcfCatalogEvents = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    await requireReviewedSources(
      ctx,
      ca4EcfCatalogEvents.flatMap((event) => event.sourceVersionIds),
    )
    let count = 0
    for (const event of ca4EcfCatalogEvents) {
      const existing = await ctx.db
        .query('ecfCatalogEvents')
        .withIndex('by_event', (index) =>
          index.eq('courtPackId', 'us-federal-ca4-civil-appeal').eq('eventId', event.eventId),
        )
        .unique()
      const doc = {
        courtPackId: 'us-federal-ca4-civil-appeal',
        eventId: event.eventId,
        catalogJson: JSON.stringify(event),
        sourceVersionIds: event.sourceVersionIds,
        published: true,
      }
      if (existing) await ctx.db.patch(existing._id, doc)
      else await ctx.db.insert('ecfCatalogEvents', doc)
      count += 1
    }
    return count
  },
})

export const publishDeadlineRules = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    await requireReviewedSources(
      ctx,
      ca4DeadlineRules.flatMap((rule) =>
        rule.ruleRefs.map((ruleRef) =>
          ruleRef.ruleId.startsWith('CA4_') ? 'ca4-local-rules-current-2026-03-23' : 'frap-effective-2025-12-01',
        ),
      ),
    )
    let count = 0
    for (const rule of ca4DeadlineRules) {
      const sourceVersionIds = [
        'frap-effective-2025-12-01',
        ...(rule.ruleRefs.some((ruleRef) => ruleRef.ruleId.startsWith('CA4_'))
          ? ['ca4-local-rules-current-2026-03-23']
          : []),
      ]
      const existing = await ctx.db
        .query('deadlineRules')
        .withIndex('by_deadline', (index) =>
          index.eq('courtPackId', 'us-federal-ca4-civil-appeal').eq('deadlineId', rule.deadlineId),
        )
        .unique()
      const doc = {
        courtPackId: 'us-federal-ca4-civil-appeal',
        deadlineId: rule.deadlineId,
        deadlineJson: JSON.stringify(rule),
        sourceVersionIds,
        published: true,
      }
      if (existing) await ctx.db.patch(existing._id, doc)
      else await ctx.db.insert('deadlineRules', doc)
      count += 1
    }
    return count
  },
})

export const publishSourceBackedConstraints = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    await requireReviewedSources(
      ctx,
      ca4SourceBackedConstraints.flatMap((constraint) => constraint.sourceVersionIds),
    )
    let count = 0
    for (const constraint of ca4SourceBackedConstraints) {
      const existing = await ctx.db
        .query('sourceBackedConstraints')
        .withIndex('by_constraint', (index) =>
          index.eq('courtPackId', 'us-federal-ca4-civil-appeal').eq('constraintId', constraint.constraintId),
        )
        .unique()
      const doc = {
        courtPackId: 'us-federal-ca4-civil-appeal',
        constraintId: constraint.constraintId,
        constraintJson: JSON.stringify(constraint),
        sourceVersionIds: constraint.sourceVersionIds,
        published: true,
      }
      if (existing) await ctx.db.patch(existing._id, doc)
      else await ctx.db.insert('sourceBackedConstraints', doc)
      count += 1
    }
    return count
  },
})

export const addReviewNote = mutation({
  args: {
    sourceVersionId: v.string(),
    note: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    await ctx.db.insert('ruleReviewNotes', {
      sourceVersionId: args.sourceVersionId,
      reviewerUserId: user._id,
      note: args.note,
      createdAt: new Date().toISOString(),
    })
    return null
  },
})

export const listSources = query({
  args: {},
  returns: v.array(
    v.object({
      sourceVersionId: v.string(),
      label: v.string(),
      sourceUrl: v.string(),
      reviewed: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireCurrentUser(ctx)
    const sources = await ctx.db.query('legalSourceVersions').collect()
    return sources.map((source) => ({
      sourceVersionId: source.sourceVersionId,
      label: source.label,
      sourceUrl: source.sourceUrl,
      reviewed: source.reviewed,
    }))
  },
})
