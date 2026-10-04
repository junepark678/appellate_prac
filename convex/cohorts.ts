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

// TODO: Import from './errors' once error module is integrated
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import { action, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  requireCurrentUser,
  requireIdentity,
  upsertCurrentUserDoc,
} from "./authHelpers";
import {
  normalizeEmail,
  requireCohortRole,
  requireInstitutionRole,
  toDeterministicId,
  writeAuditLog,
} from "./authz";
import {
  isOrganizationMembershipActive,
  isUtcTimestamp,
} from "./organizationContracts";
import {
  AppErrorCode,
  ConvexError,
  inviteAlreadyAccepted,
  inviteEmailMismatch,
  inviteExpired,
  notFound,
  validationError,
} from "./errors";

const institutionRoleValidator = v.union(
  v.literal("learner"),
  v.literal("instructor"),
  v.literal("admin"),
);

type InstitutionRole = "learner" | "instructor" | "admin";

const inviteTokenHashPrefix = "sha256:";
const createSharedOrganization = makeFunctionReference<
  "mutation",
  { name: string; slug: string },
  Id<"institutions">
>("organizations:createShared");

function generateInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hashInviteToken(token: string) {
  return `${inviteTokenHashPrefix}${await sha256Hex(token)}`;
}

function legacyInviteTokenHash(token: string) {
  return toDeterministicId(token);
}

async function findInviteByToken(ctx: MutationCtx, token: string) {
  const tokenHash = await hashInviteToken(token);
  const invites = await ctx.db
    .query("enrollmentInvites")
    .withIndex("by_token_hash", (index) => index.eq("tokenHash", tokenHash))
    .collect();
  if (invites.length > 1) {
    throw new ConvexError(AppErrorCode.CONFLICT, "Invite token is ambiguous");
  }
  if (invites[0]) return invites[0];

  const legacyHash = legacyInviteTokenHash(token);
  const legacyInvites = await ctx.db
    .query("enrollmentInvites")
    .withIndex("by_token_hash", (index) => index.eq("tokenHash", legacyHash))
    .collect();
  if (legacyInvites.length > 1) {
    throw new ConvexError(AppErrorCode.CONFLICT, "Invite token is ambiguous");
  }
  return legacyInvites[0] ?? null;
}

async function createUniqueInviteTokenHash(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateInviteToken();
    const tokenHash = await hashInviteToken(token);
    const collisions = await ctx.db
      .query("enrollmentInvites")
      .withIndex("by_token_hash", (index) => index.eq("tokenHash", tokenHash))
      .collect();
    if (collisions.length === 0) return { token, tokenHash };
  }
  throw new ConvexError(
    AppErrorCode.CONFLICT,
    "Unable to generate a unique invite token",
  );
}

export const createInstitution = action({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  returns: v.id("institutions"),
  handler: async (ctx, args) => {
    return ctx.runMutation(createSharedOrganization, {
      name: args.name,
      slug: args.slug,
    });
  },
});

export const listInstitutions = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("institutions"),
      name: v.string(),
      slug: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("archived"),
      ),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx);
    const memberships = await ctx.db
      .query("institutionMemberships")
      .withIndex("by_user", (index) => index.eq("userId", user._id))
      .collect();
    const byInstitution = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const key = membership.institutionId as string;
      byInstitution.set(key, [...(byInstitution.get(key) ?? []), membership]);
    }

    const rows = [];
    const now = Date.now();
    for (const entries of byInstitution.values()) {
      const firstMembership = entries[0];
      if (!firstMembership) continue;
      if (entries.length > 1) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Organization membership is ambiguous",
        );
      }
      const institution = await ctx.db.get(firstMembership.institutionId);
      const active = entries.filter((membership) =>
        isOrganizationMembershipActive(institution, membership, now),
      );
      if (!active[0] || !institution) continue;
      if (
        (institution.kind ?? "shared") === "personal" &&
        institution.personalOwnerUserId !== user._id
      ) {
        continue;
      }
      rows.push({
        id: institution._id,
        name: institution.name,
        slug: institution.slug,
        status: institution.status,
      });
    }
    return rows.sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const setInstitutionMember = mutation({
  args: {
    institutionId: v.id("institutions"),
    userId: v.id("users"),
    role: institutionRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, _args) => {
    await requireCurrentUser(ctx);
    throw validationError("Use organization membership management");
  },
});

export const createCohort = mutation({
  args: {
    institutionId: v.id("institutions"),
    title: v.string(),
    term: v.string(),
    startsAt: v.string(),
    endsAt: v.string(),
  },
  returns: v.id("cohorts"),
  handler: async (ctx, args) => {
    const { user } = await requireInstitutionRole(ctx, args.institutionId, [
      "instructor",
      "admin",
    ]);

    const cohortId = await ctx.db.insert("cohorts", {
      institutionId: args.institutionId,
      title: args.title,
      term: args.term,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      archived: false,
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId,
      userId: user._id,
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: args.institutionId,
      cohortId,
      action: "cohort.created",
      targetTable: "cohorts",
      targetId: cohortId,
    });
    return cohortId;
  },
});

export const addMember = mutation({
  args: {
    cohortId: v.id("cohorts"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, cohort, institution } = await requireCohortRole(
      ctx,
      args.cohortId,
      ["instructor", "admin"],
    );

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) throw notFound("Organization member");
    if (
      (institution.kind ?? "shared") === "personal" &&
      args.userId !== institution.personalOwnerUserId
    ) {
      throw notFound("Organization member");
    }
    const targetMemberships = await ctx.db
      .query("institutionMemberships")
      .withIndex("by_institution_user", (index) =>
        index
          .eq("institutionId", cohort.institutionId)
          .eq("userId", args.userId),
      )
      .collect();
    const activeTargetMemberships = targetMemberships.filter((membership) =>
      isOrganizationMembershipActive(institution, membership, Date.now()),
    );
    if (targetMemberships.length > 1) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Organization membership is ambiguous",
      );
    }
    if (!activeTargetMemberships[0]) throw notFound("Organization member");

    const existing = await ctx.db
      .query("cohortMemberships")
      .withIndex("by_cohort_user", (index) =>
        index.eq("cohortId", args.cohortId).eq("userId", args.userId),
      )
      .collect();
    if (existing.length > 1) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Cohort enrollment is ambiguous",
      );
    }
    const enrollmentId =
      existing[0]?._id ??
      (await ctx.db.insert("cohortMemberships", {
        cohortId: args.cohortId,
        userId: args.userId,
      }));
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: args.cohortId,
      action: "cohort.member_enrolled",
      targetTable: "cohortMemberships",
      targetId: enrollmentId,
    });
    return null;
  },
});

export const inviteMembers = mutation({
  args: {
    institutionId: v.id("institutions"),
    cohortId: v.optional(v.id("cohorts")),
    invites: v.array(
      v.object({
        email: v.string(),
        role: institutionRoleValidator,
      }),
    ),
    expiresAt: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      email: v.string(),
      role: institutionRoleValidator,
      token: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user, institution, membership } = await requireInstitutionRole(
      ctx,
      args.institutionId,
      ["instructor", "admin"],
    );
    if ((institution.kind ?? "shared") === "personal") {
      throw validationError(
        "Invites are not available for personal organizations",
      );
    }
    if (
      membership.role === "instructor" &&
      args.invites.some((invite) => invite.role !== "learner")
    ) {
      throw new ConvexError(
        AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
        "Only organization admins can invite instructors or admins",
        { roles: ["admin"] },
      );
    }
    if (args.cohortId) {
      const { cohort } = await requireCohortRole(ctx, args.cohortId, [
        "instructor",
        "admin",
      ]);
      if (cohort.institutionId !== args.institutionId) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Invite cohort scope mismatch",
        );
      }
    }
    if (args.invites.length === 0) {
      throw validationError("At least one invite is required", "invites");
    }
    const normalizedInvites = args.invites.map((invite) => {
      const email = normalizeEmail(invite.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw validationError("A valid email address is required", "email");
      }
      return { email, role: invite.role };
    });
    if (
      new Set(normalizedInvites.map((invite) => invite.email)).size !==
      normalizedInvites.length
    ) {
      throw new ConvexError(AppErrorCode.CONFLICT, "Duplicate invite email");
    }
    const expiresAt =
      args.expiresAt ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
    const now = Date.now();
    const expiryTime = Date.parse(expiresAt);
    if (
      !isUtcTimestamp(expiresAt) ||
      !Number.isFinite(expiryTime) ||
      expiryTime <= now ||
      expiryTime > now + 1000 * 60 * 60 * 24 * 30
    ) {
      throw validationError(
        "Invite expiry must be a future UTC time within 30 days",
        "expiresAt",
      );
    }

    const created = [];
    for (const invite of normalizedInvites) {
      const { token, tokenHash } = await createUniqueInviteTokenHash(ctx);
      await ctx.db.insert("enrollmentInvites", {
        institutionId: args.institutionId,
        ...(args.cohortId ? { cohortId: args.cohortId } : {}),
        email: invite.email,
        role: invite.role,
        tokenHash,
        expiresAt,
        createdByUserId: user._id,
        createdAt: new Date().toISOString(),
      });
      created.push({ email: invite.email, role: invite.role, token });
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: args.institutionId,
      ...(args.cohortId ? { cohortId: args.cohortId } : {}),
      action: "enrollment_invites.created",
      metadata: { count: created.length },
    });
    return created;
  },
});

export const acceptInvite = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    institutionId: v.id("institutions"),
    cohortId: v.optional(v.id("cohorts")),
    role: institutionRoleValidator,
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (identity.emailVerified !== true || !identity.email) {
      throw new ConvexError(
        AppErrorCode.AUTH_REQUIRED,
        "A verified email address is required",
      );
    }
    const invite = await findInviteByToken(ctx, args.token);
    if (!invite) throw notFound("Invite");
    if (normalizeEmail(identity.email) !== normalizeEmail(invite.email)) {
      throw inviteEmailMismatch();
    }
    if (invite.acceptedAt) throw inviteAlreadyAccepted();
    const now = Date.now();
    if (
      !isUtcTimestamp(invite.expiresAt) ||
      Date.parse(invite.expiresAt) <= now
    ) {
      throw inviteExpired();
    }

    const institution = await ctx.db.get(invite.institutionId);
    if (
      !institution ||
      institution.status !== "active" ||
      (institution.kind ?? "shared") === "personal"
    ) {
      throw notFound("Organization");
    }
    if (invite.cohortId) {
      const cohort = await ctx.db.get(invite.cohortId);
      if (!cohort) throw notFound("Cohort");
      if (cohort.institutionId !== institution._id) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Invite cohort scope mismatch",
        );
      }
    }

    // Pending invites created under the old global-role path do not retain
    // their original authority after the cutover.
    const inviterMemberships = await ctx.db
      .query("institutionMemberships")
      .withIndex("by_institution_user", (index) =>
        index
          .eq("institutionId", institution._id)
          .eq("userId", invite.createdByUserId),
      )
      .collect();
    const activeInviterMemberships = inviterMemberships.filter((membership) =>
      isOrganizationMembershipActive(institution, membership, now),
    );
    if (activeInviterMemberships.length > 1) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Organization membership is ambiguous",
      );
    }
    const inviterRole = activeInviterMemberships[0]?.role;
    const inviterMayGrantRole =
      inviterRole === "admin" ||
      (invite.role === "learner" && inviterRole === "instructor");
    if (!inviterMayGrantRole) throw notFound("Invite");

    const user = await upsertCurrentUserDoc(ctx);
    const existingMemberships = await ctx.db
      .query("institutionMemberships")
      .withIndex("by_institution_user", (index) =>
        index.eq("institutionId", institution._id).eq("userId", user._id),
      )
      .collect();
    if (existingMemberships.length > 1) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Organization membership is ambiguous",
      );
    }
    const existingMembership = existingMemberships[0];
    if (
      existingMembership &&
      !isOrganizationMembershipActive(institution, existingMembership, now)
    ) {
      throw notFound("Organization");
    }

    const roleRank: Record<InstitutionRole, number> = {
      learner: 0,
      instructor: 1,
      admin: 2,
    };
    const organizationRole =
      existingMembership &&
      roleRank[existingMembership.role] > roleRank[invite.role]
        ? existingMembership.role
        : invite.role;
    if (existingMembership) {
      if (existingMembership.role !== organizationRole) {
        await ctx.db.patch(existingMembership._id, { role: organizationRole });
      }
    } else {
      await ctx.db.insert("institutionMemberships", {
        institutionId: institution._id,
        userId: user._id,
        role: organizationRole,
        status: "active",
        createdAt: new Date(now).toISOString(),
      });
    }
    const inviteCohortId = invite.cohortId;
    if (inviteCohortId) {
      const existingEnrollments = await ctx.db
        .query("cohortMemberships")
        .withIndex("by_cohort_user", (index) =>
          index.eq("cohortId", inviteCohortId).eq("userId", user._id),
        )
        .collect();
      if (existingEnrollments.length > 1) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Cohort enrollment is ambiguous",
        );
      }
      if (!existingEnrollments[0]) {
        await ctx.db.insert("cohortMemberships", {
          cohortId: inviteCohortId,
          userId: user._id,
        });
      }
    }
    const acceptedAt = new Date().toISOString();
    await ctx.db.patch(invite._id, { acceptedAt });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: invite.institutionId,
      ...(inviteCohortId ? { cohortId: inviteCohortId } : {}),
      action: "enrollment_invite.accepted",
      targetTable: "enrollmentInvites",
      targetId: invite._id,
      metadata: { inviteRole: invite.role, role: organizationRole },
    });
    return {
      institutionId: invite.institutionId,
      ...(inviteCohortId ? { cohortId: inviteCohortId } : {}),
      role: organizationRole,
    };
  },
});

export const listMine = query({
  args: {
    institutionId: v.optional(v.id("institutions")),
  },
  returns: v.array(
    v.object({
      id: v.id("cohorts"),
      institutionId: v.id("institutions"),
      institutionName: v.string(),
      title: v.string(),
      term: v.string(),
      role: institutionRoleValidator,
      archived: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const selectedAccess = args.institutionId
      ? await requireInstitutionRole(ctx, args.institutionId, ["learner"])
      : undefined;
    const { user } = selectedAccess ?? (await requireCurrentUser(ctx));
    const organizationMemberships = selectedAccess
      ? [selectedAccess.membership]
      : await ctx.db
          .query("institutionMemberships")
          .withIndex("by_user", (index) => index.eq("userId", user._id))
          .collect();
    const enrollments = await ctx.db
      .query("cohortMemberships")
      .withIndex("by_user", (index) => index.eq("userId", user._id))
      .collect();
    const membershipsByInstitution = new Map<
      string,
      typeof organizationMemberships
    >();
    for (const membership of organizationMemberships) {
      const key = membership.institutionId as string;
      membershipsByInstitution.set(key, [
        ...(membershipsByInstitution.get(key) ?? []),
        membership,
      ]);
    }
    const now = Date.now();
    const activeOrganizations = new Map<
      string,
      {
        institution: Doc<"institutions">;
        membership: Doc<"institutionMemberships">;
      }
    >();
    for (const entries of membershipsByInstitution.values()) {
      const firstMembership = entries[0];
      if (!firstMembership) continue;
      const institution = await ctx.db.get(firstMembership.institutionId);
      if (entries.length > 1) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Organization membership is ambiguous",
        );
      }
      const activeMemberships = entries.filter((membership) =>
        isOrganizationMembershipActive(institution, membership, now),
      );
      const membership = activeMemberships[0];
      if (!institution || !membership) continue;
      if (
        (institution.kind ?? "shared") === "personal" &&
        institution.personalOwnerUserId !== user._id
      ) {
        continue;
      }
      activeOrganizations.set(institution._id, { institution, membership });
    }

    const enrollmentCounts = new Map<string, number>();
    for (const enrollment of enrollments) {
      const cohort = await ctx.db.get(enrollment.cohortId);
      if (!cohort || !activeOrganizations.has(cohort.institutionId)) continue;
      const key = enrollment.cohortId as string;
      enrollmentCounts.set(key, (enrollmentCounts.get(key) ?? 0) + 1);
    }
    if ([...enrollmentCounts.values()].some((count) => count > 1)) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Cohort enrollment is ambiguous",
      );
    }

    const rows = new Map<
      string,
      {
        id: Id<"cohorts">;
        institutionId: Id<"institutions">;
        institutionName: string;
        title: string;
        term: string;
        role: InstitutionRole;
        archived: boolean;
      }
    >();
    for (const { institution, membership } of activeOrganizations.values()) {
      const cohorts = await ctx.db
        .query("cohorts")
        .withIndex("by_institution", (index) =>
          index.eq("institutionId", institution._id),
        )
        .collect();
      for (const cohort of cohorts) {
        if (membership.role === "learner" && !enrollmentCounts.has(cohort._id))
          continue;
        rows.set(cohort._id, {
          id: cohort._id,
          institutionId: institution._id,
          institutionName: institution.name,
          title: cohort.title,
          term: cohort.term,
          role: membership.role,
          archived: cohort.archived,
        });
      }
    }
    return [...rows.values()].sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  },
});

export const listRoster = query({
  args: {
    cohortId: v.id("cohorts"),
  },
  returns: v.array(
    v.object({
      userId: v.id("users"),
      displayName: v.string(),
      organizationRole: institutionRoleValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const { cohort, institution } = await requireCohortRole(
      ctx,
      args.cohortId,
      ["instructor", "admin"],
    );
    const memberships = await ctx.db
      .query("cohortMemberships")
      .withIndex("by_cohort", (index) => index.eq("cohortId", args.cohortId))
      .collect();
    const enrollmentUsers = new Set<string>();
    for (const membership of memberships) {
      const key = membership.userId as string;
      if (enrollmentUsers.has(key)) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Cohort enrollment is ambiguous",
        );
      }
      enrollmentUsers.add(key);
    }
    const rows = [];
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;
      const organizationMemberships = await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index
            .eq("institutionId", cohort.institutionId)
            .eq("userId", user._id),
        )
        .collect();
      if (organizationMemberships.length > 1) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Organization membership is ambiguous",
        );
      }
      const activeMemberships = organizationMemberships.filter(
        (organizationMembership) =>
          isOrganizationMembershipActive(
            institution,
            organizationMembership,
            Date.now(),
          ),
      );
      const organizationMembership = activeMemberships[0];
      if (!organizationMembership) continue;
      rows.push({
        userId: user._id,
        displayName: user.displayName,
        organizationRole: organizationMembership.role,
      });
    }
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});
