import { v } from 'convex/values'

import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { scenarioValidator } from './validators'
import { requireAdminUser, requireCurrentUser } from './authHelpers'
import type { Scenario, ScenarioDocumentAsset, ScenarioIssue, ScenarioRecordExcerpt } from '../src/domain/types'
import scenarioSeed from '../src/domain/scenarios.seed.json'

const seedScenarios = scenarioSeed as Scenario[]

function parseJsonField<T>(json: string, label: string): T {
  try {
    return JSON.parse(json) as T
  } catch {
    throw new Error(`Invalid persisted JSON for ${label}.`)
  }
}

function parseOptionalJsonField<T>(json: string | undefined, label: string): T | undefined {
  return json ? parseJsonField<T>(json, label) : undefined
}

function visibilityForDoc(doc: Doc<'scenarios'>): 'public_template' | 'private' {
  if (doc.visibility) return doc.visibility
  return doc.ownerUserId ? 'private' : 'public_template'
}

function scenarioAssetFromDoc(doc: Doc<'scenarioDocumentAssets'>): ScenarioDocumentAsset {
  return {
    id: doc.assetKey,
    label: doc.label,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    source: doc.source,
    storageId: doc.storageId,
    ...(doc.sha256 ? { sha256: doc.sha256 } : {}),
    sizeBytes: doc.sizeBytes,
    pageCount: doc.pageCount,
    ...(doc.extractedText ? { extractedText: doc.extractedText } : {}),
    ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
  }
}

function scenarioFromDoc(
  doc: Doc<'scenarios'>,
  issues: ScenarioIssue[] = [],
  recordExcerpts: ScenarioRecordExcerpt[] = [],
  assets: ScenarioDocumentAsset[] = [],
): Scenario {
  const sourceCaseUrl = doc.sourceCaseUrl ? { sourceCaseUrl: doc.sourceCaseUrl } : {}
  const training = parseOptionalJsonField<Scenario['training']>(
    doc.trainingJson,
    `scenario ${doc._id} training`,
  )
  const trialDocket = parseOptionalJsonField<Scenario['trialDocket']>(
    doc.trialDocketJson,
    `scenario ${doc._id} trial docket`,
  )
  const legacyDocumentAssets = parseOptionalJsonField<Scenario['documentAssets']>(
    doc.documentAssetsJson,
    `scenario ${doc._id} document assets`,
  )?.map((asset) => {
    const { publicUrl: _publicUrl, fileUrl: _fileUrl, ...assetWithoutUrls } =
      asset as ScenarioDocumentAsset & { publicUrl?: string }
    return assetWithoutUrls
  })
  const documentAssets = assets.length ? assets : legacyDocumentAssets

  return {
    id: doc.scenarioKey,
    visibility: visibilityForDoc(doc),
    ...(doc.ownerUserId ? { ownerUserId: doc.ownerUserId } : {}),
    scenarioFamilyKey: doc.scenarioFamilyKey ?? doc.scenarioKey,
    revision: doc.revision ?? 1,
    revisionStatus: doc.revisionStatus ?? (doc.published ? 'published' : 'draft'),
    ...(doc.createdFromScenarioId ? { createdFromScenarioId: doc.createdFromScenarioId } : {}),
    ...(doc.supersededByScenarioId ? { supersededByScenarioId: doc.supersededByScenarioId } : {}),
    title: doc.title,
    source: doc.source,
    courtPackId: doc.courtPackId,
    shortCaption: doc.shortCaption,
    lowerTribunal: doc.lowerTribunal,
    natureOfSuit: doc.natureOfSuit,
    proceduralPosture: doc.proceduralPosture,
    issuesPresented: doc.issuesPresented,
    meritsRecord: doc.meritsRecord,
    ...(issues.length ? { issues } : {}),
    ...(recordExcerpts.length ? { recordExcerpts } : {}),
    ...(training ? { training } : {}),
    ...(trialDocket ? { trialDocket } : {}),
    ...(documentAssets ? { documentAssets } : {}),
    ...sourceCaseUrl,
  }
}

function scenarioDocFromInput(
  input: {
    title: string
    source: Scenario['source']
    courtPackId: string
    shortCaption: string
    lowerTribunal: string
    natureOfSuit: string
    proceduralPosture: string
    issuesPresented: string[]
    meritsRecord: string[]
    training?: Scenario['training']
    trialDocket?: Scenario['trialDocket']
    sourceCaseUrl?: string
  },
  systemFields: {
    scenarioKey: string
    visibility: 'public_template' | 'private'
    ownerUserId?: Id<'users'>
    scenarioFamilyKey: string
    revision: number
    revisionStatus: 'draft' | 'published' | 'archived'
    createdFromScenarioId?: Id<'scenarios'>
    supersededByScenarioId?: Id<'scenarios'>
    published: boolean
  },
) {
  return {
    ...systemFields,
    title: input.title,
    source: input.source,
    courtPackId: input.courtPackId,
    shortCaption: input.shortCaption,
    lowerTribunal: input.lowerTribunal,
    natureOfSuit: input.natureOfSuit,
    proceduralPosture: input.proceduralPosture,
    issuesPresented: input.issuesPresented,
    meritsRecord: input.meritsRecord,
    ...(input.training ? { trainingJson: JSON.stringify(input.training) } : {}),
    ...(input.trialDocket ? { trialDocketJson: JSON.stringify(input.trialDocket) } : {}),
    ...(input.sourceCaseUrl ? { sourceCaseUrl: input.sourceCaseUrl } : {}),
  }
}

type ReadCtx = QueryCtx | MutationCtx

async function loadRelatedScenarioData(ctx: ReadCtx, scenarioId: Id<'scenarios'>) {
  const [issues, recordExcerpts, assets] = await Promise.all([
    ctx.db
      .query('scenarioIssues')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', scenarioId))
      .collect(),
    ctx.db
      .query('scenarioRecordExcerpts')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', scenarioId))
      .collect(),
    ctx.db
      .query('scenarioDocumentAssets')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', scenarioId))
      .collect(),
  ])

  return {
    issues: issues.map((issue: Doc<'scenarioIssues'>) => ({
      id: issue.issueId,
      label: issue.label,
      standardOfReview: issue.standardOfReview,
      preservationFacts: issue.preservationFacts,
      recordSupportFacts: issue.recordSupportFacts,
      likelyArgumentsForAppellant: issue.likelyArgumentsForAppellant,
      likelyArgumentsForAppellee: issue.likelyArgumentsForAppellee,
      possibleRelief: issue.possibleRelief,
    })),
    recordExcerpts: recordExcerpts.map((excerpt: Doc<'scenarioRecordExcerpts'>) => ({
      id: excerpt.excerptId,
      label: excerpt.label,
      source: excerpt.source,
      text: excerpt.text,
      citedByIssueIds: excerpt.citedByIssueIds,
    })),
    assets: assets.map(scenarioAssetFromDoc),
  }
}

async function visibleScenarioDocsForUser(ctx: ReadCtx, userId: Id<'users'>) {
  const all = await ctx.db.query('scenarios').collect()
  return all.filter((scenario: Doc<'scenarios'>) => {
    const visibility = visibilityForDoc(scenario)
    if (visibility === 'public_template') {
      return (scenario.revisionStatus ?? (scenario.published ? 'published' : 'draft')) === 'published'
    }
    return scenario.ownerUserId === userId
  })
}

async function requireVisibleScenario(
  ctx: ReadCtx,
  scenarioKey: string,
  userId: Id<'users'>,
) {
  const scenario = await ctx.db
    .query('scenarios')
    .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenarioKey))
    .unique()
  if (!scenario) {
    throw new Error('Scenario not found')
  }
  const visibility = visibilityForDoc(scenario)
  if (visibility === 'private' && scenario.ownerUserId !== userId) {
    throw new Error('Scenario not found')
  }
  if (
    visibility === 'public_template' &&
    (scenario.revisionStatus ?? (scenario.published ? 'published' : 'draft')) !== 'published'
  ) {
    throw new Error('Scenario not found')
  }
  return scenario
}

async function cloneScenarioChildren(
  ctx: MutationCtx,
  fromScenarioId: Id<'scenarios'>,
  toScenarioId: Id<'scenarios'>,
) {
  const [issues, excerpts, assets] = await Promise.all([
    ctx.db
      .query('scenarioIssues')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', fromScenarioId))
      .collect(),
    ctx.db
      .query('scenarioRecordExcerpts')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', fromScenarioId))
      .collect(),
    ctx.db
      .query('scenarioDocumentAssets')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', fromScenarioId))
      .collect(),
  ])
  for (const issue of issues as Doc<'scenarioIssues'>[]) {
    await ctx.db.insert('scenarioIssues', {
      scenarioId: toScenarioId,
      issueId: issue.issueId,
      label: issue.label,
      standardOfReview: issue.standardOfReview,
      preservationFacts: issue.preservationFacts,
      recordSupportFacts: issue.recordSupportFacts,
      likelyArgumentsForAppellant: issue.likelyArgumentsForAppellant,
      likelyArgumentsForAppellee: issue.likelyArgumentsForAppellee,
      possibleRelief: issue.possibleRelief,
    })
  }
  for (const excerpt of excerpts as Doc<'scenarioRecordExcerpts'>[]) {
    await ctx.db.insert('scenarioRecordExcerpts', {
      scenarioId: toScenarioId,
      excerptId: excerpt.excerptId,
      label: excerpt.label,
      source: excerpt.source,
      text: excerpt.text,
      citedByIssueIds: excerpt.citedByIssueIds,
    })
  }
  const createdAt = new Date().toISOString()
  for (const asset of assets as Doc<'scenarioDocumentAssets'>[]) {
    await ctx.db.insert('scenarioDocumentAssets', {
      scenarioId: toScenarioId,
      assetKey: asset.assetKey,
      label: asset.label,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      source: asset.source,
      storageId: asset.storageId,
      ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
      sizeBytes: asset.sizeBytes,
      pageCount: asset.pageCount,
      ...(asset.extractedText ? { extractedText: asset.extractedText } : {}),
      ...(asset.sourceUrl ? { sourceUrl: asset.sourceUrl } : {}),
      createdAt,
    })
  }
}

const scenarioInputValidator = v.object({
  title: v.string(),
  source: v.union(v.literal('synthetic'), v.literal('recap_import'), v.literal('generated_from_import')),
  courtPackId: v.string(),
  shortCaption: v.string(),
  lowerTribunal: v.string(),
  natureOfSuit: v.string(),
  proceduralPosture: v.string(),
  issuesPresented: v.array(v.string()),
  meritsRecord: v.array(v.string()),
  training: v.optional(v.any()),
  trialDocket: v.optional(v.any()),
  sourceCaseUrl: v.optional(v.string()),
})

export const listAvailableForCurrentUser = query({
  args: {},
  returns: v.array(scenarioValidator),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    const docs = (await visibleScenarioDocsForUser(ctx, user._id)).filter(
      (scenario) => scenario.scenarioKey !== 'recap-import-placeholder',
    )
    const persistedScenarios = await Promise.all(
      docs.map(async (doc) => {
        const related = await loadRelatedScenarioData(ctx, doc._id)
        return scenarioFromDoc(doc, related.issues, related.recordExcerpts, related.assets)
      }),
    )
    const persistedKeys = new Set(persistedScenarios.map((scenario) => scenario.id))
    const bundledPublicTemplates = seedScenarios
      .filter((scenario) => !persistedKeys.has(scenario.id))
      .map((scenario) => ({
        ...scenario,
        visibility: 'public_template' as const,
        scenarioFamilyKey: scenario.id,
        revision: 1,
        revisionStatus: 'published' as const,
      }))
    const scenarios = [...persistedScenarios, ...bundledPublicTemplates]
    return scenarios.sort((a, b) => a.title.localeCompare(b.title))
  },
})

export const listPublished = query({
  args: {},
  returns: v.array(scenarioValidator),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx)
    const docs = await visibleScenarioDocsForUser(ctx, user._id)
    const persistedScenarios = await Promise.all(
      docs
        .filter((scenario) => visibilityForDoc(scenario) === 'public_template')
        .filter((scenario) => scenario.scenarioKey !== 'recap-import-placeholder')
        .map(async (doc) => {
          const related = await loadRelatedScenarioData(ctx, doc._id)
          return scenarioFromDoc(doc, related.issues, related.recordExcerpts, related.assets)
        }),
    )
    const persistedKeys = new Set(persistedScenarios.map((scenario) => scenario.id))
    const bundledPublicTemplates = seedScenarios
      .filter((scenario) => !persistedKeys.has(scenario.id))
      .map((scenario) => ({
        ...scenario,
        visibility: 'public_template' as const,
        scenarioFamilyKey: scenario.id,
        revision: 1,
        revisionStatus: 'published' as const,
      }))
    const scenarios = [...persistedScenarios, ...bundledPublicTemplates]
    return scenarios.sort((a, b) => a.title.localeCompare(b.title))
  },
})

export const createPrivateScenario = mutation({
  args: scenarioInputValidator,
  returns: scenarioValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const now = Date.now().toString(36)
    const scenarioKey = `private-${user._id}-${now}`
    const scenarioId = await ctx.db.insert(
      'scenarios',
      scenarioDocFromInput(args, {
        scenarioKey,
        visibility: 'private',
        ownerUserId: user._id,
        scenarioFamilyKey: scenarioKey,
        revision: 1,
        revisionStatus: 'draft',
        published: false,
      }),
    )
    const scenario = await ctx.db.get(scenarioId)
    if (!scenario) throw new Error('Unable to create scenario')
    return scenarioFromDoc(scenario)
  },
})

export const copyTemplateForCurrentUser = mutation({
  args: {
    scenarioId: v.string(),
  },
  returns: scenarioValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const template = await requireVisibleScenario(ctx, args.scenarioId, user._id)
    if (visibilityForDoc(template) !== 'public_template') {
      throw new Error('Only public templates can be copied.')
    }
    const scenarioKey = `private-${template.scenarioKey}-${user._id}-${Date.now().toString(36)}`
    const privateScenarioId = await ctx.db.insert('scenarios', {
      scenarioKey,
      visibility: 'private',
      ownerUserId: user._id,
      scenarioFamilyKey: template.scenarioFamilyKey ?? template.scenarioKey,
      revision: (template.revision ?? 1) + 1,
      revisionStatus: 'draft',
      createdFromScenarioId: template._id,
      title: template.title,
      source: template.source,
      courtPackId: template.courtPackId,
      shortCaption: template.shortCaption,
      lowerTribunal: template.lowerTribunal,
      natureOfSuit: template.natureOfSuit,
      proceduralPosture: template.proceduralPosture,
      issuesPresented: template.issuesPresented,
      meritsRecord: template.meritsRecord,
      ...(template.trainingJson ? { trainingJson: template.trainingJson } : {}),
      ...(template.trialDocketJson ? { trialDocketJson: template.trialDocketJson } : {}),
      ...(template.sourceCaseUrl ? { sourceCaseUrl: template.sourceCaseUrl } : {}),
      published: false,
    })
    await cloneScenarioChildren(ctx, template._id, privateScenarioId)
    const privateScenario = await ctx.db.get(privateScenarioId)
    if (!privateScenario) throw new Error('Unable to copy scenario')
    const related = await loadRelatedScenarioData(ctx, privateScenario._id)
    return scenarioFromDoc(privateScenario, related.issues, related.recordExcerpts, related.assets)
  },
})

export const updatePrivateScenario = mutation({
  args: {
    scenarioId: v.string(),
    input: scenarioInputValidator,
  },
  returns: scenarioValidator,
  handler: async (ctx, args) => {
    const { user } = await requireCurrentUser(ctx)
    const current = await requireVisibleScenario(ctx, args.scenarioId, user._id)
    if (visibilityForDoc(current) !== 'private' || current.ownerUserId !== user._id) {
      throw new Error('Scenario not found')
    }
    const sessions = await ctx.db
      .query('caseSessions')
      .withIndex('by_scenario', (index) => index.eq('scenarioId', current._id))
      .collect()
    if (!sessions.length) {
      await ctx.db.patch(
        current._id,
        scenarioDocFromInput(args.input, {
          scenarioKey: current.scenarioKey,
          visibility: 'private',
          ownerUserId: user._id,
          scenarioFamilyKey: current.scenarioFamilyKey ?? current.scenarioKey,
          revision: current.revision ?? 1,
          revisionStatus: current.revisionStatus ?? 'draft',
          ...(current.createdFromScenarioId ? { createdFromScenarioId: current.createdFromScenarioId } : {}),
          ...(current.supersededByScenarioId ? { supersededByScenarioId: current.supersededByScenarioId } : {}),
          published: false,
        }),
      )
      const updated = await ctx.db.get(current._id)
      if (!updated) throw new Error('Unable to update scenario')
      const related = await loadRelatedScenarioData(ctx, updated._id)
      return scenarioFromDoc(updated, related.issues, related.recordExcerpts, related.assets)
    }

    const scenarioKey = `${current.scenarioFamilyKey ?? current.scenarioKey}-r${(current.revision ?? 1) + 1}-${Date.now().toString(36)}`
    const nextId = await ctx.db.insert(
      'scenarios',
      scenarioDocFromInput(args.input, {
        scenarioKey,
        visibility: 'private',
        ownerUserId: user._id,
        scenarioFamilyKey: current.scenarioFamilyKey ?? current.scenarioKey,
        revision: (current.revision ?? 1) + 1,
        revisionStatus: 'draft',
        createdFromScenarioId: current._id,
        published: false,
      }),
    )
    await cloneScenarioChildren(ctx, current._id, nextId)
    await ctx.db.patch(current._id, { supersededByScenarioId: nextId, revisionStatus: 'archived' })
    const next = await ctx.db.get(nextId)
    if (!next) throw new Error('Unable to create scenario revision')
    const related = await loadRelatedScenarioData(ctx, next._id)
    return scenarioFromDoc(next, related.issues, related.recordExcerpts, related.assets)
  },
})

export const seedPublished = mutation({
  args: {},
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    await requireAdminUser(ctx)
    let inserted = 0
    let updated = 0

    for (const scenario of seedScenarios) {
      const existing = await ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenario.id))
        .unique()
      const scenarioDoc = scenarioDocFromInput(scenario, {
        scenarioKey: scenario.id,
        visibility: 'public_template',
        scenarioFamilyKey: scenario.id,
        revision: 1,
        revisionStatus: 'published',
        published: true,
      })

      if (existing) {
        await ctx.db.patch(existing._id, { ...scenarioDoc, documentAssetsJson: undefined })
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
      await ctx.db.patch(stalePlaceholder._id, { published: false, revisionStatus: 'archived' })
      updated += 1
    }

    return { inserted, updated }
  },
})

export const upsertScenarioDocumentAsset = internalMutation({
  args: {
    scenarioKey: v.string(),
    assetKey: v.string(),
    label: v.string(),
    fileName: v.string(),
    mimeType: v.literal('application/pdf'),
    source: v.union(v.literal('synthetic'), v.literal('courtlistener'), v.literal('uploaded')),
    storageId: v.id('_storage'),
    sha256: v.optional(v.string()),
    sizeBytes: v.number(),
    pageCount: v.number(),
    extractedText: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    createdAt: v.string(),
  },
  handler: async (ctx, args) => {
    const scenario = await ctx.db
      .query('scenarios')
      .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', args.scenarioKey))
      .unique()
    if (!scenario) throw new Error(`Scenario not found: ${args.scenarioKey}`)
    const existing = await ctx.db
      .query('scenarioDocumentAssets')
      .withIndex('by_scenario_asset_key', (index) =>
        index.eq('scenarioId', scenario._id).eq('assetKey', args.assetKey),
      )
      .unique()
    const doc = {
      scenarioId: scenario._id,
      assetKey: args.assetKey,
      label: args.label,
      fileName: args.fileName,
      mimeType: args.mimeType,
      source: args.source,
      storageId: args.storageId,
      ...(args.sha256 ? { sha256: args.sha256 } : {}),
      sizeBytes: args.sizeBytes,
      pageCount: args.pageCount,
      ...(args.extractedText ? { extractedText: args.extractedText } : {}),
      ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
      createdAt: args.createdAt,
    }
    if (existing) {
      await ctx.db.patch(existing._id, doc)
      return existing._id
    }
    return ctx.db.insert('scenarioDocumentAssets', doc)
  },
})

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const requireAdminForAction = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdminUser(ctx)
    return null
  },
})

const maxScenarioAssetBytes = 30 * 1024 * 1024

export function scenarioAssetFetchUrl(baseUrl: URL, scenarioId: string, fileName: string) {
  const url = new URL(baseUrl.href)
  const basePath = url.pathname.replace(/\/$/, '')
  url.pathname = `${basePath}/trial-records/${scenarioId}/${fileName}`
  url.search = ''
  url.hash = ''
  return url
}

function isAllowedScenarioAssetBaseUrl(baseUrl: URL) {
  if (!['http:', 'https:'].includes(baseUrl.protocol)) return false
  if (['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) return true

  const appUrl = process.env.OPENROUTER_APP_URL
  if (!appUrl) return false

  try {
    return new URL(appUrl).origin === baseUrl.origin
  } catch {
    return false
  }
}

export const migrateBundledScenarioPdfAssets = action({
  args: {
    baseUrl: v.string(),
  },
  returns: v.object({
    uploaded: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.scenarios.requireAdminForAction, {})
    let uploaded = 0
    let skipped = 0
    const baseUrl = new URL(args.baseUrl)
    if (!isAllowedScenarioAssetBaseUrl(baseUrl)) {
      throw new Error('Scenario asset base URL is not allowed.')
    }
    for (const scenario of seedScenarios) {
      for (const asset of scenario.documentAssets ?? []) {
        if (asset.storageId) {
          skipped += 1
          continue
        }
        const response = await fetch(scenarioAssetFetchUrl(baseUrl, scenario.id, asset.fileName))
        if (!response.ok) {
          skipped += 1
          continue
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType && !contentType.toLowerCase().includes('application/pdf')) {
          skipped += 1
          continue
        }
        const contentLength = Number(response.headers.get('content-length') ?? '0')
        if (contentLength > maxScenarioAssetBytes) {
          skipped += 1
          continue
        }
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > maxScenarioAssetBytes) {
          skipped += 1
          continue
        }
        const sha256 = await sha256Hex(buffer)
        const blob = new Blob([buffer], { type: 'application/pdf' })
        const storageId = await ctx.storage.store(blob, { sha256 })
        await ctx.runMutation(internal.scenarios.upsertScenarioDocumentAsset, {
          scenarioKey: scenario.id,
          assetKey: asset.id,
          label: asset.label,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          source: asset.source,
          storageId,
          sha256,
          sizeBytes: buffer.byteLength,
          pageCount: asset.pageCount,
          ...(asset.extractedText ? { extractedText: asset.extractedText } : {}),
          ...(asset.sourceUrl ? { sourceUrl: asset.sourceUrl } : {}),
          createdAt: new Date().toISOString(),
        })
        uploaded += 1
      }
    }
    return { uploaded, skipped }
  },
})
