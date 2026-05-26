import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { notFound, unauthorizedRole } from './errors'

export type ReadCtx = QueryCtx | MutationCtx
export type CohortRole = Doc<'cohortMemberships'>['role']
export type InstitutionRole = Doc<'institutionMemberships'>['role']
export type UserRole = Doc<'users'>['role']

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

export async function requireGlobalRole(ctx: ReadCtx, roles: UserRole[]) {
  const { user } = await requireCurrentUser(ctx)
  if (!roles.includes(user.role)) {
    throw unauthorizedRole(roles)
  }
  return user
}

export async function requireAdmin(ctx: ReadCtx) {
  return requireGlobalRole(ctx, ['admin'])
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
) {
  const { user } = await requireCurrentUser(ctx)
  if (user.role === 'admin') {
    return { user, membership: null }
  }

  const membership = await ctx.db
    .query('institutionMemberships')
    .withIndex('by_institution_user', (index) =>
      index.eq('institutionId', institutionId).eq('userId', user._id),
    )
    .unique()
  if (
    membership?.status === 'active' &&
    roles.includes(membership.role) &&
    (!membership.expiresAt || membership.expiresAt > new Date().toISOString())
  ) {
    return { user, membership }
  }

  if (user.role === 'instructor' && await hasActiveSupportGrant(ctx, institutionId, user._id)) {
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
  if (membership && roles.includes(membership.role)) {
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
