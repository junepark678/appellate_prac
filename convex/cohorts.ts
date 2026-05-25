import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { requireCurrentUser, requireIdentity, upsertCurrentUserDoc } from './authHelpers'
import {
  normalizeEmail,
  requireAdmin,
  requireCohortRole,
  requireInstitutionRole,
  simpleHash,
  writeAuditLog,
} from './authz'

const institutionRoleValidator = v.union(
  v.literal('learner'),
  v.literal('instructor'),
  v.literal('admin'),
)

const cohortRoleValidator = institutionRoleValidator

async function upsertInstitutionMembership(
  ctx: MutationCtx,
  institutionId: Id<'institutions'>,
  userId: Id<'users'>,
  role: 'learner' | 'instructor' | 'admin',
) {
  const existing = await ctx.db
    .query('institutionMemberships')
    .withIndex('by_institution_user', (index) =>
      index.eq('institutionId', institutionId).eq('userId', userId),
    )
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, { role, status: 'active' })
    return existing._id
  }
  return ctx.db.insert('institutionMemberships', {
    institutionId,
    userId,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
}

export const createInstitution = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    clerkOrganizationId: v.optional(v.string()),
  },
  returns: v.id('institutions'),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const existing = await ctx.db
      .query('institutions')
      .withIndex('by_slug', (index) => index.eq('slug', args.slug))
      .unique()
    if (existing) {
      throw new Error('Institution slug already exists')
    }

    const institutionId = await ctx.db.insert('institutions', {
      name: args.name,
      slug: args.slug,
      ...(args.clerkOrganizationId
        ? { clerkOrganizationId: args.clerkOrganizationId }
        : {}),
      status: 'active',
      monthlyAiBudgetCents: 5_000,
    })
    await upsertInstitutionMembership(ctx, institutionId, user._id, 'admin')
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId,
      action: 'institution.created',
      targetTable: 'institutions',
      targetId: institutionId,
    })
    return institutionId
  },
})

export const listInstitutions = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('institutions'),
      name: v.string(),
      slug: v.string(),
      clerkOrganizationId: v.optional(v.string()),
      status: v.union(v.literal('active'), v.literal('paused'), v.literal('archived')),
      monthlyAiBudgetCents: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    if (user.role === 'admin') {
      const institutions = await ctx.db.query('institutions').collect()
      return institutions.map((institution) => ({
        id: institution._id,
        name: institution.name,
        slug: institution.slug,
        ...(institution.clerkOrganizationId
          ? { clerkOrganizationId: institution.clerkOrganizationId }
          : {}),
        status: institution.status,
        monthlyAiBudgetCents: institution.monthlyAiBudgetCents,
      }))
    }

    const memberships = await ctx.db
      .query('institutionMemberships')
      .withIndex('by_user', (index) => index.eq('userId', user._id))
      .collect()
    const institutions = await Promise.all(
      memberships
        .filter((membership) => membership.status === 'active')
        .map((membership) => ctx.db.get(membership.institutionId)),
    )
    return institutions
      .filter((institution) => institution !== null)
      .map((institution) => ({
        id: institution._id,
        name: institution.name,
        slug: institution.slug,
        ...(institution.clerkOrganizationId
          ? { clerkOrganizationId: institution.clerkOrganizationId }
          : {}),
        status: institution.status,
        monthlyAiBudgetCents: institution.monthlyAiBudgetCents,
      }))
  },
})

export const setInstitutionMember = mutation({
  args: {
    institutionId: v.id('institutions'),
    userId: v.id('users'),
    role: institutionRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    await upsertInstitutionMembership(ctx, args.institutionId, args.userId, args.role)
    await writeAuditLog(ctx, {
      actorUserId: actor._id,
      institutionId: args.institutionId,
      action: 'institution.member_role_changed',
      targetTable: 'users',
      targetId: args.userId,
      metadata: { role: args.role },
    })
    return null
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
    const { user } = await requireInstitutionRole(ctx, args.institutionId, [
      'instructor',
      'admin',
    ])

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
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: args.institutionId,
      cohortId,
      action: 'cohort.created',
      targetTable: 'cohorts',
      targetId: cohortId,
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
    const { user, cohort } = await requireCohortRole(ctx, args.cohortId, [
      'instructor',
      'admin',
    ])

    const existing = await ctx.db
      .query('cohortMemberships')
      .withIndex('by_cohort_user', (index) =>
        index.eq('cohortId', args.cohortId).eq('userId', args.userId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role })
    } else {
      await ctx.db.insert('cohortMemberships', {
        cohortId: args.cohortId,
        userId: args.userId,
        role: args.role,
      })
    }
    await upsertInstitutionMembership(ctx, cohort.institutionId, args.userId, args.role)
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: args.cohortId,
      action: 'cohort.member_role_changed',
      targetTable: 'users',
      targetId: args.userId,
      metadata: { role: args.role },
    })
    return null
  },
})

export const inviteMembers = mutation({
  args: {
    institutionId: v.id('institutions'),
    cohortId: v.optional(v.id('cohorts')),
    invites: v.array(
      v.object({
        email: v.string(),
        role: institutionRoleValidator,
      }),
    ),
    expiresAt: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      email: v.string(),
      role: institutionRoleValidator,
      token: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireInstitutionRole(ctx, args.institutionId, [
      'instructor',
      'admin',
    ])
    if (args.cohortId) {
      const cohort = await ctx.db.get(args.cohortId)
      if (!cohort || cohort.institutionId !== args.institutionId) {
        throw new Error('Cohort does not belong to institution')
      }
      await requireCohortRole(ctx, args.cohortId, ['instructor', 'admin'])
    }
    const expiresAt =
      args.expiresAt ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()

    const created = []
    for (const invite of args.invites) {
      const email = normalizeEmail(invite.email)
      const token = `${email}:${crypto.randomUUID()}`
      await ctx.db.insert('enrollmentInvites', {
        institutionId: args.institutionId,
        ...(args.cohortId ? { cohortId: args.cohortId } : {}),
        email,
        role: invite.role,
        tokenHash: simpleHash(token),
        expiresAt,
        createdByUserId: user._id,
        createdAt: new Date().toISOString(),
      })
      created.push({ email, role: invite.role, token })
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: args.institutionId,
      ...(args.cohortId ? { cohortId: args.cohortId } : {}),
      action: 'enrollment_invites.created',
      metadata: { count: created.length },
    })
    return created
  },
})

export const acceptInvite = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    institutionId: v.id('institutions'),
    cohortId: v.optional(v.id('cohorts')),
    role: institutionRoleValidator,
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const user = await upsertCurrentUserDoc(ctx)
    const invite = await ctx.db
      .query('enrollmentInvites')
      .withIndex('by_token_hash', (index) => index.eq('tokenHash', simpleHash(args.token)))
      .unique()
    if (!invite) {
      throw new Error('Invite not found')
    }
    if (invite.acceptedAt) {
      throw new Error('Invite already accepted')
    }
    if (invite.expiresAt <= new Date().toISOString()) {
      throw new Error('Invite expired')
    }
    if (identity.email && normalizeEmail(identity.email) !== invite.email) {
      throw new Error('Invite email does not match signed-in user')
    }

    await upsertInstitutionMembership(ctx, invite.institutionId, user._id, invite.role)
    const inviteCohortId = invite.cohortId
    if (inviteCohortId) {
      const existing = await ctx.db
        .query('cohortMemberships')
        .withIndex('by_cohort_user', (index) =>
          index.eq('cohortId', inviteCohortId).eq('userId', user._id),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, { role: invite.role })
      } else {
        await ctx.db.insert('cohortMemberships', {
          cohortId: inviteCohortId,
          userId: user._id,
          role: invite.role,
        })
      }
    }
    const acceptedAt = new Date().toISOString()
    await ctx.db.patch(invite._id, { acceptedAt })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: invite.institutionId,
      ...(inviteCohortId ? { cohortId: inviteCohortId } : {}),
      action: 'enrollment_invite.accepted',
      targetTable: 'enrollmentInvites',
      targetId: invite._id,
      metadata: { role: invite.role },
    })
    return {
      institutionId: invite.institutionId,
      ...(inviteCohortId ? { cohortId: inviteCohortId } : {}),
      role: invite.role,
    }
  },
})

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('cohorts'),
      institutionId: v.id('institutions'),
      institutionName: v.string(),
      title: v.string(),
      term: v.string(),
      role: cohortRoleValidator,
      archived: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    const memberships = user.role === 'admin'
      ? []
      : await ctx.db
          .query('cohortMemberships')
          .withIndex('by_user', (index) => index.eq('userId', user._id))
          .collect()
    const cohorts = user.role === 'admin'
      ? await ctx.db.query('cohorts').collect()
      : (
          await Promise.all(
            memberships.map(async (membership) => ({
              membership,
              cohort: await ctx.db.get(membership.cohortId),
            })),
          )
        )
          .filter(
            (entry): entry is typeof entry & { cohort: NonNullable<typeof entry.cohort> } =>
              entry.cohort !== null,
          )
          .map((entry) => entry.cohort)
    const institutions = await Promise.all(
      cohorts.map((cohort) => ctx.db.get(cohort.institutionId)),
    )
    return cohorts.map((cohort, index) => ({
      id: cohort._id,
      institutionId: cohort.institutionId,
      institutionName: institutions[index]?.name ?? 'Institution',
      title: cohort.title,
      term: cohort.term,
      role:
        user.role === 'admin'
          ? 'admin'
          : memberships.find((membership) => membership.cohortId === cohort._id)?.role ??
            'learner',
      archived: cohort.archived,
    }))
  },
})
