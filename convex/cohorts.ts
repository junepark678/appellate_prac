import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireCurrentUser } from './authHelpers'

const cohortRoleValidator = v.union(
  v.literal('learner'),
  v.literal('instructor'),
  v.literal('admin'),
)

export const createInstitution = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  returns: v.id('institutions'),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    if (!['admin', 'instructor'].includes(user.role)) {
      throw new Error('Instructor or admin role required')
    }

    return ctx.db.insert('institutions', {
      name: args.name,
      slug: args.slug,
      status: 'active',
      monthlyAiBudgetCents: 5_000,
    })
  },
})

export const createCohort = mutation({
  args: {
    institutionId: v.id('institutions'),
    title: v.string(),
    term: v.string(),
    startsAt: v.string(),
    endsAt: v.string(),
  },
  returns: v.id('cohorts'),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    if (!['admin', 'instructor'].includes(user.role)) {
      throw new Error('Instructor or admin role required')
    }

    const cohortId = await ctx.db.insert('cohorts', {
      institutionId: args.institutionId,
      title: args.title,
      term: args.term,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      archived: false,
    })
    await ctx.db.insert('cohortMemberships', {
      cohortId,
      userId: user._id,
      role: user.role === 'admin' ? 'admin' : 'instructor',
    })
    return cohortId
  },
})

export const addMember = mutation({
  args: {
    cohortId: v.id('cohorts'),
    userId: v.id('users'),
    role: cohortRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const membership = await ctx.db
      .query('cohortMemberships')
      .withIndex('by_cohort_user', (index) =>
        index.eq('cohortId', args.cohortId).eq('userId', user._id),
      )
      .unique()
    if (!membership || !['instructor', 'admin'].includes(membership.role)) {
      throw new Error('Cohort instructor or admin role required')
    }

    const existing = await ctx.db
      .query('cohortMemberships')
      .withIndex('by_cohort_user', (index) =>
        index.eq('cohortId', args.cohortId).eq('userId', args.userId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role })
      return null
    }
    await ctx.db.insert('cohortMemberships', {
      cohortId: args.cohortId,
      userId: args.userId,
      role: args.role,
    })
    return null
  },
})

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('cohorts'),
      title: v.string(),
      term: v.string(),
      role: cohortRoleValidator,
      archived: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    const memberships = await ctx.db
      .query('cohortMemberships')
      .withIndex('by_user', (index) => index.eq('userId', user._id))
      .collect()
    const cohorts = await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        cohort: await ctx.db.get(membership.cohortId),
      })),
    )

    return cohorts
      .filter((entry) => entry.cohort !== null)
      .map((entry) => ({
        id: entry.membership.cohortId,
        title: entry.cohort?.title ?? 'Untitled cohort',
        term: entry.cohort?.term ?? '',
        role: entry.membership.role,
        archived: entry.cohort?.archived ?? false,
      }))
  },
})
