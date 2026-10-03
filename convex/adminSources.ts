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

import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./authHelpers";
import { writeAuditLog } from "./authz";
import { validationError } from "./errors";
import { fourthCircuitCivilAppealSourceManifest } from "../src/domain/rules/source-manifest";
import {
  ca4CourtSourceVersions,
  ca4DeadlineRules,
  ca4SourceBackedConstraints,
} from "../src/domain/rules/ca4-source-profile";
import {
  sourceFreshnessStatuses,
  validateEvalFreshness,
} from "../src/domain/rules/source-governance";
import { ca4EcfCatalogEvents } from "../src/domain/filing/ca4-ecf-catalog";
import { ca4FormTemplates } from "../src/packages/trial-record-pdfs";

type ReadCtx = QueryCtx | MutationCtx;

function simpleHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function requireAdmin(ctx: ReadCtx): Promise<Doc<"users">> {
  await requireCurrentUser(ctx);
  throw validationError("Use organization membership management");
}

export const seedSourceManifest = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    let count = 0;
    for (const source of fourthCircuitCivilAppealSourceManifest) {
      const existing = await ctx.db
        .query("legalSourceVersions")
        .withIndex("by_source_version", (index) =>
          index.eq("sourceVersionId", source.sourceVersionId),
        )
        .unique();
      const doc = {
        sourceVersionId: source.sourceVersionId,
        moduleId: source.moduleId,
        label: source.label,
        jurisdiction: source.jurisdiction,
        version: source.version,
        effectiveFrom: source.effectiveFrom,
        sourceUrl: source.sourceUrl,
        sourceSystem: source.sourceSystem,
        reviewed:
          source.reviewStatus === "reviewed" ||
          source.reviewStatus === "published",
        metadataJson: JSON.stringify({
          parserVersion: source.parserVersion,
          contentHash: source.contentHash,
          reviewStatus: source.reviewStatus,
          ruleRefs: source.ruleRefs,
        }),
      };
      if (existing) {
        await ctx.db.patch(existing._id, doc);
      } else {
        await ctx.db.insert("legalSourceVersions", doc);
      }
      count += 1;
    }
    return count;
  },
});

export const storeSnapshot = mutation({
  args: {
    sourceVersionId: v.string(),
    rawText: v.string(),
    parserVersion: v.string(),
  },
  returns: v.id("legalSourceSnapshots"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return ctx.db.insert("legalSourceSnapshots", {
      sourceVersionId: args.sourceVersionId,
      fetchedAt: new Date().toISOString(),
      contentHash: simpleHash(args.rawText),
      rawText: args.rawText,
      parserVersion: args.parserVersion,
      reviewStatus: "draft",
    });
  },
});

export const upsertSourceArtifact = mutation({
  args: {
    sourceVersionId: v.string(),
    label: v.string(),
    url: v.string(),
    rawText: v.string(),
    parserVersion: v.string(),
    contentHash: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    rawStorageId: v.optional(v.id("_storage")),
  },
  returns: v.id("sourceArtifacts"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const contentHash = args.contentHash ?? simpleHash(args.rawText);
    const sourceArtifacts = await ctx.db
      .query("sourceArtifacts")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", args.sourceVersionId),
      )
      .collect();
    const existing = sourceArtifacts
      .filter(
        (artifact) =>
          artifact.url === args.url && artifact.contentHash === contentHash,
      )
      .sort((a, b) => b._creationTime - a._creationTime)[0];
    const doc = {
      sourceVersionId: args.sourceVersionId,
      label: args.label,
      url: args.url,
      fetchedAt: new Date().toISOString(),
      contentHash,
      parserVersion: args.parserVersion,
      ...(args.effectiveDate ? { effectiveDate: args.effectiveDate } : {}),
      ...(args.mediaType ? { mediaType: args.mediaType } : {}),
      ...(args.rawStorageId ? { rawStorageId: args.rawStorageId } : {}),
      rawText: args.rawText,
      reviewStatus: "draft" as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return ctx.db.insert("sourceArtifacts", doc);
  },
});

export const upsertStoredSourceArtifact = internalMutation({
  args: {
    sourceVersionId: v.string(),
    label: v.string(),
    url: v.string(),
    rawText: v.optional(v.string()),
    parserVersion: v.string(),
    contentHash: v.string(),
    effectiveDate: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    rawStorageId: v.optional(v.id("_storage")),
    reviewStatus: v.union(
      v.literal("draft"),
      v.literal("reviewed"),
      v.literal("published"),
      v.literal("rejected"),
    ),
  },
  returns: v.id("sourceArtifacts"),
  handler: async (ctx, args) => {
    const sourceArtifacts = await ctx.db
      .query("sourceArtifacts")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", args.sourceVersionId),
      )
      .collect();
    const existing = sourceArtifacts
      .filter(
        (artifact) =>
          artifact.url === args.url &&
          artifact.contentHash === args.contentHash,
      )
      .sort((a, b) => b._creationTime - a._creationTime)[0];
    const doc = {
      sourceVersionId: args.sourceVersionId,
      label: args.label,
      url: args.url,
      fetchedAt: new Date().toISOString(),
      contentHash: args.contentHash,
      parserVersion: args.parserVersion,
      ...(args.effectiveDate ? { effectiveDate: args.effectiveDate } : {}),
      ...(args.mediaType ? { mediaType: args.mediaType } : {}),
      ...(args.rawStorageId ? { rawStorageId: args.rawStorageId } : {}),
      ...(args.rawText ? { rawText: args.rawText } : {}),
      reviewStatus: args.reviewStatus,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return ctx.db.insert("sourceArtifacts", doc);
  },
});

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const storeCa4FormPdfArtifacts = internalAction({
  args: {},
  returns: v.object({
    stored: v.number(),
    failed: v.array(
      v.object({
        label: v.string(),
        sourceUrl: v.string(),
        reason: v.string(),
      }),
    ),
  }),
  handler: async (ctx) => {
    let stored = 0;
    const failed: Array<{ label: string; sourceUrl: string; reason: string }> =
      [];
    for (const template of ca4FormTemplates) {
      try {
        const response = await fetch(template.sourceUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const contentType =
          response.headers.get("content-type") ?? template.mediaType;
        if (!contentType.toLowerCase().includes("pdf")) {
          throw new Error(`Expected PDF, received ${contentType}`);
        }
        const buffer = await response.arrayBuffer();
        const sha256 = await sha256Hex(buffer);
        const blob = new Blob([buffer], { type: template.mediaType });
        const storageId = await ctx.storage.store(blob, { sha256 });
        await ctx.runMutation(
          internal.adminSources.upsertStoredSourceArtifact,
          {
            sourceVersionId: template.sourceVersionId,
            label: template.label,
            url: template.sourceUrl,
            rawText: JSON.stringify({
              formTemplateId: template.id,
              category: template.category,
              fileName: template.fileName,
            }),
            parserVersion: "ca4-form-pdf-catalog-v1",
            contentHash: `sha256:${sha256}`,
            mediaType: template.mediaType,
            rawStorageId: storageId,
            reviewStatus: "published",
          },
        );
        stored += 1;
      } catch (error) {
        failed.push({
          label: template.label,
          sourceUrl: template.sourceUrl,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { stored, failed };
  },
});

export const decideSourceArtifact = mutation({
  args: {
    sourceArtifactId: v.id("sourceArtifacts"),
    decision: v.union(
      v.literal("reviewed"),
      v.literal("published"),
      v.literal("rejected"),
    ),
    notes: v.string(),
    changedConstraintsJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const artifact = await ctx.db.get(args.sourceArtifactId);
    if (!artifact) {
      throw new Error("Source artifact not found.");
    }
    await ctx.db.patch(args.sourceArtifactId, { reviewStatus: args.decision });
    await ctx.db.insert("sourceReviewDecisions", {
      sourceArtifactId: args.sourceArtifactId,
      reviewerUserId: user._id,
      decision: args.decision,
      notes: args.notes,
      ...(args.changedConstraintsJson
        ? { changedConstraintsJson: args.changedConstraintsJson }
        : {}),
      createdAt: new Date().toISOString(),
    });

    const source = await ctx.db
      .query("legalSourceVersions")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", artifact.sourceVersionId),
      )
      .unique();
    if (source) {
      await ctx.db.patch(source._id, {
        reviewed: args.decision !== "rejected",
      });
    }
    return null;
  },
});

export const publishSourceSnapshot = mutation({
  args: {
    sourceVersionId: v.string(),
    reviewStatus: v.union(
      v.literal("reviewed"),
      v.literal("published"),
      v.literal("rejected"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const snapshot = await ctx.db
      .query("legalSourceSnapshots")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", args.sourceVersionId),
      )
      .order("desc")
      .first();
    if (!snapshot) {
      throw new Error("No source snapshot exists for this source version.");
    }
    await ctx.db.patch(snapshot._id, { reviewStatus: args.reviewStatus });
    const source = await ctx.db
      .query("legalSourceVersions")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", args.sourceVersionId),
      )
      .unique();
    if (source) {
      await ctx.db.patch(source._id, {
        reviewed: args.reviewStatus !== "rejected",
      });
    }
    return null;
  },
});

async function requireReviewedSources(
  ctx: ReadCtx,
  sourceVersionIds: string[],
) {
  const uniqueIds = [...new Set(sourceVersionIds)];
  for (const sourceVersionId of uniqueIds) {
    const snapshot = await ctx.db
      .query("legalSourceSnapshots")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", sourceVersionId),
      )
      .order("desc")
      .first();
    const bundledReviewed = ca4CourtSourceVersions.some(
      (source) =>
        source.sourceVersionId === sourceVersionId &&
        ["reviewed", "published"].includes(source.reviewStatus),
    );
    const artifact = await ctx.db
      .query("sourceArtifacts")
      .withIndex("by_source_version", (index) =>
        index.eq("sourceVersionId", sourceVersionId),
      )
      .order("desc")
      .first();
    if (
      !bundledReviewed &&
      snapshot?.reviewStatus !== "published" &&
      !["reviewed", "published"].includes(artifact?.reviewStatus ?? "draft")
    ) {
      throw new Error(
        `Source ${sourceVersionId} must be reviewed before publication.`,
      );
    }
  }
}

export const publishEcfCatalogEvents = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await requireReviewedSources(
      ctx,
      ca4EcfCatalogEvents.flatMap((event) => event.sourceVersionIds),
    );
    let count = 0;
    for (const event of ca4EcfCatalogEvents) {
      const existing = await ctx.db
        .query("ecfCatalogEvents")
        .withIndex("by_event", (index) =>
          index
            .eq("courtPackId", "us-federal-ca4-civil-appeal")
            .eq("eventId", event.eventId),
        )
        .unique();
      const doc = {
        courtPackId: "us-federal-ca4-civil-appeal",
        eventId: event.eventId,
        catalogJson: JSON.stringify(event),
        sourceVersionIds: event.sourceVersionIds,
        published: true,
      };
      if (existing) await ctx.db.patch(existing._id, doc);
      else await ctx.db.insert("ecfCatalogEvents", doc);
      count += 1;
    }
    return count;
  },
});

export const publishDeadlineRules = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await requireReviewedSources(
      ctx,
      ca4DeadlineRules.flatMap((rule) =>
        rule.ruleRefs.map((ruleRef) =>
          ruleRef.ruleId.startsWith("CA4_")
            ? "ca4-local-rules-current-2026-03-23"
            : "frap-effective-2025-12-01",
        ),
      ),
    );
    let count = 0;
    for (const rule of ca4DeadlineRules) {
      const sourceVersionIds = [
        "frap-effective-2025-12-01",
        ...(rule.ruleRefs.some((ruleRef) => ruleRef.ruleId.startsWith("CA4_"))
          ? ["ca4-local-rules-current-2026-03-23"]
          : []),
      ];
      const existing = await ctx.db
        .query("deadlineRules")
        .withIndex("by_deadline", (index) =>
          index
            .eq("courtPackId", "us-federal-ca4-civil-appeal")
            .eq("deadlineId", rule.deadlineId),
        )
        .unique();
      const doc = {
        courtPackId: "us-federal-ca4-civil-appeal",
        deadlineId: rule.deadlineId,
        deadlineJson: JSON.stringify(rule),
        sourceVersionIds,
        published: true,
      };
      if (existing) await ctx.db.patch(existing._id, doc);
      else await ctx.db.insert("deadlineRules", doc);
      count += 1;
    }
    return count;
  },
});

export const publishSourceBackedConstraints = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await requireReviewedSources(
      ctx,
      ca4SourceBackedConstraints.flatMap(
        (constraint) => constraint.sourceVersionIds,
      ),
    );
    let count = 0;
    for (const constraint of ca4SourceBackedConstraints) {
      const existing = await ctx.db
        .query("sourceBackedConstraints")
        .withIndex("by_constraint", (index) =>
          index
            .eq("courtPackId", "us-federal-ca4-civil-appeal")
            .eq("constraintId", constraint.constraintId),
        )
        .unique();
      const doc = {
        courtPackId: "us-federal-ca4-civil-appeal",
        constraintId: constraint.constraintId,
        constraintJson: JSON.stringify(constraint),
        sourceVersionIds: constraint.sourceVersionIds,
        published: true,
      };
      if (existing) await ctx.db.patch(existing._id, doc);
      else await ctx.db.insert("sourceBackedConstraints", doc);
      count += 1;
    }
    return count;
  },
});

export const addReviewNote = mutation({
  args: {
    sourceVersionId: v.string(),
    note: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    await ctx.db.insert("ruleReviewNotes", {
      sourceVersionId: args.sourceVersionId,
      reviewerUserId: user._id,
      note: args.note,
      createdAt: new Date().toISOString(),
    });
    return null;
  },
});

export const listSources = query({
  args: {},
  returns: v.array(
    v.object({
      sourceVersionId: v.string(),
      label: v.string(),
      sourceUrl: v.string(),
      reviewed: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const sources = await ctx.db.query("legalSourceVersions").collect();
    return sources.map((source) => ({
      sourceVersionId: source.sourceVersionId,
      label: source.label,
      sourceUrl: source.sourceUrl,
      reviewed: source.reviewed,
    }));
  },
});

export const listSourceArtifacts = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("sourceArtifacts"),
      sourceVersionId: v.string(),
      label: v.string(),
      url: v.string(),
      contentHash: v.string(),
      parserVersion: v.string(),
      fetchedAt: v.string(),
      mediaType: v.optional(v.string()),
      rawStorageId: v.optional(v.id("_storage")),
      fileUrl: v.optional(v.string()),
      reviewStatus: v.union(
        v.literal("draft"),
        v.literal("reviewed"),
        v.literal("published"),
        v.literal("rejected"),
      ),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const artifacts = await ctx.db.query("sourceArtifacts").collect();
    const sortedArtifacts = artifacts
      .slice()
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    return Promise.all(
      sortedArtifacts.map(async (artifact) => ({
        id: artifact._id,
        sourceVersionId: artifact.sourceVersionId,
        label: artifact.label,
        url: artifact.url,
        contentHash: artifact.contentHash,
        parserVersion: artifact.parserVersion,
        fetchedAt: artifact.fetchedAt,
        ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
        ...(artifact.rawStorageId
          ? { rawStorageId: artifact.rawStorageId }
          : {}),
        ...(artifact.rawStorageId
          ? {
              fileUrl:
                (await ctx.storage.getUrl(artifact.rawStorageId)) ?? undefined,
            }
          : {}),
        reviewStatus: artifact.reviewStatus,
      })),
    );
  },
});

export const listSourceFreshness = query({
  args: {},
  returns: v.array(
    v.object({
      sourceVersionId: v.string(),
      sourceUrl: v.string(),
      bundledHash: v.string(),
      fetchedHash: v.optional(v.string()),
      parsedHash: v.optional(v.string()),
      effectiveDate: v.string(),
      reviewStatus: v.union(
        v.literal("draft"),
        v.literal("reviewed"),
        v.literal("published"),
        v.literal("rejected"),
      ),
      published: v.boolean(),
      stale: v.boolean(),
      staleReason: v.optional(v.string()),
      fetchedAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const artifacts = await ctx.db.query("sourceArtifacts").collect();
    return sourceFreshnessStatuses(
      ca4CourtSourceVersions,
      artifacts.map((artifact) => ({
        sourceVersionId: artifact.sourceVersionId,
        contentHash: artifact.contentHash,
        fetchedAt: artifact.fetchedAt,
        reviewStatus: artifact.reviewStatus,
      })),
    );
  },
});

/**
 * Trusted internal path retains production evidence gates for a future
 * organization-scoped caller. The legacy public mutation below stays closed.
 */
export const promoteCourtPackReleaseInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    courtPackId: v.string(),
    simulationEvalSnapshotJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot: unknown = JSON.parse(args.simulationEvalSnapshotJson);
    const evalIssues = validateEvalFreshness(snapshot);
    if (evalIssues.length) {
      throw new Error(
        `Simulation eval snapshot rejected: ${evalIssues.join("; ")}`,
      );
    }
    const courtPack = await ctx.db
      .query("courtPacks")
      .withIndex("by_pack_id", (index) => index.eq("packId", args.courtPackId))
      .unique();
    if (!courtPack) {
      throw new Error("Court pack not found");
    }
    await requireReviewedSources(ctx, courtPack.sourceVersionIds ?? []);
    await ctx.db.patch(courtPack._id, {
      releaseStatus: "production_approved",
      evalThresholdsJson: args.simulationEvalSnapshotJson,
      published: true,
    });
    await writeAuditLog(ctx, {
      actorUserId: args.actorUserId,
      action: "court_pack.promoted_to_production",
      targetTable: "courtPacks",
      targetId: courtPack._id,
      metadata: { courtPackId: args.courtPackId },
    });
    return null;
  },
});

export const promoteCourtPackRelease = mutation({
  args: {
    courtPackId: v.string(),
    simulationEvalSnapshotJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return null;
  },
});
