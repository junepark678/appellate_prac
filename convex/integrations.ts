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

import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'

import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireIdentity } from './authHelpers'
import { requireInstitutionRole } from './authz'
import {
  caseSessionValidator,
  courtListenerSearchResultValidator,
  toolCallValidator,
} from './validators'
import { searchCourtListenerDockets } from '../src/integrations/courtlistener'

const courtListenerCooldownMs = 5_000
const courtListenerResultLimit = 20
const courtListenerMetadataNotice =
  'Caller-reported metadata; not verified court evidence.'
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
    institutionId: v.id('institutions'),
    provider: providerValidator,
    cooldownMs: v.number(),
    nowIso: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireInstitutionRole(ctx, args.institutionId, ['learner'])
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
    institutionId: v.id('institutions'),
    provider: providerValidator,
    action: v.string(),
    accepted: v.boolean(),
    errorClass: v.optional(v.string()),
    createdAt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireInstitutionRole(ctx, args.institutionId, ['learner'])
    await ctx.db.insert('integrationEvents', {
      institutionId: args.institutionId,
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
    institutionId: v.id('institutions'),
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
    const { user } = await requireInstitutionRole(ctx, args.institutionId, ['learner'])
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
      institutionId: args.institutionId,
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
    institutionId: v.id('institutions'),
    accepted: v.boolean(),
    errorClass: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireInstitutionRole(ctx, args.institutionId, ['learner'])
    const event = await ctx.db.get(args.eventId)
    if (
      !event ||
      event.userId !== user._id ||
      event.institutionId !== args.institutionId
    ) {
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
    institutionId: v.id('institutions'),
    query: v.string(),
  },
  returns: v.array(courtListenerSearchResultValidator),
  handler: async (ctx, args) => {
    await requireIdentity(ctx)
    const nowIso = new Date().toISOString()
    const query = args.query.trim()
    if (!query) {
      await ctx.runQuery(
        internal.integrations.getIntegrationCooldownForCurrentUser,
        {
          institutionId: args.institutionId,
          provider: 'courtlistener',
          cooldownMs: courtListenerCooldownMs,
          nowIso,
        },
      )
      return []
    }
    const reservation = await ctx.runMutation(
      internal.integrations.reserveIntegrationEventForCurrentUser,
      {
        institutionId: args.institutionId,
        provider: 'courtlistener',
        action: 'searchLiveCourtListenerDockets',
        cooldownMs: courtListenerCooldownMs,
        nowIso,
      },
    )
    if (!reservation.allowed || !reservation.eventId) {
      throw new Error('CourtListener cooldown is still active.')
    }

    let results: Awaited<ReturnType<typeof searchCourtListenerDockets>>
    try {
      results = await searchCourtListenerDockets(
        query,
        requireEnv('COURTLISTENER_TOKEN'),
      )
    } catch (error) {
      console.error('CourtListener integration action failed', {
        error: errorMessage(error),
      })
      await ctx.runMutation(
        internal.integrations.finalizeIntegrationEventForCurrentUser,
        {
          eventId: reservation.eventId,
          institutionId: args.institutionId,
          accepted: false,
          errorClass: 'provider_error',
        },
      )
      throw error
    }

    await ctx.runMutation(
      internal.integrations.finalizeIntegrationEventForCurrentUser,
      {
        eventId: reservation.eventId,
        institutionId: args.institutionId,
        accepted: true,
      },
    )

    return results.slice(0, courtListenerResultLimit).map((result) => ({
      ...result,
      snippet: [courtListenerMetadataNotice, result.snippet]
        .filter(Boolean)
        .join('\n\n'),
    }))
  },
})
