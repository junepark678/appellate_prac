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

import { mutation, query } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { requireAdmin, writeAuditLog } from './authz'
import { notFound } from './errors'

const policyKeyValidator = v.union(
  v.literal('terms'),
  v.literal('privacy'),
  v.literal('training_disclaimer'),
  v.literal('ai_disclosure'),
  v.literal('ferpa'),
  v.literal('data_retention'),
  v.literal('support_access'),
)

const defaultPolicyBodies = {
  terms:
    'Use is limited to appellate practice training in authorized institutional courses. The simulator does not provide legal advice.',
  privacy:
    'Uploaded documents and simulator work are treated as education records for institutional use and are not used for public legal services.',
  training_disclaimer:
    'This is a training simulation for Fourth Circuit federal appellate practice. Do not use it for live client matters or legal advice.',
  ai_disclosure:
    'AI features may propose simulator actions, but deterministic validation gates docket mutations and instructors control assignment policy.',
  ferpa:
    'Institutional course records are handled as education records. Access is limited by institution, cohort role, and audited support grants.',
  data_retention:
    'Course records are retained for institutional review and export unless an administrator applies a documented retention process.',
  support_access:
    'Support/admin access to institutional data must be time-bound, purpose-limited, and recorded in the audit log.',
} as const

export const seedDefaults = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAdmin(ctx)
    let count = 0
    for (const [policyKey, bodyMarkdown] of Object.entries(defaultPolicyBodies)) {
      const existing = await ctx.db
        .query('policyVersions')
        .withIndex('by_policy_version', (index) =>
          index.eq('policyKey', policyKey as keyof typeof defaultPolicyBodies).eq('version', 'v1'),
        )
        .unique()
      if (!existing) {
        await ctx.db.insert('policyVersions', {
          policyKey: policyKey as keyof typeof defaultPolicyBodies,
          version: 'v1',
          title: policyKey.replaceAll('_', ' '),
          bodyMarkdown,
          effectiveAt: '2026-05-25T00:00:00.000Z',
          published: true,
        })
        count += 1
      }
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      action: 'policy.defaults_seeded',
      metadata: { inserted: count },
    })
    return count
  },
})

export const publishVersion = mutation({
  args: {
    policyKey: policyKeyValidator,
    version: v.string(),
    title: v.string(),
    bodyMarkdown: v.string(),
    effectiveAt: v.string(),
  },
  returns: v.id('policyVersions'),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const policyVersionId = await ctx.db.insert('policyVersions', {
      policyKey: args.policyKey,
      version: args.version,
      title: args.title,
      bodyMarkdown: args.bodyMarkdown,
      effectiveAt: args.effectiveAt,
      published: true,
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      action: 'policy.version_published',
      targetTable: 'policyVersions',
      targetId: policyVersionId,
      metadata: { policyKey: args.policyKey, version: args.version },
    })
    return policyVersionId
  },
})

export const listCurrent = query({
  args: {},
  returns: v.array(
    v.object({
      policyKey: policyKeyValidator,
      version: v.string(),
      title: v.string(),
      bodyMarkdown: v.string(),
      effectiveAt: v.string(),
      acceptedAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    const policies = await ctx.db
      .query('policyVersions')
      .withIndex('by_published', (index) => index.eq('published', true))
      .collect()
    const latestByKey = new Map<string, (typeof policies)[number]>()
    for (const policy of policies) {
      const existing = latestByKey.get(policy.policyKey)
      if (!existing || existing.effectiveAt < policy.effectiveAt) {
        latestByKey.set(policy.policyKey, policy)
      }
    }
    const acceptances = await ctx.db
      .query('policyAcceptances')
      .withIndex('by_user', (index) => index.eq('userId', user._id))
      .collect()
    return [...latestByKey.values()].map((policy) => {
      const acceptance = acceptances.find(
        (candidate) =>
          candidate.policyKey === policy.policyKey &&
          candidate.version === policy.version,
      )
      return {
        policyKey: policy.policyKey,
        version: policy.version,
        title: policy.title,
        bodyMarkdown: policy.bodyMarkdown,
        effectiveAt: policy.effectiveAt,
        ...(acceptance ? { acceptedAt: acceptance.acceptedAt } : {}),
      }
    })
  },
})

export const accept = mutation({
  args: {
    policyKey: policyKeyValidator,
    version: v.string(),
    contextJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const policy = await ctx.db
      .query('policyVersions')
      .withIndex('by_policy_version', (index) =>
        index.eq('policyKey', args.policyKey).eq('version', args.version),
      )
      .unique()
    if (!policy?.published) {
      throw notFound('Published policy version', `${args.policyKey}@${args.version}`)
    }
    const existing = await ctx.db
      .query('policyAcceptances')
      .withIndex('by_user_policy_version', (index) =>
        index
          .eq('userId', user._id)
          .eq('policyKey', args.policyKey)
          .eq('version', args.version),
      )
      .unique()
    if (!existing) {
      await ctx.db.insert('policyAcceptances', {
        userId: user._id,
        policyKey: args.policyKey,
        version: args.version,
        acceptedAt: new Date().toISOString(),
        ...(args.contextJson ? { contextJson: args.contextJson } : {}),
      })
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      action: 'policy.accepted',
      targetTable: 'policyVersions',
      targetId: policy._id,
      metadata: { policyKey: args.policyKey, version: args.version },
    })
    return null
  },
})
