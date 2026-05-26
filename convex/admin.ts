import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireAdmin, writeAuditLog } from './authz'
import { notFound } from './errors'

export const grantSupportAccess = mutation({
  args: {
    institutionId: v.id('institutions'),
    supportUserId: v.id('users'),
    reason: v.string(),
    expiresAt: v.string(),
  },
  returns: v.id('supportAccessGrants'),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const grantId = await ctx.db.insert('supportAccessGrants', {
      institutionId: args.institutionId,
      supportUserId: args.supportUserId,
      grantedByUserId: user._id,
      reason: args.reason,
      expiresAt: args.expiresAt,
      createdAt: new Date().toISOString(),
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: args.institutionId,
      action: 'support_access.granted',
      targetTable: 'supportAccessGrants',
      targetId: grantId,
      metadata: { supportUserId: args.supportUserId, expiresAt: args.expiresAt },
    })
    return grantId
  },
})

export const revokeSupportAccess = mutation({
  args: {
    grantId: v.id('supportAccessGrants'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const grant = await ctx.db.get(args.grantId)
    if (!grant) throw notFound('Support access grant', args.grantId)
    await ctx.db.patch(args.grantId, { revokedAt: new Date().toISOString() })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: grant.institutionId,
      action: 'support_access.revoked',
      targetTable: 'supportAccessGrants',
      targetId: args.grantId,
    })
    return null
  },
})

export const dashboard = query({
  args: {},
  returns: v.object({
    institutions: v.number(),
    users: v.number(),
    activeSupportGrants: v.number(),
    courtPacksPendingProduction: v.number(),
    recentAuditEvents: v.array(
      v.object({
        action: v.string(),
        createdAt: v.string(),
        actorUserId: v.optional(v.id('users')),
        institutionId: v.optional(v.id('institutions')),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const [institutions, users, grants, courtPacks, auditEvents] = await Promise.all([
      ctx.db.query('institutions').collect(),
      ctx.db.query('users').collect(),
      ctx.db.query('supportAccessGrants').collect(),
      ctx.db.query('courtPacks').collect(),
      ctx.db.query('auditLog').collect(),
    ])
    const now = new Date().toISOString()
    return {
      institutions: institutions.length,
      users: users.length,
      activeSupportGrants: grants.filter(
        (grant) => !grant.revokedAt && grant.expiresAt > now,
      ).length,
      courtPacksPendingProduction: courtPacks.filter(
        (pack) => pack.releaseStatus !== 'production_approved',
      ).length,
      recentAuditEvents: auditEvents
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20)
        .map((event) => ({
          action: event.action,
          createdAt: event.createdAt,
          ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
          ...(event.institutionId ? { institutionId: event.institutionId } : {}),
        })),
    }
  },
})
