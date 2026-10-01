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
import { requireScopedInstitutionRole } from "./authz";
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

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authz.ts": () => import("./authz"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./errors.ts": () => import("./errors"),
  "./organizations.ts": () => import("./organizations"),
  "./fixture.ts": async () => ({ checkInstitution }),
};

const checkInstitutionRef = makeFunctionReference<
  "query",
  { institutionId: Id<"institutions">; roles: InstitutionRole[] },
  null
>("fixture:checkInstitution");

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
});
