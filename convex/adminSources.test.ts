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
afterEach(() => {
  vi.clearAllMocks();
  authUser.role = "admin";
});

describe("legacy court pack production promotion endpoint", () => {
  it.each(["admin", "instructor", "student"])(
    "fails closed for the legacy global %s role before reading evidence",
    async (role) => {
      authUser.role = role;
      const query = vi.fn();
      const patch = vi.fn();
      const ctx = { db: { query, patch } } as unknown as MutationCtx;
      await expect(
        handler(ctx, {
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
      handler({} as MutationCtx, {
        courtPackId: "us-federal-ca4-civil-appeal",
        simulationEvalSnapshotJson: "{malformed",
      }),
    ).rejects.toThrow("Not authenticated");
  });
});
