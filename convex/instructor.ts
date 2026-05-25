import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'

type ReadCtx = QueryCtx | MutationCtx

async function requireInstructor(ctx: ReadCtx, cohortId: Id<'cohorts'>) {
  const { user } = await requireCurrentUser(ctx)
  const membership = await ctx.db
    .query('cohortMemberships')
    .withIndex('by_cohort_user', (index) =>
      index.eq('cohortId', cohortId).eq('userId', user._id),
    )
    .unique()
  if (!membership || !['instructor', 'admin'].includes(membership.role)) {
    throw new Error('Instructor or admin role required')
  }
  return user
}

export const listAssignmentSessions = query({
  args: {
    assignmentId: v.id('assignments'),
  },
  returns: v.array(
    v.object({
      assignmentSessionId: v.id('assignmentSessions'),
      caseSessionId: v.id('caseSessions'),
      userId: v.id('users'),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
      instructorNote: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentId)
    if (!assignment) throw new Error('Assignment not found')
    await requireInstructor(ctx, assignment.cohortId)
    const sessions = await ctx.db
      .query('assignmentSessions')
      .withIndex('by_assignment', (index) => index.eq('assignmentId', args.assignmentId))
      .collect()

    return sessions.map((session) => ({
      assignmentSessionId: session._id,
      caseSessionId: session.caseSessionId,
      userId: session.userId,
      ...(session.submittedAt ? { submittedAt: session.submittedAt } : {}),
      ...(session.reviewedAt ? { reviewedAt: session.reviewedAt } : {}),
      ...(session.instructorNote ? { instructorNote: session.instructorNote } : {}),
    }))
  },
})

export const reviewAssignmentSession = mutation({
  args: {
    assignmentSessionId: v.id('assignmentSessions'),
    instructorNote: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assignmentSession = await ctx.db.get(args.assignmentSessionId)
    if (!assignmentSession) throw new Error('Assignment session not found')
    const assignment = await ctx.db.get(assignmentSession.assignmentId)
    if (!assignment) throw new Error('Assignment not found')
    const reviewer = await requireInstructor(ctx, assignment.cohortId)
    await ctx.db.patch(args.assignmentSessionId, {
      instructorNote: args.instructorNote,
      reviewedAt: new Date().toISOString(),
      reviewerUserId: reviewer._id,
    })
    return null
  },
})
