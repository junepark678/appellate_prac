import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { scenarioValidator } from './validators'
import { requireCurrentUser } from './authHelpers'
import type { Id } from './_generated/dataModel'
import type { Scenario } from '../src/domain/types'
import scenarioSeed from '../src/domain/scenarios.seed.json'

const seedScenarios = scenarioSeed as Scenario[]

function scenarioFromDoc(scenario: {
  scenarioKey: string
  title: string
  source: Scenario['source']
  courtPackId: string
  shortCaption: string
  lowerTribunal: string
  natureOfSuit: string
  proceduralPosture: string
  issuesPresented: string[]
  meritsRecord: string[]
  trainingJson?: string
  trialDocketJson?: string
  documentAssetsJson?: string
  sourceCaseUrl?: string
}): Scenario {
  const sourceCaseUrl = scenario.sourceCaseUrl
    ? { sourceCaseUrl: scenario.sourceCaseUrl }
    : {}
  const training = scenario.trainingJson
    ? { training: JSON.parse(scenario.trainingJson) as Scenario['training'] }
    : {}
  const trialDocket = scenario.trialDocketJson
    ? { trialDocket: JSON.parse(scenario.trialDocketJson) as Scenario['trialDocket'] }
    : {}
  const documentAssets = scenario.documentAssetsJson
    ? { documentAssets: JSON.parse(scenario.documentAssetsJson) as Scenario['documentAssets'] }
    : {}
  return {
    id: scenario.scenarioKey,
    title: scenario.title,
    source: scenario.source,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    lowerTribunal: scenario.lowerTribunal,
    natureOfSuit: scenario.natureOfSuit,
    proceduralPosture: scenario.proceduralPosture,
    issuesPresented: scenario.issuesPresented,
    meritsRecord: scenario.meritsRecord,
    ...training,
    ...trialDocket,
    ...documentAssets,
    ...sourceCaseUrl,
  }
}

function publishedRecordFromDoc(scenario: {
  _id: Id<'scenarios'>
  scenarioKey: string
  title: string
  courtPackId: string
  shortCaption: string
  proceduralPosture: string
}) {
  return {
    id: scenario._id,
    scenarioKey: scenario.scenarioKey,
    title: scenario.title,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    proceduralPosture: scenario.proceduralPosture,
  }
}

function publishedRecordFromSeed(scenario: Scenario) {
  return {
    scenarioKey: scenario.id,
    title: scenario.title,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    proceduralPosture: scenario.proceduralPosture,
  }
}

export const listPublished = query({
  args: {},
  returns: v.array(scenarioValidator),
  handler: async (ctx) => {
    const persisted = (await ctx.db
      .query('scenarios')
      .withIndex('by_published', (index) => index.eq('published', true))
      .collect()).filter((scenario) => scenario.scenarioKey !== 'recap-import-placeholder')

    const persistedByKey = new Map(
      persisted.map((scenario) => [scenario.scenarioKey, scenarioFromDoc(scenario)]),
    )
    const seededKeys = new Set(seedScenarios.map((scenario) => scenario.id))
    const mergedSeeded = seedScenarios.map(
      (scenario) => persistedByKey.get(scenario.id) ?? scenario,
    )
    const extraPublished = persisted
      .filter((scenario) => !seededKeys.has(scenario.scenarioKey))
      .map(scenarioFromDoc)

    return [...mergedSeeded, ...extraPublished]
  },
})

export const listPublishedRecords = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.optional(v.id('scenarios')),
      scenarioKey: v.string(),
      title: v.string(),
      courtPackId: v.string(),
      shortCaption: v.string(),
      proceduralPosture: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const persisted = await ctx.db
      .query('scenarios')
      .withIndex('by_published', (index) => index.eq('published', true))
      .collect()
    const persistedRecords = persisted.filter(
      (scenario) => scenario.scenarioKey !== 'recap-import-placeholder',
    )
    const persistedByKey = new Map(
      persistedRecords.map((scenario) => [scenario.scenarioKey, scenario]),
    )
    const seededKeys = new Set(seedScenarios.map((scenario) => scenario.id))
    const mergedSeeded = seedScenarios.map((scenario) => {
      const persistedScenario = persistedByKey.get(scenario.id)
      return persistedScenario
        ? publishedRecordFromDoc(persistedScenario)
        : publishedRecordFromSeed(scenario)
    })
    const extraPublished = persistedRecords
      .filter((scenario) => !seededKeys.has(scenario.scenarioKey))
      .map(publishedRecordFromDoc)

    return [...mergedSeeded, ...extraPublished]
  },
})

export const seedPublished = mutation({
  args: {},
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    await requireCurrentUser(ctx)
    let inserted = 0
    let updated = 0

    for (const scenario of seedScenarios) {
      const existing = await ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenario.id))
        .unique()
      const scenarioDoc = {
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
        ...(scenario.training ? { trainingJson: JSON.stringify(scenario.training) } : {}),
        ...(scenario.trialDocket ? { trialDocketJson: JSON.stringify(scenario.trialDocket) } : {}),
        ...(scenario.documentAssets
          ? { documentAssetsJson: JSON.stringify(scenario.documentAssets) }
          : {}),
        ...(scenario.sourceCaseUrl ? { sourceCaseUrl: scenario.sourceCaseUrl } : {}),
        published: true,
      }

      if (existing) {
        await ctx.db.patch(existing._id, scenarioDoc)
        updated += 1
      } else {
        await ctx.db.insert('scenarios', scenarioDoc)
        inserted += 1
      }
    }

    const stalePlaceholder = await ctx.db
      .query('scenarios')
      .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', 'recap-import-placeholder'))
      .unique()
    if (stalePlaceholder?.published) {
      await ctx.db.patch(stalePlaceholder._id, { published: false })
      updated += 1
    }

    return { inserted, updated }
  },
})
