import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { fourthCircuitCivilAppealSourceManifest } from '../src/domain/rules/source-manifest'
import {
  ca4CourtSourceVersions,
  ca4DeadlineRules,
  ca4SourceBackedConstraints,
} from '../src/domain/rules/ca4-source-profile'
import { sourceFreshnessStatuses } from '../src/domain/rules/source-governance'
import { ca4EcfCatalogEvents } from '../src/domain/filing/ca4-ecf-catalog'

type ReadCtx = QueryCtx | MutationCtx

function simpleHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

async function requireAdmin(ctx: ReadCtx) {
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
        reviewed: source.reviewStatus === 'reviewed' || source.reviewStatus === 'published',
        metadataJson: JSON.stringify({
          parserVersion: source.parserVersion,
          contentHash: source.contentHash,
          reviewStatus: source.reviewStatus,
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

export const upsertSourceArtifact = mutation({
  args: {
    sourceVersionId: v.string(),
    label: v.string(),
    url: v.string(),
    rawText: v.string(),
    parserVersion: v.string(),
    contentHash: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    rawStorageId: v.optional(v.id('_storage')),
  },
  returns: v.id('sourceArtifacts'),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const contentHash = args.contentHash ?? simpleHash(args.rawText)
    const existing = await ctx.db
      .query('sourceArtifacts')
      .withIndex('by_hash', (index) => index.eq('contentHash', contentHash))
      .unique()
    const doc = {
      sourceVersionId: args.sourceVersionId,
      label: args.label,
      url: args.url,
      fetchedAt: new Date().toISOString(),
      contentHash,
      parserVersion: args.parserVersion,
      ...(args.effectiveDate ? { effectiveDate: args.effectiveDate } : {}),
      ...(args.mediaType ? { mediaType: args.mediaType } : {}),
      ...(args.rawStorageId ? { rawStorageId: args.rawStorageId } : {}),
      rawText: args.rawText,
      reviewStatus: 'draft' as const,
    }
    if (existing) {
      await ctx.db.patch(existing._id, doc)
      return existing._id
    }
    return ctx.db.insert('sourceArtifacts', doc)
  },
})

export const decideSourceArtifact = mutation({
  args: {
    sourceArtifactId: v.id('sourceArtifacts'),
    decision: v.union(v.literal('reviewed'), v.literal('published'), v.literal('rejected')),
    notes: v.string(),
    changedConstraintsJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const artifact = await ctx.db.get(args.sourceArtifactId)
    if (!artifact) {
      throw new Error('Source artifact not found.')
    }
    await ctx.db.patch(args.sourceArtifactId, { reviewStatus: args.decision })
    await ctx.db.insert('sourceReviewDecisions', {
      sourceArtifactId: args.sourceArtifactId,
      reviewerUserId: user._id,
      decision: args.decision,
      notes: args.notes,
      ...(args.changedConstraintsJson
        ? { changedConstraintsJson: args.changedConstraintsJson }
        : {}),
      createdAt: new Date().toISOString(),
    })

    const source = await ctx.db
      .query('legalSourceVersions')
      .withIndex('by_source_version', (index) =>
        index.eq('sourceVersionId', artifact.sourceVersionId),
      )
      .unique()
    if (source) {
      await ctx.db.patch(source._id, { reviewed: args.decision !== 'rejected' })
    }
    return null
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

async function requireReviewedSources(ctx: ReadCtx, sourceVersionIds: string[]) {
  const uniqueIds = [...new Set(sourceVersionIds)]
  for (const sourceVersionId of uniqueIds) {
    const snapshot = await ctx.db
      .query('legalSourceSnapshots')
      .withIndex('by_source_version', (index) =>
        index.eq('sourceVersionId', sourceVersionId),
      )
      .order('desc')
      .first()
    const bundledReviewed = ca4CourtSourceVersions.some(
      (source) =>
        source.sourceVersionId === sourceVersionId &&
        ['reviewed', 'published'].includes(source.reviewStatus),
    )
    const artifact = await ctx.db
      .query('sourceArtifacts')
      .withIndex('by_source_version', (index) =>
        index.eq('sourceVersionId', sourceVersionId),
      )
      .order('desc')
      .first()
    if (
      !bundledReviewed &&
      snapshot?.reviewStatus !== 'published' &&
      !['reviewed', 'published'].includes(artifact?.reviewStatus ?? 'draft')
    ) {
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

export const listSourceArtifacts = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('sourceArtifacts'),
      sourceVersionId: v.string(),
      label: v.string(),
      url: v.string(),
      contentHash: v.string(),
      parserVersion: v.string(),
      fetchedAt: v.string(),
      reviewStatus: v.union(
        v.literal('draft'),
        v.literal('reviewed'),
        v.literal('published'),
        v.literal('rejected'),
      ),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const artifacts = await ctx.db.query('sourceArtifacts').collect()
    return artifacts
      .slice()
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
      .map((artifact) => ({
        id: artifact._id,
        sourceVersionId: artifact.sourceVersionId,
        label: artifact.label,
        url: artifact.url,
        contentHash: artifact.contentHash,
        parserVersion: artifact.parserVersion,
        fetchedAt: artifact.fetchedAt,
        reviewStatus: artifact.reviewStatus,
      }))
  },
})

export const listSourceFreshness = query({
  args: {},
  returns: v.array(
    v.object({
      sourceVersionId: v.string(),
      sourceUrl: v.string(),
      bundledHash: v.string(),
      fetchedHash: v.optional(v.string()),
      parsedHash: v.optional(v.string()),
      effectiveDate: v.string(),
      reviewStatus: v.union(
        v.literal('draft'),
        v.literal('reviewed'),
        v.literal('published'),
        v.literal('rejected'),
      ),
      published: v.boolean(),
      stale: v.boolean(),
      staleReason: v.optional(v.string()),
      fetchedAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const artifacts = await ctx.db.query('sourceArtifacts').collect()
    return sourceFreshnessStatuses(
      ca4CourtSourceVersions,
      artifacts.map((artifact) => ({
        sourceVersionId: artifact.sourceVersionId,
        contentHash: artifact.contentHash,
        fetchedAt: artifact.fetchedAt,
        reviewStatus: artifact.reviewStatus,
      })),
    )
  },
})
