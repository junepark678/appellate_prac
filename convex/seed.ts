import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { upsertCurrentUserDoc } from './authHelpers'
import { courtPacks, rulePacks, scenarios } from '../src/domain/packs'
import type { CourtPack, RuleItem, RulePack, Scenario } from '../src/domain/types'

type SeedCounts = {
  inserted: number
  updated: number
  deleted: number
}

const countValidator = v.object({
  inserted: v.number(),
  updated: v.number(),
  deleted: v.number(),
})

const publishedCourtPackIds = new Set(['us-federal-ca4-civil-appeal'])

function emptyCounts(): SeedCounts {
  return { inserted: 0, updated: 0, deleted: 0 }
}

function sameRecord(left: Record<string, unknown>, right: Record<string, unknown>) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function rulePackDoc(pack: RulePack) {
  return {
    packId: pack.id,
    label: pack.label,
    courtSystem: pack.courtSystem,
    ...(pack.courtLevel ? { courtLevel: pack.courtLevel } : {}),
    ...(pack.procedureDomain ? { procedureDomain: pack.procedureDomain } : {}),
    version: pack.version,
    sourceUrl: pack.sourceUrl,
    published: true,
  }
}

function rulePackCurrent(doc: Doc<'rulePacks'>) {
  return {
    packId: doc.packId,
    label: doc.label,
    courtSystem: doc.courtSystem,
    ...(doc.courtLevel ? { courtLevel: doc.courtLevel } : {}),
    ...(doc.procedureDomain ? { procedureDomain: doc.procedureDomain } : {}),
    version: doc.version,
    sourceUrl: doc.sourceUrl,
    published: doc.published,
  }
}

function ruleItemDoc(packId: string, item: RuleItem) {
  return {
    packId,
    jurisdiction: item.jurisdiction,
    ruleId: item.ruleId,
    topic: item.topic,
    effectiveFrom: item.effectiveFrom,
    ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}),
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    plainText: item.plainText,
    simulatorNotes: item.simulatorNotes,
    constraintsJson: JSON.stringify(item.structuredConstraints),
  }
}

function ruleItemCurrent(doc: Doc<'ruleItems'>) {
  return {
    packId: doc.packId,
    ...(doc.jurisdiction ? { jurisdiction: doc.jurisdiction } : {}),
    ruleId: doc.ruleId,
    topic: doc.topic,
    effectiveFrom: doc.effectiveFrom,
    ...(doc.effectiveTo ? { effectiveTo: doc.effectiveTo } : {}),
    sourceLabel: doc.sourceLabel,
    sourceUrl: doc.sourceUrl,
    plainText: doc.plainText,
    simulatorNotes: doc.simulatorNotes,
    constraintsJson: doc.constraintsJson,
  }
}

function courtPackDoc(pack: CourtPack) {
  return {
    packId: pack.id,
    label: pack.label,
    courtSystem: pack.courtSystem,
    courtLevel: pack.courtLevel,
    procedureDomain: pack.procedureDomain,
    baseCourtPackIds: pack.baseCourtPackIds,
    includedRulePackIds: pack.includedRulePackIds,
    rulePackIds: pack.rulePackIds,
    participantRoles: pack.participantRoles,
    filingEventsJson: JSON.stringify(pack.filingEvents),
    aiActorsJson: JSON.stringify(pack.aiActors),
    docketNumberFormat: pack.docketNumberFormat,
    published: publishedCourtPackIds.has(pack.id),
  }
}

function courtPackCurrent(doc: Doc<'courtPacks'>) {
  return {
    packId: doc.packId,
    label: doc.label,
    courtSystem: doc.courtSystem,
    courtLevel: doc.courtLevel,
    procedureDomain: doc.procedureDomain,
    baseCourtPackIds: doc.baseCourtPackIds,
    includedRulePackIds: doc.includedRulePackIds,
    rulePackIds: doc.rulePackIds,
    ...(doc.participantRoles ? { participantRoles: doc.participantRoles } : {}),
    ...(doc.filingEventsJson ? { filingEventsJson: doc.filingEventsJson } : {}),
    ...(doc.aiActorsJson ? { aiActorsJson: doc.aiActorsJson } : {}),
    docketNumberFormat: doc.docketNumberFormat,
    published: doc.published,
  }
}

function scenarioDoc(scenario: Scenario) {
  return {
    scenarioKey: scenario.id,
    title: scenario.title,
    source: scenario.source,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    lowerTribunal: scenario.lowerTribunal,
    natureOfSuit: scenario.natureOfSuit,
    proceduralPosture: scenario.proceduralPosture,
    issuesPresented: scenario.issuesPresented,
    meritsRecord: scenario.meritsRecord,
    ...(scenario.sourceCaseUrl ? { sourceCaseUrl: scenario.sourceCaseUrl } : {}),
    published: true,
  }
}

function scenarioCurrent(doc: Doc<'scenarios'>) {
  return {
    scenarioKey: doc.scenarioKey,
    title: doc.title,
    source: doc.source,
    courtPackId: doc.courtPackId,
    shortCaption: doc.shortCaption,
    lowerTribunal: doc.lowerTribunal,
    natureOfSuit: doc.natureOfSuit,
    proceduralPosture: doc.proceduralPosture,
    issuesPresented: doc.issuesPresented,
    meritsRecord: doc.meritsRecord,
    ...(doc.sourceCaseUrl ? { sourceCaseUrl: doc.sourceCaseUrl } : {}),
    published: doc.published,
  }
}

async function upsertRulePacks(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const pack of rulePacks) {
    const doc = rulePackDoc(pack)
    const matches = await ctx.db
      .query('rulePacks')
      .withIndex('by_pack_version', (index) =>
        index.eq('packId', pack.id).eq('version', pack.version),
      )
      .collect()
    const existing = matches[0]

    for (const duplicate of matches.slice(1)) {
      await ctx.db.delete(duplicate._id)
      counts.deleted += 1
    }

    if (!existing) {
      await ctx.db.insert('rulePacks', doc)
      counts.inserted += 1
    } else if (!sameRecord(rulePackCurrent(existing), doc)) {
      await ctx.db.patch(existing._id, doc)
      counts.updated += 1
    }
  }

  return counts
}

async function upsertRuleItems(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const pack of rulePacks) {
    const existingItems = await ctx.db
      .query('ruleItems')
      .withIndex('by_pack', (index) => index.eq('packId', pack.id))
      .collect()
    const existingByRuleId = new Map<string, Array<Doc<'ruleItems'>>>()

    for (const item of existingItems) {
      const group = existingByRuleId.get(item.ruleId) ?? []
      group.push(item)
      existingByRuleId.set(item.ruleId, group)
    }

    const seededRuleIds = new Set(pack.items.map((item) => item.ruleId))

    for (const item of pack.items) {
      const doc = ruleItemDoc(pack.id, item)
      const matches = existingByRuleId.get(item.ruleId) ?? []
      const existing = matches[0]

      for (const duplicate of matches.slice(1)) {
        await ctx.db.delete(duplicate._id)
        counts.deleted += 1
      }

      if (!existing) {
        await ctx.db.insert('ruleItems', doc)
        counts.inserted += 1
      } else if (!sameRecord(ruleItemCurrent(existing), doc)) {
        await ctx.db.patch(existing._id, doc)
        counts.updated += 1
      }
    }

    for (const existing of existingItems) {
      if (!seededRuleIds.has(existing.ruleId)) {
        await ctx.db.delete(existing._id)
        counts.deleted += 1
      }
    }
  }

  return counts
}

async function upsertCourtPacks(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const pack of courtPacks) {
    const doc = courtPackDoc(pack)
    const matches = await ctx.db
      .query('courtPacks')
      .withIndex('by_pack_id', (index) => index.eq('packId', pack.id))
      .collect()
    const existing = matches[0]

    for (const duplicate of matches.slice(1)) {
      await ctx.db.delete(duplicate._id)
      counts.deleted += 1
    }

    if (!existing) {
      await ctx.db.insert('courtPacks', doc)
      counts.inserted += 1
    } else if (!sameRecord(courtPackCurrent(existing), doc)) {
      await ctx.db.patch(existing._id, doc)
      counts.updated += 1
    }
  }

  return counts
}

async function upsertScenarios(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const scenario of scenarios) {
    const doc = scenarioDoc(scenario)
    const matches = await ctx.db
      .query('scenarios')
      .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenario.id))
      .collect()
    const existing = matches[0]

    for (const duplicate of matches.slice(1)) {
      await ctx.db.delete(duplicate._id)
      counts.deleted += 1
    }

    if (!existing) {
      await ctx.db.insert('scenarios', doc)
      counts.inserted += 1
    } else if (!sameRecord(scenarioCurrent(existing), doc)) {
      await ctx.db.patch(existing._id, doc)
      counts.updated += 1
    }
  }

  return counts
}

export const all = mutation({
  args: {},
  returns: v.object({
    rulePacks: countValidator,
    ruleItems: countValidator,
    courtPacks: countValidator,
    scenarios: countValidator,
  }),
  handler: async (ctx) => {
    await upsertCurrentUserDoc(ctx)

    const seededRulePacks = await upsertRulePacks(ctx)
    const seededRuleItems = await upsertRuleItems(ctx)
    const seededCourtPacks = await upsertCourtPacks(ctx)
    const seededScenarios = await upsertScenarios(ctx)

    return {
      rulePacks: seededRulePacks,
      ruleItems: seededRuleItems,
      courtPacks: seededCourtPacks,
      scenarios: seededScenarios,
    }
  },
})

export const status = query({
  args: {},
  returns: v.object({
    rulePacks: v.number(),
    ruleItems: v.number(),
    courtPacks: v.number(),
    scenarios: v.number(),
    publishedRulePacks: v.number(),
    publishedCourtPacks: v.number(),
    publishedScenarios: v.number(),
  }),
  handler: async (ctx) => {
    const [rulePackDocs, ruleItemDocs, courtPackDocs, scenarioDocs] =
      await Promise.all([
        ctx.db.query('rulePacks').collect(),
        ctx.db.query('ruleItems').collect(),
        ctx.db.query('courtPacks').collect(),
        ctx.db.query('scenarios').collect(),
      ])

    return {
      rulePacks: rulePackDocs.length,
      ruleItems: ruleItemDocs.length,
      courtPacks: courtPackDocs.length,
      scenarios: scenarioDocs.length,
      publishedRulePacks: rulePackDocs.filter((pack) => pack.published).length,
      publishedCourtPacks: courtPackDocs.filter((pack) => pack.published).length,
      publishedScenarios: scenarioDocs.filter((scenario) => scenario.published).length,
    }
  },
})
