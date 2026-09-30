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

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { notFound, unauthorizedRole } from './errors'

export type ReadCtx = QueryCtx | MutationCtx
export type CohortRole = Doc<'cohortMemberships'>['role']
export type InstitutionRole = Doc<'institutionMemberships'>['role']
export type UserRole = Doc<'users'>['role']

const institutionRoleRank: Record<InstitutionRole, number> = {
  learner: 0,
  instructor: 1,
  admin: 2,
}

/**
 * NOT cryptographic — NEVER use for security, authentication, or tokens.
 * Produces a deterministic short id from a string for non-security lookups only.
 *
 * Canonical source: src/domain/auth-pure.ts — keep in sync.
 */
export function toDeterministicId(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Canonical source: src/domain/auth-pure.ts — keep in sync.
 */
export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function isActiveInstitutionMembership(
  membership: Pick<Doc<'institutionMemberships'>, 'status' | 'expiresAt'>,
  now = new Date().toISOString(),
) {
  return membership.status === 'active' && (!membership.expiresAt || membership.expiresAt > now)
}

export async function requireGlobalRole(ctx: ReadCtx, roles: UserRole[]) {
  const { user } = await requireCurrentUser(ctx)
  const requiresAdminOnly = roles.every((role) => role === 'admin')
  const roleAllowed =
    roles.includes(user.role) ||
    (!requiresAdminOnly && user.role !== 'admin' && roles.some((role) => role !== 'admin'))
  if (!roleAllowed) {
    throw unauthorizedRole(roles)
  }
  return user
}

export async function requireAdmin(ctx: ReadCtx) {
  return requireGlobalRole(ctx, ['admin'])
}

function institutionRoleAllowed(role: InstitutionRole, roles: InstitutionRole[]) {
  if (roles.includes(role)) return true
  if (role === 'admin') return roles.includes('admin')
  return roles.some((requestedRole) => requestedRole !== 'admin')
}

function cohortRoleAllowed(role: CohortRole, roles: CohortRole[]) {
  if (roles.includes(role)) return true
  if (role === 'admin') return roles.includes('admin')
  return roles.some((requestedRole) => requestedRole !== 'admin')
}

async function hasActiveSupportGrant(
  ctx: ReadCtx,
  institutionId: Id<'institutions'>,
  userId: Id<'users'>,
) {
  const grants = await ctx.db
    .query('supportAccessGrants')
    .withIndex('by_support_user', (index) => index.eq('supportUserId', userId))
    .collect()
  const now = new Date().toISOString()
  return grants.some(
    (grant) =>
      grant.institutionId === institutionId &&
      !grant.revokedAt &&
      grant.expiresAt > now,
  )
}

export async function requireInstitutionRole(
  ctx: ReadCtx,
  institutionId: Id<'institutions'>,
  roles: InstitutionRole[],
  options: { allowSupportGrant?: boolean } = {},
) {
  const { user } = await requireCurrentUser(ctx)
  if (user.role === 'admin') {
    return { user, membership: null }
  }

  const memberships = await ctx.db
    .query('institutionMemberships')
    .withIndex('by_institution_user', (index) =>
      index.eq('institutionId', institutionId).eq('userId', user._id),
    )
    .collect()
  const now = new Date().toISOString()
  const membership = memberships
    .filter((candidate) => isActiveInstitutionMembership(candidate, now))
    .filter((candidate) => institutionRoleAllowed(candidate.role, roles))
    .sort(
      (a, b) =>
        institutionRoleRank[b.role] - institutionRoleRank[a.role] ||
        a._creationTime - b._creationTime,
    )[0]
  if (membership) {
    return { user, membership }
  }

  if (
    options.allowSupportGrant &&
    (await hasActiveSupportGrant(ctx, institutionId, user._id))
  ) {
    return { user, membership: null }
  }

  throw unauthorizedRole(['institution'])
}

export async function requireCohortRole(
  ctx: ReadCtx,
  cohortId: Id<'cohorts'>,
  roles: CohortRole[],
) {
  const { user } = await requireCurrentUser(ctx)
  const cohort = await ctx.db.get(cohortId)
  if (!cohort) {
    throw notFound('Cohort', cohortId)
  }
  if (user.role === 'admin') {
    return { user, cohort, membership: null }
  }

  const membership = await ctx.db
    .query('cohortMemberships')
    .withIndex('by_cohort_user', (index) =>
      index.eq('cohortId', cohortId).eq('userId', user._id),
    )
    .unique()
  if (membership && cohortRoleAllowed(membership.role, roles)) {
    return { user, cohort, membership }
  }

  throw unauthorizedRole(['cohort'])
}

export async function writeAuditLog(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<'users'>
    institutionId?: Id<'institutions'>
    cohortId?: Id<'cohorts'>
    caseSessionId?: Id<'caseSessions'>
    action: string
    targetTable?: string
    targetId?: string
    metadata?: Record<string, unknown>
  },
) {
  await ctx.db.insert('auditLog', {
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    ...(args.institutionId ? { institutionId: args.institutionId } : {}),
    ...(args.cohortId ? { cohortId: args.cohortId } : {}),
    ...(args.caseSessionId ? { caseSessionId: args.caseSessionId } : {}),
    action: args.action,
    ...(args.targetTable ? { targetTable: args.targetTable } : {}),
    ...(args.targetId ? { targetId: args.targetId } : {}),
    ...(args.metadata ? { metadataJson: JSON.stringify(args.metadata) } : {}),
    createdAt: new Date().toISOString(),
  })
}
