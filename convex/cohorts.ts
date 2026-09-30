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

// TODO: Import from './errors' once error module is integrated
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { requireCurrentUser, requireIdentity, upsertCurrentUserDoc } from './authHelpers'
import {
  normalizeEmail,
  isActiveInstitutionMembership,
  requireAdmin,
  requireCohortRole,
  requireInstitutionRole,
  toDeterministicId,
  writeAuditLog,
} from './authz'

const institutionRoleValidator = v.union(
  v.literal('learner'),
  v.literal('instructor'),
  v.literal('admin'),
)

const cohortRoleValidator = institutionRoleValidator

type InstitutionRole = 'learner' | 'instructor' | 'admin'

const roleRank: Record<InstitutionRole, number> = {
  learner: 0,
  instructor: 1,
  admin: 2,
}

const inviteTokenHashPrefix = 'sha256:'

function higherRole(current: InstitutionRole, next: InstitutionRole) {
  return roleRank[current] >= roleRank[next] ? current : next
}

function highestRole(roles: InstitutionRole[]) {
  return roles.reduce<InstitutionRole>((highest, role) => higherRole(highest, role), 'learner')
}

function generateInviteToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function hashInviteToken(token: string) {
  return `${inviteTokenHashPrefix}${await sha256Hex(token)}`
}

function legacyInviteTokenHash(token: string) {
  return toDeterministicId(token)
}

async function findInviteByToken(ctx: MutationCtx, token: string) {
  const tokenHash = await hashInviteToken(token)
  const invites = await ctx.db
    .query('enrollmentInvites')
    .withIndex('by_token_hash', (index) => index.eq('tokenHash', tokenHash))
    .collect()
  if (invites.length > 1) {
    // ERROR_CODE: CONFLICT
    throw new Error('Invite token is ambiguous; request a new invite')
  }
  if (invites[0]) return invites[0]

  const legacyHash = legacyInviteTokenHash(token)
  const legacyInvites = await ctx.db
    .query('enrollmentInvites')
    .withIndex('by_token_hash', (index) => index.eq('tokenHash', legacyHash))
    .collect()
  if (legacyInvites.length > 1) {
    // ERROR_CODE: CONFLICT
    throw new Error('Invite token is ambiguous; request a new invite')
  }
  return legacyInvites[0] ?? null
}

async function createUniqueInviteTokenHash(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateInviteToken()
    const tokenHash = await hashInviteToken(token)
    const collisions = await ctx.db
      .query('enrollmentInvites')
      .withIndex('by_token_hash', (index) => index.eq('tokenHash', tokenHash))
      .collect()
    if (collisions.length === 0) return { token, tokenHash }
  }
  // ERROR_CODE: CONFLICT
  throw new Error('Unable to generate a unique invite token')
}

async function findInstitutionMemberships(
  ctx: MutationCtx,
  institutionId: Id<'institutions'>,
  userId: Id<'users'>,
) {
  return ctx.db
    .query('institutionMemberships')
    .withIndex('by_institution_user', (index) =>
      index.eq('institutionId', institutionId).eq('userId', userId),
    )
    .collect()
}

async function upsertInstitutionMembership(
  ctx: MutationCtx,
  institutionId: Id<'institutions'>,
  userId: Id<'users'>,
  role: InstitutionRole,
  options: { preserveHigherRole?: boolean } = {},
) {
  const now = new Date().toISOString()
  const existingMemberships = (
    await findInstitutionMemberships(ctx, institutionId, userId)
  ).sort((a, b) => a._creationTime - b._creationTime)
  const activeMemberships = existingMemberships.filter((membership) =>
    isActiveInstitutionMembership(membership, now),
  )
  const existing = activeMemberships[0] ?? existingMemberships[0]
  if (existing) {
    const activeExistingRole = activeMemberships.length
      ? highestRole(activeMemberships.map((membership) => membership.role))
      : role
    const nextRole = options.preserveHigherRole ? higherRole(activeExistingRole, role) : role
    await ctx.db.patch(existing._id, {
      role: nextRole,
      status: 'active',
      expiresAt: undefined,
    })
    await Promise.all(
      existingMemberships
        .filter((membership) => membership._id !== existing._id)
        .map((membership) =>
          ctx.db.patch(membership._id, {
            status: 'suspended',
            expiresAt: now,
          }),
        ),
    )
    return { id: existing._id, role: nextRole }
  }
  const id = await ctx.db.insert('institutionMemberships', {
    institutionId,
    userId,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  return { id, role }
}

async function insertInstitutionLearnerMembershipIfMissing(
  ctx: MutationCtx,
  institutionId: Id<'institutions'>,
  userId: Id<'users'>,
) {
  const membership = await upsertInstitutionMembership(ctx, institutionId, userId, 'learner', {
    preserveHigherRole: true,
  })
  return membership.id
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
      // ERROR_CODE: CONFLICT
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
    const now = new Date().toISOString()
    const activeInstitutionIds = Array.from(
      new Set(
        memberships
          .filter((membership) => isActiveInstitutionMembership(membership, now))
          .map((membership) => membership.institutionId),
      ),
    )
    const institutions = await Promise.all(
      activeInstitutionIds.map((institutionId) => ctx.db.get(institutionId)),
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
    await insertInstitutionLearnerMembershipIfMissing(
      ctx,
      cohort.institutionId,
      args.userId,
    )
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
    const { user, membership } = await requireInstitutionRole(
      ctx,
      args.institutionId,
      ['instructor', 'admin'],
    )
    const canInviteAdmins = user.role === 'admin' || membership?.role === 'admin'
    if (args.invites.some((invite) => invite.role === 'admin') && !canInviteAdmins) {
      // ERROR_CODE: AUTH_UNAUTHORIZED_ROLE
      throw new Error('Admin role required to invite institution admins')
    }
    if (args.cohortId) {
      const cohort = await ctx.db.get(args.cohortId)
      if (!cohort || cohort.institutionId !== args.institutionId) {
        // ERROR_CODE: VALIDATION_ERROR
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
      const { token, tokenHash } = await createUniqueInviteTokenHash(ctx)
      await ctx.db.insert('enrollmentInvites', {
        institutionId: args.institutionId,
        ...(args.cohortId ? { cohortId: args.cohortId } : {}),
        email,
        role: invite.role,
        tokenHash,
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
    const invite = await findInviteByToken(ctx, args.token)
    if (!invite) {
      // ERROR_CODE: NOT_FOUND
      throw new Error('Invite not found')
    }
    if (invite.acceptedAt) {
      // ERROR_CODE: CONFLICT
      throw new Error('Invite already accepted')
    }
    if (invite.expiresAt <= new Date().toISOString()) {
      // ERROR_CODE: VALIDATION_ERROR
      throw new Error('Invite expired')
    }
    if (identity.email && normalizeEmail(identity.email) !== invite.email) {
      // ERROR_CODE: AUTH_REQUIRED
      throw new Error('Invite email does not match signed-in user')
    }

    const institutionMembership = await upsertInstitutionMembership(
      ctx,
      invite.institutionId,
      user._id,
      invite.role,
      { preserveHigherRole: true },
    )
    const inviteCohortId = invite.cohortId
    if (inviteCohortId) {
      const existing = await ctx.db
        .query('cohortMemberships')
        .withIndex('by_cohort_user', (index) =>
          index.eq('cohortId', inviteCohortId).eq('userId', user._id),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, {
          role: higherRole(existing.role, invite.role),
        })
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
      metadata: { inviteRole: invite.role, role: institutionMembership.role },
    })
    return {
      institutionId: invite.institutionId,
      ...(inviteCohortId ? { cohortId: inviteCohortId } : {}),
      role: institutionMembership.role,
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

export const listRoster = query({
  args: {
    cohortId: v.id('cohorts'),
  },
  returns: v.array(
    v.object({
      userId: v.id('users'),
      displayName: v.string(),
      accountRole: v.union(v.literal('student'), v.literal('admin'), v.literal('instructor')),
      cohortRole: cohortRoleValidator,
    }),
  ),
  handler: async (ctx, args) => {
    await requireCohortRole(ctx, args.cohortId, ['instructor', 'admin'])
    const memberships = await ctx.db
      .query('cohortMemberships')
      .withIndex('by_cohort', (index) => index.eq('cohortId', args.cohortId))
      .collect()
    const rows = []
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId)
      if (!user) continue
      rows.push({
        userId: user._id,
        displayName: user.displayName,
        accountRole: user.role,
        cohortRole: membership.role,
      })
    }
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName))
  },
})
