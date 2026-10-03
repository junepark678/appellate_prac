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

import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import { ca4FormTemplates } from "../src/packages/trial-record-pdfs";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireCurrentUser } from "./authHelpers";
import {
  promoteCourtPackRelease,
  promoteCourtPackReleaseInternal,
} from "./adminSources";

const { authUser } = vi.hoisted(() => ({
  authUser: { _id: "admin-fixture", role: "admin" },
}));

vi.mock("./authHelpers", () => ({
  requireCurrentUser: vi.fn(async () => ({
    user: authUser,
  })),
}));

const publicHandler = (
  promoteCourtPackRelease as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: { courtPackId: string; simulationEvalSnapshotJson: string },
    ) => Promise<null>;
  }
)._handler;
const internalHandler = (
  promoteCourtPackReleaseInternal as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: {
        actorUserId: Id<"users">;
        courtPackId: string;
        simulationEvalSnapshotJson: string;
      },
    ) => Promise<null>;
  }
)._handler;

const now = "2026-09-30T04:00:00.000Z";
const actorUserId = "admin-fixture" as Id<"users">;
const validEval = {
  createdAt: now,
  criticalFailureCount: 0,
  validTurnRate: 0.99,
  hallucinatedSourceRate: 0,
  roleAuthorityFailureRate: 0,
  pass: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  authUser.role = "admin";
});

const formImportModules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./adminSources.ts": () => import("./adminSources"),
};

const pdfPayload = "%PDF-1.7\nSynthetic in-memory test PDF\n";
const pdfBytes = new TextEncoder().encode(pdfPayload);
const formUrls = new Set(
  ca4FormTemplates.map((template) => template.sourceUrl),
);

function mockPdfFetch(responseFor: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!formUrls.has(url)) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return responseFor(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function successfulPdfResponse() {
  return new Response(pdfPayload, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

type Assert<T extends true> = T;
type PublicApiOmitsFormImporter = Assert<
  "storeCa4FormPdfArtifacts" extends keyof typeof api.adminSources
    ? false
    : true
>;
type InternalApiIncludesFormImporter = Assert<
  "storeCa4FormPdfArtifacts" extends keyof typeof internal.adminSources
    ? true
    : false
>;

// These aliases make typecheck fail if the generated client API exposes the
// internal importer or the generated internal API omits it.
type _FormImporterApiVisibility = [
  PublicApiOmitsFormImporter,
  InternalApiIncludesFormImporter,
];

describe("registered CA4 form PDF importer", () => {
  it("is included by the generated internal API only", () => {
    // convex-test does not enforce public/internal invocation visibility, so
    // these generated API types verify the client-facing registration filter.
    const apiVisibility: _FormImporterApiVisibility = [true, true];
    expect(apiVisibility).toEqual([true, true]);
  });

  it("stores mocked PDFs and upserts published catalog artifacts in ephemeral state", async () => {
    // convexTest uses only its in-memory database and storage implementation.
    const t = convexTest(schema, formImportModules);
    const fetchMock = mockPdfFetch(() => successfulPdfResponse());
    const digest = await crypto.subtle.digest("SHA-256", pdfBytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const sha256Base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    const firstTemplate = ca4FormTemplates[0];
    expect(firstTemplate).toBeDefined();
    if (!firstTemplate) throw new Error("Expected a CA4 form template");

    const existingArtifactId = await t.run((ctx) =>
      ctx.db.insert("sourceArtifacts", {
        sourceVersionId: firstTemplate.sourceVersionId,
        label: firstTemplate.label,
        url: firstTemplate.sourceUrl,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        contentHash: `sha256:${sha256}`,
        parserVersion: "previous-parser",
        mediaType: firstTemplate.mediaType,
        rawText: "previous fixture metadata",
        reviewStatus: "draft",
      }),
    );

    const result = await t.action(
      internal.adminSources.storeCa4FormPdfArtifacts,
      {},
    );
    expect(result).toEqual({ stored: ca4FormTemplates.length, failed: [] });
    expect(fetchMock).toHaveBeenCalledTimes(ca4FormTemplates.length);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      ca4FormTemplates.map((template) => template.sourceUrl),
    );

    const artifacts = await t.run((ctx) =>
      ctx.db.query("sourceArtifacts").collect(),
    );
    expect(artifacts).toHaveLength(ca4FormTemplates.length);
    const artifactByUrl = new Map(
      artifacts.map((artifact) => [artifact.url, artifact]),
    );
    for (const template of ca4FormTemplates) {
      const artifact = artifactByUrl.get(template.sourceUrl);
      expect(artifact).toMatchObject({
        sourceVersionId: template.sourceVersionId,
        label: template.label,
        url: template.sourceUrl,
        contentHash: `sha256:${sha256}`,
        parserVersion: "ca4-form-pdf-catalog-v1",
        mediaType: template.mediaType,
        reviewStatus: "published",
      });
      expect(artifact?.rawStorageId).toBeDefined();
      expect(JSON.parse(artifact?.rawText ?? "{}")).toEqual({
        formTemplateId: template.id,
        category: template.category,
        fileName: template.fileName,
      });
    }
    expect(artifactByUrl.get(firstTemplate.sourceUrl)?._id).toBe(
      existingArtifactId,
    );

    const storageResults = await t.run(async (ctx) => {
      const storageMetadata = await ctx.db.system.query("_storage").collect();
      const storedBlobs = await Promise.all(
        artifacts.map(async (artifact) => {
          const blob = artifact.rawStorageId
            ? await ctx.storage.get(artifact.rawStorageId)
            : null;
          return blob
            ? { text: await blob.text(), type: blob.type, size: blob.size }
            : null;
        }),
      );
      return { storageMetadata, storedBlobs };
    });
    expect(storageResults.storageMetadata).toHaveLength(
      ca4FormTemplates.length,
    );
    expect(
      storageResults.storageMetadata.every(
        (metadata) =>
          metadata.sha256 === sha256Base64 &&
          metadata.size === pdfBytes.byteLength,
      ),
    ).toBe(true);
    expect(storageResults.storedBlobs).toHaveLength(ca4FormTemplates.length);
    for (const storedBlob of storageResults.storedBlobs) {
      expect(storedBlob).toEqual({
        text: pdfPayload,
        type: "application/pdf",
        size: pdfBytes.byteLength,
      });
    }
  });

  it("fails closed on unsuccessful responses and non-PDF content types", async () => {
    const t = convexTest(schema, formImportModules);
    const unavailableTemplate = ca4FormTemplates[0];
    const nonPdfTemplate = ca4FormTemplates[1];
    expect(unavailableTemplate).toBeDefined();
    expect(nonPdfTemplate).toBeDefined();
    if (!unavailableTemplate || !nonPdfTemplate) {
      throw new Error("Expected at least two CA4 form templates");
    }

    const fetchMock = mockPdfFetch((url) => {
      if (url === unavailableTemplate.sourceUrl) {
        return new Response("unavailable", { status: 503 });
      }
      if (url === nonPdfTemplate.sourceUrl) {
        return new Response("not a PDF", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return successfulPdfResponse();
    });

    const result = await t.action(
      internal.adminSources.storeCa4FormPdfArtifacts,
      {},
    );
    expect(result).toEqual({
      stored: ca4FormTemplates.length - 2,
      failed: [
        {
          label: unavailableTemplate.label,
          sourceUrl: unavailableTemplate.sourceUrl,
          reason: "HTTP 503",
        },
        {
          label: nonPdfTemplate.label,
          sourceUrl: nonPdfTemplate.sourceUrl,
          reason: "Expected PDF, received text/html",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(ca4FormTemplates.length);

    const storedState = await t.run(async (ctx) => ({
      artifacts: await ctx.db.query("sourceArtifacts").collect(),
      storageMetadata: await ctx.db.system.query("_storage").collect(),
    }));
    expect(storedState.artifacts).toHaveLength(ca4FormTemplates.length - 2);
    expect(
      storedState.artifacts.some(
        (artifact) =>
          artifact.url === unavailableTemplate.sourceUrl ||
          artifact.url === nonPdfTemplate.sourceUrl,
      ),
    ).toBe(false);
    expect(storedState.storageMetadata).toHaveLength(
      ca4FormTemplates.length - 2,
    );
  });
});

function promotionContext(reviewStatus: string) {
  const patch = vi.fn(async () => undefined);
  const insert = vi.fn(async () => "audit-fixture");
  const courtPack = {
    _id: "pack-fixture",
    sourceVersionIds: ["custom-reviewed-source"],
  };
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn(() => ({
      unique: vi.fn(async () => courtPack),
      order: vi.fn(() => ({
        first: vi.fn(async () =>
          table === "sourceArtifacts" ? { reviewStatus } : null,
        ),
      })),
    })),
  }));
  return {
    ctx: { db: { query, patch, insert } } as unknown as MutationCtx,
    query,
    patch,
    insert,
  };
}

describe("legacy court pack production promotion endpoint", () => {
  it.each(["admin", "instructor", "student"])(
    "fails closed for the legacy global %s role before reading evidence",
    async (role) => {
      authUser.role = role;
      const query = vi.fn();
      const patch = vi.fn();
      const ctx = { db: { query, patch } } as unknown as MutationCtx;
      await expect(
        publicHandler(ctx, {
          courtPackId: "us-federal-ca4-civil-appeal",
          simulationEvalSnapshotJson: "{malformed",
        }),
      ).rejects.toMatchObject({
        data: {
          code: "VALIDATION_ERROR",
          message: "Use organization membership management",
          metadata: {},
        },
      });
      expect(query).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("preserves AUTH_REQUIRED for unauthenticated actors", async () => {
    vi.mocked(requireCurrentUser).mockRejectedValueOnce(
      new Error("Not authenticated"),
    );
    await expect(
      publicHandler({} as MutationCtx, {
        courtPackId: "us-federal-ca4-civil-appeal",
        simulationEvalSnapshotJson: "{malformed",
      }),
    ).rejects.toThrow("Not authenticated");
  });
});

describe("internal court pack production evidence gates", () => {
  it.each([
    { ...validEval, pass: false },
    { ...validEval, pass: "true" },
    { ...validEval, validTurnRate: "0.99" },
    { ...validEval, hallucinatedSourceRate: null },
    { ...validEval, createdAt: "2026-09-28T04:00:00.000Z" },
    { ...validEval, createdAt: "2026-10-01T04:00:00.000Z" },
    null,
  ])(
    "rejects stale or invalid eval evidence before reading state %#",
    async (snapshot) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const query = vi.fn();
      const patch = vi.fn();
      const ctx = { db: { query, patch } } as unknown as MutationCtx;
      await expect(
        internalHandler(ctx, {
          actorUserId,
          courtPackId: "us-federal-ca4-civil-appeal",
          simulationEvalSnapshotJson: JSON.stringify(snapshot),
        }),
      ).rejects.toThrow("Simulation eval snapshot rejected");
      expect(query).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("rejects unreviewed sources even with valid passing eval evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { ctx, query, patch, insert } = promotionContext("draft");
    await expect(
      internalHandler(ctx, {
        actorUserId,
        courtPackId: "fixture-pack",
        simulationEvalSnapshotJson: JSON.stringify(validEval),
      }),
    ).rejects.toThrow(
      "Source custom-reviewed-source must be reviewed before publication.",
    );
    expect(query).toHaveBeenCalledWith("sourceArtifacts");
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(["reviewed", "published"])(
    "promotes only with %s source evidence and records the audit",
    async (reviewStatus) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const { ctx, patch, insert } = promotionContext(reviewStatus);
      const simulationEvalSnapshotJson = JSON.stringify(validEval);
      await expect(
        internalHandler(ctx, {
          actorUserId,
          courtPackId: "fixture-pack",
          simulationEvalSnapshotJson,
        }),
      ).resolves.toBeNull();
      expect(patch).toHaveBeenCalledExactlyOnceWith("pack-fixture", {
        releaseStatus: "production_approved",
        evalThresholdsJson: simulationEvalSnapshotJson,
        published: true,
      });
      expect(insert).toHaveBeenCalledExactlyOnceWith("auditLog", {
        actorUserId,
        action: "court_pack.promoted_to_production",
        targetTable: "courtPacks",
        targetId: "pack-fixture",
        metadataJson: JSON.stringify({ courtPackId: "fixture-pack" }),
        createdAt: now,
      });
    },
  );
});
