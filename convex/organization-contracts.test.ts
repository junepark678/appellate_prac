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

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import schema from "./schema";
import * as contracts from "./organizationContracts";
import type {
  DatasetManifestDTO,
  OrganizationRecords,
} from "./organizationContracts";
import type { Id } from "./_generated/dataModel";

const now = "2026-09-30T12:00:00.000Z";
const sha = "a".repeat(64);
const org = "institution-fixture" as Id<"institutions">;
const user = "user-fixture" as Id<"users">;
const versionId = "version-fixture" as Id<"organizationDatasetVersions">;
const datasetId = "dataset-fixture" as Id<"organizationDatasets">;
const storageId = "storage-fixture" as Id<"_storage">;
const manifest = (institutionId = org): DatasetManifestDTO => ({
  schemaVersion: 1,
  publisher: { institutionId, label: "Publisher" },
  kind: "source_data",
  title: "Dataset",
  description: "Fixture",
  tags: ["test"],
  assets: [
    {
      fileName: "record.txt",
      mediaType: "text/plain",
      sizeBytes: 12,
      sha256: sha,
      provenance: {
        sourceUrl: "https://example.org/source",
        retrievedAt: now,
        licenseNote: "Fixture only",
      },
    },
  ],
  review: {
    status: "organization_reviewed",
    note: "Reviewed by organization only",
    reviewedAt: now,
  },
});
const draft = (): OrganizationRecords["organizationDatasetVersions"] => ({
  datasetId,
  institutionId: org,
  version: 1,
  createdByUserId: user,
  state: "draft",
  title: "Dataset",
  description: "Fixture",
  tags: ["test"],
  draftRevision: 0,
  manifestJson: contracts.canonicalizeManifest(manifest()),
  reviewStatus: "organization_reviewed",
  reviewedByUserId: user,
  reviewedAt: now,
  reviewNote: "Reviewed by organization only",
  createdAt: now,
});
const published = (): OrganizationRecords["organizationDatasetVersions"] => ({
  ...draft(),
  state: "published",
  manifestStorageId: storageId,
  contentHash: sha,
  publishedAt: now,
  publisherLabel: "Publisher",
});
const intent = (): OrganizationRecords["documentUploadIntents"] => ({
  institutionId: org,
  scopeKind: "session",
  caseSessionId: "session-fixture" as Id<"caseSessions">,
  userId: user,
  fileName: "record.txt",
  sizeBytes: 12,
  sha256: sha,
  mimeType: "text/plain",
  chunkCount: 1,
  state: "pending",
  expiresAt: now,
  createdAt: now,
});

// Registered test-only mutation: Convex excludes *.test.ts from API codegen.
// No provider, deployed backend, custom DB mock or production writes.
const seedFixture = mutation({
  args: {
    storageId: v.id("_storage"),
    importedManifestStorageId: v.id("_storage"),
    importedAssetStorageId: v.id("_storage"),
  },
  handler: async (
    ctx,
    { storageId, importedManifestStorageId, importedAssetStorageId },
  ) => {
    const userId = await ctx.db.insert("users", {
      authSubject: "fixture",
      displayName: "Fixture",
      role: "student",
      monthlyAiBudgetCents: 0,
    });
    const institutionId = await ctx.db.insert("institutions", {
      name: "Personal workspace",
      slug: "personal-fixture",
      status: "active",
      monthlyAiBudgetCents: 0,
      kind: "personal",
      personalOwnerUserId: userId,
      createdAt: now,
    });
    const legacyOrgId = await ctx.db.insert("institutions", {
      name: "Legacy shared",
      slug: "legacy",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const institutionMembershipId = await ctx.db.insert(
      "institutionMemberships",
      {
        institutionId,
        userId,
        role: "admin",
        status: "active",
        createdAt: now,
      },
    );
    const cohortId = await ctx.db.insert("cohorts", {
      institutionId,
      title: "Cohort",
      term: "2026",
      startsAt: now,
      endsAt: now,
      archived: false,
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId,
      userId,
      role: "learner",
    });
    const scenarioId = await ctx.db.insert("scenarios", {
      institutionId,
      scenarioKey: "fixture",
      visibility: "private",
      title: "Fixture",
      source: "synthetic",
      courtPackId: "fixture",
      shortCaption: "Fixture",
      lowerTribunal: "Fixture",
      natureOfSuit: "Fixture",
      proceduralPosture: "Fixture",
      issuesPresented: [],
      meritsRecord: [],
      published: false,
    });
    const caseSessionId = await ctx.db.insert("caseSessions", {
      institutionId,
      scenarioId,
      userId,
      courtPackId: "fixture",
      status: "active",
      simulatedDate: now,
    });
    await ctx.db.insert("sourceCases", {
      caseSessionId,
      scenarioId,
      sourceSystem: "manual",
      externalId: "fixture",
      sourceUrl: "https://example.org",
      importedAt: now,
      provenanceJson: "{}",
    });
    await ctx.db.insert("integrationEvents", {
      institutionId,
      userId,
      provider: "courtlistener",
      action: "fixture-only",
      accepted: false,
      createdAt: now,
    });
    const datasetId = await ctx.db.insert("organizationDatasets", {
      institutionId,
      createdByUserId: userId,
      title: "Dataset",
      description: "Fixture",
      kind: "source_data",
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = await contracts.hashManifest(manifest(institutionId));
    const version = {
      ...draft(),
      institutionId,
      datasetId,
      createdByUserId: userId,
      reviewedByUserId: userId,
      ...snapshot,
    };
    // contentHash belongs to a publication, so leave it absent on the draft.
    const { contentHash: _hash, ...draftRow } = version;
    const versionId = await ctx.db.insert(
      "organizationDatasetVersions",
      draftRow,
    );
    const assetId = await ctx.db.insert("organizationDatasetAssets", {
      versionId,
      institutionId,
      fileName: "record.txt",
      normalizedFileName: "record.txt",
      mediaType: "text/plain",
      sizeBytes: 12,
      sha256: sha,
      storageId,
    });
    await ctx.db.insert("publicCatalogEntries", {
      datasetId,
      versionId,
      publisherInstitutionId: institutionId,
      publisherLabel: "Publisher",
      title: "Dataset",
      description: "Fixture",
      kind: "source_data",
      tags: ["test"],
      searchText: "dataset fixture",
      reviewStatus: "organization_reviewed",
      publishedAt: now,
      contentHash: snapshot.contentHash,
    });
    const importId = await ctx.db.insert("organizationDatasetImports", {
      institutionId,
      importedByUserId: userId,
      upstreamDatasetId: datasetId,
      upstreamVersionId: versionId,
      upstreamContentHash: snapshot.contentHash,
      manifestStorageId: importedManifestStorageId,
      manifestJson: snapshot.manifestJson,
      importedAt: now,
    });
    await ctx.db.insert("organizationImportedAssets", {
      importId,
      institutionId,
      fileName: "record.txt",
      mediaType: "text/plain",
      sizeBytes: 12,
      sha256: sha,
      storageId: importedAssetStorageId,
    });
    const intentId = await ctx.db.insert("documentUploadIntents", {
      ...intent(),
      institutionId,
      userId,
      caseSessionId,
      state: "stored",
      storageId,
    });
    await ctx.db.insert("documentUploadChunks", {
      intentId,
      index: 0,
      storageId,
      sizeBytes: 12,
      sha256: sha,
    });
    await ctx.db.insert("organizationMigrationFindings", {
      migrationKey: "fixture",
      tableName: "scenarios",
      recordId: scenarioId,
      reason: "Fixture only",
      status: "open",
      createdAt: now,
    });
    const subscriptionId = await ctx.db.insert(
      "organizationCatalogSubscriptions",
      {
        institutionId,
        upstreamDatasetId: datasetId,
        mode: "manual",
        revision: 0,
        changedByUserId: userId,
        updatedAt: now,
        lastAttemptVersionId: versionId,
        lastAttemptRevision: 0,
        status: "succeeded",
        latestAcquiredImportId: importId,
        lastErrorCode: "CONFLICT",
      },
    );
    await ctx.db.insert("organizationCatalogUpdateEvents", {
      subscriptionId,
      institutionId,
      actorUserId: userId,
      subscriptionRevision: 0,
      event: "mode_changed",
      mode: "manual",
      createdAt: now,
      versionId,
      importId,
      reasonCode: "CONFLICT",
    });
    const documentId = await ctx.db.insert("documents", {
      caseSessionId,
      storageId,
      fileName: "record.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      extractedSignals: [],
    });
    const analysisId = await ctx.db.insert("documentAnalyses", {
      caseSessionId,
      documentId,
      analyzerId: "fixture",
      fileSizeBytes: 12,
      mimeType: "text/plain",
      searchableText: true,
      certificateOfServiceDetected: false,
      certificateOfComplianceDetected: false,
      sealedOrRedactionWarning: false,
      warnings: [],
      createdAt: now,
    });
    contracts.validateUploadIntent({
      ...intent(),
      institutionId,
      userId,
      caseSessionId,
      state: "consumed",
      storageId,
      documentId,
      analysisId,
    });
    const { caseSessionId: _session, ...datasetIntent } = intent();
    contracts.validateUploadIntent({
      ...datasetIntent,
      institutionId,
      userId,
      scopeKind: "dataset",
      datasetVersionId: versionId,
      state: "consumed",
      storageId,
      datasetAssetId: assetId,
    });
    const finalVersion = {
      ...draftRow,
      state: "published" as const,
      manifestStorageId: storageId,
      contentHash: snapshot.contentHash,
      publishedAt: now,
      publisherLabel: "Publisher",
    };
    contracts.validateVersionTransition(draftRow, finalVersion);
    await contracts.validateManifestSnapshot(
      snapshot.manifestJson,
      snapshot.contentHash,
      (table, value) =>
        ctx.db.normalizeId(table as "institutions", value) !== null,
    );
    await ctx.db.replace(versionId, finalVersion);
    return {
      institutionId,
      legacyOrgId,
      userId,
      institutionMembershipId,
      cohortId,
      caseSessionId,
      versionId,
      importId,
      storageId,
    };
  },
});
const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./fixture.ts": async () => ({ seedFixture }),
};
type FixtureIds = {
  institutionId: Id<"institutions">;
  legacyOrgId: Id<"institutions">;
  userId: Id<"users">;
  institutionMembershipId: Id<"institutionMemberships">;
  cohortId: Id<"cohorts">;
  caseSessionId: Id<"caseSessions">;
  versionId: Id<"organizationDatasetVersions">;
  importId: Id<"organizationDatasetImports">;
  storageId: Id<"_storage">;
};
const fixtureRef = makeFunctionReference<
  "mutation",
  {
    storageId: Id<"_storage">;
    importedManifestStorageId: Id<"_storage">;
    importedAssetStorageId: Id<"_storage">;
  },
  FixtureIds
>("fixture:seedFixture");
async function seed(t: TestConvex<typeof schema>) {
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  const importedManifestStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["manifest fixture"])),
  );
  const importedAssetStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  return t.mutation(fixtureRef, {
    storageId,
    importedManifestStorageId,
    importedAssetStorageId,
  });
}

// Test-only registered validator boundary; shared helpers run after Convex shape checks.
const acceptScope = mutation({
  args: { scope: contracts.uploadScopeValidator },
  returns: v.null(),
  handler: async () => null,
});
const scopeRef = makeFunctionReference<"mutation">("scope:acceptScope");

describe("additive schema and real registered fixture transactions", () => {
  it("keeps institution membership roles required and permits optional legacy roles", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.legacyOrgId))?.kind).toBeUndefined();
      expect((await ctx.db.get(ids.userId))?.role).toBe("student");
      expect(
        await ctx.db
          .query("institutions")
          .withIndex("by_personal_owner", (q) =>
            q.eq("personalOwnerUserId", ids.userId),
          )
          .unique(),
      ).toMatchObject({ _id: ids.institutionId });
      expect(
        await ctx.db
          .query("scenarios")
          .withIndex("by_institution", (q) =>
            q.eq("institutionId", ids.institutionId),
          )
          .collect(),
      ).toHaveLength(1);
      expect(
        await ctx.db
          .query("caseSessions")
          .withIndex("by_institution", (q) =>
            q.eq("institutionId", ids.institutionId),
          )
          .collect(),
      ).toHaveLength(1);
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationDatasets")
        .collect())
        contracts.validateOrganizationRecord("organizationDatasets", row);
      expect(
        await ctx.db
          .query("organizationDatasets")
          .withIndex("by_institution")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.organizationDatasets[" indexes"]()).toContainEqual({
        indexDescriptor: "by_institution",
        fields: ["institutionId"],
      });
      expect(
        await ctx.db
          .query("organizationDatasets")
          .withIndex("by_institution_kind")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.organizationDatasets[" indexes"]()).toContainEqual({
        indexDescriptor: "by_institution_kind",
        fields: ["institutionId", "kind"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationDatasetVersions")
        .collect())
        contracts.validateOrganizationRecord(
          "organizationDatasetVersions",
          row,
        );
      expect(
        await ctx.db
          .query("organizationDatasetVersions")
          .withIndex("by_dataset_version")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetVersions[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_dataset_version",
        fields: ["datasetId", "version"],
      });
      expect(
        await ctx.db
          .query("organizationDatasetVersions")
          .withIndex("by_dataset_state")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetVersions[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_dataset_state",
        fields: ["datasetId", "state"],
      });
      expect(
        await ctx.db
          .query("organizationDatasetVersions")
          .withIndex("by_institution")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetVersions[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_institution",
        fields: ["institutionId"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationDatasetAssets")
        .collect())
        contracts.validateOrganizationRecord("organizationDatasetAssets", row);
      expect(
        await ctx.db
          .query("organizationDatasetAssets")
          .withIndex("by_version")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetAssets[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_version",
        fields: ["versionId"],
      });
      expect(
        await ctx.db
          .query("organizationDatasetAssets")
          .withIndex("by_version_name")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetAssets[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_version_name",
        fields: ["versionId", "normalizedFileName"],
      });
      expect(
        await ctx.db
          .query("organizationDatasetAssets")
          .withIndex("by_storage")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetAssets[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_storage",
        fields: ["storageId"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("publicCatalogEntries")
        .collect())
        contracts.validateOrganizationRecord("publicCatalogEntries", row);
      expect(
        await ctx.db
          .query("publicCatalogEntries")
          .withIndex("by_dataset")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.publicCatalogEntries[" indexes"]()).toContainEqual({
        indexDescriptor: "by_dataset",
        fields: ["datasetId"],
      });
      expect(
        await ctx.db
          .query("publicCatalogEntries")
          .withIndex("by_published")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.publicCatalogEntries[" indexes"]()).toContainEqual({
        indexDescriptor: "by_published",
        fields: ["publishedAt"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationDatasetImports")
        .collect())
        contracts.validateOrganizationRecord("organizationDatasetImports", row);
      expect(
        await ctx.db
          .query("organizationDatasetImports")
          .withIndex("by_institution")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetImports[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_institution",
        fields: ["institutionId"],
      });
      expect(
        await ctx.db
          .query("organizationDatasetImports")
          .withIndex("by_institution_version")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationDatasetImports[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_institution_version",
        fields: ["institutionId", "upstreamVersionId"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationImportedAssets")
        .collect())
        contracts.validateOrganizationRecord("organizationImportedAssets", row);
      expect(
        await ctx.db
          .query("organizationImportedAssets")
          .withIndex("by_import")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationImportedAssets[" indexes"](),
      ).toContainEqual({ indexDescriptor: "by_import", fields: ["importId"] });
      expect(
        await ctx.db
          .query("organizationImportedAssets")
          .withIndex("by_import_name")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationImportedAssets[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_import_name",
        fields: ["importId", "fileName"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("documentUploadIntents")
        .collect())
        contracts.validateOrganizationRecord("documentUploadIntents", row);
      expect(
        await ctx.db
          .query("documentUploadIntents")
          .withIndex("by_user")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.documentUploadIntents[" indexes"]()).toContainEqual({
        indexDescriptor: "by_user",
        fields: ["userId"],
      });
      expect(
        await ctx.db
          .query("documentUploadIntents")
          .withIndex("by_case")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.documentUploadIntents[" indexes"]()).toContainEqual({
        indexDescriptor: "by_case",
        fields: ["caseSessionId"],
      });
      expect(
        await ctx.db
          .query("documentUploadIntents")
          .withIndex("by_dataset_version")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.documentUploadIntents[" indexes"]()).toContainEqual({
        indexDescriptor: "by_dataset_version",
        fields: ["datasetVersionId"],
      });
      expect(
        await ctx.db
          .query("documentUploadIntents")
          .withIndex("by_expiry")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.documentUploadIntents[" indexes"]()).toContainEqual({
        indexDescriptor: "by_expiry",
        fields: ["expiresAt"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("documentUploadChunks")
        .collect())
        contracts.validateOrganizationRecord("documentUploadChunks", row);
      expect(
        await ctx.db
          .query("documentUploadChunks")
          .withIndex("by_intent_index")
          .collect(),
      ).toHaveLength(1);
      expect(schema.tables.documentUploadChunks[" indexes"]()).toContainEqual({
        indexDescriptor: "by_intent_index",
        fields: ["intentId", "index"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationMigrationFindings")
        .collect())
        contracts.validateOrganizationRecord(
          "organizationMigrationFindings",
          row,
        );
      expect(
        await ctx.db
          .query("organizationMigrationFindings")
          .withIndex("by_key_record")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationMigrationFindings[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_key_record",
        fields: ["migrationKey", "tableName", "recordId"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationCatalogSubscriptions")
        .collect())
        contracts.validateOrganizationRecord(
          "organizationCatalogSubscriptions",
          row,
        );
      expect(
        await ctx.db
          .query("organizationCatalogSubscriptions")
          .withIndex("by_org_dataset")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationCatalogSubscriptions[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_org_dataset",
        fields: ["institutionId", "upstreamDatasetId"],
      });
      expect(
        await ctx.db
          .query("organizationCatalogSubscriptions")
          .withIndex("by_dataset_mode")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationCatalogSubscriptions[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_dataset_mode",
        fields: ["upstreamDatasetId", "mode"],
      });
      for (const { _id, _creationTime, ...row } of await ctx.db
        .query("organizationCatalogUpdateEvents")
        .collect())
        contracts.validateOrganizationRecord(
          "organizationCatalogUpdateEvents",
          row,
        );
      expect(
        await ctx.db
          .query("organizationCatalogUpdateEvents")
          .withIndex("by_subscription")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationCatalogUpdateEvents[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_subscription",
        fields: ["subscriptionId"],
      });
      expect(
        await ctx.db
          .query("organizationCatalogUpdateEvents")
          .withIndex("by_institution")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationCatalogUpdateEvents[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_institution",
        fields: ["institutionId"],
      });
      expect(
        await ctx.db
          .query("organizationCatalogUpdateEvents")
          .withIndex("by_attempt_event")
          .collect(),
      ).toHaveLength(1);
      expect(
        schema.tables.organizationCatalogUpdateEvents[" indexes"](),
      ).toContainEqual({
        indexDescriptor: "by_attempt_event",
        fields: [
          "subscriptionId",
          "subscriptionRevision",
          "versionId",
          "event",
        ],
      });
      expect(
        await ctx.db
          .query("publicCatalogEntries")
          .withSearchIndex("by_search", (q) =>
            q.search("searchText", "dataset").eq("kind", "source_data"),
          )
          .collect(),
      ).toHaveLength(1);
    });
    await expect(
      t.run((ctx) => ctx.db.patch(ids.userId, { role: undefined })),
    ).resolves.toBeNull();
    await expect(
      t.run((ctx) =>
        ctx.db.patch(ids.institutionMembershipId, { role: undefined }),
      ),
    ).rejects.toThrow();
    await expect(
      t.run(async (ctx) => {
        const row = await ctx.db.query("cohortMemberships").first();
        if (row) await ctx.db.patch(row._id, { role: undefined });
      }),
    ).resolves.toBeNull();
    await expect(
      t.run((ctx) =>
        ctx.db.patch(ids.versionId, {
          datasetId: ids.userId as unknown as Id<"organizationDatasets">,
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects wrong table IDs and wrong upload parent fields at the Convex boundary", async () => {
    const t = convexTest(schema, {
      ...modules,
      "./scope.ts": async () => ({ acceptScope }),
    });
    const ids = await seed(t);
    await expect(
      t.mutation(scopeRef, {
        scope: { kind: "session", caseSessionId: ids.caseSessionId },
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(scopeRef, {
        scope: { kind: "dataset", versionId: ids.versionId },
      }),
    ).resolves.toBeNull();
    for (const scope of [
      { kind: "session", caseSessionId: ids.versionId },
      { kind: "dataset", versionId: ids.caseSessionId },
      { kind: "dataset", datasetVersionId: ids.versionId },
      {
        kind: "session",
        caseSessionId: ids.caseSessionId,
        versionId: ids.versionId,
      },
      { kind: "session" },
    ])
      await expect(t.mutation(scopeRef, { scope })).rejects.toThrow();
  });
});

describe("strict canonical manifests", () => {
  it("sorts keys recursively and assets lexically; hashing uses canonical UTF-8 bytes", async () => {
    const value = manifest();
    const asset = value.assets[0];
    value.assets = [
      { ...asset, fileName: "z.txt" },
      { ...asset, fileName: "A.txt" },
    ];
    const first = await contracts.hashManifest(value);
    const reversed = Object.fromEntries(Object.entries(value).reverse());
    expect(
      await contracts.hashManifest({
        ...reversed,
        assets: [...value.assets].reverse(),
      }),
    ).toEqual(first);
    const { createHash } = await import("node:crypto");
    expect(first.contentHash).toBe(
      createHash("sha256").update(first.manifestJson, "utf8").digest("hex"),
    );
    expect(
      first.manifestJson.startsWith(
        '{"assets":[{"fileName":"A.txt","mediaType":',
      ),
    ).toBe(true);
    expect(value.assets[0].fileName).toBe("z.txt");
    await expect(
      contracts.validateManifestSnapshot(first.manifestJson, first.contentHash),
    ).resolves.toEqual(JSON.parse(first.manifestJson));
    await expect(
      contracts.validateManifestSnapshot(
        first.manifestJson + " ",
        first.contentHash,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      contracts.validateManifestSnapshot(first.manifestJson, "b".repeat(64)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["root", "publisher", "asset", "provenance", "review"])(
    "rejects unknown keys at %s",
    (level) => {
      const value = manifest();
      const target =
        level === "root"
          ? value
          : level === "publisher"
            ? value.publisher
            : level === "asset"
              ? value.assets[0]
              : level === "provenance"
                ? value.assets[0].provenance
                : value.review;
      Object.assign(target, { storageId: "private" });
      expect(() => contracts.canonicalizeManifest(value)).toThrow();
    },
  );
  it("rejects malformed shapes, duplicate names, unsafe sizes, URLs and hashes", () => {
    for (const value of [
      null,
      {},
      { ...manifest(), schemaVersion: 2 },
      { ...manifest(), tags: [2] },
      { ...manifest(), publisher: { institutionId: 7, label: "Publisher" } },
    ])
      expect(() => contracts.canonicalizeManifest(value)).toThrow();
    for (const patch of [
      { sizeBytes: -1 },
      { sizeBytes: NaN },
      { sizeBytes: Infinity },
      { sizeBytes: 1.5 },
      { sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
      { sha256: "bad" },
      { provenance: { sourceUrl: "http://example.org" } },
      { provenance: { retrievedAt: "2026-02-30T00:00:00Z" } },
    ])
      expect(() =>
        contracts.canonicalizeManifest({
          ...manifest(),
          assets: [{ ...manifest().assets[0], ...patch }],
        }),
      ).toThrow();
    expect(() =>
      contracts.canonicalizeManifest({
        ...manifest(),
        assets: [
          manifest().assets[0],
          { ...manifest().assets[0], fileName: "RECORD.TXT" },
        ],
      }),
    ).toThrow();
    expect(() => contracts.parseManifest("{broken")).toThrow();
    expect(() =>
      contracts.canonicalizeManifest(manifest(), () => false),
    ).toThrow();
  });
  it("enforces the exact 262144-byte canonical UTF-8 boundary", () => {
    const value = { ...manifest(), description: "" };
    const overhead = new TextEncoder().encode(
      contracts.canonicalizeManifest(value),
    ).length;
    value.description = "x".repeat(262144 - overhead);
    expect(
      new TextEncoder().encode(contracts.canonicalizeManifest(value)),
    ).toHaveLength(262144);
    expect(() =>
      contracts.canonicalizeManifest({
        ...value,
        description: value.description + "x",
      }),
    ).toThrow();
    expect(() =>
      contracts.canonicalizeManifest({
        ...value,
        description: "é".repeat(value.description.length),
      }),
    ).toThrow();
  });
});

describe("semantic validation and compatibility", () => {
  it.each([
    "2026-02-30T00:00:00Z",
    "2026-09-30",
    "2026-09-30T00:00:00",
    "2026-09-30T01:00:00+01:00",
    "2026-09-30T24:00:00Z",
    "2026-09-30T00:00:60Z",
    "invalid",
  ])("rejects invalid or non-UTC timestamp %s", (value) => {
    expect(contracts.isUtcTimestamp(value)).toBe(false);
    expect(() =>
      contracts.validateContract(contracts.catalogUpdateEventDTOValidator, {
        event: "mode_changed",
        mode: "manual",
        createdAt: value,
        actorDisplayName: "Fixture",
      }),
    ).toThrow();
  });
  it.each([now, "2024-02-29T00:00:00Z", "2026-09-30T00:00:00.1+00:00"])(
    "accepts valid UTC %s",
    (value) => expect(contracts.isUtcTimestamp(value)).toBe(true),
  );
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe revision %s",
    (revision) => {
      expect(() =>
        contracts.validateContract(
          contracts.catalogUpdatePreferenceDTOValidator,
          { mode: "manual", revision, status: "idle" },
        ),
      ).toThrow();
    },
  );
  it("bounds versions, chunks and counts", () => {
    expect(() =>
      contracts.validateOrganizationRecord("organizationDatasetVersions", {
        ...draft(),
        version: 0,
      }),
    ).toThrow();
    for (const index of [-1, 0.5, 7, Infinity])
      expect(() =>
        contracts.validateOrganizationRecord("documentUploadChunks", {
          intentId: "intent" as Id<"documentUploadIntents">,
          index,
          storageId,
          sizeBytes: 0,
          sha256: sha,
        }),
      ).toThrow();
    for (const chunkCount of [0, 8, 1.5])
      expect(() =>
        contracts.validateUploadIntent({ ...intent(), chunkCount }),
      ).toThrow();
    contracts.assertSafeInteger(Number.MAX_SAFE_INTEGER);
  });
  it("enforces stored/consumed upload linkage and excludes foreign scope fields", () => {
    contracts.validateUploadIntent(intent());
    for (const patch of [
      { caseSessionId: undefined },
      { datasetVersionId: versionId },
      { datasetAssetId: "asset" as Id<"organizationDatasetAssets"> },
      { state: "stored" as const },
      { state: "consumed" as const, storageId },
      {
        state: "consumed" as const,
        storageId,
        documentId: "doc" as Id<"documents">,
      },
    ])
      expect(() =>
        contracts.validateUploadIntent({ ...intent(), ...patch }),
      ).toThrow();
    const { caseSessionId: _case, ...rest } = intent();
    const datasetIntent = {
      ...rest,
      scopeKind: "dataset" as const,
      datasetVersionId: versionId,
    };
    contracts.validateUploadIntent(datasetIntent);
    for (const patch of [
      { datasetVersionId: undefined },
      { caseSessionId: "case" as Id<"caseSessions"> },
      { analysisId: "analysis" as Id<"documentAnalyses"> },
      { documentId: "doc" as Id<"documents"> },
      { state: "consumed" as const, storageId },
    ])
      expect(() =>
        contracts.validateUploadIntent({ ...datasetIntent, ...patch }),
      ).toThrow();
  });
  it("requires complete published snapshots and coherent previews", () => {
    contracts.validateOrganizationRecord(
      "organizationDatasetVersions",
      draft(),
    );
    contracts.validateOrganizationRecord(
      "organizationDatasetVersions",
      published(),
    );
    for (const state of ["published", "withdrawn"] as const)
      for (const field of [
        "manifestStorageId",
        "contentHash",
        "publishedAt",
        "publisherLabel",
      ] as const) {
        const row = { ...published(), state };
        delete row[field];
        expect(() =>
          contracts.validateOrganizationRecord(
            "organizationDatasetVersions",
            row,
          ),
        ).toThrow();
      }
    expect(() =>
      contracts.validateOrganizationRecord("organizationDatasetVersions", {
        ...draft(),
        previewRevision: 0,
      }),
    ).toThrow();
    const preview = {
      ...draft(),
      previewRevision: 0,
      previewManifestStorageId: storageId,
      previewContentHash: sha,
      previewCreatedAt: now,
      previewPublisherLabel: "Publisher",
      previewManifestJson: draft().manifestJson,
    };
    contracts.validateOrganizationRecord(
      "organizationDatasetVersions",
      preview,
    );
    expect(() =>
      contracts.validateOrganizationRecord("organizationDatasetVersions", {
        ...preview,
        previewRevision: 1,
      }),
    ).toThrow();
  });
  it("preserves immutable snapshots and requires revision/preview invalidation on edits", () => {
    contracts.validateVersionTransition(published(), {
      ...published(),
      state: "withdrawn",
      withdrawnAt: now,
    });
    for (const patch of [
      { title: "Changed" },
      { tags: ["changed"] },
      { manifestJson: "{}" },
      { reviewNote: "changed" },
      { state: "draft" as const },
      { institutionId: "other" as Id<"institutions"> },
      { datasetId: "other" as Id<"organizationDatasets"> },
    ])
      expect(() =>
        contracts.validateVersionTransition(published(), {
          ...published(),
          ...patch,
        }),
      ).toThrow();
    expect(() =>
      contracts.validateVersionTransition(
        { ...published(), state: "withdrawn", withdrawnAt: now },
        published(),
      ),
    ).toThrow();
    expect(() =>
      contracts.validateVersionTransition(published(), {
        ...published(),
        state: "withdrawn",
      }),
    ).toThrow();
    contracts.validateDraftEdit(draft(), {
      ...draft(),
      title: "Edited",
      draftRevision: 1,
    });
    expect(() =>
      contracts.validateDraftEdit(draft(), { ...draft(), title: "Edited" }),
    ).toThrow();
    expect(() =>
      contracts.validateDraftEdit(draft(), { ...draft(), draftRevision: 2 }),
    ).toThrow();
  });
  it("checks normalized names, imported manifests and private-only scenario scope", () => {
    expect(() =>
      contracts.validateOrganizationRecord("organizationDatasetAssets", {
        versionId,
        institutionId: org,
        fileName: "A.txt",
        normalizedFileName: "A.txt",
        mediaType: "text/plain",
        sizeBytes: 0,
        sha256: sha,
        storageId,
      }),
    ).toThrow();
    expect(() =>
      contracts.validateOrganizationRecord("organizationDatasetImports", {
        institutionId: org,
        importedByUserId: user,
        upstreamDatasetId: datasetId,
        upstreamVersionId: versionId,
        upstreamContentHash: sha,
        manifestStorageId: storageId,
        manifestJson: "{}",
        importedAt: now,
      }),
    ).toThrow();
    contracts.validateScenarioOrganization({});
    contracts.validateScenarioOrganization({
      institutionId: org,
      visibility: "private",
    });
    expect(() =>
      contracts.validateScenarioOrganization({
        institutionId: org,
        visibility: "public_template",
      }),
    ).toThrow();
  });
  it("fails closed for inactive organizations, memberships and invalid expiry", () => {
    const instant = Date.parse(now);
    expect(
      contracts.isOrganizationMembershipActive(
        { status: "active" },
        { status: "active" },
        instant,
      ),
    ).toBe(true);
    expect(
      contracts.isOrganizationMembershipActive(
        { status: "active" },
        { status: "active", expiresAt: "2026-09-30T12:00:01Z" },
        instant,
      ),
    ).toBe(true);
    for (const organization of [
      null,
      { status: "paused" },
      { status: "archived" },
    ])
      expect(
        contracts.isOrganizationMembershipActive(
          organization,
          { status: "active" },
          instant,
        ),
      ).toBe(false);
    for (const membership of [
      null,
      { status: "suspended" },
      { status: "active", expiresAt: now },
      { status: "active", expiresAt: "bad" },
      { status: "active", expiresAt: "2026-10-01T00:00:00+01:00" },
    ])
      expect(
        contracts.isOrganizationMembershipActive(
          { status: "active" },
          membership,
          instant,
        ),
      ).toBe(false);
  });
});

describe("shared DTO fixtures and immutable linkage", () => {
  it("covers every exported DTO without widening its enums or accepting private metadata", () => {
    const summary = {
      datasetId,
      versionId,
      title: "Dataset",
      description: "Fixture",
      publisherInstitutionId: org,
      publisherLabel: "Publisher",
      kind: "source_data",
      reviewStatus: "unreviewed",
      publishedAt: now,
      contentHash: sha,
    };
    const event = {
      event: "update_blocked",
      mode: "automatic",
      createdAt: now,
      actorDisplayName: "Fixture",
      versionId,
      importId: "import" as Id<"organizationDatasetImports">,
      reasonCode: "RATE_LIMITED",
    };
    const fixtures = [
      [
        contracts.organizationMemberDTOValidator,
        {
          institutionId: org,
          name: "Organization",
          kind: "personal",
          role: "admin",
        },
      ],
      [
        contracts.organizationContextDTOValidator,
        {
          institutionId: org,
          name: "Organization",
          kind: "personal",
          role: "admin",
          capabilities: { manageMembers: true, teach: true, learn: true },
        },
      ],
      [contracts.datasetManifestDTOValidator, manifest()],
      [
        contracts.publicationPreviewDTOValidator,
        {
          versionId,
          revision: 0,
          title: "Dataset",
          publisherInstitutionId: org,
          assetNames: ["record.txt"],
          assetCount: 1,
          totalBytes: 12,
          reviewStatus: "unreviewed",
          contentHash: sha,
          warnings: [],
        },
      ],
      [contracts.catalogSummaryDTOValidator, summary],
      [
        contracts.catalogVersionDTOValidator,
        { ...summary, manifest: manifest() },
      ],
      [
        contracts.catalogSearchDTOValidator,
        { items: [summary], nextCursor: null },
      ],
      [
        contracts.importResultDTOValidator,
        {
          importId: "import",
          upstreamVersionId: versionId,
          upstreamContentHash: sha,
        },
      ],
      [
        contracts.catalogUpdatePreferenceDTOValidator,
        { mode: "manual", revision: 0, status: "idle" },
      ],
      [contracts.catalogUpdateEventDTOValidator, event],
      [
        contracts.catalogUpdateEventsDTOValidator,
        { items: [event], nextCursor: "cursor" },
      ],
    ] as const;
    for (const [validator, value] of fixtures) {
      expect(contracts.validateContract(validator, value)).toEqual(value);
      expect(() =>
        contracts.validateContract(validator, {
          ...value,
          authSubject: "private",
        }),
      ).toThrow();
    }
    for (const [validator, valid, invalid] of [
      [contracts.datasetKindValidator, "source_data", "executable"],
      [
        contracts.reviewStatusValidator,
        "organization_reviewed",
        "legally_approved",
      ],
      [contracts.organizationRoleValidator, "admin", "global_admin"],
      [contracts.organizationKindValidator, "shared", "operator"],
      [contracts.catalogUpdateModeValidator, "automatic", "scheduled"],
      [contracts.catalogUpdateStatusValidator, "blocked_budget", "paid"],
    ] as const) {
      expect(contracts.validateContract(validator, valid)).toBe(valid);
      expect(() => contracts.validateContract(validator, invalid)).toThrow();
    }
  });
  it("enforces immutable import data, publication binding and upload scope/linkage", async () => {
    const snapshot = await contracts.hashManifest(manifest());
    const imported: OrganizationRecords["organizationDatasetImports"] = {
      institutionId: org,
      importedByUserId: user,
      upstreamDatasetId: datasetId,
      upstreamVersionId: versionId,
      upstreamContentHash: snapshot.contentHash,
      manifestStorageId: storageId,
      manifestJson: snapshot.manifestJson,
      importedAt: now,
    };
    contracts.validateImmutableImport(imported, { ...imported });
    for (const patch of [
      { upstreamVersionId: "new" as Id<"organizationDatasetVersions"> },
      { institutionId: "other" as Id<"institutions"> },
      { manifestStorageId: "copy" as Id<"_storage"> },
      { upstreamContentHash: sha },
    ])
      expect(() =>
        contracts.validateImmutableImport(imported, { ...imported, ...patch }),
      ).toThrow();
    const version = { ...published(), ...snapshot };
    await expect(
      contracts.validatePublicationSnapshot(version),
    ).resolves.toEqual(manifest());
    await expect(
      contracts.validatePublicationSnapshot({
        ...version,
        publisherLabel: "Other",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      contracts.validatePublicationSnapshot({
        ...version,
        reviewNote: "Changed",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      contracts.validatePublicationSnapshot(draft()),
    ).rejects.toThrow();
    contracts.validateUploadScopeMatch(
      {
        kind: "session",
        caseSessionId: intent().caseSessionId as Id<"caseSessions">,
      },
      intent(),
    );
    expect(() =>
      contracts.validateUploadScopeMatch(
        { kind: "dataset", versionId },
        intent(),
      ),
    ).toThrow();
    expect(() =>
      contracts.validateUploadScopeMatch(
        { kind: "session", caseSessionId: "other" as Id<"caseSessions"> },
        intent(),
      ),
    ).toThrow();
    contracts.validateUploadIntentTransition(intent(), {
      ...intent(),
      state: "stored",
      storageId,
    });
    expect(() =>
      contracts.validateUploadIntentTransition(intent(), {
        ...intent(),
        institutionId: "other" as Id<"institutions">,
      }),
    ).toThrow();
    expect(() =>
      contracts.validateUploadIntentTransition(
        { ...intent(), state: "stored", storageId },
        { ...intent(), state: "stored", storageId: "other" as Id<"_storage"> },
      ),
    ).toThrow();
  });
});

it("rejects sparse arrays rather than producing invalid canonical JSON", () => {
  expect(() =>
    contracts.canonicalizeManifest({ ...manifest(), tags: new Array(2) }),
  ).toThrow();
  expect(() =>
    contracts.canonicalizeManifest({ ...manifest(), assets: new Array(1) }),
  ).toThrow();
});
