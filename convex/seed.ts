import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { upsertCurrentUserDoc } from './authHelpers'
import {
  courtPacks,
  moduleManifests,
  procedureModules,
  ruleModules,
  rulePacks,
  scenarios,
} from '../src/modules/registry'
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
    ...(pack.moduleId ? { moduleId: pack.moduleId } : {}),
    label: pack.label,
    courtSystem: pack.courtSystem,
    ...(pack.courtLevel ? { courtLevel: pack.courtLevel } : {}),
    ...(pack.procedureDomain ? { procedureDomain: pack.procedureDomain } : {}),
    version: pack.version,
    sourceUrl: pack.sourceUrl,
    sourceVersionIds: pack.sourceVersionIds ?? [],
    published: true,
  }
}

function rulePackCurrent(doc: Doc<'rulePacks'>) {
  return {
    packId: doc.packId,
    ...(doc.moduleId ? { moduleId: doc.moduleId } : {}),
    label: doc.label,
    courtSystem: doc.courtSystem,
    ...(doc.courtLevel ? { courtLevel: doc.courtLevel } : {}),
    ...(doc.procedureDomain ? { procedureDomain: doc.procedureDomain } : {}),
    version: doc.version,
    sourceUrl: doc.sourceUrl,
    sourceVersionIds: doc.sourceVersionIds ?? [],
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
    ...(pack.moduleId ? { moduleId: pack.moduleId } : {}),
    label: pack.label,
    courtSystem: pack.courtSystem,
    courtLevel: pack.courtLevel,
    procedureDomain: pack.procedureDomain,
    baseCourtPackIds: pack.baseCourtPackIds,
    includedRulePackIds: pack.includedRulePackIds,
    rulePackIds: pack.rulePackIds,
    procedureModuleIds: pack.procedureModuleIds ?? [],
    participantRoles: pack.participantRoles,
    filingEventsJson: JSON.stringify(pack.filingEvents),
    aiActorsJson: JSON.stringify(pack.aiActors),
    docketNumberFormat: pack.docketNumberFormat,
    ...(pack.releaseStatus ? { releaseStatus: pack.releaseStatus } : {}),
    ...(pack.sourceVersionIds ? { sourceVersionIds: pack.sourceVersionIds } : {}),
    ...(pack.evalThresholds
      ? { evalThresholdsJson: JSON.stringify(pack.evalThresholds) }
      : {}),
    published: publishedCourtPackIds.has(pack.id),
  }
}

function courtPackCurrent(doc: Doc<'courtPacks'>) {
  return {
    packId: doc.packId,
    ...(doc.moduleId ? { moduleId: doc.moduleId } : {}),
    label: doc.label,
    courtSystem: doc.courtSystem,
    courtLevel: doc.courtLevel,
    procedureDomain: doc.procedureDomain,
    baseCourtPackIds: doc.baseCourtPackIds,
    includedRulePackIds: doc.includedRulePackIds,
    rulePackIds: doc.rulePackIds,
    procedureModuleIds: doc.procedureModuleIds ?? [],
    ...(doc.participantRoles ? { participantRoles: doc.participantRoles } : {}),
    ...(doc.filingEventsJson ? { filingEventsJson: doc.filingEventsJson } : {}),
    ...(doc.aiActorsJson ? { aiActorsJson: doc.aiActorsJson } : {}),
    docketNumberFormat: doc.docketNumberFormat,
    ...(doc.releaseStatus ? { releaseStatus: doc.releaseStatus } : {}),
    ...(doc.sourceVersionIds ? { sourceVersionIds: doc.sourceVersionIds } : {}),
    ...(doc.evalThresholdsJson ? { evalThresholdsJson: doc.evalThresholdsJson } : {}),
    published: doc.published,
  }
}

function scenarioDoc(scenario: Scenario) {
  return {
    scenarioKey: scenario.id,
    visibility: 'public_template' as const,
    scenarioFamilyKey: scenario.id,
    revision: 1,
    revisionStatus: 'published' as const,
    title: scenario.title,
    source: scenario.source,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    lowerTribunal: scenario.lowerTribunal,
    natureOfSuit: scenario.natureOfSuit,
    proceduralPosture: scenario.proceduralPosture,
    issuesPresented: scenario.issuesPresented,
    meritsRecord: scenario.meritsRecord,
    ...(scenario.training ? { trainingJson: JSON.stringify(scenario.training) } : {}),
    ...(scenario.trialDocket ? { trialDocketJson: JSON.stringify(scenario.trialDocket) } : {}),
    ...(scenario.sourceCaseUrl ? { sourceCaseUrl: scenario.sourceCaseUrl } : {}),
    published: true,
  }
}

function scenarioCurrent(doc: Doc<'scenarios'>) {
  return {
    scenarioKey: doc.scenarioKey,
    visibility: doc.visibility ?? (doc.ownerUserId ? 'private' as const : 'public_template' as const),
    scenarioFamilyKey: doc.scenarioFamilyKey ?? doc.scenarioKey,
    revision: doc.revision ?? 1,
    revisionStatus: doc.revisionStatus ?? (doc.published ? 'published' as const : 'draft' as const),
    title: doc.title,
    source: doc.source,
    courtPackId: doc.courtPackId,
    shortCaption: doc.shortCaption,
    lowerTribunal: doc.lowerTribunal,
    natureOfSuit: doc.natureOfSuit,
    proceduralPosture: doc.proceduralPosture,
    issuesPresented: doc.issuesPresented,
    meritsRecord: doc.meritsRecord,
    ...(doc.trainingJson ? { trainingJson: doc.trainingJson } : {}),
    ...(doc.trialDocketJson ? { trialDocketJson: doc.trialDocketJson } : {}),
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

async function upsertModuleManifests(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const manifest of moduleManifests) {
    const doc = {
      moduleId: manifest.moduleId,
      type: manifest.type,
      label: manifest.label,
      version: manifest.version,
      enabled: true,
      published: true,
    }
    const matches = await ctx.db
      .query('moduleManifests')
      .withIndex('by_module_id', (index) => index.eq('moduleId', manifest.moduleId))
      .collect()
    const existing = matches[0]

    for (const duplicate of matches.slice(1)) {
      await ctx.db.delete(duplicate._id)
      counts.deleted += 1
    }

    if (!existing) {
      await ctx.db.insert('moduleManifests', doc)
      counts.inserted += 1
    } else if (
      !sameRecord(
        {
          moduleId: existing.moduleId,
          type: existing.type,
          label: existing.label,
          version: existing.version,
          enabled: existing.enabled,
          published: existing.published,
        },
        doc,
      )
    ) {
      await ctx.db.patch(existing._id, doc)
      counts.updated += 1
    }
  }

  return counts
}

async function upsertLegalSourceVersions(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const module of ruleModules) {
    for (const source of module.sources) {
      const doc = {
        sourceVersionId: source.id,
        moduleId: module.id,
        label: source.label,
        jurisdiction: source.jurisdiction,
        version: source.version,
        effectiveFrom: source.effectiveFrom,
        ...(source.effectiveTo ? { effectiveTo: source.effectiveTo } : {}),
        sourceUrl: source.sourceUrl,
        sourceSystem: source.sourceSystem,
        reviewed: source.reviewed,
      }
      const matches = await ctx.db
        .query('legalSourceVersions')
        .withIndex('by_source_version', (index) =>
          index.eq('sourceVersionId', source.id),
        )
        .collect()
      const existing = matches[0]

      for (const duplicate of matches.slice(1)) {
        await ctx.db.delete(duplicate._id)
        counts.deleted += 1
      }

      if (!existing) {
        await ctx.db.insert('legalSourceVersions', doc)
        counts.inserted += 1
      } else if (
        !sameRecord(
          {
            sourceVersionId: existing.sourceVersionId,
            moduleId: existing.moduleId,
            label: existing.label,
            jurisdiction: existing.jurisdiction,
            version: existing.version,
            effectiveFrom: existing.effectiveFrom,
            ...(existing.effectiveTo ? { effectiveTo: existing.effectiveTo } : {}),
            sourceUrl: existing.sourceUrl,
            sourceSystem: existing.sourceSystem,
            reviewed: existing.reviewed,
          },
          doc,
        )
      ) {
        await ctx.db.patch(existing._id, doc)
        counts.updated += 1
      }
    }
  }

  return counts
}

async function upsertRuleConstraints(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const module of ruleModules) {
    for (const constraint of module.constraints) {
      const doc = {
        constraintId: constraint.id,
        ruleModuleId: module.id,
        ruleId: constraint.ruleId,
        sourceVersionId: constraint.sourceVersionId,
        topic: constraint.topic,
        kind: constraint.kind,
        value: constraint.value,
        ruleRefs: constraint.ruleRefs,
      }
      const matches = await ctx.db
        .query('ruleConstraints')
        .withIndex('by_constraint', (index) =>
          index.eq('constraintId', constraint.id),
        )
        .collect()
      const existing = matches[0]

      for (const duplicate of matches.slice(1)) {
        await ctx.db.delete(duplicate._id)
        counts.deleted += 1
      }

      if (!existing) {
        await ctx.db.insert('ruleConstraints', doc)
        counts.inserted += 1
      } else if (
        !sameRecord(
          {
            constraintId: existing.constraintId,
            ruleModuleId: existing.ruleModuleId,
            ruleId: existing.ruleId,
            sourceVersionId: existing.sourceVersionId,
            topic: existing.topic,
            kind: existing.kind,
            value: existing.value,
            ruleRefs: existing.ruleRefs,
          },
          doc,
        )
      ) {
        await ctx.db.patch(existing._id, doc)
        counts.updated += 1
      }
    }
  }

  return counts
}

async function upsertProcedureTransitions(ctx: MutationCtx) {
  const counts = emptyCounts()

  for (const module of procedureModules) {
    for (const transition of module.transitions) {
      const doc = {
        transitionId: transition.id,
        procedureModuleId: module.id,
        fromState: transition.fromState,
        toState: transition.toState,
        ...(transition.filingEventId ? { filingEventId: transition.filingEventId } : {}),
        ...(transition.actorToolName ? { actorToolName: transition.actorToolName } : {}),
        guard: transition.guard,
        effect: transition.effect,
        ruleRefs: transition.ruleRefs,
      }
      const matches = await ctx.db
        .query('procedureTransitions')
        .withIndex('by_transition', (index) =>
          index.eq('transitionId', transition.id),
        )
        .collect()
      const existing = matches[0]

      for (const duplicate of matches.slice(1)) {
        await ctx.db.delete(duplicate._id)
        counts.deleted += 1
      }

      if (!existing) {
        await ctx.db.insert('procedureTransitions', doc)
        counts.inserted += 1
      } else if (
        !sameRecord(
          {
            transitionId: existing.transitionId,
            procedureModuleId: existing.procedureModuleId,
            fromState: existing.fromState,
            toState: existing.toState,
            ...(existing.filingEventId ? { filingEventId: existing.filingEventId } : {}),
            ...(existing.actorToolName ? { actorToolName: existing.actorToolName } : {}),
            guard: existing.guard,
            effect: existing.effect,
            ruleRefs: existing.ruleRefs,
          },
          doc,
        )
      ) {
        await ctx.db.patch(existing._id, doc)
        counts.updated += 1
      }
    }
  }

  return counts
}

async function upsertScenarios(ctx: MutationCtx) {
  const counts = emptyCounts()
  const seededScenarioKeys = new Set(scenarios.map((scenario) => scenario.id))

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
      await ctx.db.patch(existing._id, { ...doc, documentAssetsJson: undefined })
      counts.updated += 1
    } else if (existing.documentAssetsJson) {
      await ctx.db.patch(existing._id, { documentAssetsJson: undefined })
      counts.updated += 1
    }
  }

  const existingScenarios = await ctx.db.query('scenarios').collect()
  for (const existing of existingScenarios) {
    if (
      existing.published &&
      !existing.ownerUserId &&
      !seededScenarioKeys.has(existing.scenarioKey)
    ) {
      await ctx.db.patch(existing._id, { published: false })
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
    moduleManifests: countValidator,
    legalSourceVersions: countValidator,
    ruleConstraints: countValidator,
    procedureTransitions: countValidator,
    courtPacks: countValidator,
    scenarios: countValidator,
  }),
  handler: async (ctx) => {
    await upsertCurrentUserDoc(ctx)

    const seededRulePacks = await upsertRulePacks(ctx)
    const seededRuleItems = await upsertRuleItems(ctx)
    const seededModuleManifests = await upsertModuleManifests(ctx)
    const seededLegalSourceVersions = await upsertLegalSourceVersions(ctx)
    const seededRuleConstraints = await upsertRuleConstraints(ctx)
    const seededProcedureTransitions = await upsertProcedureTransitions(ctx)
    const seededCourtPacks = await upsertCourtPacks(ctx)
    const seededScenarios = await upsertScenarios(ctx)

    return {
      rulePacks: seededRulePacks,
      ruleItems: seededRuleItems,
      moduleManifests: seededModuleManifests,
      legalSourceVersions: seededLegalSourceVersions,
      ruleConstraints: seededRuleConstraints,
      procedureTransitions: seededProcedureTransitions,
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
    moduleManifests: v.number(),
    legalSourceVersions: v.number(),
    ruleConstraints: v.number(),
    procedureTransitions: v.number(),
    courtPacks: v.number(),
    scenarios: v.number(),
    publishedRulePacks: v.number(),
    publishedCourtPacks: v.number(),
    publishedScenarios: v.number(),
  }),
  handler: async (ctx) => {
    const [
      rulePackDocs,
      ruleItemDocs,
      moduleManifestDocs,
      legalSourceVersionDocs,
      ruleConstraintDocs,
      procedureTransitionDocs,
      courtPackDocs,
      scenarioDocs,
    ] =
      await Promise.all([
        ctx.db.query('rulePacks').collect(),
        ctx.db.query('ruleItems').collect(),
        ctx.db.query('moduleManifests').collect(),
        ctx.db.query('legalSourceVersions').collect(),
        ctx.db.query('ruleConstraints').collect(),
        ctx.db.query('procedureTransitions').collect(),
        ctx.db.query('courtPacks').collect(),
        ctx.db.query('scenarios').collect(),
      ])

    return {
      rulePacks: rulePackDocs.length,
      ruleItems: ruleItemDocs.length,
      moduleManifests: moduleManifestDocs.length,
      legalSourceVersions: legalSourceVersionDocs.length,
      ruleConstraints: ruleConstraintDocs.length,
      procedureTransitions: procedureTransitionDocs.length,
      courtPacks: courtPackDocs.length,
      scenarios: scenarioDocs.length,
      publishedRulePacks: rulePackDocs.filter((pack) => pack.published).length,
      publishedCourtPacks: courtPackDocs.filter((pack) => pack.published).length,
      publishedScenarios: scenarioDocs.filter((scenario) => scenario.published).length,
    }
  },
})
