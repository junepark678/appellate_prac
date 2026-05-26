import type { UserIdentity } from 'convex/server'

import type { Doc } from './_generated/dataModel'
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server'
import { authRequired, providerError, userNotInitialized } from './errors'

type AuthenticatedCtx = Pick<ActionCtx | QueryCtx | MutationCtx, 'auth'>

function displayNameFromIdentity(identity: UserIdentity) {
  return (
    identity.name ??
    identity.email ??
    identity.preferredUsername ??
    identity.nickname ??
    'Student account'
  )
}

export async function requireIdentity(ctx: AuthenticatedCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw authRequired()
  }
  return identity
}

export async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await requireIdentity(ctx)
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_subject', (query) =>
      query.eq('authSubject', identity.tokenIdentifier),
    )
    .unique()

  return { identity, user }
}

export async function requireCurrentUser(ctx: QueryCtx | MutationCtx) {
  const { identity, user } = await getCurrentUser(ctx)
  if (!user) {
    throw userNotInitialized()
  }
  return { identity, user }
}

export async function requireAdminUser(ctx: QueryCtx | MutationCtx) {
  const result = await requireCurrentUser(ctx)
  if (result.user.role !== 'admin') {
    throw new Error('Admin role required')
  }
  return result
}

export async function upsertCurrentUserDoc(ctx: MutationCtx): Promise<Doc<'users'>> {
  const identity = await requireIdentity(ctx)
  const existing = await ctx.db
    .query('users')
    .withIndex('by_auth_subject', (query) =>
      query.eq('authSubject', identity.tokenIdentifier),
    )
    .unique()
  const displayName = displayNameFromIdentity(identity)

  if (existing) {
    if (existing.displayName !== displayName) {
      await ctx.db.patch(existing._id, { displayName })
      return { ...existing, displayName }
    }
    return existing
  }

  const userId = await ctx.db.insert('users', {
    authSubject: identity.tokenIdentifier,
    displayName,
    role: 'student',
    monthlyAiBudgetCents: 250,
  })
  const user = await ctx.db.get(userId)
  if (!user) {
    throw providerError('convex', 500)
  }
  return user
}
