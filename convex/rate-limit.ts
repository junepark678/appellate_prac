import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { rateLimited } from './errors'

type RateLimitConfig = {
  maxCalls: number
  windowMs: number
  keyPrefix: string
}

export const RATE_LIMITS = {
  sessionCreation: { maxCalls: 5, windowMs: 60_000, keyPrefix: 'session_create' },
  filingSubmission: { maxCalls: 20, windowMs: 60_000, keyPrefix: 'filing_submit' },
  inviteCreation: { maxCalls: 10, windowMs: 60_000, keyPrefix: 'invite_create' },
  aiRun: { maxCalls: 10, windowMs: 60_000, keyPrefix: 'ai_run' },
  institutionCreation: { maxCalls: 3, windowMs: 60_000, keyPrefix: 'institution_create' },
  cohortCreation: { maxCalls: 5, windowMs: 60_000, keyPrefix: 'cohort_create' },
} as const

function rateLimitAction(config: RateLimitConfig): string {
  return `rate_limit:${config.keyPrefix}`
}

export async function checkRateLimit(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const action = rateLimitAction(config)
  const windowStart = new Date(Date.now() - config.windowMs).toISOString()

  const recentEntries = await ctx.db
    .query('auditLog')
    .withIndex('by_actor', (q) => q.eq('actorUserId', userId))
    .order('desc')
    .collect()

  const callsInWindow = recentEntries.filter(
    (entry) => entry.action === action && entry.createdAt >= windowStart,
  )

  const count = callsInWindow.length
  const allowed = count < config.maxCalls
  const resetAt =
    callsInWindow.length > 0
      ? new Date(new Date(callsInWindow[callsInWindow.length - 1].createdAt).getTime() + config.windowMs).toISOString()
      : new Date().toISOString()

  return { allowed, remaining: allowed ? config.maxCalls - count : 0, resetAt }
}

export async function requireRateLimit(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  config: RateLimitConfig,
): Promise<void> {
  const result = await checkRateLimit(ctx, userId, config)
  if (!result.allowed) {
    throw rateLimited(config.keyPrefix)
  }
}
