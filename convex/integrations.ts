import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'

import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireCurrentUser, requireIdentity } from './authHelpers'
import {
  caseSessionValidator,
  courtListenerSearchResultValidator,
  toolCallValidator,
} from './validators'
import { searchCourtListenerDockets } from '../src/integrations/courtlistener'

const courtListenerCooldownMs = 5_000
const advanceLiveEventRef = makeFunctionReference<'action'>(
  'caseSessions:advanceLiveEvent',
)

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not configured in Convex`)
  }
  return value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const providerValidator = v.union(v.literal('openrouter'), v.literal('courtlistener'))

export const getIntegrationStatus = query({
  args: {},
  returns: v.object({
    openRouterConfigured: v.boolean(),
    courtListenerConfigured: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireIdentity(ctx)
    return {
      openRouterConfigured: Boolean(
        process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL,
      ),
      courtListenerConfigured: Boolean(process.env.COURTLISTENER_TOKEN),
    }
  },
})

export const getIntegrationCooldownForCurrentUser = internalQuery({
  args: {
    provider: providerValidator,
    cooldownMs: v.number(),
    nowIso: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const events = await ctx.db
      .query('integrationEvents')
      .withIndex('by_user_provider', (index) =>
        index.eq('userId', user._id).eq('provider', args.provider),
      )
      .collect()
    const latest = events.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!latest) return { allowed: true }

    const elapsedMs =
      new Date(args.nowIso).getTime() - new Date(latest.createdAt).getTime()
    if (elapsedMs >= args.cooldownMs) return { allowed: true }
    return { allowed: false, retryAfterMs: args.cooldownMs - elapsedMs }
  },
})

export const recordIntegrationEventForCurrentUser = internalMutation({
  args: {
    provider: providerValidator,
    action: v.string(),
    accepted: v.boolean(),
    errorClass: v.optional(v.string()),
    createdAt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    await ctx.db.insert('integrationEvents', {
      userId: user._id,
      provider: args.provider,
      action: args.action,
      accepted: args.accepted,
      ...(args.errorClass ? { errorClass: args.errorClass } : {}),
      createdAt: args.createdAt,
    })
    return null
  },
})

export const requestLiveProceduralToolCall = action({
  args: {
    caseSessionId: v.id('caseSessions'),
  },
  returns: v.object({
    session: caseSessionValidator,
    toolCall: v.union(toolCallValidator, v.null()),
    rawText: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireIdentity(ctx)
    return ctx.runAction(advanceLiveEventRef, args)
  },
})

export const searchLiveCourtListenerDockets = action({
  args: {
    query: v.string(),
  },
  returns: v.array(courtListenerSearchResultValidator),
  handler: async (ctx, args) => {
    await requireIdentity(ctx)
    const nowIso = new Date().toISOString()
    const cooldown = await ctx.runQuery(
      internal.integrations.getIntegrationCooldownForCurrentUser,
      {
        provider: 'courtlistener',
        cooldownMs: courtListenerCooldownMs,
        nowIso,
      },
    )
    if (!cooldown.allowed) {
      throw new Error('CourtListener cooldown is still active.')
    }

    const query = args.query.trim()
    if (!query) return []

    try {
      const results = await searchCourtListenerDockets(query, requireEnv('COURTLISTENER_TOKEN'))
      await ctx.runMutation(internal.integrations.recordIntegrationEventForCurrentUser, {
        provider: 'courtlistener',
        action: 'searchLiveCourtListenerDockets',
        accepted: true,
        createdAt: new Date().toISOString(),
      })
      return results
    } catch (error) {
      console.error('CourtListener integration action failed', { error: errorMessage(error) })
      await ctx.runMutation(internal.integrations.recordIntegrationEventForCurrentUser, {
        provider: 'courtlistener',
        action: 'searchLiveCourtListenerDockets',
        accepted: false,
        errorClass: 'provider_error',
        createdAt: new Date().toISOString(),
      })
      throw error
    }
  },
})
