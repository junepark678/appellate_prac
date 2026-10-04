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

import { createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { AppErrorCode } from "./errors";
import type { DatasetManifestDTO } from "./organizationContracts";
import { canonicalizeManifest } from "./organizationContracts";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./authz.ts": () => import("./authz"),
  "./errors.ts": () => import("./errors"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./organizationDatasets.ts": () => import("./organizationDatasets"),
};

type Identity = {
  issuer: string;
  subject: string;
  tokenIdentifier: string;
  name: string;
};

type AssetDescriptor = DatasetManifestDTO["assets"][number];
type DraftManifestInput = { assets: AssetDescriptor[] };
type CreateArgs = {
  institutionId: Id<"institutions">;
  title: string;
  description: string;
  kind: "source_data" | "rule_pack";
};
type UpdateArgs = {
  versionId: Id<"organizationDatasetVersions">;
  expectedRevision: number;
  title: string;
  description: string;
  tags: string[];
  manifest: DraftManifestInput;
};
type DraftDTO = {
  datasetId: Id<"organizationDatasets">;
  versionId: Id<"organizationDatasetVersions">;
  institutionId: Id<"institutions">;
  version: number;
  title: string;
  description: string;
  kind: "source_data" | "rule_pack";
  tags: string[];
  draftRevision: number;
  reviewStatus: "unreviewed" | "organization_reviewed";
  reviewedAt?: string;
  reviewNote?: string;
  manifest: DatasetManifestDTO;
  createdAt: string;
};
type DraftSummary = {
  datasetId: Id<"organizationDatasets">;
  versionId: Id<"organizationDatasetVersions">;
  version: number;
  title: string;
  description: string;
  kind: "source_data" | "rule_pack";
  state: "draft" | "published" | "withdrawn";
  reviewStatus: "unreviewed" | "organization_reviewed";
  draftRevision: number;
  createdAt: string;
  updatedAt: string;
};
type ListMineResult = {
  page: DraftSummary[];
  isDone: boolean;
  continueCursor: string;
};

const createRef = makeFunctionReference<
  "mutation",
  CreateArgs,
  {
    datasetId: Id<"organizationDatasets">;
    versionId: Id<"organizationDatasetVersions">;
  }
>("organizationDatasets:create");
const newVersionRef = makeFunctionReference<
  "mutation",
  { datasetId: Id<"organizationDatasets"> },
  { versionId: Id<"organizationDatasetVersions"> }
>("organizationDatasets:newVersion");
const updateDraftRef = makeFunctionReference<"mutation", UpdateArgs, null>(
  "organizationDatasets:updateDraft",
);
const attachAssetRef = makeFunctionReference<
  "mutation",
  {
    versionId: Id<"organizationDatasetVersions">;
    intentId: Id<"documentUploadIntents">;
    fileName: string;
  },
  Id<"organizationDatasetAssets">
>("organizationDatasets:attachAsset");
const reviewDraftRef = makeFunctionReference<
  "mutation",
  {
    versionId: Id<"organizationDatasetVersions">;
    expectedRevision: number;
    reviewNote: string;
  },
  null
>("organizationDatasets:reviewDraft");
const listMineRef = makeFunctionReference<
  "query",
  {
    institutionId: Id<"institutions">;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  ListMineResult
>("organizationDatasets:listMine");
const getDraftRef = makeFunctionReference<
  "query",
  { versionId: Id<"organizationDatasetVersions"> },
  DraftDTO
>("organizationDatasets:getDraft");

function identity(subject: string): Identity {
  return {
    issuer: "https://identity.example.test",
    subject,
    tokenIdentifier: `https://identity.example.test|${subject}`,
    name: subject,
  };
}

async function seedWorkspace(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const createdAt = new Date().toISOString();
    const addUser = async (subject: string, globalRole: "student" | "admin") =>
      ctx.db.insert("users", {
        authSubject: identity(subject).tokenIdentifier,
        displayName: subject,
        role: globalRole,
        monthlyAiBudgetCents: 0,
      });
    const aliceId = await addUser("alice", "student");
    const learnerId = await addUser("learner", "admin");
    const collaboratorId = await addUser("collaborator", "admin");
    const foreignId = await addUser("foreign", "admin");
    const institutionId = await ctx.db.insert("institutions", {
      name: "North Valley Clinic",
      slug: "north-valley-clinic",
      status: "active",
      monthlyAiBudgetCents: 0,
      kind: "shared",
      createdAt,
    });
    const foreignInstitutionId = await ctx.db.insert("institutions", {
      name: "Foreign Clinic",
      slug: "foreign-clinic",
      status: "active",
      monthlyAiBudgetCents: 0,
      kind: "shared",
      createdAt,
    });
    const aliceMembershipId = await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId: aliceId,
      role: "instructor",
      status: "active",
      createdAt,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId: learnerId,
      role: "learner",
      status: "active",
      createdAt,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId: collaboratorId,
      role: "instructor",
      status: "active",
      createdAt,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId: foreignInstitutionId,
      userId: foreignId,
      role: "instructor",
      status: "active",
      createdAt,
    });
    return {
      aliceId,
      learnerId,
      collaboratorId,
      foreignId,
      institutionId,
      foreignInstitutionId,
      aliceMembershipId,
    };
  });
}

async function createDataset(
  t: TestConvex<typeof schema>,
  subject: string,
  institutionId: Id<"institutions">,
  title = "Record Sources",
) {
  return t.withIdentity(identity(subject)).mutation(createRef, {
    institutionId,
    title,
    description: "Training sources for the clinic.",
    kind: "source_data",
  });
}

async function seedStoredReceipt(
  t: TestConvex<typeof schema>,
  input: {
    userId: Id<"users">;
    institutionId: Id<"institutions">;
    versionId: Id<"organizationDatasetVersions">;
    fileName: string;
    mediaType?: AssetDescriptor["mediaType"];
    bytes?: Uint8Array;
  },
) {
  const bytes =
    input.bytes ?? new TextEncoder().encode(`fixture:${input.fileName}`);
  const mediaType = input.mediaType ?? "text/plain";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType }),
    );
    const now = Date.now();
    const intentId = await ctx.db.insert("documentUploadIntents", {
      institutionId: input.institutionId,
      scopeKind: "dataset",
      datasetVersionId: input.versionId,
      userId: input.userId,
      fileName: input.fileName,
      sizeBytes: bytes.byteLength,
      sha256,
      mimeType: mediaType,
      chunkCount: 1,
      state: "stored",
      expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
      createdAt: new Date(now).toISOString(),
      storageId,
    });
    return { intentId, storageId, sizeBytes: bytes.byteLength, sha256 };
  });
}

function assetDescriptor(
  input: Partial<AssetDescriptor> & Pick<AssetDescriptor, "fileName">,
): AssetDescriptor {
  return {
    fileName: input.fileName,
    mediaType: input.mediaType ?? "text/plain",
    sizeBytes: input.sizeBytes ?? 8,
    sha256: input.sha256 ?? "a".repeat(64),
    provenance: input.provenance ?? {},
  };
}

function updateArgs(
  versionId: Id<"organizationDatasetVersions">,
  assets: AssetDescriptor[] = [],
  overrides: Partial<Omit<UpdateArgs, "versionId" | "manifest">> = {},
): UpdateArgs {
  return {
    versionId,
    expectedRevision: overrides.expectedRevision ?? 0,
    title: overrides.title ?? "Revised Record Sources",
    description: overrides.description ?? "Updated training sources.",
    tags: overrides.tags ?? ["records", "training"],
    manifest: { assets },
  };
}

async function seedPreviewFields(
  t: TestConvex<typeof schema>,
  versionId: Id<"organizationDatasetVersions">,
) {
  return t.run(async (ctx) => {
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("version fixture missing");
    const manifestStorageId = await ctx.storage.store(
      new Blob([version.manifestJson], { type: "application/json" }),
    );
    await ctx.db.patch(versionId, {
      previewManifestStorageId: manifestStorageId,
      previewContentHash: "b".repeat(64),
      previewRevision: version.draftRevision,
      previewCreatedAt: new Date().toISOString(),
      previewPublisherLabel: "North Valley Clinic",
      previewManifestJson: version.manifestJson,
    });
  });
}

async function freezeAsPublishedFixture(
  t: TestConvex<typeof schema>,
  versionId: Id<"organizationDatasetVersions">,
  publisherLabel = "North Valley Clinic",
) {
  return t.run(async (ctx) => {
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("version fixture missing");
    const manifestValue = JSON.parse(
      version.manifestJson,
    ) as DatasetManifestDTO;
    manifestValue.publisher.label = publisherLabel;
    const manifestJson = canonicalizeManifest(manifestValue);
    const contentHash = createHash("sha256").update(manifestJson).digest("hex");
    const manifestStorageId = await ctx.storage.store(
      new Blob([manifestJson], { type: "application/json" }),
    );
    const publishedAt = new Date().toISOString();
    await ctx.db.patch(versionId, {
      state: "published",
      manifestJson,
      manifestStorageId,
      contentHash,
      publishedAt,
      publisherLabel,
    });
    return { manifestStorageId, contentHash };
  });
}

describe("private organization dataset drafts", () => {
  it("creates org-scoped private drafts, lets active members read, and hides foreign metadata", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created = await createDataset(t, "alice", fixture.institutionId);

    expect(created).toMatchObject({
      datasetId: expect.any(String),
      versionId: expect.any(String),
    });
    const alice = t.withIdentity(identity("alice"));
    const listed = await alice.query(listMineRef, {
      institutionId: fixture.institutionId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(listed).toMatchObject({ isDone: true, page: [expect.anything()] });
    expect(listed.page[0]).toMatchObject({
      datasetId: created.datasetId,
      versionId: created.versionId,
      version: 1,
      title: "Record Sources",
      state: "draft",
      reviewStatus: "unreviewed",
      draftRevision: 0,
    });
    const draft = await alice.query(getDraftRef, {
      versionId: created.versionId,
    });
    expect(draft.manifest).toMatchObject({
      schemaVersion: 1,
      publisher: {
        institutionId: fixture.institutionId,
        label: "North Valley Clinic",
      },
      kind: "source_data",
      title: "Record Sources",
      review: { status: "unreviewed" },
      assets: [],
    });

    const learner = t.withIdentity(identity("learner"));
    expect(
      await learner.query(getDraftRef, { versionId: created.versionId }),
    ).toEqual(draft);
    await expect(
      learner.mutation(updateDraftRef, updateArgs(created.versionId)),
    ).rejects.toMatchObject({ code: AppErrorCode.AUTH_UNAUTHORIZED_ROLE });
    // This account has a legacy global admin role, but only learner authority here.
    await expect(
      learner.mutation(createRef, {
        institutionId: fixture.institutionId,
        title: "Unauthorized",
        description: "",
        kind: "rule_pack",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.AUTH_UNAUTHORIZED_ROLE });

    const foreign = t.withIdentity(identity("foreign"));
    await expect(
      foreign.query(listMineRef, {
        institutionId: fixture.institutionId,
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.NOT_FOUND,
    });
    await expect(
      foreign.query(getDraftRef, { versionId: created.versionId }),
    ).rejects.toMatchObject({
      code: AppErrorCode.NOT_FOUND,
    });
    await expect(
      t.query(getDraftRef, { versionId: created.versionId }),
    ).rejects.toMatchObject({
      code: AppErrorCode.AUTH_REQUIRED,
    });

    await expect(
      alice.mutation(newVersionRef, { datasetId: created.datasetId }),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });
  });

  it("paginates organization datasets in bounded pages and validates page size", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created: Array<{
      datasetId: Id<"organizationDatasets">;
      versionId: Id<"organizationDatasetVersions">;
    }> = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(
        await createDataset(
          t,
          "alice",
          fixture.institutionId,
          `Paginated Draft ${index}`,
        ),
      );
    }
    const alice = t.withIdentity(identity("alice"));
    const first = await alice.query(listMineRef, {
      institutionId: fixture.institutionId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor).not.toBe("");
    const second = await alice.query(listMineRef, {
      institutionId: fixture.institutionId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(2);
    expect(second.isDone).toBe(false);
    const third = await alice.query(listMineRef, {
      institutionId: fixture.institutionId,
      paginationOpts: { numItems: 2, cursor: second.continueCursor },
    });
    expect(third.page).toHaveLength(1);
    expect(third.isDone).toBe(true);
    expect(
      [...first.page, ...second.page, ...third.page].map((item) =>
        String(item.datasetId),
      ),
    ).toEqual(created.map((item) => String(item.datasetId)).reverse());

    for (const numItems of [0, 51, 1.5]) {
      await expect(
        alice.query(listMineRef, {
          institutionId: fixture.institutionId,
          paginationOpts: { numItems, cursor: null },
        }),
      ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    }
  });

  it("atomically rejects stale edits and reviews across instructors", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created = await createDataset(t, "alice", fixture.institutionId);
    const alice = t.withIdentity(identity("alice"));
    const collaborator = t.withIdentity(identity("collaborator"));

    const firstRace = await Promise.allSettled([
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [], {
          title: "Instructor Alice Edit",
          expectedRevision: 0,
        }),
      ),
      collaborator.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [], {
          title: "Instructor Collaborator Edit",
          expectedRevision: 0,
        }),
      ),
    ]);
    expect(
      firstRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const staleEdit = firstRace.find((result) => result.status === "rejected");
    expect(staleEdit).toMatchObject({
      status: "rejected",
      reason: { code: AppErrorCode.CONFLICT },
    });

    const versionAfterFirstRace = await t.run((ctx) =>
      ctx.db.get(created.versionId),
    );
    expect(versionAfterFirstRace?.draftRevision).toBe(1);
    expect(["Instructor Alice Edit", "Instructor Collaborator Edit"]).toContain(
      versionAfterFirstRace?.title,
    );
    const datasetAfterFirstRace = await t.run((ctx) =>
      ctx.db.get(created.datasetId),
    );
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [], { expectedRevision: 0 }),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });
    await expect(
      collaborator.mutation(reviewDraftRef, {
        versionId: created.versionId,
        expectedRevision: 0,
        reviewNote: "This stale review must not apply.",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });
    expect(await t.run((ctx) => ctx.db.get(created.versionId))).toEqual(
      versionAfterFirstRace,
    );
    expect(await t.run((ctx) => ctx.db.get(created.datasetId))).toEqual(
      datasetAfterFirstRace,
    );

    const secondRace = await Promise.allSettled([
      collaborator.mutation(reviewDraftRef, {
        versionId: created.versionId,
        expectedRevision: 1,
        reviewNote: "Reviewed revision one only.",
      }),
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [], {
          expectedRevision: 1,
          title: "Revision Two Edit",
        }),
      ),
    ]);
    expect(
      secondRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      secondRace.find((result) => result.status === "rejected"),
    ).toMatchObject({
      status: "rejected",
      reason: { code: AppErrorCode.CONFLICT },
    });
    const versionAfterSecondRace = await t.run((ctx) =>
      ctx.db.get(created.versionId),
    );
    expect(versionAfterSecondRace?.draftRevision).toBe(2);
    if (secondRace[0]?.status === "fulfilled") {
      expect(versionAfterSecondRace).toMatchObject({
        reviewStatus: "organization_reviewed",
        reviewNote: "Reviewed revision one only.",
        reviewedByUserId: fixture.collaboratorId,
      });
      expect(versionAfterSecondRace?.title).toBe(versionAfterFirstRace?.title);
    } else {
      expect(versionAfterSecondRace).toMatchObject({
        title: "Revision Two Edit",
        reviewStatus: "unreviewed",
      });
      expect(versionAfterSecondRace).not.toHaveProperty("reviewNote");
      expect(versionAfterSecondRace).not.toHaveProperty("reviewedByUserId");
    }
  });

  it("attaches stored receipts atomically, makes retries idempotent, and resets review and preview", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created = await createDataset(t, "alice", fixture.institutionId);
    const receipt = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: created.versionId,
      fileName: "confidential-brief.txt",
    });
    const alice = t.withIdentity(identity("alice"));
    const [firstId, retryId] = await Promise.all([
      alice.mutation(attachAssetRef, {
        versionId: created.versionId,
        intentId: receipt.intentId,
        fileName: "confidential-brief.txt",
      }),
      alice.mutation(attachAssetRef, {
        versionId: created.versionId,
        intentId: receipt.intentId,
        fileName: "confidential-brief.txt",
      }),
    ]);
    expect(firstId).toBe(retryId);

    const attached = await t.run(async (ctx) => ({
      version: await ctx.db.get(created.versionId),
      intent: await ctx.db.get(receipt.intentId),
      assets: await ctx.db
        .query("organizationDatasetAssets")
        .withIndex("by_version", (index) =>
          index.eq("versionId", created.versionId),
        )
        .collect(),
    }));
    expect(attached.version?.draftRevision).toBe(1);
    expect(attached.version?.reviewStatus).toBe("unreviewed");
    expect(attached.intent).toMatchObject({
      state: "consumed",
      datasetAssetId: firstId,
    });
    expect(attached.assets).toHaveLength(1);
    expect(attached.assets[0]).toMatchObject({
      versionId: created.versionId,
      institutionId: fixture.institutionId,
      fileName: "confidential-brief.txt",
      normalizedFileName: "confidential-brief.txt",
      mediaType: "text/plain",
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      storageId: receipt.storageId,
    });

    const proprietary = assetDescriptor({
      fileName: "confidential-brief.txt",
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      provenance: { licenseNote: "Proprietary; no redistribution." },
    });
    await alice.mutation(
      updateDraftRef,
      updateArgs(created.versionId, [proprietary], { expectedRevision: 1 }),
    );
    await seedPreviewFields(t, created.versionId);
    await alice.mutation(reviewDraftRef, {
      versionId: created.versionId,
      expectedRevision: 2,
      reviewNote: "Reviewed for this organization only.",
    });
    const reviewed = await t.run((ctx) => ctx.db.get(created.versionId));
    expect(reviewed).toMatchObject({
      draftRevision: 3,
      reviewStatus: "organization_reviewed",
      reviewedByUserId: fixture.aliceId,
      reviewNote: "Reviewed for this organization only.",
    });
    for (const previewField of [
      "previewManifestStorageId",
      "previewContentHash",
      "previewRevision",
      "previewCreatedAt",
      "previewPublisherLabel",
      "previewManifestJson",
    ]) {
      expect(reviewed).not.toHaveProperty(previewField);
    }

    const followupReceipt = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: created.versionId,
      fileName: "followup.txt",
    });
    await seedPreviewFields(t, created.versionId);
    await alice.mutation(attachAssetRef, {
      versionId: created.versionId,
      intentId: followupReceipt.intentId,
      fileName: "followup.txt",
    });
    const attachedAfterReview = await t.run((ctx) =>
      ctx.db.get(created.versionId),
    );
    expect(attachedAfterReview?.draftRevision).toBe(4);
    expect(attachedAfterReview?.reviewStatus).toBe("unreviewed");
    expect(attachedAfterReview).not.toHaveProperty("reviewedByUserId");
    expect(attachedAfterReview).not.toHaveProperty("reviewNote");
    expect(attachedAfterReview).not.toHaveProperty("previewContentHash");
    expect(attachedAfterReview).not.toHaveProperty("previewManifestJson");

    await seedPreviewFields(t, created.versionId);
    await alice.mutation(
      updateDraftRef,
      updateArgs(
        created.versionId,
        [
          assetDescriptor({
            fileName: "confidential-brief.txt",
            sizeBytes: receipt.sizeBytes,
            sha256: receipt.sha256,
            // Omission in an edit does not erase an existing proprietary rights note.
            provenance: {},
          }),
          assetDescriptor({
            fileName: "followup.txt",
            sizeBytes: followupReceipt.sizeBytes,
            sha256: followupReceipt.sha256,
          }),
        ],
        { title: "Updated Sources", expectedRevision: 4 },
      ),
    );
    const edited = await alice.query(getDraftRef, {
      versionId: created.versionId,
    });
    const editedRow = await t.run((ctx) => ctx.db.get(created.versionId));
    expect(edited.draftRevision).toBe(5);
    expect(edited.reviewStatus).toBe("unreviewed");
    expect(edited.reviewedAt).toBeUndefined();
    expect(edited.reviewNote).toBeUndefined();
    expect(
      edited.manifest.assets.find(
        (asset) => asset.fileName === "confidential-brief.txt",
      )?.provenance.licenseNote,
    ).toBe("Proprietary; no redistribution.");
    expect(editedRow).not.toHaveProperty("previewContentHash");
    expect(editedRow).not.toHaveProperty("previewManifestJson");
    expect(JSON.stringify(edited)).not.toContain(receipt.storageId);
    expect(JSON.stringify(edited)).not.toContain("AGPL");
  });

  it("preserves license metadata across metadata-only new versions and allows only one open draft", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created = await createDataset(t, "alice", fixture.institutionId);
    const alice = t.withIdentity(identity("alice"));
    const supplied = [
      {
        name: "proprietary.txt",
        provenance: { licenseNote: "Proprietary; permission required." },
      },
      { name: "unspecified.txt", provenance: {} },
      {
        name: "third-party.json",
        mediaType: "application/json" as const,
        provenance: { licenseNote: "CC-BY-4.0; attribution required." },
      },
    ];
    const receipts: Awaited<ReturnType<typeof seedStoredReceipt>>[] = [];
    for (const item of supplied) {
      const receipt = await seedStoredReceipt(t, {
        userId: fixture.aliceId,
        institutionId: fixture.institutionId,
        versionId: created.versionId,
        fileName: item.name,
        ...(item.mediaType ? { mediaType: item.mediaType } : {}),
      });
      receipts.push(receipt);
      await alice.mutation(attachAssetRef, {
        versionId: created.versionId,
        intentId: receipt.intentId,
        fileName: item.name,
      });
    }
    const assets = supplied.map((item, index) => {
      const receipt = receipts[index]!;
      return assetDescriptor({
        fileName: item.name,
        mediaType: item.mediaType ?? "text/plain",
        sizeBytes: receipt.sizeBytes,
        sha256: receipt.sha256,
        provenance: item.provenance,
      });
    });
    await alice.mutation(
      updateDraftRef,
      updateArgs(created.versionId, assets, {
        expectedRevision: 3,
        title: "Rights Checked Sources",
        description: "Rights metadata is retained as publisher supplied.",
        tags: ["rights", "sources"],
      }),
    );
    await alice.mutation(reviewDraftRef, {
      versionId: created.versionId,
      expectedRevision: 4,
      reviewNote: "Organization review only; no court approval.",
    });
    await freezeAsPublishedFixture(
      t,
      created.versionId,
      "North Valley Publishing Office",
    );

    const sourceBefore = await t.run((ctx) => ctx.db.get(created.versionId));
    const sourceManifest = JSON.parse(
      sourceBefore!.manifestJson,
    ) as DatasetManifestDTO;
    const newDraft = await alice.mutation(newVersionRef, {
      datasetId: created.datasetId,
    });
    const cloned = await alice.query(getDraftRef, {
      versionId: newDraft.versionId,
    });
    expect(cloned).toMatchObject({
      version: 2,
      title: "Rights Checked Sources",
      description: "Rights metadata is retained as publisher supplied.",
      tags: ["rights", "sources"],
      reviewStatus: "unreviewed",
      draftRevision: 0,
      manifest: {
        publisher: {
          institutionId: fixture.institutionId,
          label: "North Valley Publishing Office",
        },
        review: { status: "unreviewed" },
      },
    });
    expect(cloned.manifest.assets.map((asset) => asset.provenance)).toEqual(
      sourceManifest.assets.map((asset) => asset.provenance),
    );
    expect(
      cloned.manifest.assets.find(
        (asset) => asset.fileName === "proprietary.txt",
      )?.provenance,
    ).toEqual({ licenseNote: "Proprietary; permission required." });
    expect(
      cloned.manifest.assets.find(
        (asset) => asset.fileName === "unspecified.txt",
      )?.provenance,
    ).toEqual({});
    expect(
      cloned.manifest.assets.find(
        (asset) => asset.fileName === "third-party.json",
      )?.provenance,
    ).toEqual({ licenseNote: "CC-BY-4.0; attribution required." });

    const sourceAssets = await t.run((ctx) =>
      ctx.db
        .query("organizationDatasetAssets")
        .withIndex("by_version", (index) =>
          index.eq("versionId", created.versionId),
        )
        .collect(),
    );
    const cloneAssets = await t.run((ctx) =>
      ctx.db
        .query("organizationDatasetAssets")
        .withIndex("by_version", (index) =>
          index.eq("versionId", newDraft.versionId),
        )
        .collect(),
    );
    expect(cloneAssets).toHaveLength(sourceAssets.length);
    for (const sourceAsset of sourceAssets) {
      const clonedAsset = cloneAssets.find(
        (asset) => asset.fileName === sourceAsset.fileName,
      );
      expect(clonedAsset?._id).not.toBe(sourceAsset._id);
      expect(clonedAsset?.storageId).toBe(sourceAsset.storageId);
      expect(clonedAsset?.institutionId).toBe(fixture.institutionId);
    }
    await expect(
      alice.mutation(newVersionRef, { datasetId: created.datasetId }),
    ).rejects.toMatchObject({
      code: AppErrorCode.CONFLICT,
    });
    const sourceAfter = await t.run((ctx) => ctx.db.get(created.versionId));
    expect(sourceAfter).toEqual(sourceBefore);
  });

  it("creates only one open draft when multiple instructors start a version together", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created = await createDataset(t, "alice", fixture.institutionId);
    await freezeAsPublishedFixture(t, created.versionId);
    const alice = t.withIdentity(identity("alice"));
    const collaborator = t.withIdentity(identity("collaborator"));

    const attempts = await Promise.allSettled([
      alice.mutation(newVersionRef, { datasetId: created.datasetId }),
      collaborator.mutation(newVersionRef, { datasetId: created.datasetId }),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.find((result) => result.status === "rejected"),
    ).toMatchObject({
      status: "rejected",
      reason: { code: AppErrorCode.CONFLICT },
    });

    const versions = await t.run((ctx) =>
      ctx.db
        .query("organizationDatasetVersions")
        .withIndex("by_dataset_version", (index) =>
          index.eq("datasetId", created.datasetId),
        )
        .collect(),
    );
    expect(versions.map((version) => version.version).sort()).toEqual([1, 2]);
    expect(
      versions.filter((version) => version.state === "draft"),
    ).toHaveLength(1);
  });

  it("rejects unsafe names, case collisions, hidden/mismatched assets, invalid limits, and unknown manifest keys", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const created = await createDataset(t, "alice", fixture.institutionId);
    const alice = t.withIdentity(identity("alice"));

    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [
          assetDescriptor({ fileName: "../escape.pdf" }),
        ]),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [
          assetDescriptor({ fileName: "Record.txt" }),
          assetDescriptor({ fileName: "record.TXT" }),
        ]),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [
          assetDescriptor({
            fileName: "large.txt",
            sizeBytes: 25 * 1024 * 1024 + 1,
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(
          created.versionId,
          Array.from({ length: 51 }, (_, index) =>
            assetDescriptor({ fileName: `asset-${index}.txt` }),
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(
          created.versionId,
          Array.from({ length: 5 }, (_, index) =>
            assetDescriptor({
              fileName: `large-${index}.txt`,
              sizeBytes: 25 * 1024 * 1024,
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    await expect(
      alice.mutation(updateDraftRef, {
        ...updateArgs(created.versionId),
        manifest: { assets: [], hidden: true },
      } as unknown as UpdateArgs),
    ).rejects.toThrow();
    await expect(
      alice.mutation(updateDraftRef, {
        ...updateArgs(created.versionId),
        manifest: {
          assets: [
            { ...assetDescriptor({ fileName: "bad.txt" }), unexpected: true },
          ],
        },
      } as unknown as UpdateArgs),
    ).rejects.toThrow();
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [
          assetDescriptor({ fileName: "bad-hash.txt", sha256: "not-a-hash" }),
        ]),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(created.versionId, [], { tags: ["Uppercase"] }),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.VALIDATION_ERROR });

    const attached = await createDataset(
      t,
      "alice",
      fixture.institutionId,
      "Attached fixture",
    );
    const attachedReceipt = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: attached.versionId,
      fileName: "matched.txt",
    });
    await alice.mutation(attachAssetRef, {
      versionId: attached.versionId,
      intentId: attachedReceipt.intentId,
      fileName: "matched.txt",
    });
    const matching = assetDescriptor({
      fileName: "matched.txt",
      sizeBytes: attachedReceipt.sizeBytes,
      sha256: attachedReceipt.sha256,
    });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(
          attached.versionId,
          [
            {
              ...matching,
              sha256: "b".repeat(64),
            },
          ],
          { expectedRevision: 1 },
        ),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(
          attached.versionId,
          [
            {
              ...matching,
              mediaType: "application/pdf",
            },
          ],
          { expectedRevision: 1 },
        ),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });
    await expect(
      alice.mutation(
        updateDraftRef,
        updateArgs(
          attached.versionId,
          [
            {
              ...matching,
              sizeBytes: matching.sizeBytes + 1,
            },
          ],
          { expectedRevision: 1 },
        ),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });

    const receipt = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: created.versionId,
      fileName: "actual.txt",
    });
    const assetId = await t.run(async (ctx) => {
      const intent = await ctx.db.get(receipt.intentId);
      const version = await ctx.db.get(created.versionId);
      if (!intent || !version) throw new Error("fixture missing");
      const id = await ctx.db.insert("organizationDatasetAssets", {
        versionId: version._id,
        institutionId: fixture.institutionId,
        fileName: intent.fileName,
        normalizedFileName: intent.fileName.toLowerCase(),
        mediaType: intent.mimeType,
        sizeBytes: intent.sizeBytes,
        sha256: intent.sha256,
        storageId: intent.storageId!,
      });
      return id;
    });
    await expect(
      alice.query(getDraftRef, { versionId: created.versionId }),
    ).rejects.toMatchObject({
      code: AppErrorCode.CONFLICT,
    });
    expect(assetId).toBeDefined();
    const stillDraft = await t.run((ctx) => ctx.db.get(created.versionId));
    expect(stillDraft?.draftRevision).toBe(0);
  });

  it("rejects foreign, wrong-version, revoked and conflicting receipt reuse without partial consumption", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWorkspace(t);
    const first = await createDataset(
      t,
      "alice",
      fixture.institutionId,
      "First",
    );
    const second = await createDataset(
      t,
      "alice",
      fixture.institutionId,
      "Second",
    );
    const alice = t.withIdentity(identity("alice"));

    const collaboratorReceipt = await seedStoredReceipt(t, {
      userId: fixture.collaboratorId,
      institutionId: fixture.institutionId,
      versionId: first.versionId,
      fileName: "collaborator.txt",
    });
    await expect(
      alice.mutation(attachAssetRef, {
        versionId: first.versionId,
        intentId: collaboratorReceipt.intentId,
        fileName: "collaborator.txt",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.NOT_FOUND });

    const wrongVersion = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: second.versionId,
      fileName: "second.txt",
    });
    await expect(
      alice.mutation(attachAssetRef, {
        versionId: first.versionId,
        intentId: wrongVersion.intentId,
        fileName: "second.txt",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });

    const revokedReceipt = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: first.versionId,
      fileName: "revoked.txt",
    });
    await t.run((ctx) =>
      ctx.db.patch(fixture.aliceMembershipId, { status: "suspended" }),
    );
    await expect(
      alice.mutation(attachAssetRef, {
        versionId: first.versionId,
        intentId: revokedReceipt.intentId,
        fileName: "revoked.txt",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.NOT_FOUND });
    await t.run((ctx) =>
      ctx.db.patch(fixture.aliceMembershipId, { status: "active" }),
    );

    const cancelledReceipt = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: first.versionId,
      fileName: "cancelled.txt",
    });
    await t.run((ctx) =>
      ctx.db.patch(cancelledReceipt.intentId, { state: "cancelled" }),
    );
    await expect(
      alice.mutation(attachAssetRef, {
        versionId: first.versionId,
        intentId: cancelledReceipt.intentId,
        fileName: "cancelled.txt",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });

    const reusable = await seedStoredReceipt(t, {
      userId: fixture.aliceId,
      institutionId: fixture.institutionId,
      versionId: first.versionId,
      fileName: "one-time.txt",
    });
    const assetId = await alice.mutation(attachAssetRef, {
      versionId: first.versionId,
      intentId: reusable.intentId,
      fileName: "one-time.txt",
    });
    await expect(
      alice.mutation(attachAssetRef, {
        versionId: first.versionId,
        intentId: reusable.intentId,
        fileName: "different-name.txt",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });
    await expect(
      alice.mutation(attachAssetRef, {
        versionId: second.versionId,
        intentId: reusable.intentId,
        fileName: "one-time.txt",
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.CONFLICT });

    const after = await t.run(async (ctx) => ({
      foreign: await ctx.db.get(collaboratorReceipt.intentId),
      wrongVersion: await ctx.db.get(wrongVersion.intentId),
      revoked: await ctx.db.get(revokedReceipt.intentId),
      cancelled: await ctx.db.get(cancelledReceipt.intentId),
      reusable: await ctx.db.get(reusable.intentId),
      firstVersion: await ctx.db.get(first.versionId),
      firstAssets: await ctx.db
        .query("organizationDatasetAssets")
        .withIndex("by_version", (index) =>
          index.eq("versionId", first.versionId),
        )
        .collect(),
      secondAssets: await ctx.db
        .query("organizationDatasetAssets")
        .withIndex("by_version", (index) =>
          index.eq("versionId", second.versionId),
        )
        .collect(),
    }));
    expect(after.foreign?.state).toBe("stored");
    expect(after.wrongVersion?.state).toBe("stored");
    expect(after.revoked?.state).toBe("stored");
    expect(after.cancelled?.state).toBe("cancelled");
    expect(after.reusable).toMatchObject({
      state: "consumed",
      datasetAssetId: assetId,
    });
    expect(after.firstVersion?.draftRevision).toBe(1);
    expect(
      after.firstAssets.filter((asset) => asset.fileName === "one-time.txt"),
    ).toHaveLength(1);
    expect(after.secondAssets).toHaveLength(0);
  });
});
