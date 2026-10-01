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
import { ConvexError as ConvexValuesError, v } from "convex/values";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { AppErrorCode, type AppErrorData } from "./errors";
import {
  requireScopedCohortRole,
  requireScopedInstitutionRole,
} from "./authz";
import type { InstitutionRole } from "./authz";
import schema from "./schema";

const roleValidator = v.union(
  v.literal("learner"),
  v.literal("instructor"),
  v.literal("admin"),
);

const checkInstitution = query({
  args: {
    institutionId: v.id("institutions"),
    roles: v.array(roleValidator),
  },
  returns: v.null(),
  handler: async (ctx, { institutionId, roles }) => {
    await requireScopedInstitutionRole(ctx, institutionId, roles);
    return null;
  },
});

const checkCohort = query({
  args: {
    cohortId: v.id("cohorts"),
    roles: v.array(roleValidator),
  },
  returns: v.null(),
  handler: async (ctx, { cohortId, roles }) => {
    await requireScopedCohortRole(ctx, cohortId, roles);
    return null;
  },
});

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authz.ts": () => import("./authz"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./errors.ts": () => import("./errors"),
  "./organizations.ts": () => import("./organizations"),
  "./fixture.ts": async () => ({ checkInstitution, checkCohort }),
};

const checkInstitutionRef = makeFunctionReference<
  "query",
  { institutionId: Id<"institutions">; roles: InstitutionRole[] },
  null
>("fixture:checkInstitution");

const checkCohortRef = makeFunctionReference<
  "query",
  { cohortId: Id<"cohorts">; roles: InstitutionRole[] },
  null
>("fixture:checkCohort");

const createSharedRef = makeFunctionReference<
  "mutation",
  { name: string; slug: string },
  Id<"institutions">
>("organizations:createShared");

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

async function seedWireFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authSubject: identity("wire-user").tokenIdentifier,
      displayName: "Wire user",
      role: "student",
      monthlyAiBudgetCents: 0,
    });
    const institutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Wire organization",
      slug: "wire-organization",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const conflictInstitutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Conflict organization",
      slug: "conflict-organization",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const foreignInstitutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Foreign organization secret title",
      slug: "wire-foreign-organization",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const inaccessibleInstitutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Inaccessible organization secret title",
      slug: "wire-inaccessible-organization",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    const inactiveInstitutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Inactive organization secret title",
      slug: "wire-inactive-organization",
      status: "paused",
      monthlyAiBudgetCents: 0,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId,
      role: "learner",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId: conflictInstitutionId,
      userId,
      role: "learner",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    const cohort = (targetInstitutionId: Id<"institutions">, title: string) =>
      ctx.db.insert("cohorts", {
        institutionId: targetInstitutionId,
        title,
        term: "Fall",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-12-31T00:00:00.000Z",
        archived: false,
      });
    const enrolledCohortId = await cohort(institutionId, "Enrolled cohort");
    const unEnrolledCohortId = await cohort(
      institutionId,
      "Unenrolled cohort secret title",
    );
    const foreignCohortId = await cohort(
      foreignInstitutionId,
      "Foreign cohort secret title",
    );
    const inaccessibleCohortId = await cohort(
      inaccessibleInstitutionId,
      "Inaccessible cohort secret title",
    );
    const inactiveCohortId = await cohort(
      inactiveInstitutionId,
      "Inactive cohort secret title",
    );
    const membershipConflictCohortId = await cohort(
      conflictInstitutionId,
      "Membership conflict cohort",
    );
    const enrollmentConflictCohortId = await cohort(
      institutionId,
      "Enrollment conflict cohort",
    );
    const missingCohortId = await cohort(
      inaccessibleInstitutionId,
      "Deleted cohort secret title",
    );
    await ctx.db.delete(missingCohortId);

    const cohortLifecycleSubjects = [
      { subject: "cohort-suspended-user", status: "suspended" as const },
      {
        subject: "cohort-expired-user",
        status: "active" as const,
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
      {
        subject: "cohort-invalid-expiry-user",
        status: "active" as const,
        expiresAt: "2999-01-01 00:00:00",
      },
    ];
    for (const actor of cohortLifecycleSubjects) {
      const actorId = await ctx.db.insert("users", {
        authSubject: identity(actor.subject).tokenIdentifier,
        displayName: actor.subject,
        role: "student",
        monthlyAiBudgetCents: 0,
      });
      await ctx.db.insert("institutionMemberships", {
        institutionId,
        userId: actorId,
        role: "learner",
        status: actor.status,
        createdAt: new Date().toISOString(),
        ...(actor.expiresAt ? { expiresAt: actor.expiresAt } : {}),
      });
      await ctx.db.insert("cohortMemberships", {
        cohortId: enrolledCohortId,
        userId: actorId,
        role: "learner",
      });
    }
    const instructorUserId = await ctx.db.insert("users", {
      authSubject: identity("wire-instructor").tokenIdentifier,
      displayName: "Wire instructor",
      role: "instructor",
      monthlyAiBudgetCents: 0,
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId,
      userId: instructorUserId,
      role: "instructor",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId: inactiveInstitutionId,
      userId,
      role: "learner",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: enrolledCohortId,
      userId,
      role: "learner",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: inactiveCohortId,
      userId,
      role: "learner",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: enrollmentConflictCohortId,
      userId,
      role: "learner",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: enrollmentConflictCohortId,
      userId,
      role: "admin",
    });
    await ctx.db.insert("institutionMemberships", {
      institutionId: conflictInstitutionId,
      userId,
      role: "instructor",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    const missingInstitutionId = await ctx.db.insert("institutions", {
      kind: "shared",
      createdAt: new Date().toISOString(),
      name: "Foreign record secret title",
      slug: "wire-missing-record",
      status: "active",
      monthlyAiBudgetCents: 0,
    });
    await ctx.db.delete(missingInstitutionId);

    return {
      userId,
      institutionId,
      conflictInstitutionId,
      missingInstitutionId,
      enrolledCohortId,
      unEnrolledCohortId,
      foreignCohortId,
      inaccessibleCohortId,
      inactiveCohortId,
      missingCohortId,
      membershipConflictCohortId,
      enrollmentConflictCohortId,
      instructorUserId,
      cohortLifecycleSubjects: cohortLifecycleSubjects.map(
        (actor) => actor.subject,
      ),
    };
  });
}

async function expectWireError(promise: Promise<unknown>, code: AppErrorCode) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConvexValuesError);
  const error = caught as ConvexValuesError<AppErrorData>;
  expect(error.data.code).toBe(code);
  expect(typeof error.data.message).toBe("string");
  return error;
}

describe("registered organization authorization error envelope", () => {
  it("preserves public error codes and keeps NOT_FOUND free of foreign metadata", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWireFixture(t);
    const asUser = t.withIdentity(identity("wire-user"));

    const authRequired = await expectWireError(
      t.query(checkInstitutionRef, {
        institutionId: fixture.institutionId,
        roles: ["learner"],
      }),
      AppErrorCode.AUTH_REQUIRED,
    );
    expect(authRequired.data.message).toBe("Authentication required");

    const notFound = await expectWireError(
      asUser.query(checkInstitutionRef, {
        institutionId: fixture.missingInstitutionId,
        roles: ["learner"],
      }),
      AppErrorCode.NOT_FOUND,
    );
    expect(notFound.data).toMatchObject({
      code: AppErrorCode.NOT_FOUND,
      message: "Organization not found",
    });
    expect(notFound.data.metadata).toBeUndefined();
    expect(JSON.stringify(notFound.data)).not.toContain(
      fixture.missingInstitutionId,
    );
    expect(JSON.stringify(notFound.data)).not.toContain(
      "Foreign record secret title",
    );

    const unauthorized = await expectWireError(
      asUser.query(checkInstitutionRef, {
        institutionId: fixture.institutionId,
        roles: ["instructor", "admin"],
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );
    expect(unauthorized.data.metadata).toEqual({
      roles: ["instructor", "admin"],
    });

    const validation = await expectWireError(
      asUser.mutation(createSharedRef, {
        name: "Malformed organization",
        slug: "Uppercase-Slug",
      }),
      AppErrorCode.VALIDATION_ERROR,
    );
    expect(validation.data.metadata).toEqual({ field: "slug" });

    const conflict = await expectWireError(
      asUser.query(checkInstitutionRef, {
        institutionId: fixture.conflictInstitutionId,
        roles: ["learner", "instructor", "admin"],
      }),
      AppErrorCode.CONFLICT,
    );
    expect(conflict.data.message).toBe("Organization membership is ambiguous");
  });

  it("hides cohort existence until the actor can see the cohort", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedWireFixture(t);
    const asUser = t.withIdentity(identity("wire-user"));

    const authRequired = await expectWireError(
      t.query(checkCohortRef, {
        cohortId: fixture.missingCohortId,
        roles: ["learner"],
      }),
      AppErrorCode.AUTH_REQUIRED,
    );
    expect(authRequired.data.message).toBe("Authentication required");

    const inaccessibleCohorts = [
      fixture.missingCohortId,
      fixture.foreignCohortId,
      fixture.inactiveCohortId,
      fixture.inaccessibleCohortId,
    ];
    const unavailable = await expectWireError(
      asUser.query(checkCohortRef, {
        cohortId: inaccessibleCohorts[0],
        roles: ["learner"],
      }),
      AppErrorCode.NOT_FOUND,
    );
    expect(unavailable.data).toEqual({
      code: AppErrorCode.NOT_FOUND,
      message: "Cohort not found",
    });

    for (const cohortId of inaccessibleCohorts.slice(1)) {
      const error = await expectWireError(
        asUser.query(checkCohortRef, {
          cohortId,
          roles: ["learner"],
        }),
        AppErrorCode.NOT_FOUND,
      );
      expect(error.data).toEqual(unavailable.data);
    }

    // A learner's missing enrollment must be checked before denying an
    // instructor-only operation, or that role denial would reveal the cohort.
    const notEnrolled = await expectWireError(
      asUser.query(checkCohortRef, {
        cohortId: fixture.unEnrolledCohortId,
        roles: ["instructor"],
      }),
      AppErrorCode.NOT_FOUND,
    );
    expect(notEnrolled.data).toEqual(unavailable.data);
    for (const cohortId of inaccessibleCohorts) {
      const error = await expectWireError(
        asUser.query(checkCohortRef, {
          cohortId,
          roles: ["instructor"],
        }),
        AppErrorCode.NOT_FOUND,
      );
      expect(error.data).toEqual(unavailable.data);
    }

    for (const subject of fixture.cohortLifecycleSubjects) {
      const error = await expectWireError(
        t.withIdentity(identity(subject)).query(checkCohortRef, {
          cohortId: fixture.enrolledCohortId,
          roles: ["instructor"],
        }),
        AppErrorCode.NOT_FOUND,
      );
      expect(error.data).toEqual(unavailable.data);
    }

    // Staff callers use ['learner'] for learner-scoped operations so that
    // enrollment remains required even though the role matrix permits access.
    const asInstructor = t.withIdentity(identity("wire-instructor"));
    const instructorNotEnrolled = await expectWireError(
      asInstructor.query(checkCohortRef, {
        cohortId: fixture.unEnrolledCohortId,
        roles: ["learner"],
      }),
      AppErrorCode.NOT_FOUND,
    );
    expect(instructorNotEnrolled.data).toEqual(unavailable.data);
    await t.run(async (ctx) => {
      await ctx.db.insert("cohortMemberships", {
        cohortId: fixture.unEnrolledCohortId,
        userId: fixture.instructorUserId,
        role: "instructor",
      });
    });
    await expect(
      asInstructor.query(checkCohortRef, {
        cohortId: fixture.unEnrolledCohortId,
        roles: ["learner"],
      }),
    ).resolves.toBeNull();

    const enrolledRoleDenial = await expectWireError(
      asUser.query(checkCohortRef, {
        cohortId: fixture.enrolledCohortId,
        roles: ["instructor"],
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );
    expect(enrolledRoleDenial.data.metadata).toEqual({
      roles: ["instructor"],
    });

    const membershipConflict = await expectWireError(
      asUser.query(checkCohortRef, {
        cohortId: fixture.membershipConflictCohortId,
        roles: ["learner"],
      }),
      AppErrorCode.CONFLICT,
    );
    expect(membershipConflict.data.message).toBe(
      "Organization membership is ambiguous",
    );
    const enrollmentConflict = await expectWireError(
      asUser.query(checkCohortRef, {
        cohortId: fixture.enrollmentConflictCohortId,
        roles: ["learner"],
      }),
      AppErrorCode.CONFLICT,
    );
    expect(enrollmentConflict.data.message).toBe(
      "Cohort enrollment is ambiguous",
    );

    const serialized = JSON.stringify(unavailable.data);
    expect(unavailable.data.metadata).toBeUndefined();
    for (const cohortId of inaccessibleCohorts) {
      expect(serialized).not.toContain(cohortId);
    }
    for (const secret of [
      "Foreign cohort secret title",
      "Inactive cohort secret title",
      "Inaccessible cohort secret title",
      "Deleted cohort secret title",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
