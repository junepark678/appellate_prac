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

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { AppErrorCode, type AppErrorData } from "./errors";
import type { InstitutionRole } from "./authz";
import schema from "./schema";
import { requireScopedCohortRole, requireScopedInstitutionRole } from "./authz";

const roleValidator = v.union(
  v.literal("learner"),
  v.literal("instructor"),
  v.literal("admin"),
);

const inspectInstitution = query({
  args: {
    institutionId: v.id("institutions"),
    roles: v.array(roleValidator),
  },
  returns: v.object({
    institutionId: v.id("institutions"),
    membershipRole: roleValidator,
    globalRole: v.string(),
  }),
  handler: async (ctx, { institutionId, roles }) => {
    const { user, institution, membership } =
      await requireScopedInstitutionRole(ctx, institutionId, roles);
    return {
      institutionId: institution._id,
      membershipRole: membership.role,
      globalRole: user.role,
    };
  },
});

const inspectCohort = query({
  args: {
    cohortId: v.id("cohorts"),
    roles: v.array(roleValidator),
  },
  returns: v.object({
    cohortId: v.id("cohorts"),
    institutionId: v.id("institutions"),
    membershipRole: roleValidator,
  }),
  handler: async (ctx, { cohortId, roles }) => {
    const { cohort, institution, membership } = await requireScopedCohortRole(
      ctx,
      cohortId,
      roles,
    );
    return {
      cohortId: cohort._id,
      institutionId: institution._id,
      membershipRole: membership.role,
    };
  },
});

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authz.ts": () => import("./authz"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./errors.ts": () => import("./errors"),
  "./fixture.ts": async () => ({ inspectInstitution, inspectCohort }),
};

const institutionRef = makeFunctionReference<
  "query",
  { institutionId: Id<"institutions">; roles: InstitutionRole[] },
  {
    institutionId: Id<"institutions">;
    membershipRole: InstitutionRole;
    globalRole: string;
  }
>("fixture:inspectInstitution");

const cohortRef = makeFunctionReference<
  "query",
  { cohortId: Id<"cohorts">; roles: InstitutionRole[] },
  {
    cohortId: Id<"cohorts">;
    institutionId: Id<"institutions">;
    membershipRole: InstitutionRole;
  }
>("fixture:inspectCohort");

type TestIdentity = {
  issuer: string;
  subject: string;
  tokenIdentifier: string;
  name: string;
};

const identity = (subject: string): TestIdentity => ({
  issuer: "https://identity.example.test",
  subject,
  tokenIdentifier: `https://identity.example.test|${subject}`,
  name: subject,
});

async function seedAuthorizationFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const user = async (
      subject: string,
      role: "student" | "instructor" | "admin" = "student",
    ) =>
      ctx.db.insert("users", {
        authSubject: identity(subject).tokenIdentifier,
        displayName: subject,
        role,
        monthlyAiBudgetCents: 0,
      });

    const [
      teacher,
      learner,
      adminOnly,
      duplicate,
      suspended,
      expired,
      invalidExpiry,
      pausedAdmin,
    ] = await Promise.all([
      user("teacher"),
      user("learner", "admin"),
      user("admin-only", "admin"),
      user("duplicate"),
      user("suspended"),
      user("expired"),
      user("invalid-expiry"),
      user("paused-admin"),
    ]);
    const institutionA = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Organization A",
      slug: "organization-a",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const institutionB = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Organization B",
      slug: "organization-b",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const pausedInstitution = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Paused Organization",
      slug: "paused-organization",
      status: "paused",
      monthlyAiBudgetCents: 0,
    });
    const cohortA = await ctx.db.insert("cohorts", {
      institutionId: institutionA,
      title: "Organization A cohort",
      term: "Fall",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-12-31T00:00:00.000Z",
      archived: false,
    });
    const cohortB = await ctx.db.insert("cohorts", {
      institutionId: institutionB,
      title: "Organization B cohort",
      term: "Fall",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-12-31T00:00:00.000Z",
      archived: false,
    });

    const membership = async (
      institutionId: Id<"institutions">,
      userId: Id<"users">,
      role: InstitutionRole,
      status: "active" | "suspended" = "active",
      expiresAt?: string,
    ) =>
      ctx.db.insert("institutionMemberships", {
        institutionId,
        userId,
        role,
        status,
        createdAt: new Date().toISOString(),
        ...(expiresAt ? { expiresAt } : {}),
      });

    await Promise.all([
      membership(institutionA, teacher, "instructor"),
      membership(institutionB, teacher, "learner"),
      membership(institutionB, learner, "learner"),
      membership(institutionA, duplicate, "instructor"),
      membership(institutionA, duplicate, "admin"),
      membership(institutionA, suspended, "admin", "suspended"),
      membership(
        institutionA,
        expired,
        "admin",
        "active",
        "2000-01-01T00:00:00.000Z",
      ),
      membership(
        institutionA,
        invalidExpiry,
        "admin",
        "active",
        "2999-01-01 00:00:00",
      ),
      membership(pausedInstitution, pausedAdmin, "admin"),
    ]);

    // These legacy rows and a support grant must not create scoped authority.
    await ctx.db.insert("cohortMemberships", {
      cohortId: cohortA,
      userId: adminOnly,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: cohortB,
      userId: learner,
      role: "admin",
    });
    await ctx.db.insert("supportAccessGrants", {
      institutionId: institutionA,
      supportUserId: adminOnly,
      grantedByUserId: teacher,
      reason: "test fixture only",
      expiresAt: "2999-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
    });

    return {
      teacher,
      learner,
      adminOnly,
      duplicate,
      suspended,
      expired,
      invalidExpiry,
      pausedAdmin,
      institutionA,
      institutionB,
      pausedInstitution,
      cohortA,
      cohortB,
    };
  });
}

async function expectAppError(promise: Promise<unknown>, code: AppErrorCode) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect((caught as { data?: AppErrorData }).data?.code).toBe(code);
  return caught as { data?: AppErrorData };
}

describe("scoped authorization primitives", () => {
  it("uses active institution roles and never global roles or support grants", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorizationFixture(t);
    const asTeacher = t.withIdentity(identity("teacher"));
    const asLearner = t.withIdentity(identity("learner"));
    const asAdminOnly = t.withIdentity(identity("admin-only"));
    const asDuplicate = t.withIdentity(identity("duplicate"));

    const instructorAccess = await asTeacher.query(institutionRef, {
      institutionId: fixture.institutionA,
      roles: ["instructor", "admin"],
    });
    expect(instructorAccess).toMatchObject({
      institutionId: fixture.institutionA,
      membershipRole: "instructor",
      globalRole: "student",
    });

    const learnerAccess = await asTeacher.query(institutionRef, {
      institutionId: fixture.institutionB,
      roles: ["learner"],
    });
    expect(learnerAccess.membershipRole).toBe("learner");
    await expectAppError(
      asTeacher.query(institutionRef, {
        institutionId: fixture.institutionB,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );

    // A legacy global admin role does not replace an active target membership.
    await expectAppError(
      asAdminOnly.query(institutionRef, {
        institutionId: fixture.institutionA,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.NOT_FOUND,
    );
    // An active support grant also grants no scoped membership authority.
    await expectAppError(
      asAdminOnly.query(institutionRef, {
        institutionId: fixture.institutionA,
        roles: ["learner"],
      }),
      AppErrorCode.NOT_FOUND,
    );
    // A legacy global admin role cannot elevate an active learner membership.
    await expectAppError(
      asLearner.query(institutionRef, {
        institutionId: fixture.institutionB,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );
    await expectAppError(
      asDuplicate.query(institutionRef, {
        institutionId: fixture.institutionA,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.CONFLICT,
    );

    for (const [subject, institutionId] of [
      ["suspended", fixture.institutionA],
      ["expired", fixture.institutionA],
      ["invalid-expiry", fixture.institutionA],
      ["paused-admin", fixture.pausedInstitution],
    ] as const) {
      await expectAppError(
        t.withIdentity(identity(subject)).query(institutionRef, {
          institutionId,
          roles: ["learner", "instructor", "admin"],
        }),
        AppErrorCode.NOT_FOUND,
      );
    }
  });

  it("derives cohort scope from storage and separates enrollment from teaching", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorizationFixture(t);
    const asTeacher = t.withIdentity(identity("teacher"));
    const asLearner = t.withIdentity(identity("learner"));
    const asAdminOnly = t.withIdentity(identity("admin-only"));

    const instructorAccess = await asTeacher.query(cohortRef, {
      cohortId: fixture.cohortA,
      roles: ["instructor", "admin"],
    });
    expect(instructorAccess).toEqual({
      cohortId: fixture.cohortA,
      institutionId: fixture.institutionA,
      membershipRole: "instructor",
    });
    await expectAppError(
      asTeacher.query(cohortRef, {
        cohortId: fixture.cohortB,
        roles: ["learner"],
      }),
      AppErrorCode.NOT_FOUND,
    );

    await expectAppError(
      asLearner.query(cohortRef, {
        cohortId: fixture.cohortB,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );

    await expectAppError(
      asAdminOnly.query(cohortRef, {
        cohortId: fixture.cohortA,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.NOT_FOUND,
    );

    const enrolledLearnerAccess = await asLearner.query(cohortRef, {
      cohortId: fixture.cohortB,
      roles: ["learner"],
    });
    expect(enrolledLearnerAccess.membershipRole).toBe("learner");

    // Admin inherits instructor capabilities inside its own organization.
    await t.run((ctx) =>
      ctx.db.insert("institutionMemberships", {
        institutionId: fixture.institutionA,
        userId: fixture.learner,
        role: "admin",
        status: "active",
        createdAt: new Date().toISOString(),
      }),
    );
    const adminAccess = await asLearner.query(cohortRef, {
      cohortId: fixture.cohortA,
      roles: ["instructor"],
    });
    expect(adminAccess.membershipRole).toBe("admin");
  });
});
