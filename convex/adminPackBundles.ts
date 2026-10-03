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

import { action } from "./_generated/server";
import { authRequired, validationError } from "./errors";

/**
 * Retained for public API compatibility only. Legacy global-admin bundle
 * generation is disabled; do not read payloads or perform storage work here.
 */
export const generatePackBundleZip = action({
  args: {
    bundleId: v.id("packBundles"),
  },
  returns: v.object({
    storageId: v.id("_storage"),
    zipFileName: v.string(),
    zipSizeBytes: v.number(),
    zipContentHash: v.string(),
  }),
  handler: async (ctx): Promise<never> => {
    if (!(await ctx.auth.getUserIdentity())) throw authRequired();
    throw validationError("Use organization membership management");
  },
});
