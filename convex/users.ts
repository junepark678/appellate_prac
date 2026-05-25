import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireCurrentUser, upsertCurrentUserDoc } from './authHelpers'
import { requireAdmin, writeAuditLog } from './authz'

const userRoleValidator = v.union(
  v.literal('student'),
  v.literal('admin'),
  v.literal('instructor'),
)

export const upsertCurrentUser = mutation({
  args: {},
  returns: v.object({
    id: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('student'), v.literal('admin'), v.literal('instructor')),
    monthlyAiBudgetCents: v.number(),
  }),
  handler: async (ctx) => {
    const user = await upsertCurrentUserDoc(ctx)
    return {
      id: user._id,
      displayName: user.displayName,
      role: user.role,
      monthlyAiBudgetCents: user.monthlyAiBudgetCents,
    }
  },
})

export const current = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.id('users'),
      displayName: v.string(),
      role: userRoleValidator,
      monthlyAiBudgetCents: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    return {
      id: user._id,
      displayName: user.displayName,
      role: user.role,
      monthlyAiBudgetCents: user.monthlyAiBudgetCents,
    }
  },
})

export const list = query({
  args: {
    search: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      id: v.id('users'),
      authSubject: v.string(),
      displayName: v.string(),
      role: userRoleValidator,
      monthlyAiBudgetCents: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const users = await ctx.db.query('users').collect()
    const search = args.search?.trim().toLowerCase()
    return users
      .filter((user) =>
        search
          ? user.displayName.toLowerCase().includes(search) ||
            user.authSubject.toLowerCase().includes(search)
          : true,
      )
      .slice(0, 100)
      .map((user) => ({
        id: user._id,
        authSubject: user.authSubject,
        displayName: user.displayName,
        role: user.role,
        monthlyAiBudgetCents: user.monthlyAiBudgetCents,
      }))
  },
})

export const setRole = mutation({
  args: {
    userId: v.id('users'),
    role: userRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const target = await ctx.db.get(args.userId)
    if (!target) {
      throw new Error('User not found')
    }
    await ctx.db.patch(args.userId, { role: args.role })
    await writeAuditLog(ctx, {
      actorUserId: actor._id,
      action: 'user.role_changed',
      targetTable: 'users',
      targetId: args.userId,
      metadata: { previousRole: target.role, nextRole: args.role },
    })
    return null
  },
})
