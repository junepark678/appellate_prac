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
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { v } from "convex/values";

const seedUsers = mutation({
  args: {
    users: v.array(
      v.object({
        authSubject: v.string(),
        displayName: v.string(),
        role: v.union(
          v.literal("student"),
          v.literal("admin"),
          v.literal("instructor"),
        ),
      }),
    ),
  },
  returns: v.array(v.id("users")),
  handler: async (ctx, { users }) =>
    Promise.all(
      users.map(({ authSubject, displayName, role }) =>
        ctx.db.insert("users", {
          authSubject,
          displayName,
          role,
          monthlyAiBudgetCents: 0,
        }),
      ),
    ),
});

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./organizations.ts": () => import("./organizations"),
  "./fixture.ts": async () => ({ seedUsers }),
};

const seedUsersRef = makeFunctionReference<
  "mutation",
  {
    users: {
      authSubject: string;
      displayName: string;
      role: "student" | "admin" | "instructor";
    }[];
  },
  Id<"users">[]
>("fixture:seedUsers");
const ensurePersonalRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { institutionId: Id<"institutions"> }
>("organizations:ensurePersonal");
const ensurePersonalInternalRef = makeFunctionReference<
  "mutation",
  { userId: Id<"users"> },
  { institutionId: Id<"institutions"> }
>("organizations:ensurePersonalForTrustedUser");
const createSharedRef = makeFunctionReference<
  "mutation",
  { name: string; slug: string },
  Id<"institutions">
>("organizations:createShared");
const listMineRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    institutionId: Id<"institutions">;
    name: string;
    kind: "personal" | "shared";
    role: "learner" | "instructor" | "admin";
  }[]
>("organizations:listMine");
const getContextRef = makeFunctionReference<
  "query",
  { institutionId: Id<"institutions"> },
  {
    institutionId: Id<"institutions">;
    name: string;
    kind: "personal" | "shared";
    role: "learner" | "instructor" | "admin";
    capabilities: { manageMembers: boolean; teach: boolean; learn: boolean };
  }
>("organizations:getContext");

type TestIdentity = {
  issuer: string;
  subject: string;
  tokenIdentifier: string;
  name: string;
  selectedOrganizationId?: string;
};

const identity = (
  subject: string,
  selectedOrganizationId?: string,
): TestIdentity => ({
  issuer: "https://identity.example.test",
  subject,
  tokenIdentifier: `https://identity.example.test|${subject}`,
  name: subject,
  ...(selectedOrganizationId ? { selectedOrganizationId } : {}),
});

async function seedUsersFor(
  t: TestConvex<typeof schema>,
  subjects: string[],
  role: "student" | "admin" | "instructor" = "student",
) {
  return t.mutation(seedUsersRef, {
    users: subjects.map((subject) => ({
      authSubject: identity(subject).tokenIdentifier,
      displayName: subject,
      role,
    })),
  });
}

async function insertInstitution(
  t: TestConvex<typeof schema>,
  input: {
    name: string;
    slug: string;
    status?: "active" | "paused" | "archived";
    kind?: "personal" | "shared";
    ownerUserId?: Id<"users">;
  },
) {
  return t.run((ctx) =>
    ctx.db.insert("institutions", {
      name: input.name,
      slug: input.slug,
      status: input.status ?? "active",
      monthlyAiBudgetCents: 0,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.ownerUserId ? { personalOwnerUserId: input.ownerUserId } : {}),
      ...(input.kind || input.ownerUserId
        ? { createdAt: new Date().toISOString() }
        : {}),
    }),
  );
}

async function insertMembership(
  t: TestConvex<typeof schema>,
  institutionId: Id<"institutions">,
  userId: Id<"users">,
  input: {
    role?: "learner" | "instructor" | "admin";
    status?: "active" | "suspended";
    expiresAt?: string;
  } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("institutionMemberships", {
      institutionId,
      userId,
      role: input.role ?? "learner",
      status: input.status ?? "active",
      createdAt: new Date().toISOString(),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    }),
  );
}

describe("organization APIs", () => {
  it("creates one personal workspace and returns stable identifiers across retries and Promise.all calls", async () => {
    const t = convexTest(schema, modules);
    const [userId] = await seedUsersFor(t, ["alice"]);
    if (!userId) throw new Error("user fixture missing");
    const asAlice = t.withIdentity(identity("alice"));

    // convex-test serializes top-level mutations; this is idempotence coverage,
    // not evidence of optimistic transaction conflict handling.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => asAlice.mutation(ensurePersonalRef, {})),
    );
    const ids = new Set(results.map(({ institutionId }) => institutionId));
    expect(ids.size).toBe(1);
    const institutionId = results[0]?.institutionId;
    expect(institutionId).toBeDefined();

    await t.run(async (ctx) => {
      const institutions = await ctx.db
        .query("institutions")
        .withIndex("by_personal_owner", (index) =>
          index.eq("personalOwnerUserId", userId),
        )
        .collect();
      const memberships = await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index.eq("institutionId", institutionId!).eq("userId", userId),
        )
        .collect();
      expect(institutions).toHaveLength(1);
      expect(institutions[0]).toMatchObject({
        _id: institutionId,
        kind: "personal",
        personalOwnerUserId: userId,
        name: "Personal workspace",
        slug: `personal-${userId}`,
        status: "active",
        monthlyAiBudgetCents: 0,
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ role: "admin", status: "active" });
    });
  });

  it("uses the trusted internal bootstrap and fails closed for ambiguous or inactive personal workspaces", async () => {
    const t = convexTest(schema, modules);
    const [internalUserId, suspendedUserId, expiredUserId, duplicateUserId] =
      await seedUsersFor(t, ["internal", "suspended", "expired", "duplicate"]);
    if (
      !internalUserId ||
      !suspendedUserId ||
      !expiredUserId ||
      !duplicateUserId
    ) {
      throw new Error("user fixture missing");
    }

    const internal = await t.mutation(ensurePersonalInternalRef, {
      userId: internalUserId,
    });
    expect(
      await t.mutation(ensurePersonalInternalRef, { userId: internalUserId }),
    ).toEqual(internal);

    const suspendedOrg = await insertInstitution(t, {
      name: "Personal workspace",
      slug: `personal-${suspendedUserId}`,
      kind: "personal",
      ownerUserId: suspendedUserId,
    });
    await insertMembership(t, suspendedOrg, suspendedUserId, {
      role: "admin",
      status: "suspended",
    });

    const expiredOrg = await insertInstitution(t, {
      name: "Personal workspace",
      slug: `personal-${expiredUserId}`,
      kind: "personal",
      ownerUserId: expiredUserId,
    });
    await insertMembership(t, expiredOrg, expiredUserId, {
      role: "admin",
      expiresAt: "2000-01-01T00:00:00Z",
    });

    const duplicateOne = await insertInstitution(t, {
      name: "Personal workspace",
      slug: `personal-${duplicateUserId}-a`,
      kind: "personal",
      ownerUserId: duplicateUserId,
    });
    await insertInstitution(t, {
      name: "Personal workspace",
      slug: `personal-${duplicateUserId}-b`,
      kind: "personal",
      ownerUserId: duplicateUserId,
    });
    await insertMembership(t, duplicateOne, duplicateUserId, { role: "admin" });

    const before = await t.run((ctx) =>
      ctx.db.query("institutionMemberships").collect(),
    );
    await expect(
      t.withIdentity(identity("suspended")).mutation(ensurePersonalRef, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      t.withIdentity(identity("expired")).mutation(ensurePersonalRef, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      t.withIdentity(identity("duplicate")).mutation(ensurePersonalRef, {}),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await t.run((ctx) => ctx.db.query("institutionMemberships").collect()),
    ).toEqual(before);
  });

  it("validates and creates a shared organization with only the caller membership", async () => {
    const t = convexTest(schema, modules);
    const [aliceId, bobId] = await seedUsersFor(t, [
      "alice-shared",
      "bob-shared",
    ]);
    if (!aliceId || !bobId) throw new Error("user fixture missing");
    const existingOrgId = await insertInstitution(t, {
      name: "Bob existing",
      slug: "bob-existing",
    });
    const bobMembershipId = await insertMembership(t, existingOrgId, bobId, {
      role: "instructor",
    });
    const asAlice = t.withIdentity(identity("alice-shared"));

    const institutionId = await asAlice.mutation(createSharedRef, {
      name: "  Appellate Lab  ",
      slug: "appellate-lab",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(institutionId)).toMatchObject({
        name: "Appellate Lab",
        slug: "appellate-lab",
        kind: "shared",
        status: "active",
        monthlyAiBudgetCents: 0,
      });
      const members = await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution", (index) =>
          index.eq("institutionId", institutionId),
        )
        .collect();
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        userId: aliceId,
        role: "admin",
        status: "active",
      });
      expect(await ctx.db.get(bobMembershipId)).toMatchObject({
        institutionId: existingOrgId,
        userId: bobId,
        role: "instructor",
      });
      expect(
        await ctx.db.query("institutionMemberships").collect(),
      ).toHaveLength(2);
    });

    await expect(
      asAlice.mutation(createSharedRef, { name: "  ", slug: "valid-name" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    for (const slug of ["UPPER", "two words", "ab", "x".repeat(81)]) {
      await expect(
        asAlice.mutation(createSharedRef, { name: "Valid name", slug }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    await expect(
      asAlice.mutation(createSharedRef, {
        name: "A".repeat(121),
        slug: "long-name",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      asAlice.mutation(createSharedRef, {
        name: "Another",
        slug: "appellate-lab",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });

  it("lists only active scoped memberships in stable order and derives context capabilities from membership role", async () => {
    const t = convexTest(schema, modules);
    const [aliceId, bobId, readerId] = await seedUsersFor(
      t,
      ["alice-context", "bob-context", "reader-context"],
      "admin",
    );
    if (!aliceId || !bobId || !readerId)
      throw new Error("user fixture missing");

    const personalId = await insertInstitution(t, {
      name: "Personal workspace",
      slug: `personal-${aliceId}`,
      kind: "personal",
      ownerUserId: aliceId,
    });
    await insertMembership(t, personalId, aliceId, { role: "admin" });
    const alphaId = await insertInstitution(t, {
      name: "Alpha",
      slug: "alpha",
    });
    await insertMembership(t, alphaId, aliceId, { role: "instructor" });
    const zetaId = await insertInstitution(t, { name: "Zeta", slug: "zeta" });
    await insertMembership(t, zetaId, aliceId, { role: "learner" });
    const pausedId = await insertInstitution(t, {
      name: "Paused",
      slug: "paused",
      status: "paused",
    });
    await insertMembership(t, pausedId, aliceId, { role: "admin" });
    const archivedId = await insertInstitution(t, {
      name: "Archived",
      slug: "archived",
      status: "archived",
    });
    await insertMembership(t, archivedId, aliceId, { role: "admin" });
    const suspendedId = await insertInstitution(t, {
      name: "Suspended",
      slug: "suspended",
    });
    await insertMembership(t, suspendedId, aliceId, {
      role: "admin",
      status: "suspended",
    });
    const expiredId = await insertInstitution(t, {
      name: "Expired",
      slug: "expired",
    });
    await insertMembership(t, expiredId, aliceId, {
      expiresAt: "2000-01-01T00:00:00Z",
    });
    const invalidId = await insertInstitution(t, {
      name: "Invalid expiry",
      slug: "invalid-expiry",
    });
    await insertMembership(t, invalidId, aliceId, { expiresAt: "not-a-time" });
    const offsetId = await insertInstitution(t, {
      name: "Offset expiry",
      slug: "offset-expiry",
    });
    await insertMembership(t, offsetId, aliceId, {
      expiresAt: "2099-01-01T00:00:00+01:00",
    });
    const foreignPersonalId = await insertInstitution(t, {
      name: "Bob private",
      slug: `personal-${bobId}`,
      kind: "personal",
      ownerUserId: bobId,
    });
    await insertMembership(t, foreignPersonalId, aliceId, { role: "admin" });

    const before = await t.run(async (ctx) => ({
      organizations: await ctx.db.query("institutions").collect(),
      memberships: await ctx.db.query("institutionMemberships").collect(),
    }));
    const reader = t.withIdentity(identity("reader-context"));
    expect(await reader.query(listMineRef, {})).toEqual([]);
    const afterEmptyRead = await t.run(async (ctx) => ({
      organizations: await ctx.db.query("institutions").collect(),
      memberships: await ctx.db.query("institutionMemberships").collect(),
    }));
    expect(afterEmptyRead).toEqual(before);

    const asAlice = t.withIdentity(
      identity("alice-context", foreignPersonalId),
    );
    const listed = await asAlice.query(listMineRef, {});
    expect(listed).toEqual([
      {
        institutionId: personalId,
        name: "Personal workspace",
        kind: "personal",
        role: "admin",
      },
      {
        institutionId: alphaId,
        name: "Alpha",
        kind: "shared",
        role: "instructor",
      },
      { institutionId: zetaId, name: "Zeta", kind: "shared", role: "learner" },
    ]);

    expect(
      await asAlice.query(getContextRef, { institutionId: personalId }),
    ).toEqual({
      institutionId: personalId,
      name: "Personal workspace",
      kind: "personal",
      role: "admin",
      capabilities: { manageMembers: true, teach: true, learn: true },
    });
    expect(
      await asAlice.query(getContextRef, { institutionId: alphaId }),
    ).toEqual({
      institutionId: alphaId,
      name: "Alpha",
      kind: "shared",
      role: "instructor",
      capabilities: { manageMembers: false, teach: true, learn: true },
    });
    expect(
      await asAlice.query(getContextRef, { institutionId: zetaId }),
    ).toEqual({
      institutionId: zetaId,
      name: "Zeta",
      kind: "shared",
      role: "learner",
      capabilities: { manageMembers: false, teach: false, learn: true },
    });
    for (const institutionId of [
      pausedId,
      archivedId,
      suspendedId,
      expiredId,
      invalidId,
      offsetId,
      foreignPersonalId,
    ]) {
      await expect(
        asAlice.query(getContextRef, { institutionId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    const after = await t.run(async (ctx) => ({
      organizations: await ctx.db.query("institutions").collect(),
      memberships: await ctx.db.query("institutionMemberships").collect(),
    }));
    expect(after).toEqual(before);
  });

  it("rejects unauthenticated access and duplicate personal membership records", async () => {
    const t = convexTest(schema, modules);
    const [userId, duplicateMembershipUserId] = await seedUsersFor(t, [
      "auth-check",
      "duplicate-membership",
    ]);
    if (!userId || !duplicateMembershipUserId)
      throw new Error("user fixture missing");
    const authCheckInstitutionId = await insertInstitution(t, {
      name: "Auth check",
      slug: "auth-check",
    });

    await expect(t.mutation(ensurePersonalRef, {})).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(
      t.mutation(createSharedRef, { name: "Lab", slug: "lab" }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(t.query(listMineRef, {})).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(
      t.query(getContextRef, {
        institutionId: authCheckInstitutionId,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    const institutionId = await insertInstitution(t, {
      name: "Personal workspace",
      slug: `personal-${duplicateMembershipUserId}`,
      kind: "personal",
      ownerUserId: duplicateMembershipUserId,
    });
    await insertMembership(t, institutionId, duplicateMembershipUserId, {
      role: "admin",
    });
    await insertMembership(t, institutionId, duplicateMembershipUserId, {
      role: "learner",
    });
    await expect(
      t
        .withIdentity(identity("duplicate-membership"))
        .mutation(ensurePersonalRef, {}),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
