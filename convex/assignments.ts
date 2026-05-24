import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireCurrentUser } from './authHelpers'

async function requireCohortRole(
  ctx: any,
  cohortId: IdLike,
  roles: string[],
) {
  const { user } = await requireCurrentUser(ctx)
  const membership = await ctx.db
    .query('cohortMemberships')
    .withIndex('by_cohort_user', (index: any) =>
      index.eq('cohortId', cohortId).eq('userId', user._id),
    )
    .unique()
  if (!membership || !roles.includes(membership.role)) {
    throw new Error('Cohort permission required')
  }
  return { user, membership }
}

type IdLike = any

export const create = mutation({
  args: {
    cohortId: v.id('cohorts'),
    scenarioId: v.id('scenarios'),
    title: v.string(),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    published: v.boolean(),
  },
  returns: v.id('assignments'),
  handler: async (ctx, args) => {
    const { user } = await requireCohortRole(ctx, args.cohortId, ['instructor', 'admin'])
    return ctx.db.insert('assignments', {
      cohortId: args.cohortId,
      scenarioId: args.scenarioId,
      title: args.title,
      ...(args.dueAt ? { dueAt: args.dueAt } : {}),
      ...(args.rubricId ? { rubricId: args.rubricId } : {}),
      published: args.published,
      createdByUserId: user._id,
      createdAt: new Date().toISOString(),
    })
  },
})

export const listForCohort = query({
  args: {
    cohortId: v.id('cohorts'),
  },
  returns: v.array(
    v.object({
      id: v.id('assignments'),
      title: v.string(),
      published: v.boolean(),
      dueAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCohortRole(ctx, args.cohortId, ['learner', 'instructor', 'admin'])
    const assignments = await ctx.db
      .query('assignments')
      .withIndex('by_cohort', (index) => index.eq('cohortId', args.cohortId))
      .collect()
    return assignments.map((assignment) => ({
      id: assignment._id,
      title: assignment.title,
      published: assignment.published,
      ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
    }))
  },
})

export const attachSession = mutation({
  args: {
    assignmentId: v.id('assignments'),
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.id('caseSessions'),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentId)
    if (!assignment || !assignment.published) {
      throw new Error('Published assignment not found')
    }
    const { user } = await requireCohortRole(ctx, assignment.cohortId, [
      'learner',
      'instructor',
      'admin',
    ])
    const caseSession = await ctx.db.get(args.caseSessionId)
    if (!caseSession || caseSession.userId !== user._id) {
      throw new Error('Case session not found')
    }
    await ctx.db.insert('assignmentSessions', {
      assignmentId: args.assignmentId,
      caseSessionId: args.caseSessionId,
      userId: user._id,
    })
    return args.caseSessionId
  },
})

export const submitSession = mutation({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const assignmentSession = await ctx.db
      .query('assignmentSessions')
      .withIndex('by_case', (index) => index.eq('caseSessionId', args.caseSessionId))
      .unique()
    if (!assignmentSession || assignmentSession.userId !== user._id) {
      throw new Error('Assignment session not found')
    }
    await ctx.db.patch(assignmentSession._id, { submittedAt: new Date().toISOString() })
    return null
  },
})
