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
import { requireCurrentUser, upsertCurrentUserDoc } from './authHelpers'
import { requireAdmin, writeAuditLog } from './authz'
import { notFound } from './errors'

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
      currentMonthAiSpendCents: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const [users, aiRuns] = await Promise.all([
      ctx.db.query('users').collect(),
      ctx.db.query('aiRuns').collect(),
    ])
    const search = args.search?.trim().toLowerCase()
    const month = new Date().toISOString().slice(0, 7)
    const spendByUser = new Map<string, number>()
    for (const run of aiRuns) {
      if (run.createdMonth !== month) continue
      spendByUser.set(
        run.userId,
        (spendByUser.get(run.userId) ?? 0) + run.costCents,
      )
    }
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
        currentMonthAiSpendCents: spendByUser.get(user._id) ?? 0,
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
      throw notFound('User', args.userId)
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

export const setMonthlyAiBudget = mutation({
  args: {
    userId: v.id('users'),
    monthlyAiBudgetCents: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const target = await ctx.db.get(args.userId)
    if (!target) {
      throw notFound('User', args.userId)
    }
    const monthlyAiBudgetCents = Math.max(
      0,
      Math.round(args.monthlyAiBudgetCents),
    )
    await ctx.db.patch(args.userId, { monthlyAiBudgetCents })
    await writeAuditLog(ctx, {
      actorUserId: actor._id,
      action: 'user.ai_budget_changed',
      targetTable: 'users',
      targetId: args.userId,
      metadata: {
        previousMonthlyAiBudgetCents: target.monthlyAiBudgetCents,
        nextMonthlyAiBudgetCents: monthlyAiBudgetCents,
      },
    })
    return null
  },
})
