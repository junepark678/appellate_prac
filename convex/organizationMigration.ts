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

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
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
type ClassificationState = "ready" | "ambiguous";

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

/** A source import is safe only when every recorded provenance key agrees. */
export function classifySourceProvenanceMatches(
  matches: ProvenanceMatchEvidence[],
): OwnershipClassification {
  const exact = matches.filter(
    (match) =>
      match.externalIdMatches &&
      match.sourceUrlMatches &&
      match.importTimestampMatches &&
      match.scenarioMatches &&
      match.docketNumberMatches,
  );
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

type MigrationRow = Doc<MigrationTable> & Record<string, unknown>;
type RowFinding = {
  outcome: "ready" | "ambiguous";
  reason: string;
  reportStorage?: boolean;
};

function reportId(table: MigrationTable, recordId: string, suffix: string) {
  return `${ORGANIZATION_MIGRATION_KEY}/${table}/${recordId}/${suffix}`;
}

async function personalOrganizationEvidence(
  ctx: QueryCtx,
  userId: Id<"users">,
  now: number,
): Promise<PersonalOrganizationEvidence[]> {
  const institutions = await ctx.db
    .query("institutions")
    .withIndex("by_personal_owner", (index) =>
      index.eq("personalOwnerUserId", userId),
    )
    .take(2);
  return await Promise.all(
    institutions.map(async (institution) => {
      const memberships = await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index.eq("institutionId", institution._id).eq("userId", userId),
        )
        .take(2);
      return {
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
      };
    }),
  );
}

async function assignmentEvidenceForSession(
  ctx: QueryCtx,
  sessionId: Id<"caseSessions">,
): Promise<AssignmentEvidence[]> {
  const assignmentSessions = await ctx.db
    .query("assignmentSessions")
    .withIndex("by_case", (index) => index.eq("caseSessionId", sessionId))
    .take(CLASSIFICATION_RELATION_PROBE_LIMIT);
  if (assignmentSessions.length > MAX_CLASSIFICATION_RELATION_ROWS) {
    return [
      {
        assignmentSessionUserId: "",
        state: "truncated",
      },
    ];
  }
  const evidence: AssignmentEvidence[] = [];
  for (const assignmentSession of assignmentSessions) {
    const assignment = await ctx.db.get(assignmentSession.assignmentId);
    if (!assignment) {
      evidence.push({
        assignmentSessionUserId: assignmentSession.userId,
        state: "missing_assignment",
      });
      continue;
    }
    const cohort = await ctx.db.get(assignment.cohortId);
    if (!cohort) {
      evidence.push({
        assignmentSessionUserId: assignmentSession.userId,
        state: "missing_cohort",
      });
      continue;
    }
    const institution = await ctx.db.get(cohort.institutionId);
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
}

async function classifyCaseSession(
  ctx: QueryCtx,
  session: Doc<"caseSessions">,
  now: number,
): Promise<OwnershipClassification> {
  const [owner, links, personalOrganizations] = await Promise.all([
    ctx.db.get(session.userId),
    assignmentEvidenceForSession(ctx, session._id),
    personalOrganizationEvidence(ctx, session.userId, now),
  ]);
  const existingInstitution = session.institutionId
    ? await ctx.db.get(session.institutionId)
    : null;
  return classifyCaseSessionOwnership({
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
}

async function activeMembership(
  ctx: QueryCtx,
  institutionId: Id<"institutions">,
  userId: Id<"users">,
  now: number,
) {
  const institution = await ctx.db.get(institutionId);
  const memberships = await ctx.db
    .query("institutionMemberships")
    .withIndex("by_institution_user", (index) =>
      index.eq("institutionId", institutionId).eq("userId", userId),
    )
    .take(2);
  return (
    memberships.length === 1 &&
    isOrganizationMembershipActive(institution, memberships[0] ?? null, now)
  );
}

async function classifyScenario(
  ctx: QueryCtx,
  scenario: Doc<"scenarios">,
  now: number,
  assignments: Doc<"assignments">[],
  assignmentScanTruncated: boolean,
): Promise<OwnershipClassification> {
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
    ? await ctx.db.get(scenario.ownerUserId)
    : null;
  if (!owner) return { state: "ambiguous", reason: "missing_owner" };
  if (assignmentScanTruncated) {
    return { state: "ambiguous", reason: "scenario_assignment_scan_truncated" };
  }
  const sessions = await ctx.db
    .query("caseSessions")
    .withIndex("by_scenario", (index) => index.eq("scenarioId", scenario._id))
    .take(CLASSIFICATION_RELATION_PROBE_LIMIT);
  if (sessions.length > MAX_CLASSIFICATION_RELATION_ROWS) {
    return { state: "ambiguous", reason: "scenario_session_scan_truncated" };
  }
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
    const cohort = await ctx.db.get(assignment.cohortId);
    const institution = cohort ? await ctx.db.get(cohort.institutionId) : null;
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
    ? await ctx.db.get(scenario.institutionId)
    : null;
  return classifyPrivateScenarioOwnership({
    visibility: scenario.visibility,
    ownerUserId: scenario.ownerUserId,
    ownerExists: owner !== null,
    institutionId: scenario.institutionId,
    existingInstitutionActive: existingInstitution?.status === "active",
    references,
    ownerMembershipActiveForInstitutionIds: ownerMembershipIds,
    personalOrganizations,
  });
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
  ctx: QueryCtx,
  sourceCase: Doc<"sourceCases">,
): Promise<OwnershipClassification> {
  if (sourceCase.caseSessionId) {
    const session = await ctx.db.get(sourceCase.caseSessionId);
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
  const sessions = await ctx.db
    .query("caseSessions")
    .withIndex("by_scenario", (index) =>
      index.eq("scenarioId", sourceCase.scenarioId),
    )
    .take(CLASSIFICATION_RELATION_PROBE_LIMIT);
  if (sessions.length > MAX_CLASSIFICATION_RELATION_ROWS) {
    return { state: "ambiguous", reason: "source_case_session_scan_truncated" };
  }
  const imports: Doc<"trialDocketImports">[] = [];
  for (const session of sessions) {
    const sessionImports = await ctx.db
      .query("trialDocketImports")
      .withIndex("by_case", (index) => index.eq("caseSessionId", session._id))
      .take(3);
    if (sessionImports.length > 2) {
      return { state: "ambiguous", reason: "source_import_scan_truncated" };
    }
    imports.push(...sessionImports);
  }
  for (const trialImport of imports) {
    const session = await ctx.db.get(trialImport.caseSessionId);
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
  return classifySourceProvenanceMatches(evidence);
}

async function classifyIntegrationEvent(
  ctx: QueryCtx,
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
  const session = await ctx.db.get(row.caseSessionId);
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
  return { outcome: classification.state, reason: classification.reason };
}

async function classifyAuditLog(
  ctx: QueryCtx,
  row: Doc<"auditLog">,
  now: number,
): Promise<RowFinding> {
  const scopes: string[] = [];
  let sessionScopeCount = 0;
  let missingParent = false;
  let sessionScopeUnresolved = false;
  if (row.institutionId) {
    const institution = await ctx.db.get(row.institutionId);
    if (!institution) missingParent = true;
    scopes.push(row.institutionId);
  }
  if (row.cohortId) {
    const cohort = await ctx.db.get(row.cohortId);
    if (!cohort) missingParent = true;
    else scopes.push(cohort.institutionId);
  }
  if (row.caseSessionId) {
    const session = await ctx.db.get(row.caseSessionId);
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
  return { outcome: classification.state, reason: classification.reason };
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
  ctx: QueryCtx,
  table: CaseSessionParentTable,
  id: unknown,
  caseSessionId: Id<"caseSessions">,
): Promise<CaseSessionParentLinkState> {
  if (typeof id !== "string") return "missing";
  const normalizedId = ctx.db.normalizeId(table, id);
  if (!normalizedId) return "missing";
  const parent = await ctx.db.get(normalizedId);
  if (!parent) return "missing";
  return parent.caseSessionId === caseSessionId ? "same_case" : "cross_case";
}

function parentLinkReason(prefix: string, state: CaseSessionParentLinkState) {
  return state === "missing"
    ? `${prefix}_parent_missing`
    : `${prefix}_cross_parent_conflict`;
}

async function userReferenceExists(ctx: QueryCtx, value: unknown) {
  if (typeof value !== "string") return false;
  const userId = ctx.db.normalizeId("users", value);
  return userId !== null && (await ctx.db.get(userId)) !== null;
}

async function classifyAssignmentSession(
  ctx: QueryCtx,
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
  const [assignment, session] = await Promise.all([
    ctx.db.get(row.assignmentId),
    ctx.db.get(row.caseSessionId),
  ]);
  const assignmentExists = assignment !== null;
  const sessionExists = session !== null;
  const cohort = assignment ? await ctx.db.get(assignment.cohortId) : null;
  const institution = cohort ? await ctx.db.get(cohort.institutionId) : null;
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
  ctx: QueryCtx,
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
    const session = await ctx.db.get(id as Id<"caseSessions">);
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
    const assignment = await ctx.db.get(id as Id<"assignments">);
    if (!assignment) {
      const classification = classifySimulationPolicyOwnership({
        parentExists: false,
      });
      return { outcome: classification.state, reason: classification.reason };
    }
    const cohort = await ctx.db.get(assignment.cohortId);
    if (!cohort) {
      const classification = classifySimulationPolicyOwnership({
        parentExists: false,
      });
      return { outcome: classification.state, reason: classification.reason };
    }
    const institution = await ctx.db.get(cohort.institutionId);
    const classification = classifySimulationPolicyOwnership({
      parentExists: institution !== null,
      institutionActive: institution?.status === "active",
    });
    return { outcome: classification.state, reason: classification.reason };
  }
  const cohort = await ctx.db.get(id as Id<"cohorts">);
  if (!cohort) {
    const classification = classifySimulationPolicyOwnership({
      parentExists: false,
    });
    return { outcome: classification.state, reason: classification.reason };
  }
  const institution = await ctx.db.get(cohort.institutionId);
  const classification = classifySimulationPolicyOwnership({
    parentExists: institution !== null,
    institutionActive: institution?.status === "active",
  });
  return { outcome: classification.state, reason: classification.reason };
}

async function classifyDescendant(
  ctx: QueryCtx,
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
    const scenario = await ctx.db.get(scenarioId);
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
      for (const issueId of (row.citedByIssueIds as string[]) ?? []) {
        const issues = await ctx.db
          .query("scenarioIssues")
          .withIndex("by_scenario_issue", (index) =>
            index.eq("scenarioId", scenario._id).eq("issueId", issueId),
          )
          .take(2);
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
    const session = await ctx.db.get(caseSessionId);
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
        const analysis = analysisId ? await ctx.db.get(analysisId) : null;
        if (analysis?.documentId !== row._id) {
          crossParentReason = "document_analysis_reverse_link_conflict";
        }
      }
    } else if (table === "documents") {
      const linkedAnalyses = await ctx.db
        .query("documentAnalyses")
        .withIndex("by_document", (index) =>
          index.eq("documentId", row._id as Id<"documents">),
        )
        .take(1);
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
        const document = documentId ? await ctx.db.get(documentId) : null;
        if (document?.analysisId !== row._id) {
          crossParentReason = "analysis_document_reverse_link_conflict";
        }
      }
    } else if (table === "documentAnalyses") {
      const caseDocuments = await ctx.db
        .query("documents")
        .withIndex("by_case", (index) =>
          index.eq("caseSessionId", caseSessionId),
        )
        .take(CLASSIFICATION_RELATION_PROBE_LIMIT);
      if (caseDocuments.some((document) => document.analysisId === row._id)) {
        crossParentReason = "analysis_document_reverse_link_conflict";
      } else if (caseDocuments.length > MAX_CLASSIFICATION_RELATION_ROWS) {
        crossParentReason = "analysis_document_reverse_scan_truncated";
      }
    }
    if (table === "actorWorkProducts") {
      for (const id of (row.sourceDocumentAnalysisIds as string[]) ?? []) {
        crossParentReason = await sameCaseReason(
          "documentAnalyses",
          id,
          "work_product_source_analysis",
        );
        if (crossParentReason) break;
      }
      if (crossParentReason === undefined) {
        for (const id of (row.sourceFilingIds as string[]) ?? []) {
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
      const documentIds = (row.documentIds as string[]) ?? [];
      const analysisIds =
        (row.documentAnalysisIds as string[] | undefined) ?? [];
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
  ctx: QueryCtx,
  table: MigrationTable,
  row: MigrationRow,
  now: number,
  allAssignments: Doc<"assignments">[],
  assignmentScanTruncated: boolean,
): Promise<RowFinding> {
  if (table === "institutions") {
    const institution = row as Doc<"institutions">;
    const classification = classifyInstitutionKind(institution);
    return { outcome: classification.state, reason: classification.reason };
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
    return { outcome: classification.state, reason: classification.reason };
  }
  if (table === "scenarios") {
    const classification = await classifyScenario(
      ctx,
      row as Doc<"scenarios">,
      now,
      allAssignments,
      assignmentScanTruncated,
    );
    return { outcome: classification.state, reason: classification.reason };
  }
  if (table === "sourceCases") {
    const classification = await classifySourceCase(
      ctx,
      row as Doc<"sourceCases">,
    );
    return { outcome: classification.state, reason: classification.reason };
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
    if (
      !Number.isSafeInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > 100
    ) {
      throw validationError("Limit must be an integer from 1 to 100", "limit");
    }
    if (!INSPECTABLE_TABLES.includes(args.table as MigrationTable)) {
      throw validationError(
        "Table is outside the migration inventory",
        "table",
      );
    }
    const table = args.table as MigrationTable;
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
    const page = await query.order("asc").paginate({
      numItems: args.limit,
      cursor,
    });
    const inspectsScenarioOwnership =
      table === "scenarios" ||
      table === "scenarioDocumentAssets" ||
      table === "scenarioIssues" ||
      table === "scenarioRecordExcerpts";
    const assignmentProbe = inspectsScenarioOwnership
      ? await ctx.db
          .query("assignments")
          .take(CLASSIFICATION_RELATION_PROBE_LIMIT)
      : [];
    const assignmentScanTruncated =
      assignmentProbe.length > MAX_CLASSIFICATION_RELATION_ROWS;
    const allAssignments = assignmentScanTruncated ? [] : assignmentProbe;
    const now = Date.now();
    const findings: Array<{
      id: string;
      tableName: string;
      recordId: string;
      outcome: "ready" | "ambiguous" | "warning";
      reason: string;
      storageField?: string;
      historicalConfidentiality?: "UNVERIFIED";
    }> = [];
    let ready = 0;
    let ambiguous = 0;
    for (const row of page.page) {
      const recordId = String(row._id);
      const classification = await classifyRow(
        ctx,
        table,
        row,
        now,
        allAssignments,
        assignmentScanTruncated,
      );
      const base: (typeof findings)[number] = {
        id: reportId(table, recordId, "classification"),
        tableName: table,
        recordId,
        outcome: classification.outcome,
        reason: classification.reason,
      };
      findings.push(base);
      if (classification.outcome === "ready") ready += 1;
      else ambiguous += 1;

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
      nextCursor: page.isDone
        ? null
        : JSON.stringify({ table, cursor: page.continueCursor }),
      isDone: page.isDone,
      scanned: page.page.length,
      ready,
      ambiguous,
      findings,
    };
  },
});
