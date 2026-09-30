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
import type { MutationCtx } from "./_generated/server";
import { requireCurrentUser } from "./authHelpers";
import { promoteCourtPackRelease } from "./adminSources";

const { authUser } = vi.hoisted(() => ({
  authUser: { _id: "admin-fixture", role: "admin" },
}));

vi.mock("./authHelpers", () => ({
  requireCurrentUser: vi.fn(async () => ({
    user: authUser,
  })),
}));

const handler = (
  promoteCourtPackRelease as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: { courtPackId: string; simulationEvalSnapshotJson: string },
    ) => Promise<null>;
  }
)._handler;
const now = "2026-09-30T04:00:00.000Z";
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

describe("court pack production promotion evidence", () => {
  it.each([
    { ...validEval, pass: false },
    { ...validEval, pass: "true" },
    { ...validEval, validTurnRate: "0.99" },
    { ...validEval, hallucinatedSourceRate: null },
    { ...validEval, createdAt: "2026-09-28T04:00:00.000Z" },
    { ...validEval, createdAt: "2026-10-01T04:00:00.000Z" },
    null,
  ])(
    "rejects invalid evidence before touching court pack state %#",
    async (snapshot) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const query = vi.fn();
      const patch = vi.fn();
      const ctx = { db: { query, patch } } as unknown as MutationCtx;
      await expect(
        handler(ctx, {
          courtPackId: "us-federal-ca4-civil-appeal",
          simulationEvalSnapshotJson: JSON.stringify(snapshot),
        }),
      ).rejects.toThrow("Simulation eval snapshot rejected");
      expect(query).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("still requires administrator authorization before reading evidence", async () => {
    vi.mocked(requireCurrentUser).mockRejectedValueOnce(
      new Error("Not authenticated"),
    );
    await expect(
      handler({} as MutationCtx, {
        courtPackId: "us-federal-ca4-civil-appeal",
        simulationEvalSnapshotJson: "{malformed",
      }),
    ).rejects.toThrow("Not authenticated");
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

describe("court pack promotion authorization and source review", () => {
  it("rejects an authenticated non-admin before parsing evidence or touching state", async () => {
    authUser.role = "learner";
    const { ctx, query, patch, insert } = promotionContext("published");
    await expect(
      handler(ctx, {
        courtPackId: "fixture-pack",
        simulationEvalSnapshotJson: "{malformed",
      }),
    ).rejects.toThrow("Admin role required");
    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects unreviewed sources even with valid passing eval evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { ctx, query, patch, insert } = promotionContext("draft");
    await expect(
      handler(ctx, {
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
    "promotes with %s source evidence and records the audit",
    async (reviewStatus) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const { ctx, patch, insert } = promotionContext(reviewStatus);
      const simulationEvalSnapshotJson = JSON.stringify(validEval);
      await expect(
        handler(ctx, {
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
        actorUserId: "admin-fixture",
        action: "court_pack.promoted_to_production",
        targetTable: "courtPacks",
        targetId: "pack-fixture",
        metadataJson: JSON.stringify({ courtPackId: "fixture-pack" }),
        createdAt: now,
      });
    },
  );
});
