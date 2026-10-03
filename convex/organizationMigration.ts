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

import { v } from "convex/values";

import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { isOrganizationMembershipActive } from "./organizationContracts";
import { validationError } from "./errors";

export const ORGANIZATION_MIGRATION_KEY = "org-boundary-v1";
export const LEGACY_STORAGE_CONFIDENTIALITY = "UNVERIFIED" as const;

/** The order is part of the operator contract. Tables within a step are serial. */
export const ORGANIZATION_MIGRATION_STEPS = [
  { step: 1, tables: ["institutions", "users"] },
  { step: 2, tables: ["caseSessions"] },
  { step: 3, tables: ["scenarios"] },
  { step: 4, tables: ["sourceCases"] },
  { step: 5, tables: ["integrationEvents", "auditLog"] },
  {
    step: 6,
    tables: [
      "participants",
      "documents",
      "caseSessionEvents",
      "ecfReceipts",
      "documentAnalyses",
      "actorWorkProducts",
      "filings",
      "docketEntries",
      "deadlines",
      "aiRuns",
      "actorRunAudits",
      "simulationTurns",
      "actorPackets",
      "actorDecisions",
      "trialDocketImports",
      "counterpartyStrategies",
      "amicusCandidates",
      "amicusParticipations",
      "panelDeliberations",
      "panelDispositions",
      "panelVotes",
      "meritsEvaluations",
      "assessments",
      "scenarioDocumentAssets",
      "scenarioIssues",
      "scenarioRecordExcerpts",
      "assignmentSessions",
      "simulationPolicies",
    ],
  },
] as const;

/** Shared platform catalogs are deliberately outside tenant ownership migration. */
export const EXCLUDED_SHARED_TABLES = [
  "rulePacks",
  "legalSourceVersions",
  "legalSourceSnapshots",
  "ruleReviewNotes",
  "ruleConstraints",
  "ecfCatalogEvents",
  "deadlineRules",
  "sourceBackedConstraints",
  "moduleManifests",
  "ruleItems",
  "courtPacks",
  "packBundles",
  "procedureTransitions",
  "scenarioDrafts",
  "sourceDocuments",
  "sourceArtifacts",
  "sourceReviewDecisions",
  "simulationEvalRuns",
  "policyVersions",
] as const;

export const PRESERVED_IDENTITY_TABLES = [
  "policyAcceptances",
  "userDisclaimers",
] as const;

export const PRESERVED_ORGANIZATION_TABLES = [
  "enrollmentInvites",
  "supportAccessGrants",
] as const;

type MigrationTable =
  (typeof ORGANIZATION_MIGRATION_STEPS)[number]["tables"][number];

const INSPECTABLE_TABLES = ORGANIZATION_MIGRATION_STEPS.flatMap(
  ({ tables }) => tables,
) as MigrationTable[];
const MAX_CLASSIFICATION_RELATION_ROWS = 100;
const CLASSIFICATION_RELATION_PROBE_LIMIT =
  MAX_CLASSIFICATION_RELATION_ROWS + 1;
const MAX_INSPECTION_WORK_UNITS = 900;
type ClassificationState = "ready" | "ambiguous";
type MigrationWritePlan =
  | { field: "kind"; value: "shared" }
  | {
      field: "institutionId";
      value: Id<"institutions">;
    }
  | {
      field: "institutionId";
      ensurePersonalFor: Id<"users">;
    }
  | {
      field: "caseSessionId";
      value: Id<"caseSessions">;
    };

type OwnershipDecision = OwnershipClassification & {
  targetInstitutionId?: Id<"institutions">;
  ensurePersonalFor?: Id<"users">;
};

export type OwnershipClassification = {
  state: ClassificationState;
  reason: string;
};

export function classifyLegacyUser(): OwnershipClassification {
  return {
    state: "ready",
    reason: "identity_profile_budget_and_legacy_role_preserved",
  };
}

export function classifyInstitutionKind(input: {
  kind?: "personal" | "shared";
  personalOwnerUserId?: string;
}): OwnershipClassification {
  if (input.kind === undefined && input.personalOwnerUserId !== undefined) {
    return {
      state: "ambiguous",
      reason: "missing_kind_conflicts_with_personal_owner",
    };
  }
  if (input.kind === "personal" && input.personalOwnerUserId === undefined) {
    return {
      state: "ambiguous",
      reason: "personal_organization_owner_missing",
    };
  }
  if (input.kind === "shared" && input.personalOwnerUserId !== undefined) {
    return {
      state: "ambiguous",
      reason: "shared_kind_conflicts_with_personal_owner",
    };
  }
  return {
    state: "ready",
    reason:
      input.kind === undefined
        ? "missing_kind_defaults_shared"
        : "organization_kind_recorded",
  };
}

export function classifyIntegrationEventOwnership(input: {
  hasSession: boolean;
  sessionScopeState?: ClassificationState;
  sessionInstitutionIds: string[];
  existingInstitutionId?: string;
}): OwnershipClassification {
  if (!input.hasSession) {
    return input.existingInstitutionId
      ? {
          state: "ambiguous",
          reason: "sessionless_event_has_organization_scope",
        }
      : {
          state: "ready",
          reason: "sessionless_event_remains_identity_private",
        };
  }
  if (input.sessionScopeState !== "ready") {
    return { state: "ambiguous", reason: "event_session_scope_unresolved" };
  }
  const scopes = new Set(input.sessionInstitutionIds);
  if (scopes.size !== 1) {
    return { state: "ambiguous", reason: "event_session_scope_unresolved" };
  }
  const [derivedInstitutionId] = [...scopes];
  if (
    input.existingInstitutionId !== undefined &&
    input.existingInstitutionId !== derivedInstitutionId
  ) {
    return { state: "ambiguous", reason: "conflicting_existing_scope" };
  }
  return { state: "ready", reason: "event_scope_derives_from_session" };
}

export function classifyAuditLogOwnership(input: {
  missingParent: boolean;
  sessionScopeUnresolved: boolean;
  institutionIds: string[];
}): OwnershipClassification {
  if (input.missingParent) {
    return { state: "ambiguous", reason: "audit_parent_missing" };
  }
  if (input.sessionScopeUnresolved) {
    return { state: "ambiguous", reason: "audit_session_scope_unresolved" };
  }
  const scopes = new Set(input.institutionIds);
  if (scopes.size > 1) {
    return { state: "ambiguous", reason: "audit_scope_conflict" };
  }
  return {
    state: "ready",
    reason:
      scopes.size === 0
        ? "platform_audit_remains_private"
        : "audit_scope_is_consistent",
  };
}

export function classifyDescendantParentChain(input: {
  parentExists: boolean;
  parentScopeReady: boolean;
  crossParentsAgree: boolean;
  missingParentReason?: string;
  crossParentReason?: string;
}): OwnershipClassification {
  if (!input.parentExists) {
    return {
      state: "ambiguous",
      reason: input.missingParentReason ?? "case_session_parent_missing",
    };
  }
  if (!input.parentScopeReady) {
    return { state: "ambiguous", reason: "case_session_scope_unresolved" };
  }
  if (!input.crossParentsAgree) {
    return {
      state: "ambiguous",
      reason: input.crossParentReason ?? "descendant_cross_parent_conflict",
    };
  }
  return { state: "ready", reason: "case_session_parent_chain_resolves" };
}

export function classifyAssignmentSessionOwnership(input: {
  assignmentExists: boolean;
  sessionExists: boolean;
  cohortExists: boolean;
  institutionActive: boolean;
  ownerMatches: boolean;
  scenarioMatches: boolean;
  existingScopeMatches: boolean;
  caseSessionScopeReady: boolean;
}): OwnershipClassification {
  if (!input.assignmentExists || !input.sessionExists || !input.cohortExists) {
    return { state: "ambiguous", reason: "assignment_session_parent_missing" };
  }
  if (!input.ownerMatches || !input.scenarioMatches) {
    return {
      state: "ambiguous",
      reason: "assignment_session_cross_parent_conflict",
    };
  }
  if (!input.institutionActive) {
    return { state: "ambiguous", reason: "assignment_organization_inactive" };
  }
  if (!input.existingScopeMatches) {
    return { state: "ambiguous", reason: "assignment_session_scope_conflict" };
  }
  if (!input.caseSessionScopeReady) {
    return {
      state: "ambiguous",
      reason: "assignment_session_case_scope_unresolved",
    };
  }
  return { state: "ready", reason: "assignment_session_parents_agree" };
}

export function classifySimulationPolicyOwnership(input: {
  parentExists: boolean;
  institutionActive?: boolean;
  caseSessionScopeReady?: boolean;
}): OwnershipClassification {
  if (!input.parentExists) {
    return { state: "ambiguous", reason: "policy_scope_parent_missing" };
  }
  if (input.institutionActive === false) {
    return { state: "ambiguous", reason: "policy_organization_inactive" };
  }
  if (input.caseSessionScopeReady === false) {
    return { state: "ambiguous", reason: "policy_session_scope_unresolved" };
  }
  return { state: "ready", reason: "policy_scope_resolves" };
}

type AssignmentEvidence = {
  assignmentSessionUserId: string;
  state:
    | "ready"
    | "missing_assignment"
    | "missing_cohort"
    | "missing_institution"
    | "truncated";
  institutionId?: string;
  institutionActive?: boolean;
};

type PersonalOrganizationEvidence = {
  institutionId: string;
  kind?: "personal" | "shared";
  personalOwnerUserId?: string;
  status: "active" | "paused" | "archived";
  ownerMembershipActive: boolean;
  ownerMembershipRole?: "learner" | "instructor" | "admin";
};

/** Pure rule used by both inspection and its focused fixtures. */
export function classifyCaseSessionOwnership(input: {
  userId: string;
  ownerExists: boolean;
  institutionId?: string;
  existingInstitution?: {
    kind?: "personal" | "shared";
    personalOwnerUserId?: string;
    status: "active" | "paused" | "archived";
  } | null;
  assignmentLinks: AssignmentEvidence[];
  personalOrganizations: PersonalOrganizationEvidence[];
}): OwnershipClassification {
  if (!input.ownerExists)
    return { state: "ambiguous", reason: "missing_owner" };

  if (input.assignmentLinks.length > 0) {
    if (input.assignmentLinks.some((link) => link.state === "truncated")) {
      return {
        state: "ambiguous",
        reason: "assignment_session_scan_truncated",
      };
    }
    if (input.assignmentLinks.some((link) => link.state !== "ready")) {
      return { state: "ambiguous", reason: "assignment_parent_missing" };
    }
    if (
      input.assignmentLinks.some(
        (link) => link.assignmentSessionUserId !== input.userId,
      )
    ) {
      return { state: "ambiguous", reason: "assignment_owner_mismatch" };
    }
    if (input.assignmentLinks.some((link) => link.institutionActive !== true)) {
      return { state: "ambiguous", reason: "assignment_organization_inactive" };
    }
    const institutionIds = new Set(
      input.assignmentLinks.map((link) => link.institutionId),
    );
    if (institutionIds.size !== 1 || institutionIds.has(undefined)) {
      return {
        state: "ambiguous",
        reason: "multiple_or_missing_organizations",
      };
    }
    const targetInstitutionId = [...institutionIds][0];
    if (
      input.institutionId !== undefined &&
      input.institutionId !== targetInstitutionId
    ) {
      return { state: "ambiguous", reason: "conflicting_existing_scope" };
    }
    return {
      state: "ready",
      reason:
        input.institutionId === undefined
          ? "assignment_scope_is_unambiguous"
          : "assignment_scope_already_matches",
    };
  }

  if (input.institutionId !== undefined) {
    const institution = input.existingInstitution;
    if (!institution) {
      return { state: "ambiguous", reason: "existing_scope_parent_missing" };
    }
    if (
      institution.status !== "active" ||
      institution.kind !== "personal" ||
      institution.personalOwnerUserId !== input.userId
    ) {
      // In particular, never move an existing org-bound session to personal.
      return { state: "ambiguous", reason: "existing_scope_conflict" };
    }
    const personal = input.personalOrganizations.find(
      (candidate) => candidate.institutionId === input.institutionId,
    );
    if (!personal?.ownerMembershipActive) {
      return { state: "ambiguous", reason: "owner_membership_inactive" };
    }
    return { state: "ready", reason: "personal_scope_already_matches" };
  }

  if (input.personalOrganizations.length > 1) {
    return { state: "ambiguous", reason: "personal_organization_duplicate" };
  }
  const personal = input.personalOrganizations[0];
  if (!personal) {
    return { state: "ready", reason: "ensure_personal_for_stored_owner" };
  }
  if (
    personal.kind !== "personal" ||
    personal.personalOwnerUserId !== input.userId
  ) {
    return { state: "ambiguous", reason: "personal_owner_conflict" };
  }
  if (personal.status !== "active" || !personal.ownerMembershipActive) {
    return { state: "ambiguous", reason: "owner_membership_inactive" };
  }
  return {
    state: "ready",
    reason: "personal_scope_resolves_to_existing_owner_org",
  };
}

export type ScenarioReferenceEvidence = {
  state: "ready" | "ambiguous";
  institutionId?: string;
};

/** Pure private-scenario ownership rule; it never selects an organization. */
export function classifyPrivateScenarioOwnership(input: {
  visibility?: "public_template" | "private";
  ownerUserId?: string;
  ownerExists: boolean;
  institutionId?: string;
  existingInstitutionActive?: boolean;
  references: ScenarioReferenceEvidence[];
  ownerMembershipActiveForInstitutionIds: ReadonlySet<string>;
  personalOrganizations: PersonalOrganizationEvidence[];
}): OwnershipClassification {
  if (input.visibility === "public_template") {
    return input.institutionId === undefined
      ? { state: "ready", reason: "public_template_remains_catalog" }
      : {
          state: "ambiguous",
          reason: "public_template_has_organization_scope",
        };
  }
  if (input.visibility !== "private") {
    return { state: "ambiguous", reason: "scenario_visibility_unresolved" };
  }
  if (!input.ownerUserId || !input.ownerExists) {
    return { state: "ambiguous", reason: "missing_owner" };
  }
  if (input.references.some((reference) => reference.state !== "ready")) {
    return { state: "ambiguous", reason: "referencing_parent_unresolved" };
  }

  const institutionIds = new Set(
    input.references
      .map((reference) => reference.institutionId)
      .filter((id): id is string => id !== undefined),
  );
  if (input.references.length > 0 && institutionIds.size === 0) {
    return { state: "ambiguous", reason: "referencing_scope_unresolved" };
  }
  if (institutionIds.size > 1) {
    return { state: "ambiguous", reason: "multiple_referencing_organizations" };
  }

  let targetInstitutionId: string | undefined;
  if (input.references.length === 0) {
    if (input.personalOrganizations.length > 1) {
      return { state: "ambiguous", reason: "personal_organization_duplicate" };
    }
    const personal = input.personalOrganizations[0];
    if (personal) {
      if (
        personal.kind !== "personal" ||
        personal.personalOwnerUserId !== input.ownerUserId
      ) {
        return { state: "ambiguous", reason: "personal_owner_conflict" };
      }
      if (personal.status !== "active" || !personal.ownerMembershipActive) {
        return { state: "ambiguous", reason: "owner_membership_inactive" };
      }
      targetInstitutionId = personal.institutionId;
    }
  } else {
    targetInstitutionId = [...institutionIds][0];
    if (
      targetInstitutionId &&
      !input.ownerMembershipActiveForInstitutionIds.has(targetInstitutionId)
    ) {
      return {
        state: "ambiguous",
        reason: "owner_membership_missing_or_inactive",
      };
    }
  }

  if (
    input.institutionId !== undefined &&
    (input.institutionId !== targetInstitutionId ||
      input.existingInstitutionActive !== true)
  ) {
    return { state: "ambiguous", reason: "conflicting_existing_scope" };
  }
  return {
    state: "ready",
    reason:
      input.institutionId === undefined
        ? targetInstitutionId
          ? "private_scenario_scope_is_unambiguous"
          : "ensure_personal_for_scenario_owner"
        : "private_scenario_scope_already_matches",
  };
}

export type ProvenanceMatchEvidence = {
  externalIdMatches: boolean;
  sourceUrlMatches: boolean;
  importTimestampMatches: boolean;
  scenarioMatches: boolean;
  docketNumberMatches: boolean;
};

function isExactProvenanceMatch(match: ProvenanceMatchEvidence): boolean {
  return (
    match.externalIdMatches &&
    match.sourceUrlMatches &&
    match.importTimestampMatches &&
    match.scenarioMatches &&
    match.docketNumberMatches
  );
}

/** A source import is safe only when every recorded provenance key agrees. */
export function classifySourceProvenanceMatches(
  matches: ProvenanceMatchEvidence[],
): OwnershipClassification {
  const exact = matches.filter(isExactProvenanceMatch);
  if (exact.length === 1) {
    return { state: "ready", reason: "one_provenance_match" };
  }
  return {
    state: "ambiguous",
    reason:
      exact.length > 1
        ? "multiple_provenance_matches"
        : "provenance_match_missing",
  };
}

const findingValidator = v.object({
  id: v.string(),
  tableName: v.string(),
  recordId: v.string(),
  outcome: v.union(
    v.literal("ready"),
    v.literal("ambiguous"),
    v.literal("warning"),
  ),
  reason: v.string(),
  storageField: v.optional(v.string()),
  historicalConfidentiality: v.optional(v.literal("UNVERIFIED")),
});

const inspectionResultValidator = v.object({
  nextCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
  scanned: v.number(),
  ready: v.number(),
  ambiguous: v.number(),
  findings: v.array(findingValidator),
});

const applyBatchResultValidator = v.object({
  nextCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
  scanned: v.number(),
  ready: v.number(),
  ambiguous: v.number(),
  changed: v.number(),
  skipped: v.number(),
  writes: v.array(
    v.object({
      tableName: v.string(),
      recordId: v.string(),
      outcome: v.union(
        v.literal("updated"),
        v.literal("unchanged"),
        v.literal("skipped"),
      ),
      reason: v.string(),
      field: v.optional(v.string()),
      before: v.optional(v.union(v.string(), v.null())),
      after: v.optional(v.union(v.string(), v.null())),
    }),
  ),
  findings: v.array(findingValidator),
});

type MigrationRow = Doc<MigrationTable> & Record<string, unknown>;
type BoundedInspectionWork = {
  remaining: number;
  exhausted: boolean;
  documentReads: Map<string, Promise<unknown>>;
  queryReads: Map<string, Promise<unknown>>;
  derivedReads: Map<string, Promise<unknown>>;
};
type InspectionContext = {
  db: QueryCtx["db"];
  work: BoundedInspectionWork;
};
type RowFinding = {
  outcome: "ready" | "ambiguous";
  reason: string;
  reportStorage?: boolean;
  writePlan?: MigrationWritePlan;
};

class InspectionWorkBudgetExceeded extends Error {
  constructor() {
    super("Inspection work budget exhausted");
    this.name = "InspectionWorkBudgetExceeded";
  }
}

function createInspectionContext(ctx: Pick<QueryCtx, "db">): InspectionContext {
  return {
    db: ctx.db,
    work: {
      remaining: MAX_INSPECTION_WORK_UNITS,
      exhausted: false,
      documentReads: new Map(),
      queryReads: new Map(),
      derivedReads: new Map(),
    },
  };
}

function chargeInspectionWork(ctx: InspectionContext, units: number) {
  if (units <= 0) return;
  if (units > ctx.work.remaining) {
    ctx.work.exhausted = true;
    throw new InspectionWorkBudgetExceeded();
  }
  ctx.work.remaining -= units;
}

function releaseInspectionWork(ctx: InspectionContext, units: number) {
  ctx.work.remaining = Math.min(
    MAX_INSPECTION_WORK_UNITS,
    ctx.work.remaining + units,
  );
}

async function readDocument<T extends TableNames>(
  ctx: InspectionContext,
  id: Id<T>,
): Promise<Doc<T> | null> {
  const key = String(id);
  let pending = ctx.work.documentReads.get(key);
  if (!pending) {
    pending = (async () => {
      // Count the db.get call and reserve for its possible document result.
      chargeInspectionWork(ctx, 2);
      try {
        const document = await ctx.db.get(id);
        if (!document) releaseInspectionWork(ctx, 1);
        return document;
      } catch (error) {
        releaseInspectionWork(ctx, 2);
        throw error;
      }
    })();
    ctx.work.documentReads.set(key, pending);
    void pending.catch(() => ctx.work.documentReads.delete(key));
  }
  return (await pending) as Doc<T> | null;
}

async function readQueryRows<T>(
  ctx: InspectionContext,
  cacheKey: string,
  requestedLimit: number,
  load: (limit: number) => Promise<T[]>,
): Promise<T[]> {
  let pending = ctx.work.queryReads.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const queryLimit = Math.min(requestedLimit, ctx.work.remaining - 1);
      if (queryLimit < 1) {
        ctx.work.exhausted = true;
        throw new InspectionWorkBudgetExceeded();
      }
      // Count the db.query operation and reserve for every possible result.
      chargeInspectionWork(ctx, queryLimit + 1);
      let rows: T[];
      try {
        rows = await load(queryLimit);
      } catch (error) {
        releaseInspectionWork(ctx, queryLimit + 1);
        throw error;
      }
      releaseInspectionWork(ctx, queryLimit - rows.length);
      if (queryLimit < requestedLimit && rows.length === queryLimit) {
        ctx.work.exhausted = true;
        throw new InspectionWorkBudgetExceeded();
      }
      return rows;
    })();
    ctx.work.queryReads.set(cacheKey, pending);
    void pending.catch(() => ctx.work.queryReads.delete(cacheKey));
  }
  return (await pending) as T[];
}

function memoizeInspectionWork<T>(
  ctx: InspectionContext,
  cacheKey: string,
  calculate: () => Promise<T>,
): Promise<T> {
  let pending = ctx.work.derivedReads.get(cacheKey);
  if (!pending) {
    pending = calculate();
    ctx.work.derivedReads.set(cacheKey, pending);
    void pending.catch(() => ctx.work.derivedReads.delete(cacheKey));
  }
  return pending as Promise<T>;
}

function chargeReferenceArray<T>(
  ctx: InspectionContext,
  values: readonly T[] | undefined,
): readonly T[] {
  if (!values) return [];
  chargeInspectionWork(ctx, values.length);
  return values;
}

function reportId(table: MigrationTable, recordId: string, suffix: string) {
  return `${ORGANIZATION_MIGRATION_KEY}/${table}/${recordId}/${suffix}`;
}

async function personalOrganizationEvidence(
  ctx: InspectionContext,
  userId: Id<"users">,
  now: number,
): Promise<PersonalOrganizationEvidence[]> {
  return memoizeInspectionWork(
    ctx,
    `personal-organizations:${userId}`,
    async () => {
      const institutions = await readQueryRows(
        ctx,
        `institutions/by-personal-owner:${userId}:2`,
        2,
        (limit) =>
          ctx.db
            .query("institutions")
            .withIndex("by_personal_owner", (index) =>
              index.eq("personalOwnerUserId", userId),
            )
            .take(limit),
      );
      const evidence: PersonalOrganizationEvidence[] = [];
      for (const institution of institutions) {
        const memberships = await readQueryRows(
          ctx,
          `institution-memberships/by-institution-user:${institution._id}:${userId}:2`,
          2,
          (limit) =>
            ctx.db
              .query("institutionMemberships")
              .withIndex("by_institution_user", (index) =>
                index.eq("institutionId", institution._id).eq("userId", userId),
              )
              .take(limit),
        );
        evidence.push({
          institutionId: institution._id,
          kind: institution.kind,
          personalOwnerUserId: institution.personalOwnerUserId,
          status: institution.status,
          ownerMembershipActive:
            memberships.length === 1 &&
            isOrganizationMembershipActive(
              institution,
              memberships[0] ?? null,
              now,
            ),
          ownerMembershipRole:
            memberships.length === 1 ? memberships[0]?.role : undefined,
        });
      }
      return evidence;
    },
  );
}

async function assignmentEvidenceForSession(
  ctx: InspectionContext,
  sessionId: Id<"caseSessions">,
): Promise<AssignmentEvidence[]> {
  return memoizeInspectionWork(
    ctx,
    `assignment-evidence:${sessionId}`,
    async () => {
      const assignmentSessions = await readQueryRows(
        ctx,
        `assignment-sessions/by-case:${sessionId}:${CLASSIFICATION_RELATION_PROBE_LIMIT}`,
        CLASSIFICATION_RELATION_PROBE_LIMIT,
        (limit) =>
          ctx.db
            .query("assignmentSessions")
            .withIndex("by_case", (index) =>
              index.eq("caseSessionId", sessionId),
            )
            .take(limit),
      );
      if (assignmentSessions.length > MAX_CLASSIFICATION_RELATION_ROWS) {
        return [{ assignmentSessionUserId: "", state: "truncated" }];
      }
      const evidence: AssignmentEvidence[] = [];
      for (const assignmentSession of assignmentSessions) {
        const assignment = await readDocument(
          ctx,
          assignmentSession.assignmentId,
        );
        if (!assignment) {
          evidence.push({
            assignmentSessionUserId: assignmentSession.userId,
            state: "missing_assignment",
          });
          continue;
        }
        const cohort = await readDocument(ctx, assignment.cohortId);
        if (!cohort) {
          evidence.push({
            assignmentSessionUserId: assignmentSession.userId,
            state: "missing_cohort",
          });
          continue;
        }
        const institution = await readDocument(ctx, cohort.institutionId);
        if (!institution) {
          evidence.push({
            assignmentSessionUserId: assignmentSession.userId,
            state: "missing_institution",
          });
          continue;
        }
        evidence.push({
          assignmentSessionUserId: assignmentSession.userId,
          state: "ready",
          institutionId: institution._id,
          institutionActive: institution.status === "active",
        });
      }
      return evidence;
    },
  );
}

async function classifyCaseSession(
  ctx: InspectionContext,
  session: Doc<"caseSessions">,
  now: number,
): Promise<OwnershipDecision> {
  return memoizeInspectionWork(
    ctx,
    `case-session-classification:${session._id}`,
    async () => {
      const owner = await readDocument(ctx, session.userId);
      const links = await assignmentEvidenceForSession(ctx, session._id);
      const personalOrganizations = await personalOrganizationEvidence(
        ctx,
        session.userId,
        now,
      );
      const existingInstitution = session.institutionId
        ? await readDocument(ctx, session.institutionId)
        : null;
      const classification = classifyCaseSessionOwnership({
        userId: session.userId,
        ownerExists: owner !== null,
        institutionId: session.institutionId,
        existingInstitution: existingInstitution
          ? {
              kind: existingInstitution.kind,
              personalOwnerUserId: existingInstitution.personalOwnerUserId,
              status: existingInstitution.status,
            }
          : null,
        assignmentLinks: links,
        personalOrganizations,
      });
      if (classification.state !== "ready" || session.institutionId) {
        return classification;
      }
      if (links.length > 0) {
        return {
          ...classification,
          targetInstitutionId: links[0]?.institutionId as
            | Id<"institutions">
            | undefined,
        };
      }
      // Preserve the foundation's ensurePersonal idempotence checks even when
      // an eligible personal organization already exists.
      return { ...classification, ensurePersonalFor: session.userId };
    },
  );
}

async function activeMembership(
  ctx: InspectionContext,
  institutionId: Id<"institutions">,
  userId: Id<"users">,
  now: number,
) {
  const institution = await readDocument(ctx, institutionId);
  const memberships = await readQueryRows(
    ctx,
    `institution-memberships/by-institution-user:${institutionId}:${userId}:2`,
    2,
    (limit) =>
      ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index.eq("institutionId", institutionId).eq("userId", userId),
        )
        .take(limit),
  );
  return (
    memberships.length === 1 &&
    isOrganizationMembershipActive(institution, memberships[0] ?? null, now)
  );
}

async function classifyScenario(
  ctx: InspectionContext,
  scenario: Doc<"scenarios">,
  now: number,
  assignments: Doc<"assignments">[],
  assignmentScanTruncated: boolean,
): Promise<OwnershipDecision> {
  return memoizeInspectionWork(
    ctx,
    `scenario-classification:${scenario._id}`,
    () =>
      computeScenarioClassification(
        ctx,
        scenario,
        now,
        assignments,
        assignmentScanTruncated,
      ),
  );
}

async function computeScenarioClassification(
  ctx: InspectionContext,
  scenario: Doc<"scenarios">,
  now: number,
  assignments: Doc<"assignments">[],
  assignmentScanTruncated: boolean,
): Promise<OwnershipDecision> {
  if (scenario.visibility === "public_template") {
    return scenario.institutionId === undefined
      ? { state: "ready", reason: "public_template_remains_catalog" }
      : {
          state: "ambiguous",
          reason: "public_template_has_organization_scope",
        };
  }
  if (scenario.visibility !== "private") {
    return { state: "ambiguous", reason: "scenario_visibility_unresolved" };
  }
  const owner = scenario.ownerUserId
    ? await readDocument(ctx, scenario.ownerUserId)
    : null;
  if (!owner) return { state: "ambiguous", reason: "missing_owner" };
  if (assignmentScanTruncated) {
    return { state: "ambiguous", reason: "scenario_assignment_scan_truncated" };
  }
  const sessions = await readQueryRows(
    ctx,
    `case-sessions/by-scenario:${scenario._id}:${CLASSIFICATION_RELATION_PROBE_LIMIT}`,
    CLASSIFICATION_RELATION_PROBE_LIMIT,
    (limit) =>
      ctx.db
        .query("caseSessions")
        .withIndex("by_scenario", (index) =>
          index.eq("scenarioId", scenario._id),
        )
        .take(limit),
  );
  if (sessions.length > MAX_CLASSIFICATION_RELATION_ROWS) {
    return { state: "ambiguous", reason: "scenario_session_scan_truncated" };
  }
  chargeInspectionWork(ctx, assignments.length);
  const relatedAssignments = assignments.filter(
    (assignment) => assignment.scenarioId === scenario._id,
  );
  const references: ScenarioReferenceEvidence[] = [];
  for (const session of sessions) {
    const classification = await classifyCaseSession(ctx, session, now);
    const assignmentLinks = await assignmentEvidenceForSession(
      ctx,
      session._id,
    );
    if (assignmentLinks.some((link) => link.state === "truncated")) {
      return {
        state: "ambiguous",
        reason: "scenario_assignment_session_scan_truncated",
      };
    }
    const institutionIds = new Set(
      assignmentLinks
        .map((link) => link.institutionId)
        .filter((id): id is string => id !== undefined),
    );
    if (session.institutionId) institutionIds.add(session.institutionId);
    if (institutionIds.size === 1 && classification.state === "ready") {
      references.push({
        state: "ready",
        institutionId: [...institutionIds][0],
      });
    } else {
      references.push({ state: "ambiguous" });
    }
  }
  for (const assignment of relatedAssignments) {
    const cohort = await readDocument(ctx, assignment.cohortId);
    const institution = cohort
      ? await readDocument(ctx, cohort.institutionId)
      : null;
    if (institution && institution.status === "active") {
      references.push({ state: "ready", institutionId: institution._id });
    } else {
      references.push({ state: "ambiguous" });
    }
  }

  const personalOrganizations = scenario.ownerUserId
    ? await personalOrganizationEvidence(ctx, scenario.ownerUserId, now)
    : [];
  const ownerMembershipIds = new Set<string>();
  if (scenario.ownerUserId) {
    const referencedIds = new Set(
      references
        .map((reference) => reference.institutionId)
        .filter((id): id is string => id !== undefined),
    );
    for (const institutionId of referencedIds) {
      if (
        await activeMembership(
          ctx,
          institutionId as Id<"institutions">,
          scenario.ownerUserId,
          now,
        )
      ) {
        ownerMembershipIds.add(institutionId);
      }
    }
  }
  const existingInstitution = scenario.institutionId
    ? await readDocument(ctx, scenario.institutionId)
    : null;
  const classification = classifyPrivateScenarioOwnership({
    visibility: scenario.visibility,
    ownerUserId: scenario.ownerUserId,
    ownerExists: owner !== null,
    institutionId: scenario.institutionId,
    existingInstitutionActive: existingInstitution?.status === "active",
    references,
    ownerMembershipActiveForInstitutionIds: ownerMembershipIds,
    personalOrganizations,
  });
  if (classification.state !== "ready" || scenario.institutionId) {
    return classification;
  }
  if (references.length > 0) {
    const targetInstitutionIds = new Set(
      references
        .map((reference) => reference.institutionId)
        .filter((id): id is string => id !== undefined),
    );
    return {
      ...classification,
      targetInstitutionId: [...targetInstitutionIds][0] as Id<"institutions">,
    };
  }
  const personal = personalOrganizations[0];
  return personal
    ? {
        ...classification,
        targetInstitutionId: personal.institutionId as Id<"institutions">,
      }
    : { ...classification, ensurePersonalFor: scenario.ownerUserId };
}

function sourceUrlFromProvenance(value: Record<string, unknown>): string {
  const absoluteUrl = value.absolute_url;
  if (typeof absoluteUrl === "string") {
    try {
      return new URL(absoluteUrl, "https://www.courtlistener.com").toString();
    } catch {
      return "https://www.courtlistener.com/";
    }
  }
  const docketId = value.docket_id;
  if (typeof docketId === "number" && docketId !== 0) {
    return `https://www.courtlistener.com/docket/${docketId}/`;
  }
  return "https://www.courtlistener.com/";
}

async function classifySourceCase(
  ctx: InspectionContext,
  sourceCase: Doc<"sourceCases">,
): Promise<
  OwnershipClassification & { targetCaseSessionId?: Id<"caseSessions"> }
> {
  if (sourceCase.caseSessionId) {
    const session = await readDocument(ctx, sourceCase.caseSessionId);
    if (!session)
      return { state: "ambiguous", reason: "source_session_missing" };
    if (session.scenarioId !== sourceCase.scenarioId) {
      return { state: "ambiguous", reason: "source_scenario_conflict" };
    }
    return { state: "ready", reason: "source_session_link_already_matches" };
  }

  if (sourceCase.sourceSystem !== "courtlistener") {
    return { state: "ambiguous", reason: "source_provenance_unmatched" };
  }
  let provenance: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(sourceCase.provenanceJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "ambiguous", reason: "source_provenance_invalid" };
    }
    provenance = parsed as Record<string, unknown>;
  } catch {
    return { state: "ambiguous", reason: "source_provenance_invalid" };
  }
  const recordedExternalId = provenance.docket_id ?? provenance.id;
  if (
    (typeof recordedExternalId !== "string" &&
      typeof recordedExternalId !== "number") ||
    String(recordedExternalId) !== sourceCase.externalId
  ) {
    return { state: "ambiguous", reason: "source_external_id_conflict" };
  }
  const docketNumber =
    typeof provenance.docketNumber === "string"
      ? provenance.docketNumber
      : `CourtListener docket ${provenance.docket_id ?? provenance.id}`;
  const sourceUrl = sourceUrlFromProvenance(provenance);
  const evidence: ProvenanceMatchEvidence[] = [];
  const sessions = await readQueryRows(
    ctx,
    `case-sessions/by-scenario:${sourceCase.scenarioId}:${CLASSIFICATION_RELATION_PROBE_LIMIT}`,
    CLASSIFICATION_RELATION_PROBE_LIMIT,
    (limit) =>
      ctx.db
        .query("caseSessions")
        .withIndex("by_scenario", (index) =>
          index.eq("scenarioId", sourceCase.scenarioId),
        )
        .take(limit),
  );
  if (sessions.length > MAX_CLASSIFICATION_RELATION_ROWS) {
    return { state: "ambiguous", reason: "source_case_session_scan_truncated" };
  }
  const imports: Doc<"trialDocketImports">[] = [];
  for (const session of sessions) {
    const sessionImports = await readQueryRows(
      ctx,
      `trial-docket-imports/by-case:${session._id}:3`,
      3,
      (limit) =>
        ctx.db
          .query("trialDocketImports")
          .withIndex("by_case", (index) =>
            index.eq("caseSessionId", session._id),
          )
          .take(limit),
    );
    if (sessionImports.length > 2) {
      return { state: "ambiguous", reason: "source_import_scan_truncated" };
    }
    imports.push(...sessionImports);
  }
  for (const trialImport of imports) {
    const session = await readDocument(ctx, trialImport.caseSessionId);
    evidence.push({
      externalIdMatches: String(recordedExternalId) === sourceCase.externalId,
      sourceUrlMatches:
        sourceCase.sourceUrl === sourceUrl &&
        trialImport.sourceUrl === sourceUrl,
      importTimestampMatches: trialImport.importedAt === sourceCase.importedAt,
      scenarioMatches: session?.scenarioId === sourceCase.scenarioId,
      docketNumberMatches: trialImport.docketNumber === docketNumber,
    });
  }
  const classification = classifySourceProvenanceMatches(evidence);
  if (classification.state !== "ready") return classification;
  const matchingIndex = evidence.findIndex(isExactProvenanceMatch);
  const matchedImport = imports[matchingIndex];
  return matchedImport
    ? { ...classification, targetCaseSessionId: matchedImport.caseSessionId }
    : { state: "ambiguous", reason: "provenance_match_missing" };
}

async function classifyIntegrationEvent(
  ctx: InspectionContext,
  row: Doc<"integrationEvents">,
  now: number,
): Promise<RowFinding> {
  if (!row.caseSessionId) {
    const classification = classifyIntegrationEventOwnership({
      hasSession: false,
      sessionInstitutionIds: [],
      existingInstitutionId: row.institutionId,
    });
    return { outcome: classification.state, reason: classification.reason };
  }
  const session = await readDocument(ctx, row.caseSessionId);
  if (!session)
    return { outcome: "ambiguous", reason: "event_session_missing" };
  const sessionClassification = await classifyCaseSession(ctx, session, now);
  const links = await assignmentEvidenceForSession(ctx, session._id);
  const scopes = new Set(
    links
      .map((link) => link.institutionId)
      .filter((id): id is string => id !== undefined),
  );
  if (session.institutionId) scopes.add(session.institutionId);
  const classification = classifyIntegrationEventOwnership({
    hasSession: true,
    sessionScopeState: sessionClassification.state,
    sessionInstitutionIds: [...scopes],
    existingInstitutionId: row.institutionId,
  });
  const targetInstitutionId = [...scopes][0];
  return {
    outcome: classification.state,
    reason: classification.reason,
    writePlan:
      classification.state === "ready" &&
      row.institutionId === undefined &&
      targetInstitutionId
        ? {
            field: "institutionId",
            value: targetInstitutionId as Id<"institutions">,
          }
        : undefined,
  };
}

async function classifyAuditLog(
  ctx: InspectionContext,
  row: Doc<"auditLog">,
  now: number,
): Promise<RowFinding> {
  const scopes: string[] = [];
  let sessionScopeCount = 0;
  let missingParent = false;
  let sessionScopeUnresolved = false;
  if (row.institutionId) {
    const institution = await readDocument(ctx, row.institutionId);
    if (!institution) missingParent = true;
    scopes.push(row.institutionId);
  }
  if (row.cohortId) {
    const cohort = await readDocument(ctx, row.cohortId);
    if (!cohort) missingParent = true;
    else scopes.push(cohort.institutionId);
  }
  if (row.caseSessionId) {
    const session = await readDocument(ctx, row.caseSessionId);
    if (!session) {
      missingParent = true;
    } else {
      const classification = await classifyCaseSession(ctx, session, now);
      if (classification.state !== "ready") sessionScopeUnresolved = true;
      const assignmentLinks = await assignmentEvidenceForSession(
        ctx,
        session._id,
      );
      for (const link of assignmentLinks) {
        if (link.institutionId) {
          scopes.push(link.institutionId);
          sessionScopeCount += 1;
        }
      }
      if (session.institutionId) {
        scopes.push(session.institutionId);
        sessionScopeCount += 1;
      }
      if (sessionScopeCount === 0) sessionScopeUnresolved = true;
    }
  }
  const classification = classifyAuditLogOwnership({
    missingParent,
    sessionScopeUnresolved,
    institutionIds: scopes,
  });
  const targetInstitutionIds = new Set(scopes);
  return {
    outcome: classification.state,
    reason: classification.reason,
    writePlan:
      classification.state === "ready" &&
      row.institutionId === undefined &&
      targetInstitutionIds.size === 1
        ? {
            field: "institutionId",
            value: [...targetInstitutionIds][0] as Id<"institutions">,
          }
        : undefined,
  };
}

const CASE_SESSION_TABLES = new Set([
  "participants",
  "documents",
  "caseSessionEvents",
  "ecfReceipts",
  "documentAnalyses",
  "actorWorkProducts",
  "filings",
  "docketEntries",
  "deadlines",
  "aiRuns",
  "actorRunAudits",
  "simulationTurns",
  "actorPackets",
  "actorDecisions",
  "trialDocketImports",
  "counterpartyStrategies",
  "amicusCandidates",
  "amicusParticipations",
  "panelDeliberations",
  "panelDispositions",
  "panelVotes",
  "meritsEvaluations",
  "assessments",
]);

type CaseSessionParentTable =
  | "filings"
  | "documentAnalyses"
  | "documents"
  | "docketEntries"
  | "simulationTurns";

type CaseSessionParentLinkState = "missing" | "cross_case" | "same_case";

async function checkCaseSessionParentLink(
  ctx: InspectionContext,
  table: CaseSessionParentTable,
  id: unknown,
  caseSessionId: Id<"caseSessions">,
): Promise<CaseSessionParentLinkState> {
  if (typeof id !== "string") return "missing";
  const normalizedId = ctx.db.normalizeId(table, id);
  if (!normalizedId) return "missing";
  const parent = await readDocument(ctx, normalizedId);
  if (!parent) return "missing";
  return parent.caseSessionId === caseSessionId ? "same_case" : "cross_case";
}

function parentLinkReason(prefix: string, state: CaseSessionParentLinkState) {
  return state === "missing"
    ? `${prefix}_parent_missing`
    : `${prefix}_cross_parent_conflict`;
}

async function userReferenceExists(ctx: InspectionContext, value: unknown) {
  if (typeof value !== "string") return false;
  const userId = ctx.db.normalizeId("users", value);
  return userId !== null && (await readDocument(ctx, userId)) !== null;
}

async function classifyAssignmentSession(
  ctx: InspectionContext,
  row: Doc<"assignmentSessions">,
  now: number,
): Promise<RowFinding> {
  if (
    row.reviewerUserId &&
    !(await userReferenceExists(ctx, row.reviewerUserId))
  ) {
    return { outcome: "ambiguous", reason: "assignment_reviewer_missing" };
  }
  if (
    row.reopenedByUserId &&
    !(await userReferenceExists(ctx, row.reopenedByUserId))
  ) {
    return { outcome: "ambiguous", reason: "assignment_reopener_missing" };
  }
  const assignment = await readDocument(ctx, row.assignmentId);
  const session = await readDocument(ctx, row.caseSessionId);
  const assignmentExists = assignment !== null;
  const sessionExists = session !== null;
  const cohort = assignment
    ? await readDocument(ctx, assignment.cohortId)
    : null;
  const institution = cohort
    ? await readDocument(ctx, cohort.institutionId)
    : null;
  const caseSessionClassification = session
    ? await classifyCaseSession(ctx, session, now)
    : null;
  const classification = classifyAssignmentSessionOwnership({
    assignmentExists,
    sessionExists,
    cohortExists: cohort !== null && institution !== null,
    institutionActive: institution?.status === "active",
    ownerMatches:
      assignment !== null && session !== null && row.userId === session.userId,
    scenarioMatches:
      assignment !== null &&
      session !== null &&
      assignment.scenarioId === session.scenarioId,
    existingScopeMatches:
      session !== null &&
      (session.institutionId === undefined ||
        session.institutionId === institution?._id),
    caseSessionScopeReady: caseSessionClassification?.state === "ready",
  });
  return { outcome: classification.state, reason: classification.reason };
}

async function classifySimulationPolicy(
  ctx: InspectionContext,
  row: Doc<"simulationPolicies">,
  now: number,
): Promise<RowFinding> {
  if (!(await userReferenceExists(ctx, row.createdByUserId))) {
    return {
      outcome: "ambiguous",
      reason: "simulation_policy_creator_missing",
    };
  }
  const table =
    row.scope === "session"
      ? "caseSessions"
      : row.scope === "assignment"
        ? "assignments"
        : "cohorts";
  const id = ctx.db.normalizeId(table, row.scopeId);
  if (!id) {
    const classification = classifySimulationPolicyOwnership({
      parentExists: false,
    });
    return { outcome: classification.state, reason: classification.reason };
  }
  if (row.scope === "session") {
    const session = await readDocument(ctx, id as Id<"caseSessions">);
    if (!session) {
      const classification = classifySimulationPolicyOwnership({
        parentExists: false,
      });
      return { outcome: classification.state, reason: classification.reason };
    }
    const classification = await classifyCaseSession(ctx, session, now);
    const resolved = classifySimulationPolicyOwnership({
      parentExists: true,
      caseSessionScopeReady: classification.state === "ready",
    });
    return { outcome: resolved.state, reason: resolved.reason };
  }
  if (row.scope === "assignment") {
    const assignment = await readDocument(ctx, id as Id<"assignments">);
    if (!assignment) {
      const classification = classifySimulationPolicyOwnership({
        parentExists: false,
      });
      return { outcome: classification.state, reason: classification.reason };
    }
    const cohort = await readDocument(ctx, assignment.cohortId);
    if (!cohort) {
      const classification = classifySimulationPolicyOwnership({
        parentExists: false,
      });
      return { outcome: classification.state, reason: classification.reason };
    }
    const institution = await readDocument(ctx, cohort.institutionId);
    const classification = classifySimulationPolicyOwnership({
      parentExists: institution !== null,
      institutionActive: institution?.status === "active",
    });
    return { outcome: classification.state, reason: classification.reason };
  }
  const cohort = await readDocument(ctx, id as Id<"cohorts">);
  if (!cohort) {
    const classification = classifySimulationPolicyOwnership({
      parentExists: false,
    });
    return { outcome: classification.state, reason: classification.reason };
  }
  const institution = await readDocument(ctx, cohort.institutionId);
  const classification = classifySimulationPolicyOwnership({
    parentExists: institution !== null,
    institutionActive: institution?.status === "active",
  });
  return { outcome: classification.state, reason: classification.reason };
}

async function classifyDescendant(
  ctx: InspectionContext,
  table: MigrationTable,
  row: MigrationRow,
  now: number,
  allAssignments: Doc<"assignments">[],
  assignmentScanTruncated: boolean,
): Promise<RowFinding> {
  if (table === "assignmentSessions") {
    return classifyAssignmentSession(
      ctx,
      row as Doc<"assignmentSessions">,
      now,
    );
  }
  if (table === "simulationPolicies") {
    return classifySimulationPolicy(ctx, row as Doc<"simulationPolicies">, now);
  }
  if (
    table === "scenarioDocumentAssets" ||
    table === "scenarioIssues" ||
    table === "scenarioRecordExcerpts"
  ) {
    const scenarioId = row.scenarioId as Id<"scenarios">;
    const scenario = await readDocument(ctx, scenarioId);
    if (!scenario) {
      const classification = classifyDescendantParentChain({
        parentExists: false,
        parentScopeReady: false,
        crossParentsAgree: false,
        missingParentReason: "scenario_parent_missing",
      });
      return {
        outcome: classification.state,
        reason: classification.reason,
        reportStorage: true,
      };
    }
    if (table === "scenarioRecordExcerpts") {
      const citedByIssueIds = chargeReferenceArray(
        ctx,
        row.citedByIssueIds as string[] | undefined,
      );
      for (const issueId of citedByIssueIds) {
        const issues = await readQueryRows(
          ctx,
          `scenario-issues/by-scenario-issue:${scenario._id}:${issueId}:2`,
          2,
          (limit) =>
            ctx.db
              .query("scenarioIssues")
              .withIndex("by_scenario_issue", (index) =>
                index.eq("scenarioId", scenario._id).eq("issueId", issueId),
              )
              .take(limit),
        );
        if (issues.length === 0) {
          return {
            outcome: "ambiguous",
            reason: "scenario_excerpt_issue_missing_or_cross_scenario",
            reportStorage: true,
          };
        }
        if (issues.length > 1) {
          return {
            outcome: "ambiguous",
            reason: "scenario_excerpt_issue_ambiguous",
            reportStorage: true,
          };
        }
      }
    }
    if (scenario.visibility === "public_template") {
      return scenario.institutionId === undefined
        ? {
            outcome: "ready",
            reason: "public_template_child_remains_catalog",
            reportStorage: false,
          }
        : {
            outcome: "ambiguous",
            reason: "public_template_has_organization_scope",
            reportStorage: false,
          };
    }
    const classification = await classifyScenario(
      ctx,
      scenario,
      now,
      allAssignments,
      assignmentScanTruncated,
    );
    return classification.state === "ready"
      ? {
          outcome: "ready",
          reason: "private_scenario_parent_resolves",
          reportStorage: true,
        }
      : {
          outcome: "ambiguous",
          reason: classification.reason,
          reportStorage: true,
        };
  }

  if (table === "documents" || CASE_SESSION_TABLES.has(table)) {
    const caseSessionId = row.caseSessionId as Id<"caseSessions">;
    const session = await readDocument(ctx, caseSessionId);
    if (!session) {
      const classification = classifyDescendantParentChain({
        parentExists: false,
        parentScopeReady: false,
        crossParentsAgree: false,
      });
      return { outcome: classification.state, reason: classification.reason };
    }
    const classification = await classifyCaseSession(ctx, session, now);
    if (classification.state !== "ready") {
      const unresolved = classifyDescendantParentChain({
        parentExists: true,
        parentScopeReady: false,
        crossParentsAgree: true,
      });
      return { outcome: unresolved.state, reason: classification.reason };
    }

    const sameCaseReason = async (
      childTable: CaseSessionParentTable,
      id: unknown,
      reasonPrefix: string,
    ) => {
      const state = await checkCaseSessionParentLink(
        ctx,
        childTable,
        id,
        caseSessionId,
      );
      return state === "same_case"
        ? undefined
        : parentLinkReason(reasonPrefix, state);
    };
    let crossParentReason: string | undefined;
    if (table === "ecfReceipts") {
      crossParentReason = await sameCaseReason(
        "filings",
        row.filingId,
        "receipt_filing",
      );
    }
    if (table === "documents" && row.analysisId) {
      crossParentReason = await sameCaseReason(
        "documentAnalyses",
        row.analysisId,
        "document_analysis",
      );
      if (crossParentReason === undefined) {
        const analysisId = ctx.db.normalizeId(
          "documentAnalyses",
          row.analysisId as string,
        );
        const analysis = analysisId
          ? await readDocument(ctx, analysisId)
          : null;
        if (analysis?.documentId !== row._id) {
          crossParentReason = "document_analysis_reverse_link_conflict";
        }
      }
    } else if (table === "documents") {
      const linkedAnalyses = await readQueryRows(
        ctx,
        `document-analyses/by-document:${row._id}:1`,
        1,
        (limit) =>
          ctx.db
            .query("documentAnalyses")
            .withIndex("by_document", (index) =>
              index.eq("documentId", row._id as Id<"documents">),
            )
            .take(limit),
      );
      if (linkedAnalyses.length > 0) {
        crossParentReason = "document_analysis_reverse_link_conflict";
      }
    }
    if (table === "documentAnalyses" && row.documentId) {
      crossParentReason = await sameCaseReason(
        "documents",
        row.documentId,
        "analysis_document",
      );
      if (crossParentReason === undefined) {
        const documentId = ctx.db.normalizeId(
          "documents",
          row.documentId as string,
        );
        const document = documentId
          ? await readDocument(ctx, documentId)
          : null;
        if (document?.analysisId !== row._id) {
          crossParentReason = "analysis_document_reverse_link_conflict";
        }
      }
    } else if (table === "documentAnalyses") {
      const caseDocuments = await readQueryRows(
        ctx,
        `documents/by-case:${caseSessionId}:${CLASSIFICATION_RELATION_PROBE_LIMIT}`,
        CLASSIFICATION_RELATION_PROBE_LIMIT,
        (limit) =>
          ctx.db
            .query("documents")
            .withIndex("by_case", (index) =>
              index.eq("caseSessionId", caseSessionId),
            )
            .take(limit),
      );
      if (caseDocuments.some((document) => document.analysisId === row._id)) {
        crossParentReason = "analysis_document_reverse_link_conflict";
      } else if (caseDocuments.length > MAX_CLASSIFICATION_RELATION_ROWS) {
        crossParentReason = "analysis_document_reverse_scan_truncated";
      }
    }
    if (table === "actorWorkProducts") {
      const sourceDocumentAnalysisIds = chargeReferenceArray(
        ctx,
        row.sourceDocumentAnalysisIds as string[] | undefined,
      );
      for (const id of sourceDocumentAnalysisIds) {
        crossParentReason = await sameCaseReason(
          "documentAnalyses",
          id,
          "work_product_source_analysis",
        );
        if (crossParentReason) break;
      }
      if (crossParentReason === undefined) {
        const sourceFilingIds = chargeReferenceArray(
          ctx,
          row.sourceFilingIds as string[] | undefined,
        );
        for (const id of sourceFilingIds) {
          crossParentReason = await sameCaseReason(
            "filings",
            id,
            "work_product_source_filing",
          );
          if (crossParentReason) break;
        }
      }
    }
    if (
      table === "caseSessionEvents" &&
      row.actorUserId &&
      !(await userReferenceExists(ctx, row.actorUserId))
    ) {
      crossParentReason = "case_session_event_actor_missing";
    }
    if (table === "aiRuns" && !(await userReferenceExists(ctx, row.userId))) {
      crossParentReason = "ai_run_user_missing";
    }
    if (table === "filings" && crossParentReason === undefined) {
      const documentIds = chargeReferenceArray(
        ctx,
        row.documentIds as string[] | undefined,
      );
      const analysisIds = chargeReferenceArray(
        ctx,
        row.documentAnalysisIds as string[] | undefined,
      );
      for (const id of documentIds) {
        crossParentReason = await sameCaseReason(
          "documents",
          id,
          "filing_document",
        );
        if (crossParentReason) break;
      }
      if (crossParentReason === undefined) {
        for (const id of analysisIds) {
          crossParentReason = await sameCaseReason(
            "documentAnalyses",
            id,
            "filing_analysis",
          );
          if (crossParentReason) break;
        }
      }
    }
    if (
      crossParentReason === undefined &&
      table === "docketEntries" &&
      row.filingId
    ) {
      crossParentReason = await sameCaseReason(
        "filings",
        row.filingId,
        "docket_filing",
      );
    }
    if (
      crossParentReason === undefined &&
      table === "deadlines" &&
      row.sourceEntryId
    ) {
      crossParentReason = await sameCaseReason(
        "docketEntries",
        row.sourceEntryId,
        "deadline_entry",
      );
    }
    if (
      crossParentReason === undefined &&
      (table === "actorPackets" || table === "actorDecisions")
    ) {
      crossParentReason = await sameCaseReason(
        "simulationTurns",
        row.turnId,
        "turn",
      );
    }
    const final = classifyDescendantParentChain({
      parentExists: true,
      parentScopeReady: true,
      crossParentsAgree: crossParentReason === undefined,
      crossParentReason,
    });
    return { outcome: final.state, reason: final.reason };
  }
  return { outcome: "ready", reason: "table_is_in_ordered_inventory" };
}

async function classifyRow(
  ctx: InspectionContext,
  table: MigrationTable,
  row: MigrationRow,
  now: number,
  allAssignments: Doc<"assignments">[],
  assignmentScanTruncated: boolean,
): Promise<RowFinding> {
  if (table === "institutions") {
    const institution = row as Doc<"institutions">;
    const classification = classifyInstitutionKind(institution);
    return {
      outcome: classification.state,
      reason: classification.reason,
      writePlan:
        classification.state === "ready" && institution.kind === undefined
          ? { field: "kind", value: "shared" }
          : undefined,
    };
  }
  if (table === "users") {
    const classification = classifyLegacyUser();
    return { outcome: classification.state, reason: classification.reason };
  }
  if (table === "caseSessions") {
    const classification = await classifyCaseSession(
      ctx,
      row as Doc<"caseSessions">,
      now,
    );
    return {
      outcome: classification.state,
      reason: classification.reason,
      writePlan:
        classification.state !== "ready" || row.institutionId !== undefined
          ? undefined
          : classification.targetInstitutionId
            ? {
                field: "institutionId",
                value: classification.targetInstitutionId,
              }
            : classification.ensurePersonalFor
              ? {
                  field: "institutionId",
                  ensurePersonalFor: classification.ensurePersonalFor,
                }
              : undefined,
    };
  }
  if (table === "scenarios") {
    const classification = await classifyScenario(
      ctx,
      row as Doc<"scenarios">,
      now,
      allAssignments,
      assignmentScanTruncated,
    );
    return {
      outcome: classification.state,
      reason: classification.reason,
      writePlan:
        classification.state !== "ready" || row.institutionId !== undefined
          ? undefined
          : classification.targetInstitutionId
            ? {
                field: "institutionId",
                value: classification.targetInstitutionId,
              }
            : classification.ensurePersonalFor
              ? {
                  field: "institutionId",
                  ensurePersonalFor: classification.ensurePersonalFor,
                }
              : undefined,
    };
  }
  if (table === "sourceCases") {
    const classification = await classifySourceCase(
      ctx,
      row as Doc<"sourceCases">,
    );
    return {
      outcome: classification.state,
      reason: classification.reason,
      writePlan:
        classification.state === "ready" &&
        row.caseSessionId === undefined &&
        classification.targetCaseSessionId
          ? {
              field: "caseSessionId",
              value: classification.targetCaseSessionId,
            }
          : undefined,
    };
  }
  if (table === "integrationEvents") {
    return classifyIntegrationEvent(ctx, row as Doc<"integrationEvents">, now);
  }
  if (table === "auditLog") {
    return classifyAuditLog(ctx, row as Doc<"auditLog">, now);
  }
  return classifyDescendant(
    ctx,
    table,
    row,
    now,
    allAssignments,
    assignmentScanTruncated,
  );
}

function storageReferenceFields(
  table: MigrationTable,
  row: MigrationRow,
): string[] {
  const fields: string[] = [];
  if (table === "documents" && row.storageId) fields.push("storageId");
  if (table === "scenarioDocumentAssets" && row.storageId)
    fields.push("storageId");
  if (table === "actorRunAudits" && row.rawOutputStorageId)
    fields.push("rawOutputStorageId");
  if (table === "simulationTurns") {
    if (row.rawActorPacketStorageId) fields.push("rawActorPacketStorageId");
    if (row.rawProviderResultStorageId)
      fields.push("rawProviderResultStorageId");
  }
  if (table === "actorPackets" && row.rawStorageId) fields.push("rawStorageId");
  if (table === "actorDecisions" && row.rawProviderResultStorageId)
    fields.push("rawProviderResultStorageId");
  return fields;
}

function parseCursor(table: MigrationTable, cursor: string | null | undefined) {
  if (cursor === undefined || cursor === null) return null;
  try {
    const decoded: unknown = JSON.parse(cursor);
    if (
      !decoded ||
      typeof decoded !== "object" ||
      (decoded as { table?: unknown }).table !== table ||
      typeof (decoded as { cursor?: unknown }).cursor !== "string"
    ) {
      throw new Error("cursor does not match inspection table");
    }
    return (decoded as { cursor: string }).cursor;
  } catch {
    throw validationError(
      "Cursor is invalid or belongs to another table",
      "cursor",
    );
  }
}

type BatchArgs = {
  table: string;
  cursor?: string | null;
  limit: number;
};
type BatchFinding = {
  id: string;
  tableName: string;
  recordId: string;
  outcome: "ready" | "ambiguous" | "warning";
  reason: string;
  storageField?: string;
  historicalConfidentiality?: "UNVERIFIED";
};
type ClassifiedBatchRow = {
  row: MigrationRow;
  classification: RowFinding;
  finding: BatchFinding;
  findingReserve: number;
};
type PreparedBatch = {
  table: MigrationTable;
  nextCursor: string | null;
  isDone: boolean;
  rows: ClassifiedBatchRow[];
  findings: BatchFinding[];
  work: InspectionContext;
};

function validateBatchArgs(args: BatchArgs): MigrationTable {
  if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw validationError("Limit must be an integer from 1 to 100", "limit");
  }
  if (!INSPECTABLE_TABLES.includes(args.table as MigrationTable)) {
    throw validationError("Table is outside the migration inventory", "table");
  }
  return args.table as MigrationTable;
}

/**
 * Both the read-only inspector and apply mutation use this one bounded
 * classifier. Apply reserves four units per row for its indexed finding
 * lookup and possible insert/patch; classification and all extra apply reads
 * and writes still share the same 900-unit transaction budget.
 */
async function prepareMigrationBatch(
  ctx: Pick<QueryCtx, "db">,
  args: BatchArgs,
  reserveFindingWrites: boolean,
): Promise<PreparedBatch> {
  const table = validateBatchArgs(args);
  const inspectionCtx = createInspectionContext(ctx);
  const cursor = parseCursor(table, args.cursor);
  const query = ctx.db.query(table) as unknown as {
    order: (direction: "asc") => {
      paginate: (options: {
        numItems: number;
        cursor: string | null;
      }) => Promise<{
        page: MigrationRow[];
        continueCursor: string;
        isDone: boolean;
      }>;
    };
  };
  chargeInspectionWork(inspectionCtx, args.limit + 1);
  const page = await query.order("asc").paginate({
    numItems: args.limit,
    cursor,
  });
  releaseInspectionWork(inspectionCtx, args.limit - page.page.length);

  const findingReserve = reserveFindingWrites ? 4 : 0;
  const rowFindingReserve = page.page.length * findingReserve;
  if (rowFindingReserve > inspectionCtx.work.remaining) {
    throw new Error("Migration batch could not reserve finding work");
  }
  inspectionCtx.work.remaining -= rowFindingReserve;

  const inspectsScenarioOwnership =
    table === "scenarios" ||
    table === "scenarioDocumentAssets" ||
    table === "scenarioIssues" ||
    table === "scenarioRecordExcerpts";
  const assignmentProbe = inspectsScenarioOwnership
    ? await readQueryRows(
        inspectionCtx,
        `assignments/inspection-prefix:${CLASSIFICATION_RELATION_PROBE_LIMIT}`,
        CLASSIFICATION_RELATION_PROBE_LIMIT,
        (limit) => ctx.db.query("assignments").take(limit),
      )
    : [];
  const assignmentScanTruncated =
    assignmentProbe.length > MAX_CLASSIFICATION_RELATION_ROWS;
  const allAssignments = assignmentScanTruncated ? [] : assignmentProbe;
  const now = Date.now();
  const findings: BatchFinding[] = [];
  const rows: ClassifiedBatchRow[] = [];
  for (const row of page.page) {
    const recordId = String(row._id);
    let classification: RowFinding;
    if (inspectionCtx.work.exhausted || inspectionCtx.work.remaining === 0) {
      inspectionCtx.work.exhausted = true;
      classification = {
        outcome: "ambiguous",
        reason: "inspection_work_budget_exhausted",
      };
    } else {
      try {
        classification = await classifyRow(
          inspectionCtx,
          table,
          row,
          now,
          allAssignments,
          assignmentScanTruncated,
        );
      } catch (error) {
        if (!(error instanceof InspectionWorkBudgetExceeded)) throw error;
        classification = {
          outcome: "ambiguous",
          reason: "inspection_work_budget_exhausted",
        };
      }
    }
    const finding: BatchFinding = {
      id: reportId(table, recordId, "classification"),
      tableName: table,
      recordId,
      outcome: classification.outcome,
      reason: classification.reason,
    };
    findings.push(finding);
    rows.push({
      row,
      classification,
      finding,
      findingReserve,
    });

    const storageFields =
      classification.reportStorage === false
        ? []
        : storageReferenceFields(table, row);
    for (const storageField of storageFields) {
      findings.push({
        id: reportId(
          table,
          recordId,
          `legacy_storage_url_unverified/${storageField}`,
        ),
        tableName: table,
        recordId,
        outcome: "warning",
        reason: "legacy_storage_object_may_have_had_a_bearer_url",
        storageField,
        historicalConfidentiality: LEGACY_STORAGE_CONFIDENTIALITY,
      });
    }
  }
  return {
    table,
    nextCursor: page.isDone
      ? null
      : JSON.stringify({ table, cursor: page.continueCursor }),
    isDone: page.isDone,
    rows,
    findings,
    work: inspectionCtx,
  };
}

function chargeReservedOrSharedWork(
  work: InspectionContext,
  reserve: { remaining: number },
  units: number,
) {
  const fromReserve = Math.min(reserve.remaining, units);
  reserve.remaining -= fromReserve;
  const fromShared = units - fromReserve;
  if (fromShared > work.work.remaining) {
    work.work.exhausted = true;
    throw new InspectionWorkBudgetExceeded();
  }
  work.work.remaining -= fromShared;
}

type PersonalWorkspaceResult =
  | { institutionId: Id<"institutions"> }
  | { reason: string };

async function ensurePersonalForMigration(
  ctx: MutationCtx,
  work: InspectionContext,
  userId: Id<"users">,
  now: number,
  ensured: Map<string, Id<"institutions">>,
): Promise<PersonalWorkspaceResult> {
  const cacheKey = String(userId);
  const cached = ensured.get(cacheKey);
  if (cached) return { institutionId: cached };

  const user = await readDocument(work, userId);
  if (!user) return { reason: "personal_owner_missing" };
  const personalOrganizations = await personalOrganizationEvidence(
    work,
    userId,
    now,
  );
  if (personalOrganizations.length > 1) {
    return { reason: "personal_organization_duplicate" };
  }
  const existing = personalOrganizations[0];
  if (existing) {
    if (
      existing.kind !== "personal" ||
      existing.personalOwnerUserId !== userId
    ) {
      return { reason: "personal_owner_conflict" };
    }
    if (!existing.ownerMembershipActive) {
      return { reason: "owner_membership_inactive" };
    }
    if (existing.ownerMembershipRole !== "admin") {
      return { reason: "personal_membership_requires_repair" };
    }
    const institutionId = existing.institutionId as Id<"institutions">;
    ensured.set(cacheKey, institutionId);
    return { institutionId };
  }

  const slug = `personal-${userId}`;
  const slugMatches = await readQueryRows(
    work,
    `institutions/by-slug:${slug}:2`,
    2,
    (limit) =>
      ctx.db
        .query("institutions")
        .withIndex("by_slug", (index) => index.eq("slug", slug))
        .take(limit),
  );
  if (slugMatches.length > 0) {
    return { reason: "personal_workspace_slug_conflict" };
  }

  const createdAt = new Date().toISOString();
  chargeInspectionWork(work, 1);
  const institutionId = await ctx.db.insert("institutions", {
    kind: "personal",
    personalOwnerUserId: userId,
    createdAt,
    name: "Personal workspace",
    slug,
    status: "active",
    monthlyAiBudgetCents: 0,
  });
  chargeInspectionWork(work, 1);
  await ctx.db.insert("institutionMemberships", {
    institutionId,
    userId,
    role: "admin",
    status: "active",
    createdAt,
  });
  ensured.set(cacheKey, institutionId);
  return { institutionId };
}

type WriteApplication = {
  outcome: "updated" | "unchanged" | "skipped";
  reason: string;
  field?: string;
  before?: string | null;
  after?: string | null;
};

async function applyWritePlan(
  ctx: MutationCtx,
  work: InspectionContext,
  row: MigrationRow,
  plan: MigrationWritePlan,
  now: number,
  ensuredPersonal: Map<string, Id<"institutions">>,
): Promise<WriteApplication> {
  chargeInspectionWork(work, 2);
  const current = await ctx.db.get(row._id);
  if (!current) {
    return {
      outcome: "skipped",
      reason: "conditional_write_record_missing",
      field: plan.field,
      before: null,
      after: null,
    };
  }
  const currentValue = (current as Record<string, unknown>)[plan.field];
  if (currentValue !== undefined) {
    const expectedValue =
      plan.field === "institutionId" && "value" in plan
        ? plan.value
        : plan.field === "kind"
          ? "shared"
          : undefined;
    if (expectedValue !== undefined && currentValue === expectedValue) {
      return {
        outcome: "unchanged",
        reason: "field_already_matches",
        field: plan.field,
        before: String(currentValue),
        after: String(currentValue),
      };
    }
    return {
      outcome: "skipped",
      reason: "conditional_write_conflict",
      field: plan.field,
      before: String(currentValue),
      after: null,
    };
  }

  let targetValue: string;
  if (plan.field === "kind") {
    targetValue = plan.value;
  } else if ("value" in plan) {
    targetValue = plan.value;
  } else {
    const personal = await ensurePersonalForMigration(
      ctx,
      work,
      plan.ensurePersonalFor,
      now,
      ensuredPersonal,
    );
    if (!("institutionId" in personal)) {
      return {
        outcome: "skipped",
        reason: personal.reason,
        field: plan.field,
        before: null,
        after: null,
      };
    }
    targetValue = personal.institutionId;
  }

  chargeInspectionWork(work, 1);
  if (plan.field === "kind") {
    await ctx.db.patch(row._id, { kind: "shared" });
  } else if (plan.field === "institutionId") {
    await ctx.db.patch(row._id, {
      institutionId: targetValue as Id<"institutions">,
    });
  } else {
    await ctx.db.patch(row._id, {
      caseSessionId: targetValue as Id<"caseSessions">,
    });
  }
  return {
    outcome: "updated",
    reason: "conditional_absent_field_write",
    field: plan.field,
    before: null,
    after: targetValue,
  };
}

async function persistClassificationFinding(
  ctx: MutationCtx,
  work: InspectionContext,
  row: ClassifiedBatchRow,
  reserve: { remaining: number },
  outcome: "ready" | "ambiguous",
  reason: string,
  now: string,
) {
  chargeReservedOrSharedWork(work, reserve, 3);
  const matches = await ctx.db
    .query("organizationMigrationFindings")
    .withIndex("by_key_record", (index) =>
      index
        .eq("migrationKey", ORGANIZATION_MIGRATION_KEY)
        .eq("tableName", row.finding.tableName)
        .eq("recordId", row.finding.recordId),
    )
    .take(2);
  reserve.remaining += 2 - matches.length;
  if (matches.length > 1) {
    throw new Error("Duplicate organization migration findings");
  }
  const existing = matches[0];
  if (outcome === "ambiguous") {
    if (!existing) {
      chargeReservedOrSharedWork(work, reserve, 1);
      await ctx.db.insert("organizationMigrationFindings", {
        migrationKey: ORGANIZATION_MIGRATION_KEY,
        tableName: row.finding.tableName,
        recordId: row.finding.recordId,
        reason,
        status: "open",
        createdAt: now,
      });
    } else if (existing.status !== "open" || existing.reason !== reason) {
      chargeReservedOrSharedWork(work, reserve, 1);
      await ctx.db.patch(existing._id, { reason, status: "open" });
    }
  } else if (existing?.status === "open") {
    chargeReservedOrSharedWork(work, reserve, 1);
    await ctx.db.patch(existing._id, { status: "resolved" });
  }
}

/**
 * Read-only internal inventory page. It never changes rows, calls storage APIs,
 * creates findings, or emits storage IDs/URLs. The `table` is table-bound in the
 * cursor to prevent a continuation from silently switching inventory roots.
 */
export const inspectBatch = internalQuery({
  args: {
    table: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: inspectionResultValidator,
  handler: async (ctx, args) => {
    const prepared = await prepareMigrationBatch(ctx, args, false);
    const ready = prepared.rows.filter(
      ({ classification }) => classification.outcome === "ready",
    ).length;
    return {
      nextCursor: prepared.nextCursor,
      isDone: prepared.isDone,
      scanned: prepared.rows.length,
      ready,
      ambiguous: prepared.rows.length - ready,
      findings: prepared.findings,
    };
  },
});

/**
 * Internal, resumable apply page. It calls the exact same bounded classifier
 * as inspectBatch, writes only absent fields, and persists one idempotent
 * finding per migration key/table/record transaction.
 */
export const applyBatch = internalMutation({
  args: {
    table: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: applyBatchResultValidator,
  handler: async (ctx, args) => {
    const prepared = await prepareMigrationBatch(ctx, args, true);
    const now = new Date().toISOString();
    const ensuredPersonal = new Map<string, Id<"institutions">>();
    const writes: Array<{
      tableName: string;
      recordId: string;
      outcome: "updated" | "unchanged" | "skipped";
      reason: string;
      field?: string;
      before?: string | null;
      after?: string | null;
    }> = [];
    let changed = 0;
    let skipped = 0;
    let ready = 0;
    let ambiguous = 0;

    for (const row of prepared.rows) {
      const reserve = { remaining: row.findingReserve };
      let outcome = row.classification.outcome;
      let reason = row.classification.reason;
      let write: WriteApplication = {
        outcome: outcome === "ready" ? "unchanged" : "skipped",
        reason,
      };

      if (outcome === "ready" && row.classification.writePlan) {
        write = await applyWritePlan(
          ctx,
          prepared.work,
          row.row,
          row.classification.writePlan,
          Date.now(),
          ensuredPersonal,
        );
        if (write.outcome === "skipped") {
          outcome = "ambiguous";
          reason = write.reason;
        } else if (write.outcome === "updated") {
          changed += 1;
        }
      }

      if (write.outcome !== "updated") skipped += 1;
      try {
        await persistClassificationFinding(
          ctx,
          prepared.work,
          row,
          reserve,
          outcome,
          reason,
          now,
        );
      } catch (error) {
        if (!(error instanceof InspectionWorkBudgetExceeded)) throw error;
        // A finding lookup/write is reserved for every row before classifying;
        // reaching this branch indicates a budget-accounting defect.
        throw new Error("Reserved migration finding budget was exhausted");
      }

      row.finding.outcome = outcome;
      row.finding.reason = reason;
      if (outcome === "ready") ready += 1;
      else ambiguous += 1;
      writes.push({
        tableName: prepared.table,
        recordId: String(row.row._id),
        outcome: write.outcome,
        reason,
        ...(write.field ? { field: write.field } : {}),
        ...(write.field ? { before: write.before ?? null } : {}),
        ...(write.field ? { after: write.after ?? null } : {}),
      });
    }

    return {
      nextCursor: prepared.nextCursor,
      isDone: prepared.isDone,
      scanned: prepared.rows.length,
      ready,
      ambiguous,
      changed,
      skipped,
      writes,
      findings: prepared.findings,
    };
  },
});
