import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { scenarioValidator } from './validators'
import { requireCurrentUser } from './authHelpers'
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
  sourceCaseUrl?: string
}): Scenario {
  const sourceCaseUrl = scenario.sourceCaseUrl
    ? { sourceCaseUrl: scenario.sourceCaseUrl }
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
    ...sourceCaseUrl,
  }
}

export const listPublished = query({
  args: {},
  returns: v.array(scenarioValidator),
  handler: async (ctx) => {
    const persisted = await ctx.db
      .query('scenarios')
      .withIndex('by_published', (index) => index.eq('published', true))
      .collect()

    if (!persisted.length) {
      return seedScenarios
    }

    return persisted.map(scenarioFromDoc)
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

    return { inserted, updated }
  },
})
