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
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireInstitutionRole } from "./authz";
import {
  assertSafeInteger,
  canonicalizeManifest,
  datasetKindValidator,
  datasetManifestDTOValidator,
  parseManifest,
  validateContract,
  validateDraftEdit,
  validateOrganizationRecord,
  validatePublicationSnapshot,
  validateUploadIntent,
  validateUploadIntentTransition,
} from "./organizationContracts";
import type {
  DatasetKind,
  DatasetManifestDTO,
  ReviewStatus,
} from "./organizationContracts";
import { AppErrorCode, ConvexError, notFound, validationError } from "./errors";

const maxAssetCount = 50;
const maxAssetBytes = 25 * 1024 * 1024;
const maxVersionBytes = 100 * 1024 * 1024;
const maxTitleLength = 160;
const maxDescriptionLength = 4000;
const maxTagCount = 10;
const maxTagLength = 32;
const maxReviewNoteLength = 4000;

const draftAssetValidator = v.object({
  fileName: v.string(),
  mediaType: v.union(
    v.literal("application/pdf"),
    v.literal("text/plain"),
    v.literal("application/json"),
  ),
  sizeBytes: v.number(),
  sha256: v.string(),
  provenance: v.object({
    sourceUrl: v.optional(v.string()),
    retrievedAt: v.optional(v.string()),
    licenseNote: v.optional(v.string()),
  }),
});

// The editable input contains only data describing already attached files.
// The server supplies publisher, dataset, and review fields from trusted rows.
const draftManifestInputValidator = v.object({
  assets: v.array(draftAssetValidator),
});

const versionStateValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("withdrawn"),
);

const draftSummaryValidator = v.object({
  datasetId: v.id("organizationDatasets"),
  versionId: v.id("organizationDatasetVersions"),
  version: v.number(),
  title: v.string(),
  description: v.string(),
  kind: datasetKindValidator,
  state: versionStateValidator,
  reviewStatus: v.union(
    v.literal("unreviewed"),
    v.literal("organization_reviewed"),
  ),
  draftRevision: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const listMinePaginationOptsValidator = v.object({
  cursor: v.union(v.string(), v.null()),
  numItems: v.number(),
});

const listMineResultValidator = v.object({
  page: v.array(draftSummaryValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const getDraftDTOValidator = v.object({
  datasetId: v.id("organizationDatasets"),
  versionId: v.id("organizationDatasetVersions"),
  institutionId: v.id("institutions"),
  version: v.number(),
  title: v.string(),
  description: v.string(),
  kind: datasetKindValidator,
  tags: v.array(v.string()),
  draftRevision: v.number(),
  reviewStatus: v.union(
    v.literal("unreviewed"),
    v.literal("organization_reviewed"),
  ),
  reviewedAt: v.optional(v.string()),
  reviewNote: v.optional(v.string()),
  manifest: datasetManifestDTOValidator,
  createdAt: v.string(),
});

type AssetDescriptor = DatasetManifestDTO["assets"][number];
type VersionRecord = Omit<
  Doc<"organizationDatasetVersions">,
  "_id" | "_creationTime"
>;
type AssetRecord = Omit<
  Doc<"organizationDatasetAssets">,
  "_id" | "_creationTime"
>;
type UploadIntentRecord = Omit<
  Doc<"documentUploadIntents">,
  "_id" | "_creationTime"
>;
type ReadCtx = QueryCtx | MutationCtx;

function conflict(message: string) {
  return new ConvexError(AppErrorCode.CONFLICT, message);
}

function recordWithoutSystemFields<
  T extends { _id: unknown; _creationTime: number },
>(row: T): Omit<T, "_id" | "_creationTime"> {
  const {
    _id: _ignoredId,
    _creationTime: _ignoredCreationTime,
    ...record
  } = row;
  return record;
}

function titleValue(value: string) {
  const title = value.trim();
  if (title.length < 1 || title.length > maxTitleLength) {
    throw validationError(
      "Title must be between 1 and 160 characters.",
      "title",
    );
  }
  return title;
}

function descriptionValue(value: string) {
  if (value.length > maxDescriptionLength) {
    throw validationError(
      "Description must be at most 4000 characters.",
      "description",
    );
  }
  return value;
}

function tagsValue(tags: string[]) {
  if (tags.length > maxTagCount) {
    throw validationError("A dataset may have at most 10 tags.", "tags");
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    if (
      tag.length < 1 ||
      tag.length > maxTagLength ||
      tag !== tag.trim() ||
      tag !== tag.toLowerCase()
    ) {
      throw validationError(
        "Tags must be non-empty, lowercase, trimmed, and at most 32 characters.",
        "tags",
      );
    }
    if (seen.has(tag)) throw validationError("Tags must be unique.", "tags");
    seen.add(tag);
  }
  return tags;
}

function safeFileName(fileName: string) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(fileName) ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw validationError(
      "Asset name must be a safe relative file name.",
      "fileName",
    );
  }
}

function assertAssetLimits(assets: AssetDescriptor[]) {
  if (assets.length > maxAssetCount) {
    throw validationError(
      "A version may contain at most 50 assets.",
      "manifest",
    );
  }
  let totalBytes = 0;
  const names = new Set<string>();
  for (const asset of assets) {
    safeFileName(asset.fileName);
    assertSafeInteger(asset.sizeBytes, 1, maxAssetBytes);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw validationError(
        "Asset SHA-256 must be lowercase hexadecimal.",
        "manifest",
      );
    }
    const normalized = asset.fileName.toLowerCase();
    if (names.has(normalized)) {
      throw validationError(
        "Asset names must be unique, including case.",
        "manifest",
      );
    }
    names.add(normalized);
    totalBytes += asset.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxVersionBytes) {
      throw validationError(
        "A version may contain at most 100 MiB of assets.",
        "manifest",
      );
    }
  }
}

function privateManifest(input: {
  institutionId: Id<"institutions">;
  publisherLabel: string;
  kind: DatasetKind;
  title: string;
  description: string;
  tags: string[];
  assets: AssetDescriptor[];
  reviewStatus: ReviewStatus;
  reviewNote?: string;
  reviewedAt?: string;
}): { manifestJson: string; manifest: DatasetManifestDTO } {
  const manifest: DatasetManifestDTO = {
    schemaVersion: 1,
    publisher: {
      institutionId: input.institutionId,
      label: input.publisherLabel,
    },
    kind: input.kind,
    title: input.title,
    description: input.description,
    tags: input.tags,
    assets: input.assets,
    review: {
      status: input.reviewStatus,
      ...(input.reviewNote !== undefined ? { note: input.reviewNote } : {}),
      ...(input.reviewedAt !== undefined
        ? { reviewedAt: input.reviewedAt }
        : {}),
    },
  };
  return {
    manifestJson: canonicalizeManifest(manifest),
    manifest,
  };
}

function clearEditableMetadata(
  before: VersionRecord,
  patch: Pick<
    VersionRecord,
    "title" | "description" | "tags" | "manifestJson" | "reviewStatus"
  > &
    Partial<
      Pick<VersionRecord, "reviewedByUserId" | "reviewedAt" | "reviewNote">
    >,
): VersionRecord {
  const {
    reviewedByUserId: _reviewedByUserId,
    reviewedAt: _reviewedAt,
    reviewNote: _reviewNote,
    previewManifestStorageId: _previewManifestStorageId,
    previewContentHash: _previewContentHash,
    previewRevision: _previewRevision,
    previewCreatedAt: _previewCreatedAt,
    previewPublisherLabel: _previewPublisherLabel,
    previewManifestJson: _previewManifestJson,
    ...immutableAndEditable
  } = before;
  return {
    ...immutableAndEditable,
    ...patch,
    draftRevision: before.draftRevision + 1,
  };
}

function previewClearingPatch() {
  return {
    previewManifestStorageId: undefined,
    previewContentHash: undefined,
    previewRevision: undefined,
    previewCreatedAt: undefined,
    previewPublisherLabel: undefined,
    previewManifestJson: undefined,
  };
}

function updateReviewClearingPatch() {
  return {
    reviewedByUserId: undefined,
    reviewedAt: undefined,
    reviewNote: undefined,
  };
}

async function requireDataset(
  ctx: ReadCtx,
  datasetId: Id<"organizationDatasets">,
  roles: Array<"learner" | "instructor" | "admin">,
) {
  const dataset = await ctx.db.get(datasetId);
  if (!dataset) throw notFound("Dataset");
  const { user, institution } = await requireInstitutionRole(
    ctx,
    dataset.institutionId,
    roles,
  );
  if (institution._id !== dataset.institutionId) throw notFound("Dataset");
  return { dataset, user, institution };
}

async function requireVersion(
  ctx: ReadCtx,
  versionId: Id<"organizationDatasetVersions">,
  roles: Array<"learner" | "instructor" | "admin">,
) {
  const version = await ctx.db.get(versionId);
  if (!version) throw notFound("Dataset version");
  const dataset = await ctx.db.get(version.datasetId);
  if (!dataset || dataset.institutionId !== version.institutionId) {
    throw notFound("Dataset version");
  }
  const { user, institution } = await requireInstitutionRole(
    ctx,
    dataset.institutionId,
    roles,
  );
  if (institution._id !== version.institutionId)
    throw notFound("Dataset version");
  return { dataset, version, user, institution };
}

function requireDraft(version: Doc<"organizationDatasetVersions">) {
  if (version.state !== "draft") {
    throw conflict("Only a draft version can be edited.");
  }
}

function requireExpectedDraftRevision(
  version: Doc<"organizationDatasetVersions">,
  expectedRevision: number,
) {
  assertSafeInteger(expectedRevision);
  assertSafeInteger(version.draftRevision);
  if (version.draftRevision !== expectedRevision) {
    throw conflict("Dataset draft changed; reload it before editing.");
  }
}

function asVersionRecord(
  version: Doc<"organizationDatasetVersions">,
): VersionRecord {
  return recordWithoutSystemFields(version) as VersionRecord;
}

function asUploadIntentRecord(
  intent: Doc<"documentUploadIntents">,
): UploadIntentRecord {
  return recordWithoutSystemFields(intent) as UploadIntentRecord;
}

function manifestForVersion(
  version: Doc<"organizationDatasetVersions">,
  institution: Doc<"institutions">,
): DatasetManifestDTO {
  const manifest = parseManifest(version.manifestJson);
  if (
    manifest.publisher.institutionId !== institution._id ||
    manifest.title !== version.title ||
    manifest.description !== version.description ||
    JSON.stringify(manifest.tags) !== JSON.stringify(version.tags) ||
    manifest.review.status !== version.reviewStatus ||
    manifest.review.note !== version.reviewNote ||
    manifest.review.reviewedAt !== version.reviewedAt
  ) {
    throw conflict("Dataset version metadata is inconsistent.");
  }
  if (
    version.reviewStatus === "unreviewed"
      ? version.reviewedByUserId !== undefined ||
        version.reviewedAt !== undefined ||
        version.reviewNote !== undefined
      : version.reviewedByUserId === undefined ||
        version.reviewedAt === undefined
  ) {
    throw conflict("Dataset review provenance is inconsistent.");
  }
  return manifest;
}

function assertAssetRowsMatchManifest(
  version: Doc<"organizationDatasetVersions">,
  institutionId: Id<"institutions">,
  assets: Doc<"organizationDatasetAssets">[],
  manifestAssets: AssetDescriptor[],
) {
  assertAssetLimits(manifestAssets);
  if (assets.length !== manifestAssets.length) {
    throw conflict("Dataset assets do not match the draft manifest.");
  }
  const manifestByName = new Map(
    manifestAssets.map((asset) => [asset.fileName.toLowerCase(), asset]),
  );
  const rowNames = new Set<string>();
  for (const asset of assets) {
    const normalizedFileName = asset.fileName.toLowerCase();
    if (
      asset.versionId !== version._id ||
      asset.institutionId !== institutionId ||
      asset.normalizedFileName !== normalizedFileName ||
      rowNames.has(normalizedFileName)
    ) {
      throw conflict("Dataset asset linkage is inconsistent.");
    }
    rowNames.add(normalizedFileName);
    safeFileName(asset.fileName);
    assertSafeInteger(asset.sizeBytes, 1, maxAssetBytes);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw conflict("Dataset asset checksum is invalid.");
    }
    const descriptor = manifestByName.get(normalizedFileName);
    if (
      !descriptor ||
      descriptor.fileName !== asset.fileName ||
      descriptor.mediaType !== asset.mediaType ||
      descriptor.sizeBytes !== asset.sizeBytes ||
      descriptor.sha256 !== asset.sha256
    ) {
      throw conflict("Dataset assets do not match the draft manifest.");
    }
  }
}

async function readAndValidateVersion(
  ctx: ReadCtx,
  version: Doc<"organizationDatasetVersions">,
  dataset: Doc<"organizationDatasets">,
  institution: Doc<"institutions">,
) {
  if (
    version.institutionId !== dataset.institutionId ||
    version.datasetId !== dataset._id
  ) {
    throw notFound("Dataset version");
  }
  const versionRecord = asVersionRecord(version);
  validateOrganizationRecord("organizationDatasetVersions", versionRecord);
  const manifest = manifestForVersion(version, institution);
  if (manifest.kind !== dataset.kind) {
    throw conflict("Dataset draft metadata is inconsistent.");
  }
  const assets = await ctx.db
    .query("organizationDatasetAssets")
    .withIndex("by_version", (index) => index.eq("versionId", version._id))
    .take(maxAssetCount + 1);
  if (assets.length > maxAssetCount) {
    throw validationError(
      "A version may contain at most 50 assets.",
      "manifest",
    );
  }
  assertAssetRowsMatchManifest(
    version,
    institution._id,
    assets,
    manifest.assets,
  );
  return { manifest, assets };
}

function inputAssetDescriptors(value: unknown) {
  const manifest = validateContract(draftManifestInputValidator, value);
  assertAssetLimits(manifest.assets as AssetDescriptor[]);
  return manifest.assets as AssetDescriptor[];
}

function mergeAssetProvenance(
  incomingAssets: AssetDescriptor[],
  existingAssets: AssetDescriptor[],
) {
  const existingByName = new Map(
    existingAssets.map((asset) => [asset.fileName.toLowerCase(), asset]),
  );
  return incomingAssets.map((asset) => {
    const existing = existingByName.get(asset.fileName.toLowerCase());
    if (!existing || existing.fileName !== asset.fileName) return asset;
    return {
      ...asset,
      provenance: {
        ...existing.provenance,
        ...asset.provenance,
      },
    };
  });
}

function clearPreviewAndReviewFields() {
  return { ...previewClearingPatch(), ...updateReviewClearingPatch() };
}

export const create = mutation({
  args: {
    institutionId: v.id("institutions"),
    title: v.string(),
    description: v.string(),
    kind: datasetKindValidator,
  },
  returns: v.object({
    datasetId: v.id("organizationDatasets"),
    versionId: v.id("organizationDatasetVersions"),
  }),
  handler: async (ctx, args) => {
    const { user, institution } = await requireInstitutionRole(
      ctx,
      args.institutionId,
      ["instructor"],
    );
    const title = titleValue(args.title);
    const description = descriptionValue(args.description);
    const now = new Date().toISOString();
    const dataset = {
      institutionId: institution._id,
      createdByUserId: user._id,
      title,
      description,
      kind: args.kind,
      createdAt: now,
      updatedAt: now,
    };
    validateOrganizationRecord("organizationDatasets", dataset);
    const datasetId = await ctx.db.insert("organizationDatasets", dataset);
    const { manifestJson } = privateManifest({
      institutionId: institution._id,
      publisherLabel: institution.name,
      kind: args.kind,
      title,
      description,
      tags: [],
      assets: [],
      reviewStatus: "unreviewed",
    });
    const version: VersionRecord = {
      datasetId,
      institutionId: institution._id,
      version: 1,
      createdByUserId: user._id,
      state: "draft",
      title,
      description,
      tags: [],
      draftRevision: 0,
      manifestJson,
      reviewStatus: "unreviewed",
      createdAt: now,
    };
    validateOrganizationRecord("organizationDatasetVersions", version);
    const versionId = await ctx.db.insert(
      "organizationDatasetVersions",
      version,
    );
    return { datasetId, versionId };
  },
});

export const newVersion = mutation({
  args: { datasetId: v.id("organizationDatasets") },
  returns: v.object({ versionId: v.id("organizationDatasetVersions") }),
  handler: async (ctx, { datasetId }) => {
    const { dataset, user, institution } = await requireDataset(
      ctx,
      datasetId,
      ["instructor"],
    );
    const openDrafts = await ctx.db
      .query("organizationDatasetVersions")
      .withIndex("by_dataset_state", (index) =>
        index.eq("datasetId", dataset._id).eq("state", "draft"),
      )
      .take(2);
    if (openDrafts.length > 0)
      throw conflict("Dataset already has an open draft.");

    const source = await ctx.db
      .query("organizationDatasetVersions")
      .withIndex("by_dataset_version", (index) =>
        index.eq("datasetId", dataset._id),
      )
      .order("desc")
      .first();
    if (
      !source ||
      (source.state !== "published" && source.state !== "withdrawn")
    ) {
      throw conflict(
        "A published or withdrawn version is required to start a new version.",
      );
    }
    const nextVersion = source.version + 1;
    assertSafeInteger(nextVersion, 2);
    const versionCollision = await ctx.db
      .query("organizationDatasetVersions")
      .withIndex("by_dataset_version", (index) =>
        index.eq("datasetId", dataset._id).eq("version", nextVersion),
      )
      .take(2);
    if (versionCollision.length > 0)
      throw conflict("Dataset version number is already in use.");

    const sourceRecord = asVersionRecord(source);
    validateOrganizationRecord("organizationDatasetVersions", sourceRecord);
    await validatePublicationSnapshot(sourceRecord);
    const { manifest: sourceManifest, assets: sourceAssets } =
      await readAndValidateVersion(ctx, source, dataset, institution);
    const title = titleValue(source.title);
    const description = descriptionValue(source.description);
    const tags = tagsValue(source.tags);
    const { manifestJson } = privateManifest({
      institutionId: institution._id,
      publisherLabel: sourceManifest.publisher.label,
      kind: dataset.kind,
      title,
      description,
      tags,
      assets: sourceManifest.assets,
      reviewStatus: "unreviewed",
    });
    const now = new Date().toISOString();
    const version: VersionRecord = {
      datasetId: dataset._id,
      institutionId: institution._id,
      version: nextVersion,
      createdByUserId: user._id,
      state: "draft",
      title,
      description,
      tags,
      draftRevision: 0,
      manifestJson,
      reviewStatus: "unreviewed",
      createdAt: now,
    };
    validateOrganizationRecord("organizationDatasetVersions", version);
    const versionId = await ctx.db.insert(
      "organizationDatasetVersions",
      version,
    );
    for (const sourceAsset of sourceAssets) {
      const asset: AssetRecord = {
        versionId,
        institutionId: institution._id,
        fileName: sourceAsset.fileName,
        normalizedFileName: sourceAsset.normalizedFileName,
        mediaType: sourceAsset.mediaType,
        sizeBytes: sourceAsset.sizeBytes,
        sha256: sourceAsset.sha256,
        // New versions retain same-organization references; bytes are not read or copied.
        storageId: sourceAsset.storageId,
      };
      validateOrganizationRecord("organizationDatasetAssets", asset);
      await ctx.db.insert("organizationDatasetAssets", asset);
    }
    await ctx.db.patch(dataset._id, { title, description, updatedAt: now });
    return { versionId };
  },
});

export const updateDraft = mutation({
  args: {
    versionId: v.id("organizationDatasetVersions"),
    expectedRevision: v.number(),
    title: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    manifest: draftManifestInputValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { dataset, version, institution } = await requireVersion(
      ctx,
      args.versionId,
      ["instructor"],
    );
    requireDraft(version);
    requireExpectedDraftRevision(version, args.expectedRevision);
    const { manifest: currentManifest, assets } = await readAndValidateVersion(
      ctx,
      version,
      dataset,
      institution,
    );
    const title = titleValue(args.title);
    const description = descriptionValue(args.description);
    const tags = tagsValue(args.tags);
    const assetDescriptors = mergeAssetProvenance(
      inputAssetDescriptors(args.manifest),
      currentManifest.assets,
    );
    assertAssetRowsMatchManifest(
      version,
      institution._id,
      assets,
      assetDescriptors,
    );
    const { manifestJson } = privateManifest({
      institutionId: institution._id,
      publisherLabel: currentManifest.publisher.label,
      kind: dataset.kind,
      title,
      description,
      tags,
      assets: assetDescriptors,
      reviewStatus: "unreviewed",
    });
    const before = asVersionRecord(version);
    const after = clearEditableMetadata(before, {
      title,
      description,
      tags,
      manifestJson,
      reviewStatus: "unreviewed",
    });
    validateDraftEdit(before, after);
    await ctx.db.patch(version._id, {
      title,
      description,
      tags,
      manifestJson,
      reviewStatus: "unreviewed",
      draftRevision: after.draftRevision,
      ...clearPreviewAndReviewFields(),
    });
    await ctx.db.patch(dataset._id, {
      title,
      description,
      updatedAt: new Date().toISOString(),
    });
    return null;
  },
});

export const attachAsset = mutation({
  args: {
    versionId: v.id("organizationDatasetVersions"),
    intentId: v.id("documentUploadIntents"),
    fileName: v.string(),
  },
  returns: v.id("organizationDatasetAssets"),
  handler: async (ctx, args) => {
    const { dataset, version, user, institution } = await requireVersion(
      ctx,
      args.versionId,
      ["instructor"],
    );
    requireDraft(version);
    safeFileName(args.fileName);

    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.userId !== user._id) throw notFound("Upload intent");
    const intentRecord = asUploadIntentRecord(intent);
    validateUploadIntent(intentRecord);
    if (
      intent.scopeKind !== "dataset" ||
      intent.datasetVersionId !== version._id ||
      intent.institutionId !== institution._id ||
      intent.caseSessionId !== undefined
    ) {
      throw conflict("Upload scope mismatch.");
    }

    if (intent.state === "consumed") {
      if (!intent.datasetAssetId || intent.fileName !== args.fileName) {
        throw conflict(
          "Upload receipt was already consumed by another attachment.",
        );
      }
      const linkedAsset = await ctx.db.get(intent.datasetAssetId);
      if (
        !linkedAsset ||
        linkedAsset.versionId !== version._id ||
        linkedAsset.institutionId !== institution._id ||
        linkedAsset.fileName !== intent.fileName ||
        linkedAsset.normalizedFileName !== intent.fileName.toLowerCase() ||
        linkedAsset.mediaType !== intent.mimeType ||
        linkedAsset.sizeBytes !== intent.sizeBytes ||
        linkedAsset.sha256 !== intent.sha256 ||
        linkedAsset.storageId !== intent.storageId
      ) {
        throw conflict("Upload receipt linkage is inconsistent.");
      }
      await readAndValidateVersion(ctx, version, dataset, institution);
      return linkedAsset._id;
    }

    if (intent.state !== "stored" || !intent.storageId) {
      throw conflict("A stored upload receipt is required.");
    }
    if (intent.datasetAssetId !== undefined) {
      throw conflict("Upload receipt already has an asset linkage.");
    }
    const expiry = Date.parse(intent.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      throw conflict("Upload receipt has expired.");
    }
    if (intent.fileName !== args.fileName) {
      throw conflict("Attachment name must match the stored upload receipt.");
    }
    assertSafeInteger(intent.sizeBytes, 1, maxAssetBytes);
    if (!/^[a-f0-9]{64}$/.test(intent.sha256)) {
      throw validationError("Upload receipt checksum is invalid.");
    }

    const { manifest, assets } = await readAndValidateVersion(
      ctx,
      version,
      dataset,
      institution,
    );
    if (assets.length >= maxAssetCount) {
      throw validationError(
        "A version may contain at most 50 assets.",
        "manifest",
      );
    }
    const normalizedFileName = args.fileName.toLowerCase();
    if (
      assets.some((asset) => asset.normalizedFileName === normalizedFileName)
    ) {
      throw conflict("An asset with this name already exists in the version.");
    }
    const descriptor: AssetDescriptor = {
      fileName: args.fileName,
      mediaType: intent.mimeType,
      sizeBytes: intent.sizeBytes,
      sha256: intent.sha256,
      provenance: {},
    };
    const nextAssets = [...manifest.assets, descriptor];
    assertAssetLimits(nextAssets);
    const { manifestJson } = privateManifest({
      institutionId: institution._id,
      publisherLabel: manifest.publisher.label,
      kind: dataset.kind,
      title: version.title,
      description: version.description,
      tags: version.tags,
      assets: nextAssets,
      reviewStatus: "unreviewed",
    });
    const before = asVersionRecord(version);
    const after = clearEditableMetadata(before, {
      title: version.title,
      description: version.description,
      tags: version.tags,
      manifestJson,
      reviewStatus: "unreviewed",
    });
    validateDraftEdit(before, after);

    const storageReferences = await ctx.db
      .query("organizationDatasetAssets")
      .withIndex("by_storage", (index) =>
        index.eq("storageId", intent.storageId!),
      )
      .take(2);
    if (storageReferences.length > 0) {
      throw conflict("Upload storage is already linked to an asset.");
    }
    const asset: AssetRecord = {
      versionId: version._id,
      institutionId: institution._id,
      fileName: args.fileName,
      normalizedFileName,
      mediaType: intent.mimeType,
      sizeBytes: intent.sizeBytes,
      sha256: intent.sha256,
      storageId: intent.storageId,
    };
    validateOrganizationRecord("organizationDatasetAssets", asset);

    const assetId = await ctx.db.insert("organizationDatasetAssets", asset);
    const consumedIntent: UploadIntentRecord = {
      ...intentRecord,
      state: "consumed",
      datasetAssetId: assetId,
    };
    validateUploadIntentTransition(intentRecord, consumedIntent);
    await ctx.db.patch(intent._id, {
      state: "consumed",
      datasetAssetId: assetId,
    });
    await ctx.db.patch(version._id, {
      manifestJson,
      reviewStatus: "unreviewed",
      draftRevision: after.draftRevision,
      ...clearPreviewAndReviewFields(),
    });
    await ctx.db.patch(dataset._id, { updatedAt: new Date().toISOString() });
    return assetId;
  },
});

export const reviewDraft = mutation({
  args: {
    versionId: v.id("organizationDatasetVersions"),
    expectedRevision: v.number(),
    reviewNote: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { versionId, expectedRevision, reviewNote }) => {
    const { dataset, version, user, institution } = await requireVersion(
      ctx,
      versionId,
      ["instructor"],
    );
    requireDraft(version);
    requireExpectedDraftRevision(version, expectedRevision);
    if (reviewNote.length > maxReviewNoteLength) {
      throw validationError(
        "Review note must be at most 4000 characters.",
        "reviewNote",
      );
    }
    const { manifest } = await readAndValidateVersion(
      ctx,
      version,
      dataset,
      institution,
    );
    const reviewedAt = new Date().toISOString();
    const nextManifest = privateManifest({
      institutionId: institution._id,
      publisherLabel: manifest.publisher.label,
      kind: dataset.kind,
      title: version.title,
      description: version.description,
      tags: version.tags,
      assets: manifest.assets,
      reviewStatus: "organization_reviewed",
      reviewNote,
      reviewedAt,
    });
    const before = asVersionRecord(version);
    const after = clearEditableMetadata(before, {
      title: version.title,
      description: version.description,
      tags: version.tags,
      manifestJson: nextManifest.manifestJson,
      reviewStatus: "organization_reviewed",
      reviewedByUserId: user._id,
      reviewedAt,
      reviewNote,
    });
    validateDraftEdit(before, after);
    await ctx.db.patch(version._id, {
      manifestJson: nextManifest.manifestJson,
      reviewStatus: "organization_reviewed",
      reviewedByUserId: user._id,
      reviewedAt,
      reviewNote,
      draftRevision: after.draftRevision,
      ...previewClearingPatch(),
    });
    await ctx.db.patch(dataset._id, { updatedAt: reviewedAt });
    return null;
  },
});

export const listMine = query({
  args: {
    institutionId: v.id("institutions"),
    paginationOpts: listMinePaginationOptsValidator,
  },
  returns: listMineResultValidator,
  handler: async (ctx, { institutionId, paginationOpts }) => {
    const { institution } = await requireInstitutionRole(ctx, institutionId, [
      "learner",
    ]);
    assertSafeInteger(paginationOpts.numItems, 1, 50);
    const datasetPage = await ctx.db
      .query("organizationDatasets")
      .withIndex("by_institution", (index) =>
        index.eq("institutionId", institution._id),
      )
      .order("desc")
      .paginate(paginationOpts);
    const summaries = await Promise.all(
      datasetPage.page.map(async (dataset) => {
        const latest = await ctx.db
          .query("organizationDatasetVersions")
          .withIndex("by_dataset_version", (index) =>
            index.eq("datasetId", dataset._id),
          )
          .order("desc")
          .first();
        if (!latest || latest.institutionId !== institution._id) {
          throw conflict("Dataset version history is inconsistent.");
        }
        assertSafeInteger(latest.version, 1);
        assertSafeInteger(latest.draftRevision);
        return {
          datasetId: dataset._id,
          versionId: latest._id,
          version: latest.version,
          title: latest.title,
          description: latest.description,
          kind: dataset.kind,
          state: latest.state,
          reviewStatus: latest.reviewStatus,
          draftRevision: latest.draftRevision,
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
        };
      }),
    );
    return {
      page: summaries,
      isDone: datasetPage.isDone,
      continueCursor: datasetPage.continueCursor,
    };
  },
});

export const getDraft = query({
  args: { versionId: v.id("organizationDatasetVersions") },
  returns: getDraftDTOValidator,
  handler: async (ctx, { versionId }) => {
    const { dataset, version, institution } = await requireVersion(
      ctx,
      versionId,
      ["learner"],
    );
    if (version.state !== "draft") throw notFound("Dataset draft");
    const { manifest } = await readAndValidateVersion(
      ctx,
      version,
      dataset,
      institution,
    );
    return {
      datasetId: dataset._id,
      versionId: version._id,
      institutionId: institution._id,
      version: version.version,
      title: version.title,
      description: version.description,
      kind: dataset.kind,
      tags: version.tags,
      draftRevision: version.draftRevision,
      reviewStatus: version.reviewStatus,
      ...(version.reviewedAt !== undefined
        ? { reviewedAt: version.reviewedAt }
        : {}),
      ...(version.reviewNote !== undefined
        ? { reviewNote: version.reviewNote }
        : {}),
      manifest,
      createdAt: version.createdAt,
    };
  },
});
