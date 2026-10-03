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
  vi.useRealTimers();
  vi.clearAllMocks();
  authUser.role = "admin";
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
