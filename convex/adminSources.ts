import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { fourthCircuitCivilAppealSourceManifest } from '../src/domain/rules/source-manifest'

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

