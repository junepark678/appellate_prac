// TODO: Import from './errors' once error module is integrated
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { requireCohortRole, writeAuditLog } from './authz'
import { createInitialSession } from '../src/domain/simulation'
import { inferProcedureState } from '../src/domain/procedure/state-machine'
import type { Scenario } from '../src/domain/types'
import scenarioSeed from '../src/domain/scenarios.seed.json'

type ReadCtx = QueryCtx | MutationCtx
type CohortRole = Doc<'cohortMemberships'>['role']

const autonomyModeValidator = v.union(
  v.literal('paused'),
  v.literal('supervised'),
  v.literal('autonomous'),
)

const assignmentStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('in_progress'),
  v.literal('submitted'),
  v.literal('reviewed'),
)
const seedScenarios = scenarioSeed as Scenario[]

function seedScenarioDoc(scenario: Scenario) {
  return {
    scenarioKey: scenario.id,
    title: scenario.title,
    source: scenario.source,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    lowerTribunal: scenario.lowerTribunal,
    natureOfSuit: scenario.natureOfSuit,
    proceduralPosture: scenario.proceduralPosture,
    issuesPresented: scenario.issuesPresented,
    meritsRecord: scenario.meritsRecord,
    ...(scenario.training ? { trainingJson: JSON.stringify(scenario.training) } : {}),
    ...(scenario.trialDocket ? { trialDocketJson: JSON.stringify(scenario.trialDocket) } : {}),
    ...(scenario.documentAssets
      ? { documentAssetsJson: JSON.stringify(scenario.documentAssets) }
      : {}),
    ...(scenario.sourceCaseUrl ? { sourceCaseUrl: scenario.sourceCaseUrl } : {}),
    published: true,
  }
}

async function requireAssignmentRole(
  ctx: ReadCtx,
  assignmentId: Id<'assignments'>,
  roles: CohortRole[],
) {
  const assignment = await ctx.db.get(assignmentId)
  if (!assignment || assignment.archivedAt) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Assignment not found')
  }
  const access = await requireCohortRole(ctx, assignment.cohortId, roles)
  return { assignment, ...access }
}

async function getAssignmentSession(
  ctx: ReadCtx,
  assignmentId: Id<'assignments'>,
  userId: Id<'users'>,
) {
  const sessions = await listAssignmentSessionsForUser(ctx, assignmentId, userId)
  return sessions[0] ?? null
}

async function listAssignmentSessionsForUser(
  ctx: ReadCtx,
  assignmentId: Id<'assignments'>,
  userId: Id<'users'>,
) {
  const sessions = await ctx.db
    .query('assignmentSessions')
    .withIndex('by_assignment_user', (index) =>
      index.eq('assignmentId', assignmentId).eq('userId', userId),
    )
    .collect()
  return sessions.sort((a, b) => a._creationTime - b._creationTime)
}

async function requireScenarioForAssignment(
  ctx: MutationCtx,
  args: {
    scenarioId?: Id<'scenarios'>
    scenarioKey?: string
  },
) {
  if (args.scenarioId) {
    const scenario = await ctx.db.get(args.scenarioId)
    if (!scenario || !scenario.published) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Scenario not found')
    }
    return scenario
  }

  if (!args.scenarioKey) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Scenario not found')
  }

  const scenarioKey = args.scenarioKey
  const existing = await ctx.db
    .query('scenarios')
    .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenarioKey))
    .unique()
  const bundled = seedScenarios.find((scenario) => scenario.id === scenarioKey)
  if (existing) {
    if (bundled) {
      await ctx.db.patch(existing._id, seedScenarioDoc(bundled))
      const updated = await ctx.db.get(existing._id)
      if (!updated) {
        // ERROR_CODE: NOT_FOUND
        throw new Error('Scenario not found')
      }
      return updated
    }
    if (!existing.published) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Scenario not found')
    }
    return existing
  }

  if (!bundled) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Scenario not found')
  }
  const scenarioId = await ctx.db.insert('scenarios', seedScenarioDoc(bundled))
  const scenario = await ctx.db.get(scenarioId)
  if (!scenario) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Scenario not found')
  }
  return scenario
}

function isSubmittedLockActive(
  session: Pick<Doc<'assignmentSessions'>, 'submittedAt' | 'reopenedAt'> | null,
) {
  return Boolean(
    session?.submittedAt &&
      (!session.reopenedAt || session.reopenedAt <= session.submittedAt),
  )
}

function statusForAssignmentSession(session: Doc<'assignmentSessions'> | null) {
  if (!session) return 'not_started' as const
  if (session.reviewedAt) return 'reviewed' as const
  if (isSubmittedLockActive(session)) return 'submitted' as const
  return 'in_progress' as const
}

function canViewUnpublishedAssignment(
  user: Doc<'users'>,
  membership: Doc<'cohortMemberships'> | null,
) {
  return (
    user.role === 'admin' ||
    membership?.role === 'instructor' ||
    membership?.role === 'admin'
  )
}

async function insertInitialSessionState(
  ctx: MutationCtx,
  caseSessionId: Id<'caseSessions'>,
  scenarioKey: string,
) {
  const initialSession = createInitialSession(scenarioKey)
  const procedureState = inferProcedureState(initialSession)
  await ctx.db.patch(caseSessionId, {
    status: initialSession.status,
    procedureState,
    simulatedDate: initialSession.simulatedDate,
    courtPackId: initialSession.courtPackId,
    autonomyMode: initialSession.autonomyMode,
    turnPolicy: initialSession.turnPolicy,
    ...(initialSession.sourceProfileId
      ? { sourceProfileId: initialSession.sourceProfileId }
      : {}),
    qualityState: initialSession.qualityState,
  })
  for (const participant of initialSession.participants) {
    await ctx.db.insert('participants', {
      caseSessionId,
      displayName: participant.displayName,
      role: participant.role,
    })
  }
  for (const entry of initialSession.docketEntries) {
    await ctx.db.insert('docketEntries', {
      caseSessionId,
      entryNumber: entry.entryNumber,
      filedAt: entry.filedAt,
      actorRole: entry.actorRole,
      title: entry.title,
      text: entry.text,
      ruleRefs: entry.ruleRefs,
    })
  }
  for (const deadline of initialSession.deadlines) {
    await ctx.db.insert('deadlines', {
      caseSessionId,
      label: deadline.label,
      dueDate: deadline.dueDate,
      targetEventId: deadline.targetEventId,
      status: deadline.status,
      sourceRuleRefs: deadline.sourceRuleRefs,
    })
  }
  await ctx.db.insert('caseSessionEvents', {
    caseSessionId,
    sequence: 1,
    eventType: 'assignment_session_started',
    payloadJson: JSON.stringify({ scenarioKey, procedureState }),
    createdAt: new Date().toISOString(),
  })
}

export const create = mutation({
  args: {
    cohortId: v.id('cohorts'),
    scenarioId: v.optional(v.id('scenarios')),
    scenarioKey: v.optional(v.string()),
    title: v.string(),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    published: v.boolean(),
    autonomyMode: v.optional(autonomyModeValidator),
    maxTurnsPerRun: v.optional(v.number()),
    maxCostCentsPerRun: v.optional(v.number()),
    requireHumanApprovalFor: v.optional(v.array(v.string())),
    stopOnDeficiency: v.optional(v.boolean()),
    budgetCapCents: v.optional(v.number()),
    hideAiReasoning: v.optional(v.boolean()),
    allowedFilingEvents: v.optional(v.array(v.string())),
  },
  returns: v.id('assignments'),
  handler: async (ctx, args) => {
    const { user, cohort } = await requireCohortRole(ctx, args.cohortId, [
      'instructor',
      'admin',
    ])
    const scenario = await requireScenarioForAssignment(ctx, args)
    let simulationPolicyId
    if (args.autonomyMode) {
      simulationPolicyId = await ctx.db.insert('simulationPolicies', {
        scope: 'assignment',
        scopeId: 'pending',
        autonomyMode: args.autonomyMode,
        maxTurnsPerRun: args.maxTurnsPerRun ?? 6,
        maxCostCentsPerRun: args.maxCostCentsPerRun ?? args.budgetCapCents ?? 25,
        requireHumanApprovalFor: args.requireHumanApprovalFor ?? [
          'disposeCase',
          'enterJudgment',
        ],
        stopOnDeficiency: args.stopOnDeficiency ?? true,
        createdByUserId: user._id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
    const now = new Date().toISOString()
    const assignmentId = await ctx.db.insert('assignments', {
      cohortId: args.cohortId,
      scenarioId: scenario._id,
      title: args.title,
      ...(args.dueAt ? { dueAt: args.dueAt } : {}),
      ...(args.rubricId ? { rubricId: args.rubricId } : {}),
      published: args.published,
      autonomyMode: args.autonomyMode ?? 'paused',
      ...(simulationPolicyId ? { simulationPolicyId } : {}),
      ...(typeof args.budgetCapCents === 'number'
        ? { budgetCapCents: args.budgetCapCents }
        : {}),
      ...(typeof args.hideAiReasoning === 'boolean'
        ? { hideAiReasoning: args.hideAiReasoning }
        : {}),
      ...(args.allowedFilingEvents ? { allowedFilingEvents: args.allowedFilingEvents } : {}),
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    })
    if (simulationPolicyId) {
      await ctx.db.patch(simulationPolicyId, { scopeId: assignmentId })
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: args.cohortId,
      action: 'assignment.created',
      targetTable: 'assignments',
      targetId: assignmentId,
      metadata: { published: args.published },
    })
    return assignmentId
  },
})

export const update = mutation({
  args: {
    assignmentId: v.id('assignments'),
    title: v.optional(v.string()),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    autonomyMode: v.optional(autonomyModeValidator),
    budgetCapCents: v.optional(v.number()),
    hideAiReasoning: v.optional(v.boolean()),
    allowedFilingEvents: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(ctx, args.assignmentId, [
      'instructor',
      'admin',
    ])
    await ctx.db.patch(args.assignmentId, {
      ...(args.title ? { title: args.title } : {}),
      ...(args.dueAt ? { dueAt: args.dueAt } : {}),
      ...(args.rubricId ? { rubricId: args.rubricId } : {}),
      ...(args.autonomyMode ? { autonomyMode: args.autonomyMode } : {}),
      ...(typeof args.budgetCapCents === 'number'
        ? { budgetCapCents: args.budgetCapCents }
        : {}),
      ...(typeof args.hideAiReasoning === 'boolean'
        ? { hideAiReasoning: args.hideAiReasoning }
        : {}),
      ...(args.allowedFilingEvents ? { allowedFilingEvents: args.allowedFilingEvents } : {}),
      updatedAt: new Date().toISOString(),
    })
    if (assignment.simulationPolicyId && args.autonomyMode) {
      await ctx.db.patch(assignment.simulationPolicyId, {
        autonomyMode: args.autonomyMode,
        updatedAt: new Date().toISOString(),
      })
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      action: 'assignment.updated',
      targetTable: 'assignments',
      targetId: args.assignmentId,
    })
    return null
  },
})

export const publish = mutation({
  args: {
    assignmentId: v.id('assignments'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(ctx, args.assignmentId, [
      'instructor',
      'admin',
    ])
    await ctx.db.patch(args.assignmentId, {
      published: true,
      updatedAt: new Date().toISOString(),
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      action: 'assignment.published',
      targetTable: 'assignments',
      targetId: args.assignmentId,
    })
    return null
  },
})

export const archive = mutation({
  args: {
    assignmentId: v.id('assignments'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(ctx, args.assignmentId, [
      'instructor',
      'admin',
    ])
    await ctx.db.patch(args.assignmentId, {
      published: false,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      action: 'assignment.archived',
      targetTable: 'assignments',
      targetId: args.assignmentId,
    })
    return null
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
      autonomyMode: v.optional(autonomyModeValidator),
      budgetCapCents: v.optional(v.number()),
      hideAiReasoning: v.optional(v.boolean()),
      archivedAt: v.optional(v.string()),
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
      ...(assignment.archivedAt ? { archivedAt: assignment.archivedAt } : {}),
    }))
  },
})

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('assignments'),
      cohortId: v.id('cohorts'),
      cohortTitle: v.string(),
      institutionName: v.string(),
      title: v.string(),
      published: v.boolean(),
      dueAt: v.optional(v.string()),
      autonomyMode: v.optional(autonomyModeValidator),
      status: assignmentStatusValidator,
      caseSessionId: v.optional(v.id('caseSessions')),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    const memberships = await ctx.db
      .query('cohortMemberships')
      .withIndex('by_user', (index) => index.eq('userId', user._id))
      .collect()
    const rows = []
    for (const membership of memberships) {
      const cohort = await ctx.db.get(membership.cohortId)
      if (!cohort || cohort.archived) continue
      const institution = await ctx.db.get(cohort.institutionId)
      const assignments = await ctx.db
        .query('assignments')
        .withIndex('by_cohort', (index) => index.eq('cohortId', cohort._id))
        .collect()
      for (const assignment of assignments) {
        if (!assignment.published || assignment.archivedAt) continue
        const session = await getAssignmentSession(ctx, assignment._id, user._id)
        rows.push({
          id: assignment._id,
          cohortId: cohort._id,
          cohortTitle: cohort.title,
          institutionName: institution?.name ?? 'Institution',
          title: assignment.title,
          published: assignment.published,
          ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
          ...(assignment.autonomyMode ? { autonomyMode: assignment.autonomyMode } : {}),
          status: statusForAssignmentSession(session),
          ...(session?.caseSessionId ? { caseSessionId: session.caseSessionId } : {}),
          ...(session?.submittedAt ? { submittedAt: session.submittedAt } : {}),
          ...(session?.reviewedAt ? { reviewedAt: session.reviewedAt } : {}),
        })
      }
    }
    return rows.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
  },
})

export const get = query({
  args: {
    assignmentId: v.id('assignments'),
  },
  returns: v.union(
    v.object({
      id: v.id('assignments'),
      cohortId: v.id('cohorts'),
      title: v.string(),
      dueAt: v.optional(v.string()),
      rubricId: v.optional(v.string()),
      published: v.boolean(),
      autonomyMode: v.optional(autonomyModeValidator),
      budgetCapCents: v.optional(v.number()),
      hideAiReasoning: v.optional(v.boolean()),
      allowedFilingEvents: v.optional(v.array(v.string())),
      scenarioTitle: v.string(),
      scenarioKey: v.string(),
      status: assignmentStatusValidator,
      caseSessionId: v.optional(v.id('caseSessions')),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
      instructorNote: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { assignment, user, membership } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ['learner', 'instructor', 'admin'],
    )
    if (!assignment.published && !canViewUnpublishedAssignment(user, membership)) return null
    const scenario = await ctx.db.get(assignment.scenarioId)
    const session = await getAssignmentSession(ctx, assignment._id, user._id)
    return {
      id: assignment._id,
      cohortId: assignment.cohortId,
      title: assignment.title,
      ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
      ...(assignment.rubricId ? { rubricId: assignment.rubricId } : {}),
      published: assignment.published,
      ...(assignment.autonomyMode ? { autonomyMode: assignment.autonomyMode } : {}),
      ...(typeof assignment.budgetCapCents === 'number'
        ? { budgetCapCents: assignment.budgetCapCents }
        : {}),
      ...(typeof assignment.hideAiReasoning === 'boolean'
        ? { hideAiReasoning: assignment.hideAiReasoning }
        : {}),
      ...(assignment.allowedFilingEvents
        ? { allowedFilingEvents: assignment.allowedFilingEvents }
        : {}),
      scenarioTitle: scenario?.title ?? 'Scenario',
      scenarioKey: scenario?.scenarioKey ?? '',
      status: statusForAssignmentSession(session),
      ...(session?.caseSessionId ? { caseSessionId: session.caseSessionId } : {}),
      ...(session?.submittedAt ? { submittedAt: session.submittedAt } : {}),
      ...(session?.reviewedAt ? { reviewedAt: session.reviewedAt } : {}),
      ...(session?.instructorNote ? { instructorNote: session.instructorNote } : {}),
    }
  },
})

export const startSession = mutation({
  args: {
    assignmentId: v.id('assignments'),
  },
  returns: v.id('caseSessions'),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(ctx, args.assignmentId, [
      'learner',
      'instructor',
      'admin',
    ])
    if (!assignment.published) {
      // ERROR_CODE: VALIDATION_ERROR
      throw new Error('Assignment is not published')
    }
    const existing = await getAssignmentSession(ctx, assignment._id, user._id)
    if (existing) {
      return existing.caseSessionId
    }
    const scenario = await ctx.db.get(assignment.scenarioId)
    if (!scenario) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Scenario not found')
    }
    const initialSession = createInitialSession(scenario.scenarioKey)
    const caseSessionId = await ctx.db.insert('caseSessions', {
      scenarioId: assignment.scenarioId,
      userId: user._id,
      courtPackId: initialSession.courtPackId,
      status: initialSession.status,
      procedureState: inferProcedureState(initialSession),
      autonomyMode: assignment.autonomyMode ?? 'paused',
      turnPolicy: initialSession.turnPolicy,
      ...(initialSession.sourceProfileId
        ? { sourceProfileId: initialSession.sourceProfileId }
        : {}),
      qualityState: initialSession.qualityState,
      simulatedDate: initialSession.simulatedDate,
    })
    await insertInitialSessionState(ctx, caseSessionId, scenario.scenarioKey)
    if (assignment.simulationPolicyId) {
      const policy = await ctx.db.get(assignment.simulationPolicyId)
      if (policy) {
        await ctx.db.patch(caseSessionId, {
          autonomyMode: policy.autonomyMode,
          turnPolicy: {
            maxTurnsPerRun: policy.maxTurnsPerRun,
            requireHumanApprovalFor: policy.requireHumanApprovalFor,
            stopOnDeficiency: policy.stopOnDeficiency,
          },
        })
      }
    }
    await ctx.db.insert('assignmentSessions', {
      assignmentId: assignment._id,
      caseSessionId,
      userId: user._id,
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId,
      action: 'assignment_session.started',
      targetTable: 'assignments',
      targetId: assignment._id,
    })
    return caseSessionId
  },
})

export const attachSession = mutation({
  args: {
    assignmentId: v.id('assignments'),
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.id('caseSessions'),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(ctx, args.assignmentId, [
      'learner',
      'instructor',
      'admin',
    ])
    if (!assignment.published) {
      // ERROR_CODE: VALIDATION_ERROR
      throw new Error('Assignment is not published')
    }
    const caseSession = await ctx.db.get(args.caseSessionId)
    if (!caseSession || caseSession.userId !== user._id) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Case session not found')
    }
    const existing = await getAssignmentSession(ctx, assignment._id, user._id)
    if (existing) {
      return existing.caseSessionId
    }
    await ctx.db.insert('assignmentSessions', {
      assignmentId: args.assignmentId,
      caseSessionId: args.caseSessionId,
      userId: user._id,
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: args.caseSessionId,
      action: 'assignment_session.attached',
      targetTable: 'assignments',
      targetId: args.assignmentId,
    })
    return args.caseSessionId
  },
})

export const submitSession = mutation({
  args: {
    assignmentId: v.id('assignments'),
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ['learner', 'instructor', 'admin'],
    )
    const assignmentSessions = await listAssignmentSessionsForUser(
      ctx,
      assignment._id,
      user._id,
    )
    const assignmentSession = assignmentSessions.find(
      (candidate) => candidate.caseSessionId === args.caseSessionId,
    )
    if (!assignmentSession) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Assignment session not found')
    }
    if (isSubmittedLockActive(assignmentSession)) {
      // ERROR_CODE: SESSION_LOCKED
      throw new Error('Assignment session is already submitted')
    }
    const submittedAt = new Date().toISOString()
    await ctx.db.patch(assignmentSession._id, { submittedAt })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: args.caseSessionId,
      action: 'assignment_session.submitted',
      targetTable: 'assignmentSessions',
      targetId: assignmentSession._id,
    })
    return null
  },
})

export const reopenSession = mutation({
  args: {
    assignmentSessionId: v.id('assignmentSessions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assignmentSession = await ctx.db.get(args.assignmentSessionId)
    if (!assignmentSession) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Assignment session not found')
    }
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      assignmentSession.assignmentId,
      ['instructor', 'admin'],
    )
    await ctx.db.patch(args.assignmentSessionId, {
      reopenedAt: new Date().toISOString(),
      reopenedByUserId: user._id,
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: assignmentSession.caseSessionId,
      action: 'assignment_session.reopened',
      targetTable: 'assignmentSessions',
      targetId: args.assignmentSessionId,
    })
    return null
  },
})
