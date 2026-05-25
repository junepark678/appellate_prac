import { courtPacks } from '../packs'
import type {
  CourtPack,
  CourtSourceVersion,
  SimulationEvalThresholds,
  SourceBackedConstraint,
  SourceFreshnessStatus,
} from '../types'
import { ca4EcfCatalogEvents } from '../filing/ca4-ecf-catalog'
import {
  ca4CourtSourceVersions,
  ca4DeadlineRules,
  ca4ProcedureProfile,
  ca4SourceBackedConstraints,
} from './ca4-source-profile'

export type SourceArtifactSnapshot = {
  sourceVersionId: string
  contentHash: string
  fetchedAt: string
  reviewStatus: CourtSourceVersion['reviewStatus']
  parsedHash?: string
}

export type EvalFreshnessSnapshot = {
  createdAt: string
  criticalFailureCount: number
  validTurnRate: number
  hallucinatedSourceRate: number
  roleAuthorityFailureRate: number
  pass: boolean
}

export type ReleaseGateMode = 'beta' | 'production'

export type ReleaseGateOptions = {
  mode: ReleaseGateMode
  now?: string
  courtPacks?: CourtPack[]
  sourceVersions?: CourtSourceVersion[]
  sourceArtifacts?: SourceArtifactSnapshot[]
  latestEval?: EvalFreshnessSnapshot
  env?: Record<string, string | undefined>
}

export type ReleaseGateResult = {
  pass: boolean
  issues: string[]
  sourceStatuses: SourceFreshnessStatus[]
}

export const productionEvalThresholds: SimulationEvalThresholds = {
  maxCriticalFailures: 0,
  minValidTurnRate: 0.98,
  maxHallucinatedSourceRate: 0.01,
  maxRoleAuthorityFailureRate: 0,
}

const productionRequiredEnvVars = [
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_AUTHORIZED_PARTIES',
  'VITE_CONVEX_URL',
  'CONVEX_DEPLOY_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
]

export function normalizeSourceText(rawText: string) {
  return rawText.replace(/\s+/g, ' ').trim()
}

function hashIsFetched(contentHash: string) {
  return /^sha256:[a-f0-9]{64}$/.test(contentHash)
}

function latestArtifactBySourceVersion(sourceArtifacts: SourceArtifactSnapshot[]) {
  const latest = new Map<string, SourceArtifactSnapshot>()
  for (const artifact of sourceArtifacts) {
    const current = latest.get(artifact.sourceVersionId)
    if (!current || current.fetchedAt.localeCompare(artifact.fetchedAt) < 0) {
      latest.set(artifact.sourceVersionId, artifact)
    }
  }
  return latest
}

export function sourceFreshnessStatuses(
  sourceVersions: CourtSourceVersion[] = ca4CourtSourceVersions,
  sourceArtifacts: SourceArtifactSnapshot[] = [],
): SourceFreshnessStatus[] {
  const latestArtifacts = latestArtifactBySourceVersion(sourceArtifacts)
  return sourceVersions.map((source) => {
    const latestArtifact = latestArtifacts.get(source.sourceVersionId)
    const bundledHash = source.contentHash
    const fetchedHash = latestArtifact?.contentHash
    const staleReasons: string[] = []

    if (!hashIsFetched(bundledHash)) {
      staleReasons.push('bundled source hash is not a fetched sha256 hash')
    }
    if (source.reviewStatus === 'draft' || source.reviewStatus === 'rejected') {
      staleReasons.push(`source is ${source.reviewStatus}`)
    }
    if (fetchedHash && fetchedHash !== bundledHash) {
      staleReasons.push('latest fetched hash differs from bundled hash')
    }
    if (latestArtifact && latestArtifact.reviewStatus !== 'published') {
      staleReasons.push(`latest artifact is ${latestArtifact.reviewStatus}`)
    }

    return {
      sourceVersionId: source.sourceVersionId,
      sourceUrl: source.sourceUrl,
      bundledHash,
      ...(fetchedHash ? { fetchedHash } : {}),
      ...(source.parsedHash ?? latestArtifact?.parsedHash
        ? { parsedHash: source.parsedHash ?? latestArtifact?.parsedHash }
        : {}),
      effectiveDate: source.effectiveFrom,
      reviewStatus: source.reviewStatus,
      published: source.reviewStatus === 'published',
      stale: staleReasons.length > 0,
      ...(staleReasons.length ? { staleReason: staleReasons.join('; ') } : {}),
      ...(latestArtifact?.fetchedAt ? { fetchedAt: latestArtifact.fetchedAt } : {}),
    }
  })
}

function sourceIdsForDeadlineRule(rule: (typeof ca4DeadlineRules)[number]) {
  return [
    ca4ProcedureProfile.sourceVersionIds.find((id) => id.startsWith('frap-')) ??
      'frap-effective-2025-12-01',
    ...(rule.ruleRefs.some((ruleRef) => ruleRef.ruleId.startsWith('CA4_'))
      ? [ca4ProcedureProfile.sourceVersionIds.find((id) => id.startsWith('ca4-local-rules-'))]
      : []),
  ].filter((sourceVersionId): sourceVersionId is string => Boolean(sourceVersionId))
}

function validateReferencedSources(
  sourceIds: string[],
  sourceById: Map<string, CourtSourceVersion>,
  context: string,
  mode: ReleaseGateMode,
) {
  const issues: string[] = []
  for (const sourceId of new Set(sourceIds)) {
    const source = sourceById.get(sourceId)
    if (!source) {
      issues.push(`${context} references unknown source version ${sourceId}.`)
      continue
    }
    const allowedStatuses =
      mode === 'production' ? ['published'] : ['reviewed', 'published']
    if (!allowedStatuses.includes(source.reviewStatus)) {
      issues.push(
        `${context} references ${sourceId}, which is ${source.reviewStatus}; ${mode} requires ${allowedStatuses.join(' or ')}.`,
      )
    }
  }
  return issues
}

function validateSourceBackedConstraints(
  constraints: SourceBackedConstraint[],
  sourceById: Map<string, CourtSourceVersion>,
  mode: ReleaseGateMode,
) {
  return constraints.flatMap((constraint) =>
    validateReferencedSources(
      constraint.sourceVersionIds,
      sourceById,
      `Constraint ${constraint.constraintId}`,
      mode,
    ),
  )
}

function validateEvalFreshness(
  latestEval: EvalFreshnessSnapshot | undefined,
  thresholds: SimulationEvalThresholds,
  mode: ReleaseGateMode,
) {
  if (mode !== 'production') return []
  if (!latestEval) return ['Production release requires a latest simulation eval run.']

  const issues: string[] = []
  if (!latestEval.pass) issues.push('Latest simulation eval run did not pass.')
  if (latestEval.criticalFailureCount > thresholds.maxCriticalFailures) {
    issues.push(
      `Latest eval has ${latestEval.criticalFailureCount} critical failures; maximum is ${thresholds.maxCriticalFailures}.`,
    )
  }
  if (latestEval.validTurnRate < thresholds.minValidTurnRate) {
    issues.push(
      `Latest eval valid-turn rate is ${latestEval.validTurnRate}; minimum is ${thresholds.minValidTurnRate}.`,
    )
  }
  if (latestEval.hallucinatedSourceRate > thresholds.maxHallucinatedSourceRate) {
    issues.push(
      `Latest eval hallucinated-source rate is ${latestEval.hallucinatedSourceRate}; maximum is ${thresholds.maxHallucinatedSourceRate}.`,
    )
  }
  if (latestEval.roleAuthorityFailureRate > thresholds.maxRoleAuthorityFailureRate) {
    issues.push(
      `Latest eval role-authority failure rate is ${latestEval.roleAuthorityFailureRate}; maximum is ${thresholds.maxRoleAuthorityFailureRate}.`,
    )
  }
  return issues
}

function validateProductionEnv(env: Record<string, string | undefined>) {
  return productionRequiredEnvVars
    .filter((name) => !env[name])
    .map((name) => `Production release requires ${name}.`)
}

export function evaluateReleaseGate(options: ReleaseGateOptions): ReleaseGateResult {
  const sourceVersions = options.sourceVersions ?? ca4CourtSourceVersions
  const sourceById = new Map(sourceVersions.map((source) => [source.sourceVersionId, source]))
  const sourceStatuses = sourceFreshnessStatuses(sourceVersions, options.sourceArtifacts)
  const activeCourtPacks = (options.courtPacks ?? courtPacks).filter(
    (pack) => pack.releaseStatus !== 'retired' && pack.sourceVersionIds?.length,
  )
  const issues: string[] = []

  for (const courtPack of activeCourtPacks) {
    if (options.mode === 'production' && courtPack.releaseStatus !== 'production_approved') {
      issues.push(
        `${courtPack.id} is ${courtPack.releaseStatus ?? 'draft'}; production release requires production_approved.`,
      )
    }

    issues.push(
      ...validateReferencedSources(
        courtPack.sourceVersionIds ?? [],
        sourceById,
        `Court pack ${courtPack.id}`,
        options.mode,
      ),
    )
  }

  for (const status of sourceStatuses) {
    if (status.stale) {
      issues.push(`Source ${status.sourceVersionId} is stale: ${status.staleReason}.`)
    }
    if (options.mode === 'production' && status.reviewStatus !== 'published') {
      issues.push(`Source ${status.sourceVersionId} is ${status.reviewStatus}; production requires published.`)
    }
  }

  for (const event of ca4EcfCatalogEvents) {
    issues.push(
      ...validateReferencedSources(
        event.sourceVersionIds,
        sourceById,
        `ECF event ${event.eventId}`,
        options.mode,
      ),
    )
  }

  for (const rule of ca4DeadlineRules) {
    issues.push(
      ...validateReferencedSources(
        sourceIdsForDeadlineRule(rule),
        sourceById,
        `Deadline rule ${rule.deadlineId}`,
        options.mode,
      ),
    )
  }

  issues.push(
    ...validateSourceBackedConstraints(
      ca4SourceBackedConstraints,
      sourceById,
      options.mode,
    ),
  )

  const thresholds = activeCourtPacks[0]?.evalThresholds ?? productionEvalThresholds
  issues.push(...validateEvalFreshness(options.latestEval, thresholds, options.mode))
  if (options.mode === 'production') {
    issues.push(...validateProductionEnv(options.env ?? process.env))
  }

  return {
    pass: issues.length === 0,
    issues: [...new Set(issues)],
    sourceStatuses,
  }
}

export function assertReleaseGate(options: ReleaseGateOptions) {
  const result = evaluateReleaseGate(options)
  if (!result.pass) {
    throw new Error(`Release gate failed:\n${result.issues.map((issue) => `- ${issue}`).join('\n')}`)
  }
  return result
}
