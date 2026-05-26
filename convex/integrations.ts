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

export const reserveIntegrationEventForCurrentUser = internalMutation({
  args: {
    provider: providerValidator,
    action: v.string(),
    cooldownMs: v.number(),
    nowIso: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
    eventId: v.optional(v.id('integrationEvents')),
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
    if (latest) {
      const elapsedMs =
        new Date(args.nowIso).getTime() - new Date(latest.createdAt).getTime()
      if (elapsedMs < args.cooldownMs) {
        return { allowed: false, retryAfterMs: args.cooldownMs - elapsedMs }
      }
    }

    const eventId = await ctx.db.insert('integrationEvents', {
      userId: user._id,
      provider: args.provider,
      action: args.action,
      accepted: false,
      errorClass: 'in_flight',
      createdAt: args.nowIso,
    })
    return { allowed: true, eventId }
  },
})

export const finalizeIntegrationEventForCurrentUser = internalMutation({
  args: {
    eventId: v.id('integrationEvents'),
    accepted: v.boolean(),
    errorClass: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const event = await ctx.db.get(args.eventId)
    if (!event || event.userId !== user._id) {
      throw new Error('Integration event reservation not found.')
    }
    await ctx.db.patch(args.eventId, {
      accepted: args.accepted,
      errorClass: args.errorClass,
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
    const query = args.query.trim()
    if (!query) return []
    const reservation = await ctx.runMutation(
      internal.integrations.reserveIntegrationEventForCurrentUser,
      {
        provider: 'courtlistener',
        action: 'searchLiveCourtListenerDockets',
        cooldownMs: courtListenerCooldownMs,
        nowIso,
      },
    )
    if (!reservation.allowed || !reservation.eventId) {
      throw new Error('CourtListener cooldown is still active.')
    }

    try {
      const results = await searchCourtListenerDockets(query, requireEnv('COURTLISTENER_TOKEN'))
      await ctx.runMutation(internal.integrations.finalizeIntegrationEventForCurrentUser, {
        eventId: reservation.eventId,
        accepted: true,
      })
      return results
    } catch (error) {
      console.error('CourtListener integration action failed', { error: errorMessage(error) })
      await ctx.runMutation(internal.integrations.finalizeIntegrationEventForCurrentUser, {
        eventId: reservation.eventId,
        accepted: false,
        errorClass: 'provider_error',
      })
      throw error
    }
  },
})
