import { v } from 'convex/values'

import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requireAdmin, writeAuditLog } from './authz'
import { notFound } from './errors'

const bundleStatusValidator = v.union(
  v.literal('draft'),
  v.literal('indexed'),
  v.literal('published'),
  v.literal('retired'),
)

function parseJsonObject(value: string | undefined) {
  if (!value) return {}
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

function artifactKind(artifact: {
  label: string
  url: string
  mediaType?: string
  sourceVersionId: string
}) {
  const text = `${artifact.label} ${artifact.url} ${artifact.sourceVersionId}`.toLowerCase()
  if (text.includes('form')) return 'form'
  if (text.includes('statute') || text.includes('u.s.c') || text.includes('uscode')) {
    return 'statute'
  }
  if (text.includes('rule') || text.includes('frap') || text.includes('local')) return 'rule'
  return 'source'
}

export const grantSupportAccess = mutation({
  args: {
    institutionId: v.id('institutions'),
    supportUserId: v.id('users'),
    reason: v.string(),
    expiresAt: v.string(),
  },
  returns: v.id('supportAccessGrants'),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const grantId = await ctx.db.insert('supportAccessGrants', {
      institutionId: args.institutionId,
      supportUserId: args.supportUserId,
      grantedByUserId: user._id,
      reason: args.reason,
      expiresAt: args.expiresAt,
      createdAt: new Date().toISOString(),
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: args.institutionId,
      action: 'support_access.granted',
      targetTable: 'supportAccessGrants',
      targetId: grantId,
      metadata: { supportUserId: args.supportUserId, expiresAt: args.expiresAt },
    })
    return grantId
  },
})

export const revokeSupportAccess = mutation({
  args: {
    grantId: v.id('supportAccessGrants'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const grant = await ctx.db.get(args.grantId)
    if (!grant) throw notFound('Support access grant', args.grantId)
    await ctx.db.patch(args.grantId, { revokedAt: new Date().toISOString() })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: grant.institutionId,
      action: 'support_access.revoked',
      targetTable: 'supportAccessGrants',
      targetId: args.grantId,
    })
    return null
  },
})

export const dashboard = query({
  args: {},
  returns: v.object({
    institutions: v.number(),
    users: v.number(),
    activeSupportGrants: v.number(),
    courtPacksPendingProduction: v.number(),
    recentAuditEvents: v.array(
      v.object({
        action: v.string(),
        createdAt: v.string(),
        actorUserId: v.optional(v.id('users')),
        institutionId: v.optional(v.id('institutions')),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const [institutions, users, grants, courtPacks, auditEvents] = await Promise.all([
      ctx.db.query('institutions').collect(),
      ctx.db.query('users').collect(),
      ctx.db.query('supportAccessGrants').collect(),
      ctx.db.query('courtPacks').collect(),
      ctx.db.query('auditLog').collect(),
    ])
    const now = new Date().toISOString()
    return {
      institutions: institutions.length,
      users: users.length,
      activeSupportGrants: grants.filter(
        (grant) => !grant.revokedAt && grant.expiresAt > now,
      ).length,
      courtPacksPendingProduction: courtPacks.filter(
        (pack) => pack.releaseStatus !== 'production_approved',
      ).length,
      recentAuditEvents: auditEvents
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20)
        .map((event) => ({
          action: event.action,
          createdAt: event.createdAt,
          ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
          ...(event.institutionId ? { institutionId: event.institutionId } : {}),
        })),
    }
  },
})

export const packManagement = query({
  args: {},
  returns: v.object({
    courtPacks: v.array(
      v.object({
        id: v.id('courtPacks'),
        packId: v.string(),
        moduleId: v.optional(v.string()),
        label: v.string(),
        courtSystem: v.string(),
        courtLevel: v.string(),
        procedureDomain: v.string(),
        baseCourtPackIds: v.array(v.string()),
        sharedRulePackIds: v.array(v.string()),
        localRulePackIds: v.array(v.string()),
        procedureModuleIds: v.array(v.string()),
        componentModuleIds: v.array(v.string()),
        filingEventCount: v.number(),
        aiActorCount: v.number(),
        sourceVersionIds: v.array(v.string()),
        releaseStatus: v.optional(
          v.union(
            v.literal('draft'),
            v.literal('source_review_pending'),
            v.literal('eval_pending'),
            v.literal('beta_approved'),
            v.literal('production_approved'),
            v.literal('retired'),
          ),
        ),
        published: v.boolean(),
        latestBundle: v.optional(
          v.object({
            id: v.id('packBundles'),
            bundleVersion: v.string(),
            label: v.string(),
            status: bundleStatusValidator,
            zipFileName: v.optional(v.string()),
            zipSizeBytes: v.optional(v.number()),
            zipContentHash: v.optional(v.string()),
            zipUrl: v.optional(v.string()),
            manifestJson: v.string(),
            updatedAt: v.string(),
          }),
        ),
      }),
    ),
    rulePacks: v.array(
      v.object({
        packId: v.string(),
        moduleId: v.optional(v.string()),
        label: v.string(),
        courtSystem: v.string(),
        courtLevel: v.optional(v.string()),
        procedureDomain: v.optional(v.string()),
        version: v.string(),
        sourceUrl: v.string(),
        sourceVersionIds: v.array(v.string()),
        itemCount: v.number(),
        published: v.boolean(),
      }),
    ),
    moduleManifests: v.array(
      v.object({
        moduleId: v.string(),
        type: v.string(),
        label: v.string(),
        version: v.string(),
        dependenciesJson: v.optional(v.string()),
        enabled: v.boolean(),
        published: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const [courtPacks, rulePacks, ruleItems, moduleManifests, packBundles] =
      await Promise.all([
        ctx.db.query('courtPacks').collect(),
        ctx.db.query('rulePacks').collect(),
        ctx.db.query('ruleItems').collect(),
        ctx.db.query('moduleManifests').collect(),
        ctx.db.query('packBundles').collect(),
      ])

    const ruleItemCounts = new Map<string, number>()
    for (const item of ruleItems) {
      ruleItemCounts.set(item.packId, (ruleItemCounts.get(item.packId) ?? 0) + 1)
    }
    const rulePackModuleById = new Map(
      rulePacks.map((pack) => [pack.packId, pack.moduleId ?? pack.packId]),
    )
    const courtPackModuleById = new Map(
      courtPacks.map((pack) => [pack.packId, pack.moduleId ?? pack.packId]),
    )
    const bundlesByCourtPack = new Map<string, typeof packBundles>()
    for (const bundle of packBundles) {
      const existing = bundlesByCourtPack.get(bundle.courtPackId) ?? []
      existing.push(bundle)
      bundlesByCourtPack.set(bundle.courtPackId, existing)
    }

    return {
      courtPacks: await Promise.all(
        courtPacks
          .slice()
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(async (pack) => {
            const latestBundle = (bundlesByCourtPack.get(pack.packId) ?? [])
              .slice()
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
            const componentModuleIds = [
              ...(pack.moduleId ? [pack.moduleId] : []),
              ...pack.baseCourtPackIds.map((packId) => courtPackModuleById.get(packId) ?? packId),
              ...pack.includedRulePackIds.map((packId) => rulePackModuleById.get(packId) ?? packId),
              ...pack.rulePackIds.map((packId) => rulePackModuleById.get(packId) ?? packId),
              ...(pack.procedureModuleIds ?? []),
            ].filter((value, index, values) => values.indexOf(value) === index)
            const filingEvents = Object.keys(parseJsonObject(pack.filingEventsJson)).length
              ? JSON.parse(pack.filingEventsJson ?? '[]')
              : []
            const aiActors = Object.keys(parseJsonObject(pack.aiActorsJson)).length
              ? JSON.parse(pack.aiActorsJson ?? '[]')
              : []
            return {
              id: pack._id,
              packId: pack.packId,
              ...(pack.moduleId ? { moduleId: pack.moduleId } : {}),
              label: pack.label,
              courtSystem: pack.courtSystem,
              courtLevel: pack.courtLevel,
              procedureDomain: pack.procedureDomain,
              baseCourtPackIds: pack.baseCourtPackIds,
              sharedRulePackIds: pack.includedRulePackIds,
              localRulePackIds: pack.rulePackIds,
              procedureModuleIds: pack.procedureModuleIds ?? [],
              componentModuleIds,
              filingEventCount: Array.isArray(filingEvents) ? filingEvents.length : 0,
              aiActorCount: Array.isArray(aiActors) ? aiActors.length : 0,
              sourceVersionIds: pack.sourceVersionIds ?? [],
              ...(pack.releaseStatus ? { releaseStatus: pack.releaseStatus } : {}),
              published: pack.published,
              ...(latestBundle
                ? {
                    latestBundle: {
                      id: latestBundle._id,
                      bundleVersion: latestBundle.bundleVersion,
                      label: latestBundle.label,
                      status: latestBundle.status,
                      ...(latestBundle.zipFileName
                        ? { zipFileName: latestBundle.zipFileName }
                        : {}),
                      ...(latestBundle.zipSizeBytes
                        ? { zipSizeBytes: latestBundle.zipSizeBytes }
                        : {}),
                      ...(latestBundle.zipContentHash
                        ? { zipContentHash: latestBundle.zipContentHash }
                        : {}),
                      ...(latestBundle.zipStorageId
                        ? {
                            zipUrl:
                              (await ctx.storage.getUrl(latestBundle.zipStorageId)) ??
                              undefined,
                          }
                        : {}),
                      manifestJson: latestBundle.manifestJson,
                      updatedAt: latestBundle.updatedAt,
                    },
                  }
                : {}),
            }
          }),
      ),
      rulePacks: rulePacks
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((pack) => ({
          packId: pack.packId,
          ...(pack.moduleId ? { moduleId: pack.moduleId } : {}),
          label: pack.label,
          courtSystem: pack.courtSystem,
          ...(pack.courtLevel ? { courtLevel: pack.courtLevel } : {}),
          ...(pack.procedureDomain ? { procedureDomain: pack.procedureDomain } : {}),
          version: pack.version,
          sourceUrl: pack.sourceUrl,
          sourceVersionIds: pack.sourceVersionIds ?? [],
          itemCount: ruleItemCounts.get(pack.packId) ?? 0,
          published: pack.published,
        })),
      moduleManifests: moduleManifests
        .slice()
        .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
        .map((manifest) => ({
          moduleId: manifest.moduleId,
          type: manifest.type,
          label: manifest.label,
          version: manifest.version,
          ...(manifest.dependenciesJson ? { dependenciesJson: manifest.dependenciesJson } : {}),
          enabled: manifest.enabled,
          published: manifest.published,
        })),
    }
  },
})

export const createPackBundleManifest = mutation({
  args: {
    courtPackId: v.string(),
    bundleVersion: v.string(),
    label: v.optional(v.string()),
  },
  returns: v.id('packBundles'),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const courtPack = await ctx.db
      .query('courtPacks')
      .withIndex('by_pack_id', (index) => index.eq('packId', args.courtPackId))
      .unique()
    if (!courtPack) throw notFound('Court pack', args.courtPackId)

    const [rulePacks, ruleItems, sourceVersions, artifacts, moduleManifests] =
      await Promise.all([
        ctx.db.query('rulePacks').collect(),
        ctx.db.query('ruleItems').collect(),
        ctx.db.query('legalSourceVersions').collect(),
        ctx.db.query('sourceArtifacts').collect(),
        ctx.db.query('moduleManifests').collect(),
      ])
    const neededRulePackIds = [
      ...courtPack.includedRulePackIds,
      ...courtPack.rulePackIds,
    ].filter((value, index, values) => values.indexOf(value) === index)
    const includedRulePacks = rulePacks.filter((pack) =>
      neededRulePackIds.includes(pack.packId),
    )
    const sourceVersionIds = [
      ...(courtPack.sourceVersionIds ?? []),
      ...includedRulePacks.flatMap((pack) => pack.sourceVersionIds ?? []),
    ].filter((value, index, values) => values.indexOf(value) === index)
    const latestArtifactBySourceUrl = new Map<string, (typeof artifacts)[number]>()
    for (const artifact of artifacts) {
      if (!sourceVersionIds.includes(artifact.sourceVersionId)) continue
      const key = `${artifact.sourceVersionId}\n${artifact.url}`
      const existing = latestArtifactBySourceUrl.get(key)
      if (!existing || artifact.fetchedAt > existing.fetchedAt) {
        latestArtifactBySourceUrl.set(key, artifact)
      }
    }
    const selectedArtifacts = [...latestArtifactBySourceUrl.values()].sort((a, b) =>
      `${a.sourceVersionId} ${a.label} ${a.url}`.localeCompare(
        `${b.sourceVersionId} ${b.label} ${b.url}`,
      ),
    )
    const moduleIds = [
      ...(courtPack.moduleId ? [courtPack.moduleId] : []),
      ...includedRulePacks.map((pack) => pack.moduleId ?? pack.packId),
      ...(courtPack.procedureModuleIds ?? []),
    ].filter((value, index, values) => values.indexOf(value) === index)
    const sourceVersionById = new Map(
      sourceVersions.map((source) => [source.sourceVersionId, source]),
    )
    const moduleById = new Map(moduleManifests.map((module) => [module.moduleId, module]))
    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      courtPack: {
        id: courtPack.packId,
        label: courtPack.label,
        courtSystem: courtPack.courtSystem,
        courtLevel: courtPack.courtLevel,
        procedureDomain: courtPack.procedureDomain,
        releaseStatus: courtPack.releaseStatus ?? 'draft',
      },
      composition: {
        baseCourtPackIds: courtPack.baseCourtPackIds,
        sharedRulePackIds: courtPack.includedRulePackIds,
        localRulePackIds: courtPack.rulePackIds,
        procedureModuleIds: courtPack.procedureModuleIds ?? [],
        componentModuleIds: moduleIds,
      },
      modules: moduleIds.map((moduleId) => {
        const module = moduleById.get(moduleId)
        return {
          moduleId,
          type: module?.type ?? 'unknown',
          label: module?.label ?? moduleId,
          version: module?.version ?? 'unknown',
        }
      }),
      rulePacks: includedRulePacks.map((pack) => ({
        packId: pack.packId,
        moduleId: pack.moduleId ?? pack.packId,
        label: pack.label,
        version: pack.version,
        sourceVersionIds: pack.sourceVersionIds ?? [],
        itemCount: ruleItems.filter((item) => item.packId === pack.packId).length,
        compositionRole: courtPack.rulePackIds.includes(pack.packId)
          ? 'local-overlay'
          : 'shared-dependency',
      })),
      ruleIndex: ruleItems
        .filter((item) => neededRulePackIds.includes(item.packId))
        .map((item) => ({
          packId: item.packId,
          ruleId: item.ruleId,
          topic: item.topic,
          sourceLabel: item.sourceLabel,
          sourceUrl: item.sourceUrl,
        })),
      sources: sourceVersionIds.map((sourceVersionId) => {
        const source = sourceVersionById.get(sourceVersionId)
        return {
          sourceVersionId,
          moduleId: source?.moduleId,
          label: source?.label ?? sourceVersionId,
          jurisdiction: source?.jurisdiction,
          version: source?.version,
          effectiveFrom: source?.effectiveFrom,
          sourceUrl: source?.sourceUrl,
          reviewed: source?.reviewed ?? false,
        }
      }),
      artifacts: selectedArtifacts.map((artifact) => ({
        id: artifact._id,
        kind: artifactKind(artifact),
        sourceVersionId: artifact.sourceVersionId,
        label: artifact.label,
        url: artifact.url,
        fetchedAt: artifact.fetchedAt,
        contentHash: artifact.contentHash,
        parserVersion: artifact.parserVersion,
        mediaType: artifact.mediaType,
        hasStorage: Boolean(artifact.rawStorageId),
        reviewStatus: artifact.reviewStatus,
      })),
      inventory: {
        rules: ruleItems.filter((item) => neededRulePackIds.includes(item.packId)).length,
        forms: selectedArtifacts.filter((artifact) => artifactKind(artifact) === 'form').length,
        statutes: selectedArtifacts.filter((artifact) => artifactKind(artifact) === 'statute')
          .length,
        sourceArtifacts: selectedArtifacts.length,
        filingEvents: Array.isArray(JSON.parse(courtPack.filingEventsJson ?? '[]'))
          ? JSON.parse(courtPack.filingEventsJson ?? '[]').length
          : 0,
        aiActors: Array.isArray(JSON.parse(courtPack.aiActorsJson ?? '[]'))
          ? JSON.parse(courtPack.aiActorsJson ?? '[]').length
          : 0,
      },
    }
    const now = new Date().toISOString()
    const existing = await ctx.db
      .query('packBundles')
      .withIndex('by_court_pack_version', (index) =>
        index.eq('courtPackId', args.courtPackId).eq('bundleVersion', args.bundleVersion),
      )
      .unique()
    const doc = {
      courtPackId: args.courtPackId,
      bundleVersion: args.bundleVersion,
      label: args.label?.trim() || `${courtPack.label} ${args.bundleVersion}`,
      manifestJson: JSON.stringify(manifest),
      sourceVersionIds,
      componentModuleIds: moduleIds,
      artifactIds: selectedArtifacts.map((artifact) => artifact._id),
      status: 'indexed' as const,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    }
    let bundleId
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...doc,
        createdByUserId: existing.createdByUserId,
        createdAt: existing.createdAt,
      })
      bundleId = existing._id
    } else {
      bundleId = await ctx.db.insert('packBundles', doc)
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      action: 'pack_bundle.manifest_indexed',
      targetTable: 'packBundles',
      targetId: bundleId,
      metadata: { courtPackId: args.courtPackId, bundleVersion: args.bundleVersion },
    })
    return bundleId
  },
})

export const generatePackBundleUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return ctx.storage.generateUploadUrl()
  },
})

export const attachPackBundleZip = mutation({
  args: {
    bundleId: v.id('packBundles'),
    storageId: v.id('_storage'),
    zipFileName: v.string(),
    zipSizeBytes: v.number(),
    zipContentHash: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const bundle = await ctx.db.get(args.bundleId)
    if (!bundle) throw notFound('Pack bundle', args.bundleId)
    await ctx.db.patch(args.bundleId, {
      zipStorageId: args.storageId,
      zipFileName: args.zipFileName,
      zipSizeBytes: args.zipSizeBytes,
      ...(args.zipContentHash ? { zipContentHash: args.zipContentHash } : {}),
      status: 'published',
      updatedAt: new Date().toISOString(),
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      action: 'pack_bundle.zip_attached',
      targetTable: 'packBundles',
      targetId: args.bundleId,
      metadata: {
        courtPackId: bundle.courtPackId,
        bundleVersion: bundle.bundleVersion,
        zipFileName: args.zipFileName,
      },
    })
    return null
  },
})

export const attachGeneratedPackBundleZip = internalMutation({
  args: {
    bundleId: v.id('packBundles'),
    storageId: v.id('_storage'),
    zipFileName: v.string(),
    zipSizeBytes: v.number(),
    zipContentHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const bundle = await ctx.db.get(args.bundleId)
    if (!bundle) throw notFound('Pack bundle', args.bundleId)
    await ctx.db.patch(args.bundleId, {
      zipStorageId: args.storageId,
      zipFileName: args.zipFileName,
      zipSizeBytes: args.zipSizeBytes,
      zipContentHash: args.zipContentHash,
      status: 'published',
      updatedAt: new Date().toISOString(),
    })
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      action: 'pack_bundle.zip_generated',
      targetTable: 'packBundles',
      targetId: args.bundleId,
      metadata: {
        courtPackId: bundle.courtPackId,
        bundleVersion: bundle.bundleVersion,
        zipFileName: args.zipFileName,
      },
    })
    return null
  },
})

export const bundleZipPayload = internalQuery({
  args: {
    bundleId: v.id('packBundles'),
  },
  returns: v.object({
    bundleId: v.id('packBundles'),
    courtPackId: v.string(),
    bundleVersion: v.string(),
    label: v.string(),
    manifestJson: v.string(),
    rules: v.array(
      v.object({
        packId: v.string(),
        ruleId: v.string(),
        topic: v.string(),
        sourceLabel: v.string(),
        sourceUrl: v.string(),
        plainText: v.string(),
        simulatorNotes: v.string(),
        constraintsJson: v.string(),
      }),
    ),
    artifacts: v.array(
      v.object({
        id: v.id('sourceArtifacts'),
        kind: v.string(),
        sourceVersionId: v.string(),
        label: v.string(),
        url: v.string(),
        contentHash: v.string(),
        mediaType: v.optional(v.string()),
        rawStorageId: v.optional(v.id('_storage')),
        rawText: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const bundle = await ctx.db.get(args.bundleId)
    if (!bundle) throw notFound('Pack bundle', args.bundleId)
    const manifest = JSON.parse(bundle.manifestJson) as {
      rulePacks?: Array<{ packId?: string }>
    }
    const rulePackIds = new Set(
      (manifest.rulePacks ?? [])
        .map((pack) => pack.packId)
        .filter((packId): packId is string => Boolean(packId)),
    )
    const [ruleItems, artifacts] = await Promise.all([
      ctx.db.query('ruleItems').collect(),
      Promise.all(bundle.artifactIds.map((artifactId) => ctx.db.get(artifactId))),
    ])
    return {
      bundleId: bundle._id,
      courtPackId: bundle.courtPackId,
      bundleVersion: bundle.bundleVersion,
      label: bundle.label,
      manifestJson: bundle.manifestJson,
      rules: ruleItems
        .filter((item) => rulePackIds.has(item.packId))
        .map((item) => ({
          packId: item.packId,
          ruleId: item.ruleId,
          topic: item.topic,
          sourceLabel: item.sourceLabel,
          sourceUrl: item.sourceUrl,
          plainText: item.plainText,
          simulatorNotes: item.simulatorNotes,
          constraintsJson: item.constraintsJson,
        })),
      artifacts: artifacts
        .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
        .map((artifact) => ({
          id: artifact._id,
          kind: artifactKind(artifact),
          sourceVersionId: artifact.sourceVersionId,
          label: artifact.label,
          url: artifact.url,
          contentHash: artifact.contentHash,
          ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
          ...(artifact.rawStorageId ? { rawStorageId: artifact.rawStorageId } : {}),
          ...(artifact.rawText ? { rawText: artifact.rawText } : {}),
        })),
    }
  },
})
