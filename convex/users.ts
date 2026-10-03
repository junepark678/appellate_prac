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
import { requireCurrentUser, upsertCurrentUserDoc } from "./authHelpers";
import { requireInstitutionRole, writeAuditLog } from "./authz";
import { AppErrorCode, ConvexError, notFound, validationError } from "./errors";
import {
  isOrganizationMembershipActive,
  isUtcTimestamp,
} from "./organizationContracts";

const legacyUserRoleValidator = v.union(
  v.literal("student"),
  v.literal("admin"),
  v.literal("instructor"),
);

const institutionRoleValidator = v.union(
  v.literal("learner"),
  v.literal("instructor"),
  v.literal("admin"),
);

const membershipStatusValidator = v.union(
  v.literal("active"),
  v.literal("suspended"),
);

async function rejectLegacyUserOperation(
  ctx: Parameters<typeof requireCurrentUser>[0],
): Promise<never> {
  await requireCurrentUser(ctx);
  throw validationError("Use organization membership management");
}

export const upsertCurrentUser = mutation({
  args: {},
  returns: v.object({
    id: v.string(),
    displayName: v.string(),
  }),
  handler: async (ctx) => {
    const user = await upsertCurrentUserDoc(ctx);
    return {
      id: user._id,
      displayName: user.displayName,
    };
  },
});

export const current = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.id("users"),
      displayName: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx);
    return {
      id: user._id,
      displayName: user.displayName,
    };
  },
});

/** Deprecated global listing remains registered but cannot disclose profiles. */
export const list = query({
  args: {
    search: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      id: v.id("users"),
      authSubject: v.string(),
      displayName: v.string(),
      role: legacyUserRoleValidator,
      monthlyAiBudgetCents: v.number(),
      currentMonthAiSpendCents: v.number(),
    }),
  ),
  handler: async (ctx) => rejectLegacyUserOperation(ctx),
});

/** Deprecated global role mutation is retained only for a safe error response. */
export const setRole = mutation({
  args: {
    userId: v.id("users"),
    role: legacyUserRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx) => rejectLegacyUserOperation(ctx),
});

/** Per-user global budgets are no longer managed by organization admins. */
export const setMonthlyAiBudget = mutation({
  args: {
    userId: v.id("users"),
    monthlyAiBudgetCents: v.number(),
  },
  returns: v.null(),
  handler: async (ctx) => rejectLegacyUserOperation(ctx),
});

export const listOrganizationMembers = query({
  args: {
    institutionId: v.id("institutions"),
    search: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      membershipId: v.id("institutionMemberships"),
      userId: v.id("users"),
      displayName: v.string(),
      role: institutionRoleValidator,
      status: membershipStatusValidator,
      expiresAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const { institution } = await requireInstitutionRole(
      ctx,
      args.institutionId,
      ["admin"],
    );
    const search = args.search?.trim().toLowerCase();
    if (search && search.length > 120) {
      throw validationError("Search must be 120 characters or fewer", "search");
    }
    const memberships = await ctx.db
      .query("institutionMemberships")
      .withIndex("by_institution", (index) =>
        index.eq("institutionId", institution._id),
      )
      .collect();
    const rows = [];
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;
      if (search && !user.displayName.toLowerCase().includes(search)) continue;
      rows.push({
        membershipId: membership._id,
        userId: user._id,
        displayName: user.displayName,
        role: membership.role,
        status: membership.status,
        ...(membership.expiresAt ? { expiresAt: membership.expiresAt } : {}),
      });
    }
    return rows.sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  },
});

export const updateOrganizationMember = mutation({
  args: {
    institutionId: v.id("institutions"),
    membershipId: v.id("institutionMemberships"),
    role: institutionRoleValidator,
    status: membershipStatusValidator,
    expiresAt: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user: actor, institution } = await requireInstitutionRole(
      ctx,
      args.institutionId,
      ["admin"],
    );
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.institutionId !== institution._id) {
      throw notFound("Organization member");
    }
    if (
      (institution.kind ?? "shared") === "personal" &&
      membership.userId === institution.personalOwnerUserId
    ) {
      throw validationError(
        "Personal organization owner membership is immutable",
      );
    }
    if ((institution.kind ?? "shared") === "personal") {
      throw notFound("Organization member");
    }

    const now = Date.now();
    const nextExpiresAt = args.expiresAt ?? membership.expiresAt;
    if (
      args.expiresAt !== undefined &&
      (!isUtcTimestamp(args.expiresAt) || Date.parse(args.expiresAt) <= now)
    ) {
      throw validationError(
        "Membership expiry must be a future UTC time",
        "expiresAt",
      );
    }

    const targetIsActiveAdmin =
      membership.role === "admin" &&
      isOrganizationMembershipActive(institution, membership, now);
    const targetRemainsActiveAdmin =
      args.role === "admin" &&
      args.status === "active" &&
      (!nextExpiresAt ||
        (isUtcTimestamp(nextExpiresAt) && Date.parse(nextExpiresAt) > now));
    if (targetIsActiveAdmin && !targetRemainsActiveAdmin) {
      const institutionMemberships = await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution", (index) =>
          index.eq("institutionId", institution._id),
        )
        .collect();
      const activeAdminCount = institutionMemberships.filter(
        (candidate) =>
          candidate.role === "admin" &&
          isOrganizationMembershipActive(institution, candidate, now),
      ).length;
      if (activeAdminCount <= 1) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "The last active organization admin cannot be removed or suspended",
        );
      }
    }

    await ctx.db.patch(membership._id, {
      role: args.role,
      status: args.status,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
    await writeAuditLog(ctx, {
      actorUserId: actor._id,
      institutionId: institution._id,
      action: "organization.member_updated",
      targetTable: "institutionMemberships",
      targetId: membership._id,
      metadata: {
        previousRole: membership.role,
        nextRole: args.role,
        previousStatus: membership.status,
        nextStatus: args.status,
      },
    });
    return null;
  },
});

export const setOrganizationBudget = mutation({
  args: {
    institutionId: v.id("institutions"),
    monthlyAiBudgetCents: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, institution } = await requireInstitutionRole(
      ctx,
      args.institutionId,
      ["admin"],
    );
    if (
      !Number.isSafeInteger(args.monthlyAiBudgetCents) ||
      args.monthlyAiBudgetCents < 0
    ) {
      throw validationError(
        "Organization budget must be a non-negative integer",
        "monthlyAiBudgetCents",
      );
    }
    const previousMonthlyAiBudgetCents = institution.monthlyAiBudgetCents;
    await ctx.db.patch(institution._id, {
      monthlyAiBudgetCents: args.monthlyAiBudgetCents,
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: institution._id,
      action: "organization.ai_budget_changed",
      targetTable: "institutions",
      targetId: institution._id,
      metadata: {
        previousMonthlyAiBudgetCents,
        nextMonthlyAiBudgetCents: args.monthlyAiBudgetCents,
      },
    });
    return null;
  },
});
