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
import type { Infer, Validator } from "convex/values";
import { validationError, ConvexError, AppErrorCode } from "./errors";

export const organizationKindValidator = v.union(
  v.literal("personal"),
  v.literal("shared"),
);
export const organizationRoleValidator = v.union(
  v.literal("learner"),
  v.literal("instructor"),
  v.literal("admin"),
);
export const datasetKindValidator = v.union(
  v.literal("source_data"),
  v.literal("rule_pack"),
);
export const reviewStatusValidator = v.union(
  v.literal("unreviewed"),
  v.literal("organization_reviewed"),
);
export const assetMediaTypeValidator = v.union(
  v.literal("application/pdf"),
  v.literal("text/plain"),
  v.literal("application/json"),
);
export const catalogUpdateModeValidator = v.union(
  v.literal("manual"),
  v.literal("automatic"),
);
export const catalogUpdateStatusValidator = v.union(
  v.literal("idle"),
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("blocked_budget"),
  v.literal("blocked_access"),
  v.literal("source_unavailable"),
  v.literal("failed"),
);
export const catalogUpdateEventValidator = v.union(
  v.literal("mode_changed"),
  v.literal("update_queued"),
  v.literal("update_acquired"),
  v.literal("update_blocked"),
  v.literal("update_failed"),
);
export const catalogUpdateReasonValidator = v.union(
  v.literal("VALIDATION_ERROR"),
  v.literal("NOT_FOUND"),
  v.literal("AUTH_UNAUTHORIZED_ROLE"),
  v.literal("CONFLICT"),
  v.literal("RATE_LIMITED"),
);

export const uploadScopeValidator = v.union(
  v.object({ kind: v.literal("session"), caseSessionId: v.id("caseSessions") }),
  v.object({
    kind: v.literal("dataset"),
    versionId: v.id("organizationDatasetVersions"),
  }),
);
export const organizationMemberDTOValidator = v.object({
  institutionId: v.id("institutions"),
  name: v.string(),
  kind: organizationKindValidator,
  role: organizationRoleValidator,
});
export const organizationContextDTOValidator = v.object({
  ...organizationMemberDTOValidator.fields,
  expiresAt: v.optional(v.string()),
  capabilities: v.object({
    manageMembers: v.boolean(),
    teach: v.boolean(),
    learn: v.boolean(),
  }),
});
export const datasetManifestDTOValidator = v.object({
  schemaVersion: v.literal(1),
  publisher: v.object({
    institutionId: v.id("institutions"),
    label: v.string(),
  }),
  kind: datasetKindValidator,
  title: v.string(),
  description: v.string(),
  tags: v.array(v.string()),
  assets: v.array(
    v.object({
      fileName: v.string(),
      mediaType: assetMediaTypeValidator,
      sizeBytes: v.number(),
      sha256: v.string(),
      provenance: v.object({
        sourceUrl: v.optional(v.string()),
        retrievedAt: v.optional(v.string()),
        licenseNote: v.optional(v.string()),
      }),
    }),
  ),
  review: v.object({
    status: reviewStatusValidator,
    note: v.optional(v.string()),
    reviewedAt: v.optional(v.string()),
  }),
});
export const publicationPreviewDTOValidator = v.object({
  versionId: v.id("organizationDatasetVersions"),
  revision: v.number(),
  title: v.string(),
  publisherInstitutionId: v.id("institutions"),
  assetNames: v.array(v.string()),
  assetCount: v.number(),
  totalBytes: v.number(),
  reviewStatus: reviewStatusValidator,
  contentHash: v.string(),
  warnings: v.array(v.string()),
});
export const catalogSummaryDTOValidator = v.object({
  datasetId: v.id("organizationDatasets"),
  versionId: v.id("organizationDatasetVersions"),
  title: v.string(),
  description: v.string(),
  publisherInstitutionId: v.id("institutions"),
  publisherLabel: v.string(),
  kind: datasetKindValidator,
  reviewStatus: reviewStatusValidator,
  publishedAt: v.string(),
  contentHash: v.string(),
});
export const catalogVersionDTOValidator = v.object({
  ...catalogSummaryDTOValidator.fields,
  manifest: datasetManifestDTOValidator,
});
export const catalogSearchDTOValidator = v.object({
  items: v.array(catalogSummaryDTOValidator),
  nextCursor: v.union(v.string(), v.null()),
});
export const importResultDTOValidator = v.object({
  importId: v.id("organizationDatasetImports"),
  upstreamVersionId: v.id("organizationDatasetVersions"),
  upstreamContentHash: v.string(),
});
export const catalogUpdatePreferenceDTOValidator = v.object({
  mode: catalogUpdateModeValidator,
  revision: v.number(),
  status: catalogUpdateStatusValidator,
  latestAcquiredImportId: v.optional(v.id("organizationDatasetImports")),
  lastAttemptVersionId: v.optional(v.id("organizationDatasetVersions")),
});
export const catalogUpdateEventDTOValidator = v.object({
  event: catalogUpdateEventValidator,
  mode: catalogUpdateModeValidator,
  createdAt: v.string(),
  actorDisplayName: v.string(),
  versionId: v.optional(v.id("organizationDatasetVersions")),
  importId: v.optional(v.id("organizationDatasetImports")),
  reasonCode: v.optional(catalogUpdateReasonValidator),
});
export const catalogUpdateEventsDTOValidator = v.object({
  items: v.array(catalogUpdateEventDTOValidator),
  nextCursor: v.union(v.string(), v.null()),
});
export type OrganizationKind = Infer<typeof organizationKindValidator>;
export type OrganizationRole = Infer<typeof organizationRoleValidator>;
export type DatasetKind = Infer<typeof datasetKindValidator>;
export type ReviewStatus = Infer<typeof reviewStatusValidator>;
export type UploadScope = Infer<typeof uploadScopeValidator>;
export type OrganizationMemberDTO = Infer<
  typeof organizationMemberDTOValidator
>;
export type OrganizationContextDTO = Infer<
  typeof organizationContextDTOValidator
>;
export type DatasetManifestDTO = Infer<typeof datasetManifestDTOValidator>;
export type PublicationPreviewDTO = Infer<
  typeof publicationPreviewDTOValidator
>;
export type CatalogSummaryDTO = Infer<typeof catalogSummaryDTOValidator>;
export type CatalogVersionDTO = Infer<typeof catalogVersionDTOValidator>;
export type CatalogSearchDTO = Infer<typeof catalogSearchDTOValidator>;
export type ImportResultDTO = Infer<typeof importResultDTOValidator>;
export type CatalogUpdateMode = Infer<typeof catalogUpdateModeValidator>;
export type CatalogUpdateStatus = Infer<typeof catalogUpdateStatusValidator>;
export type CatalogUpdatePreferenceDTO = Infer<
  typeof catalogUpdatePreferenceDTOValidator
>;
export type CatalogUpdateEventDTO = Infer<
  typeof catalogUpdateEventDTOValidator
>;
export type CatalogUpdateEventsDTO = Infer<
  typeof catalogUpdateEventsDTOValidator
>;

// Shared row shapes; semantic checks below must also run before future writes.
export const organizationDatasetsValidator = v.object({
  institutionId: v.id("institutions"),
  createdByUserId: v.id("users"),
  title: v.string(),
  description: v.string(),
  kind: datasetKindValidator,
  createdAt: v.string(),
  updatedAt: v.string(),
});
export const organizationDatasetVersionsValidator = v.object({
  datasetId: v.id("organizationDatasets"),
  institutionId: v.id("institutions"),
  version: v.number(),
  createdByUserId: v.id("users"),
  state: v.union(
    v.literal("draft"),
    v.literal("published"),
    v.literal("withdrawn"),
  ),
  title: v.string(),
  description: v.string(),
  tags: v.array(v.string()),
  draftRevision: v.number(),
  manifestJson: v.string(),
  reviewStatus: reviewStatusValidator,
  reviewedByUserId: v.optional(v.id("users")),
  reviewedAt: v.optional(v.string()),
  reviewNote: v.optional(v.string()),
  createdAt: v.string(),
  previewManifestStorageId: v.optional(v.id("_storage")),
  previewContentHash: v.optional(v.string()),
  previewRevision: v.optional(v.number()),
  previewCreatedAt: v.optional(v.string()),
  previewPublisherLabel: v.optional(v.string()),
  previewManifestJson: v.optional(v.string()),
  manifestStorageId: v.optional(v.id("_storage")),
  contentHash: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
  withdrawnAt: v.optional(v.string()),
  publisherLabel: v.optional(v.string()),
});
export const organizationDatasetAssetsValidator = v.object({
  versionId: v.id("organizationDatasetVersions"),
  institutionId: v.id("institutions"),
  fileName: v.string(),
  normalizedFileName: v.string(),
  mediaType: assetMediaTypeValidator,
  sizeBytes: v.number(),
  sha256: v.string(),
  storageId: v.id("_storage"),
});
export const publicCatalogEntriesValidator = v.object({
  datasetId: v.id("organizationDatasets"),
  versionId: v.id("organizationDatasetVersions"),
  publisherInstitutionId: v.id("institutions"),
  publisherLabel: v.string(),
  title: v.string(),
  description: v.string(),
  kind: datasetKindValidator,
  tags: v.array(v.string()),
  searchText: v.string(),
  reviewStatus: reviewStatusValidator,
  publishedAt: v.string(),
  contentHash: v.string(),
});
export const organizationDatasetImportsValidator = v.object({
  institutionId: v.id("institutions"),
  importedByUserId: v.id("users"),
  upstreamDatasetId: v.id("organizationDatasets"),
  upstreamVersionId: v.id("organizationDatasetVersions"),
  upstreamContentHash: v.string(),
  manifestStorageId: v.id("_storage"),
  manifestJson: v.string(),
  importedAt: v.string(),
});
export const organizationImportedAssetsValidator = v.object({
  importId: v.id("organizationDatasetImports"),
  institutionId: v.id("institutions"),
  fileName: v.string(),
  mediaType: assetMediaTypeValidator,
  sizeBytes: v.number(),
  sha256: v.string(),
  storageId: v.id("_storage"),
});
export const documentUploadIntentsValidator = v.object({
  institutionId: v.id("institutions"),
  scopeKind: v.union(v.literal("session"), v.literal("dataset")),
  caseSessionId: v.optional(v.id("caseSessions")),
  datasetVersionId: v.optional(v.id("organizationDatasetVersions")),
  userId: v.id("users"),
  fileName: v.string(),
  sizeBytes: v.number(),
  sha256: v.string(),
  mimeType: assetMediaTypeValidator,
  chunkCount: v.number(),
  state: v.union(
    v.literal("pending"),
    v.literal("stored"),
    v.literal("consumed"),
    v.literal("cancelled"),
  ),
  expiresAt: v.string(),
  createdAt: v.string(),
  // Internal lease fields; user-visible upload states remain unchanged.
  completionClaimToken: v.optional(v.string()),
  completionClaimExpiresAt: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  documentId: v.optional(v.id("documents")),
  analysisId: v.optional(v.id("documentAnalyses")),
  datasetAssetId: v.optional(v.id("organizationDatasetAssets")),
});
export const documentUploadChunksValidator = v.object({
  intentId: v.id("documentUploadIntents"),
  index: v.number(),
  storageId: v.id("_storage"),
  sizeBytes: v.number(),
  sha256: v.string(),
});
export const organizationMigrationFindingsValidator = v.object({
  migrationKey: v.string(),
  tableName: v.string(),
  recordId: v.string(),
  reason: v.string(),
  status: v.union(v.literal("open"), v.literal("resolved")),
  createdAt: v.string(),
});
export const organizationCatalogSubscriptionsValidator = v.object({
  institutionId: v.id("institutions"),
  upstreamDatasetId: v.id("organizationDatasets"),
  mode: catalogUpdateModeValidator,
  revision: v.number(),
  changedByUserId: v.id("users"),
  updatedAt: v.string(),
  lastAttemptVersionId: v.optional(v.id("organizationDatasetVersions")),
  lastAttemptRevision: v.optional(v.number()),
  status: catalogUpdateStatusValidator,
  latestAcquiredImportId: v.optional(v.id("organizationDatasetImports")),
  lastErrorCode: v.optional(catalogUpdateReasonValidator),
});
export const organizationCatalogUpdateEventsValidator = v.object({
  subscriptionId: v.id("organizationCatalogSubscriptions"),
  institutionId: v.id("institutions"),
  actorUserId: v.id("users"),
  subscriptionRevision: v.number(),
  event: catalogUpdateEventValidator,
  mode: catalogUpdateModeValidator,
  createdAt: v.string(),
  versionId: v.optional(v.id("organizationDatasetVersions")),
  importId: v.optional(v.id("organizationDatasetImports")),
  reasonCode: v.optional(catalogUpdateReasonValidator),
});

export const organizationRecordValidators = {
  organizationDatasets: organizationDatasetsValidator,
  organizationDatasetVersions: organizationDatasetVersionsValidator,
  organizationDatasetAssets: organizationDatasetAssetsValidator,
  publicCatalogEntries: publicCatalogEntriesValidator,
  organizationDatasetImports: organizationDatasetImportsValidator,
  organizationImportedAssets: organizationImportedAssetsValidator,
  documentUploadIntents: documentUploadIntentsValidator,
  documentUploadChunks: documentUploadChunksValidator,
  organizationMigrationFindings: organizationMigrationFindingsValidator,
  organizationCatalogSubscriptions: organizationCatalogSubscriptionsValidator,
  organizationCatalogUpdateEvents: organizationCatalogUpdateEventsValidator,
} as const;
export type OrganizationRecords = {
  [K in keyof typeof organizationRecordValidators]: Infer<
    (typeof organizationRecordValidators)[K]
  >;
};

export const MAX_CANONICAL_MANIFEST_BYTES = 262144;

type ValidatorShape = Validator<unknown, "required" | "optional", string>;
/** JSON manifests cannot use Convex's argument validator. Validate their complete
 * shape here; typed IDs are additionally checked by Convex at API/DB boundaries.
 * Pass db.normalizeId via this adapter when validating IDs from parsed JSON. */
export type ContractIdCheck = (table: string, value: string) => boolean;

function matchesShape(
  shape: ValidatorShape,
  value: unknown,
  checkId?: ContractIdCheck,
): boolean {
  switch (shape.kind) {
    case "null":
      return value === null;
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "float64":
      return typeof value === "number" && Number.isFinite(value);
    case "literal":
      return value === shape.value;
    case "id":
      return (
        typeof value === "string" &&
        value.length > 0 &&
        (!checkId || checkId(shape.tableName, value))
      );
    case "array":
      return (
        Array.isArray(value) &&
        Object.keys(value).length === value.length &&
        Array.from(value).every((item) =>
          matchesShape(shape.element, item, checkId),
        )
      );
    case "union":
      return shape.members.some((member) =>
        matchesShape(member, value, checkId),
      );
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const record = value as Record<string, unknown>;
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        return false;
      if (Object.keys(record).some((key) => !Object.hasOwn(shape.fields, key)))
        return false;
      return Object.entries(shape.fields).every(([key, field]) =>
        !Object.hasOwn(record, key)
          ? field.isOptional === "optional"
          : matchesShape(field, record[key], checkId),
      );
    }
    default:
      return false; // No broader Convex types are part of this wire contract.
  }
}

/** Accept UTC Z or +00:00, with seconds and optional millisecond precision.
 * Calendar round-trip rejects JS Date's silent normalization of impossible dates. */
export function isUtcTimestamp(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(
      value,
    )
  )
    return false;
  const normalized = value.replace(/\+00:00$/, "Z");
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) return false;
  const [seconds, fraction = ""] = normalized.slice(0, -1).split(".");
  return (
    new Date(time).toISOString() === `${seconds}.${fraction.padEnd(3, "0")}Z`
  );
}

export function assertSafeInteger(
  value: number,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw validationError("Invalid integer bounds");
}

function validateScalars(value: unknown, key = ""): void {
  if (typeof value === "number") {
    assertSafeInteger(
      value,
      key === "version" || key === "chunkCount" ? 1 : 0,
      key === "index" ? 6 : key === "chunkCount" ? 7 : Number.MAX_SAFE_INTEGER,
    );
  } else if (typeof value === "string") {
    if (key.endsWith("At") && !isUtcTimestamp(value))
      throw validationError("Invalid UTC timestamp");
    if (
      (key === "sha256" || /(?:contentHash|ContentHash)$/.test(key)) &&
      !/^[a-f0-9]{64}$/.test(value)
    )
      throw validationError("Invalid SHA256");
    if (key === "sourceUrl") {
      try {
        if (new URL(value).protocol !== "https:") throw new Error();
      } catch {
        throw validationError("Source URL must be HTTPS metadata");
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => validateScalars(item));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([field, item]) =>
      validateScalars(item, field),
    );
  }
}

/** Use alongside Convex args/returns validators: v.number/v.string alone cannot
 * enforce safe integers, calendar validity, hash format or cross-field rules. */
export function validateContract<V extends ValidatorShape>(
  validator: V,
  value: unknown,
  checkId?: ContractIdCheck,
): Infer<V> {
  if (!matchesShape(validator, value, checkId))
    throw validationError("Invalid organization contract shape");
  validateScalars(value);
  return value as Infer<V>;
}

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(lexical)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeManifest(
  value: unknown,
  checkId?: ContractIdCheck,
): string {
  const manifest = validateContract(
    datasetManifestDTOValidator,
    value,
    checkId,
  );
  const names = new Set<string>();
  for (const asset of manifest.assets) {
    const name = asset.fileName.toLowerCase();
    if (names.has(name)) throw validationError("Duplicate manifest asset name");
    names.add(name);
  }
  const json = canonicalJson({
    ...manifest,
    assets: [...manifest.assets].sort((a, b) =>
      lexical(a.fileName, b.fileName),
    ),
  });
  if (new TextEncoder().encode(json).byteLength > MAX_CANONICAL_MANIFEST_BYTES)
    throw validationError("Manifest exceeds canonical UTF-8 limit");
  return json;
}

export function parseManifest(
  json: string,
  checkId?: ContractIdCheck,
): DatasetManifestDTO {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw validationError("Invalid manifest JSON");
  }
  return JSON.parse(canonicalizeManifest(value, checkId)) as DatasetManifestDTO;
}

export async function hashManifest(
  value: unknown,
  checkId?: ContractIdCheck,
): Promise<{ manifestJson: string; contentHash: string }> {
  const manifestJson = canonicalizeManifest(value, checkId);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(manifestJson),
  );
  return {
    manifestJson,
    contentHash: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

const previewFields = [
  "previewManifestStorageId",
  "previewContentHash",
  "previewRevision",
  "previewCreatedAt",
  "previewPublisherLabel",
  "previewManifestJson",
] as const;

export function validateUploadIntent(
  value: OrganizationRecords["documentUploadIntents"],
): void {
  validateContract(documentUploadIntentsValidator, value);
  if (
    (value.completionClaimToken === undefined) !==
    (value.completionClaimExpiresAt === undefined)
  ) {
    throw validationError("Upload completion claim linkage is incomplete");
  }
  if (
    value.completionClaimToken !== undefined &&
    (value.state !== "pending" ||
      !isUtcTimestamp(value.completionClaimExpiresAt!) ||
      Date.parse(value.completionClaimExpiresAt!) > Date.parse(value.expiresAt))
  ) {
    throw validationError("Invalid upload completion claim");
  }
  if (value.scopeKind === "session") {
    if (
      !value.caseSessionId ||
      value.datasetVersionId !== undefined ||
      value.datasetAssetId !== undefined
    )
      throw validationError("Invalid session upload linkage");
    if (value.state === "consumed" && (!value.documentId || !value.analysisId))
      throw validationError(
        "Consumed session upload requires document and analysis",
      );
  } else {
    if (
      !value.datasetVersionId ||
      value.caseSessionId !== undefined ||
      value.documentId !== undefined ||
      value.analysisId !== undefined
    )
      throw validationError("Invalid dataset upload linkage");
    if (value.state === "consumed" && !value.datasetAssetId)
      throw validationError("Consumed dataset upload requires asset");
  }
  if (
    (value.state === "stored" || value.state === "consumed") &&
    !value.storageId
  )
    throw validationError("Stored upload requires storage");
}

/** Validates a complete new row, not a partial patch. Relational checks and
 * index read/write uniqueness still belong in the owning transaction. */
export function validateOrganizationRecord<K extends keyof OrganizationRecords>(
  table: K,
  value: OrganizationRecords[K],
  checkId?: ContractIdCheck,
): void {
  validateContract(organizationRecordValidators[table], value, checkId);
  if (table === "documentUploadIntents")
    validateUploadIntent(value as OrganizationRecords["documentUploadIntents"]);
  if (table === "organizationDatasetAssets") {
    const asset = value as OrganizationRecords["organizationDatasetAssets"];
    if (asset.normalizedFileName !== asset.fileName.toLowerCase())
      throw validationError("Invalid normalized asset name");
  }
  if (table === "organizationDatasetVersions") {
    const version = value as OrganizationRecords["organizationDatasetVersions"];
    parseManifest(version.manifestJson, checkId);
    if (
      version.state !== "draft" &&
      (!version.manifestStorageId ||
        !version.contentHash ||
        !version.publishedAt ||
        version.publisherLabel === undefined)
    )
      throw validationError("Published snapshot fields are required");
    const hasPreview = previewFields.some(
      (field) => version[field] !== undefined,
    );
    if (
      hasPreview &&
      previewFields.some((field) => version[field] === undefined)
    )
      throw validationError("Incomplete publication preview");
    if (hasPreview && version.previewRevision !== version.draftRevision)
      throw validationError("Stale publication preview");
    if (version.previewManifestJson !== undefined)
      parseManifest(version.previewManifestJson, checkId);
  }
  if (table === "organizationDatasetImports")
    parseManifest(
      (value as OrganizationRecords["organizationDatasetImports"]).manifestJson,
      checkId,
    );
}

/** Apply when future code replaces a version; never silently mutate snapshots. */
export function validateVersionTransition(
  before: OrganizationRecords["organizationDatasetVersions"],
  after: OrganizationRecords["organizationDatasetVersions"],
): void {
  validateOrganizationRecord("organizationDatasetVersions", after);
  const conflict = () => {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "Immutable version or scope mismatch",
    );
  };
  for (const field of [
    "datasetId",
    "institutionId",
    "version",
    "createdByUserId",
    "createdAt",
  ] as const) {
    if (before[field] !== after[field]) conflict();
  }
  if (before.state !== "draft") {
    const {
      state: oldState,
      withdrawnAt: oldWithdrawal,
      ...oldSnapshot
    } = before;
    const {
      state: newState,
      withdrawnAt: newWithdrawal,
      ...newSnapshot
    } = after;
    if (canonicalJson(oldSnapshot) !== canonicalJson(newSnapshot)) conflict();
    if (
      oldState === "withdrawn"
        ? newState !== oldState || oldWithdrawal !== newWithdrawal
        : newState !== "published" && newState !== "withdrawn"
    )
      conflict();
    if (
      oldState === "published" &&
      newState === "published" &&
      oldWithdrawal !== newWithdrawal
    )
      conflict();
    if (oldState === "published" && newState === "withdrawn" && !newWithdrawal)
      conflict();
  } else if (after.state === "withdrawn") conflict();
}

/** Call for every draft edit, including asset/review edits held in other rows. */
export function validateDraftEdit(
  before: OrganizationRecords["organizationDatasetVersions"],
  after: OrganizationRecords["organizationDatasetVersions"],
): void {
  validateVersionTransition(before, after);
  if (
    before.state !== "draft" ||
    after.state !== "draft" ||
    after.draftRevision !== before.draftRevision + 1 ||
    previewFields.some((field) => after[field] !== undefined)
  ) {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "Draft edit requires a new revision and cleared preview",
    );
  }
}

/** Verify the immutable snapshot's canonical bytes and hash before publication
 * or import finalization. No metadata URL is fetched by these helpers. */
export async function validateManifestSnapshot(
  manifestJson: string,
  contentHash: string,
  checkId?: ContractIdCheck,
): Promise<DatasetManifestDTO> {
  const manifest = parseManifest(manifestJson, checkId);
  const expected = await hashManifest(manifest, checkId);
  if (
    manifestJson !== expected.manifestJson ||
    contentHash !== expected.contentHash
  )
    throw new ConvexError(AppErrorCode.CONFLICT, "Manifest snapshot mismatch");
  return manifest;
}

/** These compatibility guards do not authorize operations or create records. */
export function validateScenarioOrganization(value: {
  institutionId?: string;
  visibility?: "public_template" | "private";
}): void {
  if (value.institutionId !== undefined && value.visibility !== "private")
    throw validationError("Only private scenarios have an organization");
}
export function isOrganizationMembershipActive(
  institution: { status: string } | null,
  membership: { status: string; expiresAt?: string } | null,
  now: number,
): boolean {
  return (
    Number.isFinite(now) &&
    institution?.status === "active" &&
    membership?.status === "active" &&
    (membership.expiresAt === undefined ||
      (isUtcTimestamp(membership.expiresAt) &&
        Date.parse(membership.expiresAt) > now))
  );
}

export function validateUploadScopeMatch(
  scope: UploadScope,
  intent: OrganizationRecords["documentUploadIntents"],
): void {
  validateContract(uploadScopeValidator, scope);
  validateUploadIntent(intent);
  if (
    scope.kind !== intent.scopeKind ||
    (scope.kind === "session"
      ? scope.caseSessionId !== intent.caseSessionId
      : scope.versionId !== intent.datasetVersionId)
  ) {
    throw new ConvexError(AppErrorCode.CONFLICT, "Upload scope mismatch");
  }
}

export function validateUploadIntentTransition(
  before: OrganizationRecords["documentUploadIntents"],
  after: OrganizationRecords["documentUploadIntents"],
): void {
  validateUploadIntent(after);
  for (const field of [
    "institutionId",
    "scopeKind",
    "caseSessionId",
    "datasetVersionId",
    "userId",
    "fileName",
    "sizeBytes",
    "sha256",
    "mimeType",
    "chunkCount",
    "expiresAt",
    "createdAt",
  ] as const) {
    if (before[field] !== after[field])
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Immutable upload scope mismatch",
      );
  }
  if (
    before.state === "pending" &&
    after.state === "pending" &&
    before.completionClaimToken !== undefined &&
    after.completionClaimToken !== undefined &&
    before.completionClaimToken !== after.completionClaimToken &&
    Date.parse(before.completionClaimExpiresAt ?? "") > Date.now()
  ) {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "A live upload completion claim cannot be replaced",
    );
  }
  if (
    before.completionClaimToken !== undefined &&
    before.completionClaimToken === after.completionClaimToken &&
    before.completionClaimExpiresAt !== after.completionClaimExpiresAt
  ) {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "Upload completion claim lease is immutable",
    );
  }
  for (const field of [
    "storageId",
    "documentId",
    "analysisId",
    "datasetAssetId",
  ] as const) {
    if (before[field] !== undefined && before[field] !== after[field])
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Conflicting upload linkage",
      );
  }
}

/** Import rows and their private asset copies have no mutable version alias. */
export function validateImmutableImport(
  before: OrganizationRecords["organizationDatasetImports"],
  after: OrganizationRecords["organizationDatasetImports"],
): void {
  validateOrganizationRecord("organizationDatasetImports", after);
  if (canonicalJson(before) !== canonicalJson(after))
    throw new ConvexError(AppErrorCode.CONFLICT, "Immutable import mismatch");
}

/** Bind published metadata and asset descriptors to the exact canonical snapshot.
 * The transaction must additionally resolve parent IDs and enforce uniqueness. */
export async function validatePublicationSnapshot(
  version: OrganizationRecords["organizationDatasetVersions"],
): Promise<DatasetManifestDTO> {
  validateOrganizationRecord("organizationDatasetVersions", version);
  if (version.state === "draft" || !version.contentHash)
    throw validationError("Published version required");
  const manifest = await validateManifestSnapshot(
    version.manifestJson,
    version.contentHash,
  );
  if (
    manifest.publisher.institutionId !== version.institutionId ||
    manifest.publisher.label !== version.publisherLabel ||
    manifest.title !== version.title ||
    manifest.description !== version.description ||
    canonicalJson(manifest.tags) !== canonicalJson(version.tags) ||
    manifest.review.status !== version.reviewStatus ||
    manifest.review.note !== version.reviewNote ||
    manifest.review.reviewedAt !== version.reviewedAt
  ) {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "Publication metadata mismatch",
    );
  }
  return manifest;
}
