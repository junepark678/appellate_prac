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

import { mutation, query } from "./_generated/server";
import { requireCurrentUser } from "./authHelpers";
import { validationError } from "./errors";

async function rejectLegacyDraftOperation(
  ctx: Parameters<typeof requireCurrentUser>[0],
): Promise<never> {
  await requireCurrentUser(ctx);
  throw validationError(
    "Scenario draft review requires organization administration",
  );
}

export const list = query({
  args: {
    reviewStatus: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("reviewed"),
        v.literal("published"),
        v.literal("rejected"),
      ),
    ),
  },
  returns: v.array(
    v.object({
      id: v.id("scenarioDrafts"),
      title: v.string(),
      courtPackId: v.string(),
      reviewStatus: v.union(
        v.literal("draft"),
        v.literal("reviewed"),
        v.literal("published"),
        v.literal("rejected"),
      ),
      sourceSystem: v.union(
        v.literal("courtlistener"),
        v.literal("recap"),
        v.literal("manual"),
      ),
      createdAt: v.string(),
    }),
  ),
  handler: async (ctx) => {
    return rejectLegacyDraftOperation(ctx);
  },
});

export const createManualDraft = mutation({
  args: {
    title: v.string(),
    courtPackId: v.string(),
    draftJson: v.string(),
    provenanceJson: v.string(),
  },
  returns: v.id("scenarioDrafts"),
  handler: async (ctx) => {
    return rejectLegacyDraftOperation(ctx);
  },
});

export const setReviewStatus = mutation({
  args: {
    draftId: v.id("scenarioDrafts"),
    reviewStatus: v.union(
      v.literal("draft"),
      v.literal("reviewed"),
      v.literal("published"),
      v.literal("rejected"),
    ),
  },
  returns: v.null(),
  handler: async (ctx) => {
    return rejectLegacyDraftOperation(ctx);
  },
});
