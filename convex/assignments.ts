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
    autonomyMode: v.optional(
      v.union(v.literal('paused'), v.literal('supervised'), v.literal('autonomous')),
    ),
    maxTurnsPerRun: v.optional(v.number()),
    maxCostCentsPerRun: v.optional(v.number()),
    requireHumanApprovalFor: v.optional(v.array(v.string())),
    stopOnDeficiency: v.optional(v.boolean()),
    budgetCapCents: v.optional(v.number()),
    hideAiReasoning: v.optional(v.boolean()),
  },
  returns: v.id('assignments'),
  handler: async (ctx, args) => {
    const { user } = await requireCohortRole(ctx, args.cohortId, ['instructor', 'admin'])
    let simulationPolicyId
    if (args.autonomyMode) {
      simulationPolicyId = await ctx.db.insert('simulationPolicies', {
        scope: 'assignment',
        scopeId: 'pending',
        autonomyMode: args.autonomyMode,
        maxTurnsPerRun: args.maxTurnsPerRun ?? 6,
        maxCostCentsPerRun: args.maxCostCentsPerRun ?? args.budgetCapCents ?? 25,
        requireHumanApprovalFor: args.requireHumanApprovalFor ?? ['disposeCase', 'enterJudgment'],
        stopOnDeficiency: args.stopOnDeficiency ?? true,
        createdByUserId: user._id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
    const assignmentId = await ctx.db.insert('assignments', {
      cohortId: args.cohortId,
      scenarioId: args.scenarioId,
      title: args.title,
      ...(args.dueAt ? { dueAt: args.dueAt } : {}),
      ...(args.rubricId ? { rubricId: args.rubricId } : {}),
      published: args.published,
      ...(args.autonomyMode ? { autonomyMode: args.autonomyMode } : {}),
      ...(simulationPolicyId ? { simulationPolicyId } : {}),
      ...(typeof args.budgetCapCents === 'number'
        ? { budgetCapCents: args.budgetCapCents }
        : {}),
      ...(typeof args.hideAiReasoning === 'boolean'
        ? { hideAiReasoning: args.hideAiReasoning }
        : {}),
      createdByUserId: user._id,
      createdAt: new Date().toISOString(),
    })
    if (simulationPolicyId) {
      await ctx.db.patch(simulationPolicyId, { scopeId: assignmentId })
    }
    return assignmentId
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
      autonomyMode: v.optional(
        v.union(v.literal('paused'), v.literal('supervised'), v.literal('autonomous')),
      ),
      budgetCapCents: v.optional(v.number()),
      hideAiReasoning: v.optional(v.boolean()),
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
      ...(assignment.autonomyMode ? { autonomyMode: assignment.autonomyMode } : {}),
      ...(typeof assignment.budgetCapCents === 'number'
        ? { budgetCapCents: assignment.budgetCapCents }
        : {}),
      ...(typeof assignment.hideAiReasoning === 'boolean'
        ? { hideAiReasoning: assignment.hideAiReasoning }
        : {}),
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
    const policy = assignment.simulationPolicyId
      ? await ctx.db.get(assignment.simulationPolicyId)
      : null
    if (policy) {
      await ctx.db.patch(args.caseSessionId, {
        autonomyMode: policy.autonomyMode,
        turnPolicy: {
          maxTurnsPerRun: policy.maxTurnsPerRun,
          requireHumanApprovalFor: policy.requireHumanApprovalFor,
          stopOnDeficiency: policy.stopOnDeficiency,
        },
      })
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
