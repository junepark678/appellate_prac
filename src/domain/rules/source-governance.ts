import { courtPacks } from "../packs";
import type {
  CourtPack,
  CourtSourceVersion,
  SimulationEvalThresholds,
  SourceBackedConstraint,
  SourceFreshnessStatus,
} from "../types";
import { ca4EcfCatalogEvents } from "../filing/ca4-ecf-catalog";
import {
  ca4CourtSourceVersions,
  ca4DeadlineRules,
  ca4ProcedureProfile,
  ca4SourceBackedConstraints,
} from "./ca4-source-profile";

export type SourceArtifactSnapshot = {
  sourceVersionId: string;
  contentHash: string;
  fetchedAt: string;
  reviewStatus: CourtSourceVersion["reviewStatus"];
  parsedHash?: string;
};

export type EvalFreshnessSnapshot = {
  createdAt: string;
  criticalFailureCount: number;
  validTurnRate: number;
  hallucinatedSourceRate: number;
  roleAuthorityFailureRate: number;
  pass: boolean;
};

export type ReleaseGateMode = "beta" | "production";
export type ReleaseGateTarget = "web" | "backend" | "all";

// Release evidence expires after one day; rerun the eval before releasing.
export const productionEvalMaxAgeMs = 24 * 60 * 60 * 1000;

export type ReleaseGateOptions = {
  mode: ReleaseGateMode;
  now?: string;
  target?: ReleaseGateTarget;
  maxEvalAgeMs?: number;
  courtPacks?: CourtPack[];
  sourceVersions?: CourtSourceVersion[];
  sourceArtifacts?: SourceArtifactSnapshot[];
  latestEval?: unknown;
  env?: Record<string, string | undefined>;
};

export type ReleaseGateResult = {
  pass: boolean;
  issues: string[];
  sourceStatuses: SourceFreshnessStatus[];
};

export const productionEvalThresholds: SimulationEvalThresholds = {
  maxCriticalFailures: 0,
  minValidTurnRate: 0.98,
  maxHallucinatedSourceRate: 0.01,
  maxRoleAuthorityFailureRate: 0,
};

const webRequiredEnvVars = [
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_AUTHORIZED_PARTIES",
  "VITE_CONVEX_URL",
];

export function normalizeSourceText(rawText: string) {
  return rawText.replace(/\s+/g, " ").trim();
}

function hashIsFetched(contentHash: string) {
  return /^sha256:[a-f0-9]{64}$/.test(contentHash);
}

function latestArtifactBySourceVersion(
  sourceArtifacts: SourceArtifactSnapshot[],
) {
  const latest = new Map<string, SourceArtifactSnapshot>();
  for (const artifact of sourceArtifacts) {
    const current = latest.get(artifact.sourceVersionId);
    if (!current || current.fetchedAt.localeCompare(artifact.fetchedAt) < 0) {
      latest.set(artifact.sourceVersionId, artifact);
    }
  }
  return latest;
}

export function sourceFreshnessStatuses(
  sourceVersions: CourtSourceVersion[] = ca4CourtSourceVersions,
  sourceArtifacts: SourceArtifactSnapshot[] = [],
): SourceFreshnessStatus[] {
  const latestArtifacts = latestArtifactBySourceVersion(sourceArtifacts);
  return sourceVersions.map((source) => {
    const latestArtifact = latestArtifacts.get(source.sourceVersionId);
    const bundledHash = source.contentHash;
    const fetchedHash = latestArtifact?.contentHash;
    const staleReasons: string[] = [];

    if (!hashIsFetched(bundledHash)) {
      staleReasons.push("bundled source hash is not a fetched sha256 hash");
    }
    if (source.reviewStatus === "draft" || source.reviewStatus === "rejected") {
      staleReasons.push(`source is ${source.reviewStatus}`);
    }
    if (fetchedHash && fetchedHash !== bundledHash) {
      staleReasons.push("latest fetched hash differs from bundled hash");
    }
    if (latestArtifact && latestArtifact.reviewStatus !== "published") {
      staleReasons.push(`latest artifact is ${latestArtifact.reviewStatus}`);
    }

    return {
      sourceVersionId: source.sourceVersionId,
      sourceUrl: source.sourceUrl,
      bundledHash,
      ...(fetchedHash ? { fetchedHash } : {}),
      ...((source.parsedHash ?? latestArtifact?.parsedHash)
        ? { parsedHash: source.parsedHash ?? latestArtifact?.parsedHash }
        : {}),
      effectiveDate: source.effectiveFrom,
      reviewStatus: source.reviewStatus,
      published: source.reviewStatus === "published",
      stale: staleReasons.length > 0,
      ...(staleReasons.length ? { staleReason: staleReasons.join("; ") } : {}),
      ...(latestArtifact?.fetchedAt
        ? { fetchedAt: latestArtifact.fetchedAt }
        : {}),
    };
  });
}

function sourceIdsForDeadlineRule(rule: (typeof ca4DeadlineRules)[number]) {
  return [
    ca4ProcedureProfile.sourceVersionIds.find((id) => id.startsWith("frap-")) ??
      "frap-effective-2025-12-01",
    ...(rule.ruleRefs.some((ruleRef) => ruleRef.ruleId.startsWith("CA4_"))
      ? [
          ca4ProcedureProfile.sourceVersionIds.find((id) =>
            id.startsWith("ca4-local-rules-"),
          ),
        ]
      : []),
  ].filter((sourceVersionId): sourceVersionId is string =>
    Boolean(sourceVersionId),
  );
}

function validateReferencedSources(
  sourceIds: string[],
  sourceById: Map<string, CourtSourceVersion>,
  context: string,
  mode: ReleaseGateMode,
) {
  const issues: string[] = [];
  for (const sourceId of new Set(sourceIds)) {
    const source = sourceById.get(sourceId);
    if (!source) {
      issues.push(`${context} references unknown source version ${sourceId}.`);
      continue;
    }
    const allowedStatuses =
      mode === "production" ? ["published"] : ["reviewed", "published"];
    if (!allowedStatuses.includes(source.reviewStatus)) {
      issues.push(
        `${context} references ${sourceId}, which is ${source.reviewStatus}; ${mode} requires ${allowedStatuses.join(" or ")}.`,
      );
    }
  }
  return issues;
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
  );
}

function utcTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  // Round-trip to reject ambiguous dates, missing timezones and normalized invalid dates.
  const canonical = new Date(timestamp).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z"))
    return undefined;
  return timestamp;
}

export function validateEvalFreshness(
  latestEval: unknown,
  thresholds: SimulationEvalThresholds = productionEvalThresholds,
  mode: ReleaseGateMode = "production",
  now: string = new Date().toISOString(),
  maxAgeMs: number = productionEvalMaxAgeMs,
) {
  if (mode !== "production") return [];
  if (latestEval === undefined)
    return ["Production release requires a latest simulation eval run."];
  if (
    latestEval === null ||
    typeof latestEval !== "object" ||
    Array.isArray(latestEval)
  ) {
    return ["Latest simulation eval snapshot must be an object."];
  }

  const evalRecord = latestEval as Record<string, unknown>;
  const issues: string[] = [];
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
    issues.push(
      "Maximum eval age must be a finite positive number of milliseconds.",
    );
  if (typeof evalRecord.pass !== "boolean")
    issues.push("Latest eval pass must be a boolean.");
  const criticalFailures = evalRecord.criticalFailureCount;
  if (
    typeof criticalFailures !== "number" ||
    !Number.isSafeInteger(criticalFailures) ||
    criticalFailures < 0
  ) {
    issues.push(
      "Latest eval criticalFailureCount must be a non-negative safe integer.",
    );
  }
  for (const field of [
    "validTurnRate",
    "hallucinatedSourceRate",
    "roleAuthorityFailureRate",
  ] as const) {
    const rate = evalRecord[field];
    if (
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 1
    ) {
      issues.push(
        `Latest eval ${field} must be a finite number between 0 and 1.`,
      );
    }
  }
  const createdAt = utcTimestamp(evalRecord.createdAt);
  const evaluatedAt = utcTimestamp(now);
  if (createdAt === undefined)
    issues.push("Latest eval createdAt must be a valid UTC ISO timestamp.");
  if (evaluatedAt === undefined)
    issues.push("Release check now must be a valid UTC ISO timestamp.");
  if (createdAt !== undefined && evaluatedAt !== undefined) {
    if (createdAt > evaluatedAt)
      issues.push("Latest simulation eval timestamp is in the future.");
    if (evaluatedAt - createdAt > maxAgeMs) {
      issues.push(
        `Latest simulation eval is stale; maximum age is ${maxAgeMs / 3_600_000} hours.`,
      );
    }
  }
  // Do not compare untrusted values until their complete schema has been validated.
  if (issues.length) return issues;
  const snapshot = evalRecord as EvalFreshnessSnapshot;
  if (!snapshot.pass) issues.push("Latest simulation eval run did not pass.");
  if (snapshot.criticalFailureCount > thresholds.maxCriticalFailures) {
    issues.push(
      `Latest eval has ${snapshot.criticalFailureCount} critical failures; maximum is ${thresholds.maxCriticalFailures}.`,
    );
  }
  if (snapshot.validTurnRate < thresholds.minValidTurnRate) {
    issues.push(
      `Latest eval valid-turn rate is ${snapshot.validTurnRate}; minimum is ${thresholds.minValidTurnRate}.`,
    );
  }
  if (snapshot.hallucinatedSourceRate > thresholds.maxHallucinatedSourceRate) {
    issues.push(
      `Latest eval hallucinated-source rate is ${snapshot.hallucinatedSourceRate}; maximum is ${thresholds.maxHallucinatedSourceRate}.`,
    );
  }
  if (
    snapshot.roleAuthorityFailureRate > thresholds.maxRoleAuthorityFailureRate
  ) {
    issues.push(
      `Latest eval role-authority failure rate is ${snapshot.roleAuthorityFailureRate}; maximum is ${thresholds.maxRoleAuthorityFailureRate}.`,
    );
  }
  return issues;
}

function validateProductionEnv(
  env: Record<string, string | undefined>,
  target: ReleaseGateTarget,
) {
  const required = [
    ...(target === "web" || target === "all" ? webRequiredEnvVars : []),
    ...(target === "backend" || target === "all" ? ["CONVEX_DEPLOY_KEY"] : []),
  ];
  return required
    .filter((name) => !env[name]?.trim())
    .map((name) => `Production ${target} release requires ${name}.`);
}

export function evaluateReleaseGate(
  options: ReleaseGateOptions,
): ReleaseGateResult {
  const sourceVersions = options.sourceVersions ?? ca4CourtSourceVersions;
  const sourceById = new Map(
    sourceVersions.map((source) => [source.sourceVersionId, source]),
  );
  const sourceStatuses = sourceFreshnessStatuses(
    sourceVersions,
    options.sourceArtifacts,
  );
  const activeCourtPacks = (options.courtPacks ?? courtPacks).filter(
    (pack) => pack.releaseStatus !== "retired" && pack.sourceVersionIds?.length,
  );
  const issues: string[] = [];

  for (const courtPack of activeCourtPacks) {
    if (
      options.mode === "production" &&
      courtPack.releaseStatus !== "production_approved"
    ) {
      issues.push(
        `${courtPack.id} is ${courtPack.releaseStatus ?? "draft"}; production release requires production_approved.`,
      );
    }

    issues.push(
      ...validateReferencedSources(
        courtPack.sourceVersionIds ?? [],
        sourceById,
        `Court pack ${courtPack.id}`,
        options.mode,
      ),
    );
  }

  for (const status of sourceStatuses) {
    if (status.stale) {
      issues.push(
        `Source ${status.sourceVersionId} is stale: ${status.staleReason}.`,
      );
    }
    if (options.mode === "production" && status.reviewStatus !== "published") {
      issues.push(
        `Source ${status.sourceVersionId} is ${status.reviewStatus}; production requires published.`,
      );
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
    );
  }

  for (const rule of ca4DeadlineRules) {
    issues.push(
      ...validateReferencedSources(
        sourceIdsForDeadlineRule(rule),
        sourceById,
        `Deadline rule ${rule.deadlineId}`,
        options.mode,
      ),
    );
  }

  issues.push(
    ...validateSourceBackedConstraints(
      ca4SourceBackedConstraints,
      sourceById,
      options.mode,
    ),
  );

  const thresholds =
    activeCourtPacks[0]?.evalThresholds ?? productionEvalThresholds;
  issues.push(
    ...validateEvalFreshness(
      options.latestEval,
      thresholds,
      options.mode,
      options.now ?? new Date().toISOString(),
      options.maxEvalAgeMs ?? productionEvalMaxAgeMs,
    ),
  );
  if (options.mode === "production") {
    issues.push(
      ...validateProductionEnv(
        options.env ?? process.env,
        options.target ?? "all",
      ),
    );
  }

  return {
    pass: issues.length === 0,
    issues: [...new Set(issues)],
    sourceStatuses,
  };
}

export function assertReleaseGate(options: ReleaseGateOptions) {
  const result = evaluateReleaseGate(options);
  if (!result.pass) {
    throw new Error(
      `Release gate failed:\n${result.issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
  return result;
}
