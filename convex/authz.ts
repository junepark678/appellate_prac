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

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCurrentUser } from "./authHelpers";
import { isOrganizationMembershipActive } from "./organizationContracts";
import {
  AppErrorCode,
  ConvexError,
  notFound,
  unauthorizedRole,
} from "./errors";

export type ReadCtx = QueryCtx | MutationCtx;
/** Legacy cohort role fields are not an authorization source. */
export type CohortRole = InstitutionRole;
export type InstitutionRole = Doc<"institutionMemberships">["role"];

/**
 * NOT cryptographic — NEVER use for security, authentication, or tokens.
 * Produces a deterministic short id from a string for non-security lookups only.
 *
 * Canonical source: src/domain/auth-pure.ts — keep in sync.
 */
export function toDeterministicId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Canonical source: src/domain/auth-pure.ts — keep in sync.
 */
export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Retained only for source compatibility. Global user roles no longer grant
 * authority; authenticated callers must use an organization-scoped helper.
 */
export async function requireGlobalRole(
  ctx: ReadCtx,
  _roles: string[],
): Promise<Doc<"users">> {
  await requireCurrentUser(ctx);
  throw new ConvexError(
    AppErrorCode.VALIDATION_ERROR,
    "Use organization membership management",
  );
}

/** Legacy global administrator checks are deliberately fail-closed. */
export async function requireAdmin(ctx: ReadCtx): Promise<Doc<"users">> {
  return requireGlobalRole(ctx, ["admin"]);
}

const scopedRoleCapabilities: Record<InstitutionRole, InstitutionRole[]> = {
  learner: ["learner"],
  instructor: ["learner", "instructor"],
  admin: ["learner", "instructor", "admin"],
};

function scopedRoleAllowed(role: InstitutionRole, roles: InstitutionRole[]) {
  return scopedRoleCapabilities[role].some((capability) =>
    roles.includes(capability),
  );
}

async function requireScopedInstitution(
  ctx: ReadCtx,
  institutionId: Id<"institutions">,
  user: Doc<"users">,
) {
  const institution = await ctx.db.get(institutionId);
  if (
    !institution ||
    institution.status !== "active" ||
    ((institution.kind ?? "shared") === "personal" &&
      institution.personalOwnerUserId !== user._id)
  ) {
    throw notFound("Organization");
  }
  return institution;
}

async function requireScopedMembership(
  ctx: ReadCtx,
  institution: Doc<"institutions">,
  user: Doc<"users">,
) {
  const memberships = await ctx.db
    .query("institutionMemberships")
    .withIndex("by_institution_user", (index) =>
      index.eq("institutionId", institution._id).eq("userId", user._id),
    )
    .collect();
  const activeMemberships = memberships.filter((membership) =>
    isOrganizationMembershipActive(institution, membership, Date.now()),
  );
  if (activeMemberships.length > 1) {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "Organization membership is ambiguous",
    );
  }
  const membership = activeMemberships[0];
  if (!membership) throw notFound("Organization");
  return membership;
}

async function requireScopedCohortEnrollment(
  ctx: ReadCtx,
  cohortId: Id<"cohorts">,
  userId: Id<"users">,
) {
  const enrollments = await ctx.db
    .query("cohortMemberships")
    .withIndex("by_cohort_user", (index) =>
      index.eq("cohortId", cohortId).eq("userId", userId),
    )
    .collect();
  if (enrollments.length > 1) {
    throw new ConvexError(
      AppErrorCode.CONFLICT,
      "Cohort enrollment is ambiguous",
    );
  }
  if (!enrollments[0]) throw notFound("Cohort");
}

/** Organization-scoped authorization. Only active organization membership
 * supplies authority; global roles and support grants are ignored. */
export async function requireScopedInstitutionRole(
  ctx: ReadCtx,
  institutionId: Id<"institutions">,
  roles: InstitutionRole[],
) {
  const { user } = await requireCurrentUser(ctx);
  const institution = await requireScopedInstitution(ctx, institutionId, user);
  const membership = await requireScopedMembership(ctx, institution, user);
  if (!scopedRoleAllowed(membership.role, roles)) {
    throw unauthorizedRole(roles);
  }
  return { user, institution, membership };
}

/** Canonical helper retained under the established API name. */
export async function requireInstitutionRole(
  ctx: ReadCtx,
  institutionId: Id<"institutions">,
  roles: InstitutionRole[],
  _legacyOptions: { allowSupportGrant?: boolean } = {},
) {
  return requireScopedInstitutionRole(ctx, institutionId, roles);
}

/**
 * Derive the cohort's institution from storage. The returned membership is
 * always the active organization membership; cohort membership is checked
 * only as enrollment for learner-scoped cohort operations.
 * Callers must pass the exact operation role set. Learner-scoped operations
 * use ['learner']; including 'instructor' or 'admin' grants eligible staff
 * teaching access without requiring cohort enrollment.
 */
export async function requireScopedCohortRole(
  ctx: ReadCtx,
  cohortId: Id<"cohorts">,
  roles: InstitutionRole[],
) {
  const { user } = await requireCurrentUser(ctx);
  const cohort = await ctx.db.get(cohortId);
  if (!cohort) throw notFound("Cohort");

  let institution: Doc<"institutions">;
  let membership: Doc<"institutionMemberships">;
  try {
    institution = await requireScopedInstitution(
      ctx,
      cohort.institutionId,
      user,
    );
    membership = await requireScopedMembership(ctx, institution, user);
  } catch (error) {
    // A cohort is visible only through an active institution membership. Keep
    // missing, inactive, and inaccessible cohort lookups indistinguishable.
    if (
      error instanceof ConvexError &&
      error.data.code === AppErrorCode.NOT_FOUND
    ) {
      throw notFound("Cohort");
    }
    throw error;
  }

  // Learners can see cohort existence only through their enrollment, even if
  // the requested operation will later fail the institution-role check.
  if (membership.role === "learner") {
    await requireScopedCohortEnrollment(ctx, cohortId, user._id);
  }

  if (!scopedRoleAllowed(membership.role, roles)) {
    throw unauthorizedRole(roles);
  }

  const mayUseTeachingAccess =
    membership.role !== "learner" &&
    roles.some((role) => role === "instructor" || role === "admin");
  if (!mayUseTeachingAccess && membership.role !== "learner") {
    await requireScopedCohortEnrollment(ctx, cohortId, user._id);
  }

  return { user, cohort, institution, membership };
}

/** Canonical helper retained under the established API name. */
export async function requireCohortRole(
  ctx: ReadCtx,
  cohortId: Id<"cohorts">,
  roles: InstitutionRole[],
) {
  return requireScopedCohortRole(ctx, cohortId, roles);
}

export async function writeAuditLog(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"users">;
    institutionId?: Id<"institutions">;
    cohortId?: Id<"cohorts">;
    caseSessionId?: Id<"caseSessions">;
    action: string;
    targetTable?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ctx.db.insert("auditLog", {
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    ...(args.institutionId ? { institutionId: args.institutionId } : {}),
    ...(args.cohortId ? { cohortId: args.cohortId } : {}),
    ...(args.caseSessionId ? { caseSessionId: args.caseSessionId } : {}),
    action: args.action,
    ...(args.targetTable ? { targetTable: args.targetTable } : {}),
    ...(args.targetId ? { targetId: args.targetId } : {}),
    ...(args.metadata ? { metadataJson: JSON.stringify(args.metadata) } : {}),
    createdAt: new Date().toISOString(),
  });
}
