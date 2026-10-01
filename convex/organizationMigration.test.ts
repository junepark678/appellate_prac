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

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { TestConvex } from "convex-test";
import {
  classifyAssignmentSessionOwnership,
  classifyAuditLogOwnership,
  classifyCaseSessionOwnership,
  classifyDescendantParentChain,
  classifyInstitutionKind,
  classifyIntegrationEventOwnership,
  classifyLegacyUser,
  classifyPrivateScenarioOwnership,
  classifySimulationPolicyOwnership,
  classifySourceProvenanceMatches,
  EXCLUDED_SHARED_TABLES,
  LEGACY_STORAGE_CONFIDENTIALITY,
  ORGANIZATION_MIGRATION_KEY,
  ORGANIZATION_MIGRATION_STEPS,
  PRESERVED_IDENTITY_TABLES,
  PRESERVED_ORGANIZATION_TABLES,
} from "./organizationMigration";
import { isOrganizationMembershipActive } from "./organizationContracts";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./organizationMigration.ts": () => import("./organizationMigration"),
};

type Finding = {
  id: string;
  tableName: string;
  recordId: string;
  outcome: "ready" | "ambiguous" | "warning";
  reason: string;
  storageField?: string;
  historicalConfidentiality?: "UNVERIFIED";
};
type InspectionResult = {
  nextCursor: string | null;
  isDone: boolean;
  scanned: number;
  ready: number;
  ambiguous: number;
  findings: Finding[];
};
const inspectRef = makeFunctionReference<
  "query",
  { table: string; cursor?: string | null; limit: number },
  InspectionResult
>("organizationMigration:inspectBatch");

async function seedLegacyDocument(
  t: TestConvex<typeof schema>,
  authSubject = "test|legacy-owner",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authSubject,
      displayName: "Legacy owner",
      role: "admin",
      monthlyAiBudgetCents: 17,
    });
    const scenarioId = await ctx.db.insert("scenarios", {
      scenarioKey: "legacy-private",
      visibility: "private",
      title: "Private fixture",
      source: "synthetic",
      courtPackId: "ca4",
      shortCaption: "Fixture v. Fixture",
      lowerTribunal: "district court",
      natureOfSuit: "civil",
      proceduralPosture: "appeal",
      issuesPresented: [],
      meritsRecord: [],
      ownerUserId: userId,
      published: false,
    });
    const caseSessionId = await ctx.db.insert("caseSessions", {
      scenarioId,
      userId,
      courtPackId: "ca4",
      status: "active",
      simulatedDate: "2026-09-30T00:00:00.000Z",
    });
    const storageId = await ctx.storage.store(new Blob(["fixture bytes"]));
    const documentId = await ctx.db.insert("documents", {
      caseSessionId,
      storageId,
      fileName: "fixture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 13,
      extractedSignals: [],
    });
    return { userId, scenarioId, caseSessionId, storageId, documentId };
  });
}

describe("organization migration inspection contract", () => {
  it("records the exact six ordered groups and every excluded or preserved table in fixtures", () => {
    expect(ORGANIZATION_MIGRATION_STEPS).toEqual([
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
    ]);
    expect(EXCLUDED_SHARED_TABLES).toEqual([
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
    ]);
    expect(PRESERVED_IDENTITY_TABLES).toEqual([
      "policyAcceptances",
      "userDisclaimers",
    ]);
    expect(PRESERVED_ORGANIZATION_TABLES).toEqual([
      "enrollmentInvites",
      "supportAccessGrants",
    ]);
  });

  it("classifies case ownership without guessing across all contract cases", () => {
    const base = {
      userId: "user-1",
      ownerExists: true,
      personalOrganizations: [],
    };
    expect(
      classifyCaseSessionOwnership({ ...base, assignmentLinks: [] }),
    ).toEqual({
      state: "ready",
      reason: "ensure_personal_for_stored_owner",
    });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        assignmentLinks: [
          {
            assignmentSessionUserId: "user-1",
            state: "ready",
            institutionId: "org-1",
            institutionActive: true,
          },
        ],
      }),
    ).toMatchObject({
      state: "ready",
      reason: "assignment_scope_is_unambiguous",
    });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        assignmentLinks: [
          {
            assignmentSessionUserId: "user-1",
            state: "ready",
            institutionId: "org-1",
            institutionActive: true,
          },
          {
            assignmentSessionUserId: "user-1",
            state: "ready",
            institutionId: "org-2",
            institutionActive: true,
          },
        ],
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "multiple_or_missing_organizations",
    });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        assignmentLinks: [
          { assignmentSessionUserId: "user-1", state: "missing_cohort" },
        ],
      }),
    ).toEqual({ state: "ambiguous", reason: "assignment_parent_missing" });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        assignmentLinks: [
          {
            assignmentSessionUserId: "user-2",
            state: "ready",
            institutionId: "org-1",
            institutionActive: true,
          },
        ],
      }),
    ).toEqual({ state: "ambiguous", reason: "assignment_owner_mismatch" });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        institutionId: "org-old",
        existingInstitution: {
          kind: "shared",
          status: "active",
        },
        assignmentLinks: [],
        personalOrganizations: [],
      }),
    ).toEqual({ state: "ambiguous", reason: "existing_scope_conflict" });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        institutionId: "org-bound",
        existingInstitution: { kind: "shared", status: "active" },
        assignmentLinks: [],
        personalOrganizations: [],
      }),
    ).toEqual({ state: "ambiguous", reason: "existing_scope_conflict" });
    expect(
      classifyCaseSessionOwnership({
        ...base,
        assignmentLinks: [],
        personalOrganizations: [
          {
            institutionId: "personal-1",
            kind: "personal",
            personalOwnerUserId: "user-1",
            status: "active",
            ownerMembershipActive: false,
          },
        ],
      }),
    ).toEqual({ state: "ambiguous", reason: "owner_membership_inactive" });
  });

  it("classifies each other inventory rule through pure shared helpers", () => {
    expect(classifyInstitutionKind({})).toEqual({
      state: "ready",
      reason: "missing_kind_defaults_shared",
    });
    expect(classifyInstitutionKind({ kind: "shared" })).toEqual({
      state: "ready",
      reason: "organization_kind_recorded",
    });
    expect(classifyInstitutionKind({ personalOwnerUserId: "user-1" })).toEqual({
      state: "ambiguous",
      reason: "missing_kind_conflicts_with_personal_owner",
    });
    expect(classifyInstitutionKind({ kind: "personal" })).toEqual({
      state: "ambiguous",
      reason: "personal_organization_owner_missing",
    });
    expect(
      classifyInstitutionKind({
        kind: "shared",
        personalOwnerUserId: "user-1",
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "shared_kind_conflicts_with_personal_owner",
    });
    expect(classifyLegacyUser()).toEqual({
      state: "ready",
      reason: "identity_profile_budget_and_legacy_role_preserved",
    });

    expect(
      classifyIntegrationEventOwnership({
        hasSession: false,
        sessionInstitutionIds: [],
      }),
    ).toEqual({
      state: "ready",
      reason: "sessionless_event_remains_identity_private",
    });
    expect(
      classifyIntegrationEventOwnership({
        hasSession: false,
        sessionInstitutionIds: [],
        existingInstitutionId: "org-1",
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "sessionless_event_has_organization_scope",
    });
    expect(
      classifyIntegrationEventOwnership({
        hasSession: true,
        sessionScopeState: "ready",
        sessionInstitutionIds: ["org-1", "org-2"],
      }),
    ).toEqual({ state: "ambiguous", reason: "event_session_scope_unresolved" });
    expect(
      classifyAuditLogOwnership({
        missingParent: false,
        sessionScopeUnresolved: false,
        institutionIds: [],
      }),
    ).toEqual({ state: "ready", reason: "platform_audit_remains_private" });
    expect(
      classifyAuditLogOwnership({
        missingParent: false,
        sessionScopeUnresolved: false,
        institutionIds: ["org-1", "org-2"],
      }),
    ).toEqual({ state: "ambiguous", reason: "audit_scope_conflict" });

    expect(
      classifyAssignmentSessionOwnership({
        assignmentExists: true,
        sessionExists: true,
        cohortExists: true,
        institutionActive: true,
        ownerMatches: true,
        scenarioMatches: true,
        existingScopeMatches: true,
        caseSessionScopeReady: true,
      }),
    ).toEqual({ state: "ready", reason: "assignment_session_parents_agree" });
    expect(
      classifyAssignmentSessionOwnership({
        assignmentExists: true,
        sessionExists: true,
        cohortExists: true,
        institutionActive: true,
        ownerMatches: false,
        scenarioMatches: true,
        existingScopeMatches: true,
        caseSessionScopeReady: true,
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "assignment_session_cross_parent_conflict",
    });
    expect(classifySimulationPolicyOwnership({ parentExists: false })).toEqual({
      state: "ambiguous",
      reason: "policy_scope_parent_missing",
    });
    expect(
      classifySimulationPolicyOwnership({
        parentExists: true,
        caseSessionScopeReady: false,
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "policy_session_scope_unresolved",
    });
    expect(
      classifySimulationPolicyOwnership({
        parentExists: true,
        institutionActive: true,
      }),
    ).toEqual({ state: "ready", reason: "policy_scope_resolves" });
    expect(
      classifyDescendantParentChain({
        parentExists: true,
        parentScopeReady: true,
        crossParentsAgree: false,
        crossParentReason: "turn_cross_parent_conflict",
      }),
    ).toEqual({ state: "ambiguous", reason: "turn_cross_parent_conflict" });
  });

  it("uses active finite unexpired membership for private-scenario ownership", () => {
    const personal = {
      institutionId: "personal-1",
      kind: "personal" as const,
      personalOwnerUserId: "user-1",
      status: "active" as const,
      ownerMembershipActive: true,
    };
    const oneOrganization = classifyPrivateScenarioOwnership({
      visibility: "private",
      ownerUserId: "user-1",
      ownerExists: true,
      references: [{ state: "ready", institutionId: "org-1" }],
      ownerMembershipActiveForInstitutionIds: new Set(["org-1"]),
      personalOrganizations: [],
    });
    expect(oneOrganization).toEqual({
      state: "ready",
      reason: "private_scenario_scope_is_unambiguous",
    });
    expect(
      classifyPrivateScenarioOwnership({
        visibility: "private",
        ownerUserId: "user-1",
        ownerExists: true,
        references: [{ state: "ready", institutionId: "org-1" }],
        ownerMembershipActiveForInstitutionIds: new Set(),
        personalOrganizations: [],
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "owner_membership_missing_or_inactive",
    });
    expect(
      classifyPrivateScenarioOwnership({
        visibility: "private",
        ownerUserId: "user-1",
        ownerExists: true,
        references: [
          { state: "ready", institutionId: "org-1" },
          { state: "ready", institutionId: "org-2" },
        ],
        ownerMembershipActiveForInstitutionIds: new Set(["org-1", "org-2"]),
        personalOrganizations: [],
      }),
    ).toEqual({
      state: "ambiguous",
      reason: "multiple_referencing_organizations",
    });
    expect(
      classifyPrivateScenarioOwnership({
        visibility: "private",
        ownerUserId: "user-1",
        ownerExists: true,
        references: [],
        ownerMembershipActiveForInstitutionIds: new Set(),
        personalOrganizations: [personal],
      }),
    ).toEqual({
      state: "ready",
      reason: "private_scenario_scope_is_unambiguous",
    });
    expect(
      classifyPrivateScenarioOwnership({
        visibility: "private",
        ownerUserId: "user-1",
        ownerExists: true,
        references: [],
        ownerMembershipActiveForInstitutionIds: new Set(),
        personalOrganizations: [],
      }),
    ).toEqual({ state: "ready", reason: "ensure_personal_for_scenario_owner" });
    expect(
      classifyPrivateScenarioOwnership({
        visibility: "private",
        ownerUserId: "user-1",
        ownerExists: true,
        institutionId: "org-other",
        existingInstitutionActive: true,
        references: [],
        ownerMembershipActiveForInstitutionIds: new Set(),
        personalOrganizations: [personal],
      }),
    ).toEqual({ state: "ambiguous", reason: "conflicting_existing_scope" });
    expect(
      classifyPrivateScenarioOwnership({
        visibility: "public_template",
        ownerExists: false,
        references: [],
        ownerMembershipActiveForInstitutionIds: new Set(),
        personalOrganizations: [],
      }),
    ).toEqual({ state: "ready", reason: "public_template_remains_catalog" });
  });

  it("requires one exact provenance match and marks legacy links unverified", () => {
    const evidence = {
      externalIdMatches: true,
      sourceUrlMatches: true,
      importTimestampMatches: true,
      scenarioMatches: true,
      docketNumberMatches: true,
    };
    expect(classifySourceProvenanceMatches([evidence])).toEqual({
      state: "ready",
      reason: "one_provenance_match",
    });
    expect(classifySourceProvenanceMatches([])).toEqual({
      state: "ambiguous",
      reason: "provenance_match_missing",
    });
    expect(classifySourceProvenanceMatches([evidence, evidence])).toEqual({
      state: "ambiguous",
      reason: "multiple_provenance_matches",
    });
    expect(LEGACY_STORAGE_CONFIDENTIALITY).toBe("UNVERIFIED");
    expect(ORGANIZATION_MIGRATION_KEY).toBe("org-boundary-v1");
    expect(
      isOrganizationMembershipActive(
        { status: "active" },
        { status: "active", expiresAt: "2020-01-01T00:00:00.000Z" },
        Date.parse("2026-09-30T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isOrganizationMembershipActive(
        { status: "active" },
        { status: "active", expiresAt: "2026-10-01T00:00:00+01:00" },
        Date.parse("2026-09-30T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("links a historic source only to one exact provenance-matched docket import", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        authSubject: "test|source-owner",
        displayName: "Source owner",
        role: "student",
        monthlyAiBudgetCents: 0,
      });
      const scenarioId = await ctx.db.insert("scenarios", {
        scenarioKey: "source-fixture",
        visibility: "private",
        title: "Source fixture",
        source: "synthetic",
        courtPackId: "ca4",
        shortCaption: "Source v. Fixture",
        lowerTribunal: "district court",
        natureOfSuit: "civil",
        proceduralPosture: "appeal",
        issuesPresented: [],
        meritsRecord: [],
        ownerUserId: userId,
        published: false,
      });
      const caseSessionId = await ctx.db.insert("caseSessions", {
        scenarioId,
        userId,
        courtPackId: "ca4",
        status: "active",
        simulatedDate: "2026-09-30T00:00:00.000Z",
      });
      const importedAt = "2026-09-30T00:00:00.000Z";
      const sourceUrl = "https://www.courtlistener.com/docket/123/";
      const provenanceJson = JSON.stringify({
        id: 456,
        docket_id: 123,
        docketNumber: "2:26-cv-123",
      });
      await ctx.db.insert("sourceCases", {
        scenarioId,
        sourceSystem: "courtlistener",
        externalId: "123",
        sourceUrl,
        importedAt,
        provenanceJson,
      });
      const trialImport = {
        caseSessionId,
        caption: "Source v. Fixture",
        court: "ca4",
        docketNumber: "2:26-cv-123",
        sourceUrl,
        entriesJson: "[]",
        importedAt,
      };
      await ctx.db.insert("trialDocketImports", trialImport);
      return { scenarioId, caseSessionId, trialImport };
    });

    const unique = await t.query(inspectRef, {
      table: "sourceCases",
      limit: 100,
    });
    expect(unique).toMatchObject({ ready: 1, ambiguous: 0 });
    await t.run((ctx) =>
      ctx.db.insert("trialDocketImports", fixture.trialImport),
    );
    const duplicate = await t.query(inspectRef, {
      table: "sourceCases",
      limit: 100,
    });
    expect(duplicate).toMatchObject({ ready: 0, ambiguous: 1 });
    expect(duplicate.findings[0]).toMatchObject({
      outcome: "ambiguous",
      reason: "multiple_provenance_matches",
    });
  });

  it("reports stable legacy-storage warnings and performs no database writes", async () => {
    const t = convexTest(schema, modules);
    const { documentId } = await seedLegacyDocument(t);
    const before = await t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      sessions: (await ctx.db.query("caseSessions").collect()).length,
      documents: (await ctx.db.query("documents").collect()).length,
      migrationFindings: (
        await ctx.db.query("organizationMigrationFindings").collect()
      ).length,
      blobs: (await ctx.db.system.query("_storage").collect()).length,
    }));

    const first = await t.query(inspectRef, { table: "documents", limit: 100 });
    const second = await t.query(inspectRef, {
      table: "documents",
      limit: 100,
    });
    const warning = first.findings.find(
      (finding) => finding.outcome === "warning",
    );
    expect(first).toMatchObject({
      scanned: 1,
      ready: 1,
      ambiguous: 0,
      isDone: true,
    });
    expect(warning).toMatchObject({
      id: `${ORGANIZATION_MIGRATION_KEY}/documents/${documentId}/legacy_storage_url_unverified/storageId`,
      tableName: "documents",
      recordId: String(documentId),
      reason: "legacy_storage_object_may_have_had_a_bearer_url",
      storageField: "storageId",
      historicalConfidentiality: "UNVERIFIED",
    });
    expect(second.findings.map(({ id }) => id)).toEqual(
      first.findings.map(({ id }) => id),
    );
    expect(
      first.findings.some(
        (finding) => "storageId" in finding || "url" in finding,
      ),
    ).toBe(false);

    const after = await t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      sessions: (await ctx.db.query("caseSessions").collect()).length,
      documents: (await ctx.db.query("documents").collect()).length,
      migrationFindings: (
        await ctx.db.query("organizationMigrationFindings").collect()
      ).length,
      blobs: (await ctx.db.system.query("_storage").collect()).length,
    }));
    expect(after).toEqual(before);
    expect(after.migrationFindings).toBe(0);
  });

  it("bounds scenario assignment probes and reports truncated ownership as ambiguous", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedLegacyDocument(t);
    await t.run(async (ctx) => {
      const at = "2026-09-30T00:00:00.000Z";
      const institutionId = await ctx.db.insert("institutions", {
        kind: "shared",
        name: "Bounded fixture organization",
        slug: "bounded-fixture-organization",
        status: "active",
        monthlyAiBudgetCents: 100,
      });
      const cohortId = await ctx.db.insert("cohorts", {
        institutionId,
        title: "Bounded fixture cohort",
        term: "2026",
        startsAt: at,
        endsAt: "2027-01-01T00:00:00.000Z",
        archived: false,
      });
      for (let index = 0; index <= 100; index += 1) {
        await ctx.db.insert("assignments", {
          cohortId,
          scenarioId: owner.scenarioId,
          title: `Bounded assignment ${index}`,
          published: true,
          createdByUserId: owner.userId,
          createdAt: at,
        });
      }
    });

    const scenarios = await t.query(inspectRef, {
      table: "scenarios",
      limit: 100,
    });
    expect(
      scenarios.findings.find(
        (finding) => finding.recordId === String(owner.scenarioId),
      ),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "scenario_assignment_scan_truncated",
    });
  });

  it("reports missing, cross-case, and conflicting descendant links", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedLegacyDocument(t);
    const foreignOwner = await seedLegacyDocument(t, "test|foreign-owner");
    const fixture = await t.run(async (ctx) => {
      const at = "2026-09-30T00:00:00.000Z";
      const foreignAnalysisId = await ctx.db.insert("documentAnalyses", {
        caseSessionId: foreignOwner.caseSessionId,
        documentId: foreignOwner.documentId,
        analyzerId: "fixture",
        fileSizeBytes: 13,
        mimeType: "application/pdf",
        searchableText: true,
        certificateOfServiceDetected: false,
        certificateOfComplianceDetected: false,
        sealedOrRedactionWarning: false,
        warnings: [],
        createdAt: at,
      });
      const foreignFilingId = await ctx.db.insert("filings", {
        caseSessionId: foreignOwner.caseSessionId,
        eventId: "foreign-event",
        participantRole: "appellant",
        title: "Foreign fixture filing",
        documentIds: [foreignOwner.documentId],
        certificateOfService: false,
        certificateOfCompliance: false,
        sealed: false,
        notes: "fixture",
        filedAt: at,
        outcome: "accepted",
        validationIssues: [],
      });

      const wrongCaseDocumentId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "wrong-case-analysis.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      await ctx.db.patch(wrongCaseDocumentId, {
        analysisId: foreignAnalysisId,
      });
      const missingAnalysisDocumentId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "missing-analysis.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      const deletedAnalysisId = await ctx.db.insert("documentAnalyses", {
        caseSessionId: owner.caseSessionId,
        documentId: missingAnalysisDocumentId,
        analyzerId: "fixture",
        fileSizeBytes: 1,
        mimeType: "application/pdf",
        searchableText: false,
        certificateOfServiceDetected: false,
        certificateOfComplianceDetected: false,
        sealedOrRedactionWarning: false,
        warnings: [],
        createdAt: at,
      });
      await ctx.db.delete(deletedAnalysisId);
      await ctx.db.patch(missingAnalysisDocumentId, {
        analysisId: deletedAnalysisId,
      });
      const reverseConflictDocumentId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "reverse-conflict.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      const otherDocumentId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "other-document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      const reverseConflictAnalysisId = await ctx.db.insert(
        "documentAnalyses",
        {
          caseSessionId: owner.caseSessionId,
          documentId: otherDocumentId,
          analyzerId: "fixture",
          fileSizeBytes: 1,
          mimeType: "application/pdf",
          searchableText: false,
          certificateOfServiceDetected: false,
          certificateOfComplianceDetected: false,
          sealedOrRedactionWarning: false,
          warnings: [],
          createdAt: at,
        },
      );
      await ctx.db.patch(reverseConflictDocumentId, {
        analysisId: reverseConflictAnalysisId,
      });
      const missingAnalysisBacklinkId = await ctx.db.insert(
        "documentAnalyses",
        {
          caseSessionId: owner.caseSessionId,
          analyzerId: "fixture",
          fileSizeBytes: 1,
          mimeType: "application/pdf",
          searchableText: false,
          certificateOfServiceDetected: false,
          certificateOfComplianceDetected: false,
          sealedOrRedactionWarning: false,
          warnings: [],
          createdAt: at,
        },
      );
      const missingAnalysisBacklinkDocumentId = await ctx.db.insert(
        "documents",
        {
          caseSessionId: owner.caseSessionId,
          fileName: "missing-analysis-backlink.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          extractedSignals: [],
        },
      );
      await ctx.db.patch(missingAnalysisBacklinkDocumentId, {
        analysisId: missingAnalysisBacklinkId,
      });
      const missingDocumentBacklinkId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "missing-document-backlink.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      const missingDocumentBacklinkAnalysisId = await ctx.db.insert(
        "documentAnalyses",
        {
          caseSessionId: owner.caseSessionId,
          documentId: missingDocumentBacklinkId,
          analyzerId: "fixture",
          fileSizeBytes: 1,
          mimeType: "application/pdf",
          searchableText: false,
          certificateOfServiceDetected: false,
          certificateOfComplianceDetected: false,
          sealedOrRedactionWarning: false,
          warnings: [],
          createdAt: at,
        },
      );
      const unlinkedDocumentId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "unlinked.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      const unlinkedAnalysisId = await ctx.db.insert("documentAnalyses", {
        caseSessionId: owner.caseSessionId,
        analyzerId: "fixture",
        fileSizeBytes: 1,
        mimeType: "application/pdf",
        searchableText: false,
        certificateOfServiceDetected: false,
        certificateOfComplianceDetected: false,
        sealedOrRedactionWarning: false,
        warnings: [],
        createdAt: at,
      });

      const missingDocumentId = await ctx.db.insert("documents", {
        caseSessionId: owner.caseSessionId,
        fileName: "deleted-parent.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedSignals: [],
      });
      await ctx.db.delete(missingDocumentId);
      const missingDocumentAnalysisId = await ctx.db.insert(
        "documentAnalyses",
        {
          caseSessionId: owner.caseSessionId,
          documentId: missingDocumentId,
          analyzerId: "fixture",
          fileSizeBytes: 1,
          mimeType: "application/pdf",
          searchableText: false,
          certificateOfServiceDetected: false,
          certificateOfComplianceDetected: false,
          sealedOrRedactionWarning: false,
          warnings: [],
          createdAt: at,
        },
      );
      const crossCaseDocumentAnalysisId = await ctx.db.insert(
        "documentAnalyses",
        {
          caseSessionId: owner.caseSessionId,
          documentId: foreignOwner.documentId,
          analyzerId: "fixture",
          fileSizeBytes: 13,
          mimeType: "application/pdf",
          searchableText: true,
          certificateOfServiceDetected: false,
          certificateOfComplianceDetected: false,
          sealedOrRedactionWarning: false,
          warnings: [],
          createdAt: at,
        },
      );

      const workProduct = async (
        sourceDocumentAnalysisIds: string[],
        sourceFilingIds: string[],
      ) =>
        await ctx.db.insert("actorWorkProducts", {
          caseSessionId: owner.caseSessionId,
          actorId: "fixture-actor",
          kind: "counterparty_strategy",
          status: "proposed",
          workProductJson: "{}",
          sourceDocumentAnalysisIds,
          sourceFilingIds,
          createdAt: at,
        });
      const missingAnalysisWorkProductId = await workProduct(
        ["missing-analysis-id"],
        [],
      );
      const crossCaseAnalysisWorkProductId = await workProduct(
        [String(foreignAnalysisId)],
        [],
      );
      const crossCaseFilingWorkProductId = await workProduct(
        [],
        [String(foreignFilingId)],
      );
      const missingFilingWorkProductId = await workProduct(
        [],
        ["missing-filing-id"],
      );
      await ctx.db.insert("scenarioIssues", {
        scenarioId: foreignOwner.scenarioId,
        issueId: "foreign-issue",
        label: "Foreign issue fixture",
        standardOfReview: "de novo",
        preservationFacts: [],
        recordSupportFacts: [],
        likelyArgumentsForAppellant: [],
        likelyArgumentsForAppellee: [],
        possibleRelief: [],
      });
      const crossScenarioExcerptId = await ctx.db.insert(
        "scenarioRecordExcerpts",
        {
          scenarioId: owner.scenarioId,
          excerptId: "cross-scenario-excerpt",
          label: "Cross-scenario citation fixture",
          source: "synthetic",
          text: "fixture",
          citedByIssueIds: ["foreign-issue"],
        },
      );
      const duplicateIssueId = "duplicate-issue";
      const duplicateIssueFields = {
        scenarioId: owner.scenarioId,
        issueId: duplicateIssueId,
        label: "Duplicate issue fixture",
        standardOfReview: "de novo",
        preservationFacts: [],
        recordSupportFacts: [],
        likelyArgumentsForAppellant: [],
        likelyArgumentsForAppellee: [],
        possibleRelief: [],
      };
      await ctx.db.insert("scenarioIssues", duplicateIssueFields);
      await ctx.db.insert("scenarioIssues", duplicateIssueFields);
      const duplicateIssueExcerptId = await ctx.db.insert(
        "scenarioRecordExcerpts",
        {
          scenarioId: owner.scenarioId,
          excerptId: "duplicate-issue-excerpt",
          label: "Duplicate issue link fixture",
          source: "synthetic",
          text: "fixture",
          citedByIssueIds: [duplicateIssueId],
        },
      );
      const staleActorUserId = await ctx.db.insert("users", {
        authSubject: "test|deleted-actor",
        displayName: "Deleted actor fixture",
        role: "student",
        monthlyAiBudgetCents: 10,
      });
      await ctx.db.delete(staleActorUserId);
      const danglingEventId = await ctx.db.insert("caseSessionEvents", {
        caseSessionId: owner.caseSessionId,
        sequence: 1,
        eventType: "fixture",
        payloadJson: "{}",
        createdAt: at,
        actorUserId: staleActorUserId,
      });
      const danglingAiRunId = await ctx.db.insert("aiRuns", {
        caseSessionId: owner.caseSessionId,
        userId: staleActorUserId,
        actorId: "fixture-actor",
        model: "fixture-model",
        provider: "fixture-provider",
        promptHash: "fixture-hash",
        toolCallJson: "{}",
        accepted: false,
        issues: [],
        costCents: 0,
        latencyMs: 0,
        createdMonth: "2026-09",
        createdAt: at,
      });
      const danglingPolicyId = await ctx.db.insert("simulationPolicies", {
        scope: "session",
        scopeId: String(owner.caseSessionId),
        autonomyMode: "supervised",
        maxTurnsPerRun: 1,
        maxCostCentsPerRun: 0,
        requireHumanApprovalFor: [],
        stopOnDeficiency: true,
        createdByUserId: staleActorUserId,
        createdAt: at,
        updatedAt: at,
      });

      const conflictUserId = await ctx.db.insert("users", {
        authSubject: "test|assignment-owner",
        displayName: "Assignment owner fixture",
        role: "student",
        monthlyAiBudgetCents: 10,
      });
      const conflictScenarioId = await ctx.db.insert("scenarios", {
        scenarioKey: "assignment-owner-conflict",
        visibility: "private",
        title: "Assignment owner fixture",
        source: "synthetic",
        courtPackId: "ca4",
        shortCaption: "Owner v. Conflict",
        lowerTribunal: "district court",
        natureOfSuit: "civil",
        proceduralPosture: "appeal",
        issuesPresented: [],
        meritsRecord: [],
        ownerUserId: conflictUserId,
        published: false,
      });
      const conflictSessionId = await ctx.db.insert("caseSessions", {
        scenarioId: conflictScenarioId,
        userId: conflictUserId,
        courtPackId: "ca4",
        status: "active",
        simulatedDate: at,
      });
      const institutionId = await ctx.db.insert("institutions", {
        kind: "shared",
        name: "Fixture organization",
        slug: "fixture-organization",
        status: "active",
        monthlyAiBudgetCents: 100,
      });
      const cohortId = await ctx.db.insert("cohorts", {
        institutionId,
        title: "Fixture cohort",
        term: "2026",
        startsAt: at,
        endsAt: "2027-01-01T00:00:00.000Z",
        archived: false,
      });
      const assignmentId = await ctx.db.insert("assignments", {
        cohortId,
        scenarioId: conflictScenarioId,
        title: "Fixture assignment",
        published: true,
        createdByUserId: conflictUserId,
        createdAt: at,
      });
      const ownerConflictAssignmentSessionId = await ctx.db.insert(
        "assignmentSessions",
        {
          assignmentId,
          caseSessionId: conflictSessionId,
          userId: foreignOwner.userId,
        },
      );
      const missingReviewerAssignmentSessionId = await ctx.db.insert(
        "assignmentSessions",
        {
          assignmentId,
          caseSessionId: conflictSessionId,
          userId: conflictUserId,
          reviewerUserId: staleActorUserId,
        },
      );
      const missingReopenerAssignmentSessionId = await ctx.db.insert(
        "assignmentSessions",
        {
          assignmentId,
          caseSessionId: conflictSessionId,
          userId: conflictUserId,
          reopenedAt: at,
          reopenedByUserId: staleActorUserId,
        },
      );
      return {
        missingDocumentAnalysisId,
        crossCaseDocumentAnalysisId,
        wrongCaseDocumentId,
        missingAnalysisDocumentId,
        reverseConflictDocumentId,
        missingAnalysisBacklinkId,
        missingAnalysisBacklinkDocumentId,
        missingDocumentBacklinkId,
        missingDocumentBacklinkAnalysisId,
        unlinkedDocumentId,
        unlinkedAnalysisId,
        missingAnalysisWorkProductId,
        crossCaseAnalysisWorkProductId,
        crossCaseFilingWorkProductId,
        missingFilingWorkProductId,
        crossScenarioExcerptId,
        duplicateIssueExcerptId,
        danglingEventId,
        danglingAiRunId,
        danglingPolicyId,
        ownerConflictAssignmentSessionId,
        missingReviewerAssignmentSessionId,
        missingReopenerAssignmentSessionId,
      };
    });

    const analyses = await t.query(inspectRef, {
      table: "documentAnalyses",
      limit: 100,
    });
    const documents = await t.query(inspectRef, {
      table: "documents",
      limit: 100,
    });
    const workProducts = await t.query(inspectRef, {
      table: "actorWorkProducts",
      limit: 100,
    });
    const excerpts = await t.query(inspectRef, {
      table: "scenarioRecordExcerpts",
      limit: 100,
    });
    const events = await t.query(inspectRef, {
      table: "caseSessionEvents",
      limit: 100,
    });
    const aiRuns = await t.query(inspectRef, { table: "aiRuns", limit: 100 });
    const policies = await t.query(inspectRef, {
      table: "simulationPolicies",
      limit: 100,
    });
    const assignmentSessions = await t.query(inspectRef, {
      table: "assignmentSessions",
      limit: 100,
    });
    const findingFor = (result: InspectionResult, id: string) =>
      result.findings.find((finding) => finding.recordId === id);

    expect(
      findingFor(analyses, String(fixture.missingDocumentAnalysisId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "analysis_document_parent_missing",
    });
    expect(
      findingFor(analyses, String(fixture.crossCaseDocumentAnalysisId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "analysis_document_cross_parent_conflict",
    });
    expect(
      findingFor(documents, String(fixture.wrongCaseDocumentId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "document_analysis_cross_parent_conflict",
    });
    expect(
      findingFor(documents, String(fixture.missingAnalysisDocumentId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "document_analysis_parent_missing",
    });
    expect(
      findingFor(documents, String(fixture.reverseConflictDocumentId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "document_analysis_reverse_link_conflict",
    });
    expect(
      findingFor(documents, String(fixture.missingAnalysisBacklinkDocumentId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "document_analysis_reverse_link_conflict",
    });
    expect(
      findingFor(analyses, String(fixture.missingAnalysisBacklinkId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "analysis_document_reverse_link_conflict",
    });
    expect(
      findingFor(analyses, String(fixture.missingDocumentBacklinkAnalysisId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "analysis_document_reverse_link_conflict",
    });
    expect(
      findingFor(documents, String(fixture.missingDocumentBacklinkId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "document_analysis_reverse_link_conflict",
    });
    expect(
      findingFor(documents, String(fixture.unlinkedDocumentId)),
    ).toMatchObject({
      outcome: "ready",
      reason: "case_session_parent_chain_resolves",
    });
    expect(
      findingFor(analyses, String(fixture.unlinkedAnalysisId)),
    ).toMatchObject({
      outcome: "ready",
      reason: "case_session_parent_chain_resolves",
    });
    expect(
      findingFor(workProducts, String(fixture.missingAnalysisWorkProductId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "work_product_source_analysis_parent_missing",
    });
    expect(
      findingFor(workProducts, String(fixture.crossCaseAnalysisWorkProductId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "work_product_source_analysis_cross_parent_conflict",
    });
    expect(
      findingFor(workProducts, String(fixture.crossCaseFilingWorkProductId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "work_product_source_filing_cross_parent_conflict",
    });
    expect(
      findingFor(workProducts, String(fixture.missingFilingWorkProductId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "work_product_source_filing_parent_missing",
    });
    expect(
      findingFor(excerpts, String(fixture.crossScenarioExcerptId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "scenario_excerpt_issue_missing_or_cross_scenario",
    });
    expect(
      findingFor(excerpts, String(fixture.duplicateIssueExcerptId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "scenario_excerpt_issue_ambiguous",
    });
    expect(findingFor(events, String(fixture.danglingEventId))).toMatchObject({
      outcome: "ambiguous",
      reason: "case_session_event_actor_missing",
    });
    expect(findingFor(aiRuns, String(fixture.danglingAiRunId))).toMatchObject({
      outcome: "ambiguous",
      reason: "ai_run_user_missing",
    });
    expect(
      findingFor(policies, String(fixture.danglingPolicyId)),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "simulation_policy_creator_missing",
    });
    expect(
      findingFor(
        assignmentSessions,
        String(fixture.ownerConflictAssignmentSessionId),
      ),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "assignment_session_cross_parent_conflict",
    });
    expect(
      findingFor(
        assignmentSessions,
        String(fixture.missingReviewerAssignmentSessionId),
      ),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "assignment_reviewer_missing",
    });
    expect(
      findingFor(
        assignmentSessions,
        String(fixture.missingReopenerAssignmentSessionId),
      ),
    ).toMatchObject({
      outcome: "ambiguous",
      reason: "assignment_reopener_missing",
    });
  });

  it("enforces limits, table-bound cursors, and the internal inventory boundary", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authSubject: "test|page-a",
        displayName: "Page A",
        role: "student",
        monthlyAiBudgetCents: 1,
      });
      await ctx.db.insert("users", {
        authSubject: "test|page-b",
        displayName: "Page B",
        role: "student",
        monthlyAiBudgetCents: 2,
      });
    });
    const first = await t.query(inspectRef, { table: "users", limit: 1 });
    expect(first).toMatchObject({
      scanned: 1,
      ready: 1,
      ambiguous: 0,
      isDone: false,
    });
    expect(first.nextCursor).toBeTruthy();
    const second = await t.query(inspectRef, {
      table: "users",
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second).toMatchObject({
      scanned: 1,
      ready: 1,
      ambiguous: 0,
      isDone: true,
    });
    await expect(
      t.query(inspectRef, { table: "users", limit: 0 }),
    ).rejects.toThrow();
    await expect(
      t.query(inspectRef, { table: "users", limit: 1.5 }),
    ).rejects.toThrow();
    await expect(
      t.query(inspectRef, { table: "users", limit: 101 }),
    ).rejects.toThrow();
    await expect(
      t.query(inspectRef, {
        table: "institutions",
        cursor: first.nextCursor,
        limit: 1,
      }),
    ).rejects.toThrow();
    await expect(
      t.query(inspectRef, { table: "rulePacks", limit: 1 }),
    ).rejects.toThrow();
  });
});
