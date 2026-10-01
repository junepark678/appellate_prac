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
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  organizationContextDTOValidator,
  organizationMemberDTOValidator,
  isOrganizationMembershipActive,
  type OrganizationContextDTO,
  type OrganizationMemberDTO,
} from "./organizationContracts";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrganizationUser } from "./authHelpers";
import { AppErrorCode, ConvexError, notFound, validationError } from "./errors";

type OrganizationReadCtx = QueryCtx | MutationCtx;

function conflict(message: string) {
  return new ConvexError(AppErrorCode.CONFLICT, message);
}

function effectiveKind(
  institution: Doc<"institutions">,
): "personal" | "shared" {
  // Rows predating the organization-kind backfill are shared by contract.
  return institution.kind ?? "shared";
}

async function activeMembershipForUser(
  ctx: OrganizationReadCtx,
  institution: Doc<"institutions">,
  userId: Id<"users">,
) {
  const memberships = await ctx.db
    .query("institutionMemberships")
    .withIndex("by_institution_user", (index) =>
      index.eq("institutionId", institution._id).eq("userId", userId),
    )
    .collect();

  if (memberships.length > 1) {
    throw conflict("Organization membership is ambiguous");
  }
  const membership = memberships[0];
  if (
    !isOrganizationMembershipActive(institution, membership ?? null, Date.now())
  ) {
    return null;
  }
  return membership;
}

function memberDTO(
  institution: Doc<"institutions">,
  role: Doc<"institutionMemberships">["role"],
): OrganizationMemberDTO {
  return {
    institutionId: institution._id,
    name: institution.name,
    kind: effectiveKind(institution),
    role,
  };
}

async function ensurePersonalForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"institutions">> {
  const user = await ctx.db.get(userId);
  if (!user) throw notFound("User");

  const personalInstitutions = await ctx.db
    .query("institutions")
    .withIndex("by_personal_owner", (index) =>
      index.eq("personalOwnerUserId", userId),
    )
    .collect();

  if (personalInstitutions.length > 1) {
    throw conflict("Personal workspace is ambiguous");
  }

  if (personalInstitutions.length === 0) {
    const slug = `personal-${userId}`;
    const slugMatches = await ctx.db
      .query("institutions")
      .withIndex("by_slug", (index) => index.eq("slug", slug))
      .collect();
    if (slugMatches.length > 0) {
      throw conflict("Personal workspace slug is already in use");
    }

    const createdAt = new Date().toISOString();
    const institutionId = await ctx.db.insert("institutions", {
      kind: "personal",
      personalOwnerUserId: userId,
      createdAt,
      name: "Personal workspace",
      slug,
      status: "active",
      // No organization-level budget is granted by this bootstrap.
      monthlyAiBudgetCents: 0,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId,
      role: "admin",
      status: "active",
      createdAt,
    });
    return institutionId;
  }

  const institution = personalInstitutions[0];
  if (
    !institution ||
    institution.kind !== "personal" ||
    institution.personalOwnerUserId !== userId
  ) {
    throw conflict("Personal workspace ownership is inconsistent");
  }

  const membership = await activeMembershipForUser(ctx, institution, userId);
  if (!membership) {
    // Do not silently reactivate, recreate, or repair an owner's membership.
    throw notFound("Organization");
  }
  if (membership.role !== "admin") {
    throw conflict("Personal workspace membership requires repair");
  }
  return institution._id;
}

export const ensurePersonal = mutation({
  args: {},
  returns: v.object({ institutionId: v.id("institutions") }),
  handler: async (ctx) => {
    const { userId } = await requireOrganizationUser(ctx);
    return { institutionId: await ensurePersonalForUser(ctx, userId) };
  },
});

/** Trusted internal bootstrap for callers that have already resolved a user. */
export const ensurePersonalForTrustedUser = internalMutation({
  args: { userId: v.id("users") },
  returns: v.object({ institutionId: v.id("institutions") }),
  handler: async (ctx, { userId }) => ({
    institutionId: await ensurePersonalForUser(ctx, userId),
  }),
});

export const createShared = mutation({
  args: { name: v.string(), slug: v.string() },
  returns: v.id("institutions"),
  handler: async (ctx, args) => {
    const { userId } = await requireOrganizationUser(ctx);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 120) {
      throw validationError(
        "Name must be between 1 and 120 characters",
        "name",
      );
    }
    if (
      args.slug.length < 3 ||
      args.slug.length > 80 ||
      !/^[a-z0-9-]+$/.test(args.slug)
    ) {
      throw validationError(
        "Slug must be 3 to 80 lowercase letters, numbers, or hyphens",
        "slug",
      );
    }

    const matches = await ctx.db
      .query("institutions")
      .withIndex("by_slug", (index) => index.eq("slug", args.slug))
      .collect();
    if (matches.length > 0) {
      throw new ConvexError(
        AppErrorCode.ALREADY_EXISTS,
        "Organization slug already exists",
      );
    }

    const createdAt = new Date().toISOString();
    const institutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt,
      name,
      slug: args.slug,
      status: "active",
      // Organization APIs do not grant an unapproved spend allowance.
      monthlyAiBudgetCents: 0,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId,
      role: "admin",
      status: "active",
      createdAt,
    });
    return institutionId;
  },
});

export const listMine = query({
  args: {},
  returns: v.array(organizationMemberDTOValidator),
  handler: async (ctx) => {
    const { userId } = await requireOrganizationUser(ctx);
    const memberships = await ctx.db
      .query("institutionMemberships")
      .withIndex("by_user", (index) => index.eq("userId", userId))
      .collect();
    const membershipCounts = new Map<string, number>();
    for (const membership of memberships) {
      const key = membership.institutionId as string;
      membershipCounts.set(key, (membershipCounts.get(key) ?? 0) + 1);
    }
    if ([...membershipCounts.values()].some((count) => count > 1)) {
      throw conflict("Organization membership is ambiguous");
    }

    const now = Date.now();
    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const institution = await ctx.db.get(membership.institutionId);
        if (
          !institution ||
          !isOrganizationMembershipActive(institution, membership, now)
        ) {
          return null;
        }
        const kind = effectiveKind(institution);
        if (kind === "personal" && institution.personalOwnerUserId !== userId) {
          return null;
        }
        return memberDTO(institution, membership.role);
      }),
    );

    return rows
      .filter((row): row is OrganizationMemberDTO => row !== null)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "personal" ? -1 : 1;
        if (left.name < right.name) return -1;
        if (left.name > right.name) return 1;
        if (left.institutionId < right.institutionId) return -1;
        if (left.institutionId > right.institutionId) return 1;
        return 0;
      });
  },
});

export const getContext = query({
  args: { institutionId: v.id("institutions") },
  returns: organizationContextDTOValidator,
  handler: async (ctx, { institutionId }): Promise<OrganizationContextDTO> => {
    const { userId } = await requireOrganizationUser(ctx);
    const institution = await ctx.db.get(institutionId);
    if (!institution || institution.status !== "active") {
      throw notFound("Organization");
    }
    const kind = effectiveKind(institution);
    if (kind === "personal" && institution.personalOwnerUserId !== userId) {
      throw notFound("Organization");
    }
    const membership = await activeMembershipForUser(ctx, institution, userId);
    if (!membership) throw notFound("Organization");

    const item = memberDTO(institution, membership.role);
    return {
      ...item,
      capabilities: {
        manageMembers: membership.role === "admin",
        teach: membership.role === "admin" || membership.role === "instructor",
        learn: true,
      },
    };
  },
});
