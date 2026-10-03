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

import type { Id } from "./_generated/dataModel";
import type { AppErrorData } from "./errors";
import { toDeterministicId } from "./authz";
import schema from "./schema";

const modules = {
  "./_generated/api.ts": () => import("./_generated/api"),
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authz.ts": () => import("./authz"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./cohorts.ts": () => import("./cohorts"),
  "./errors.ts": () => import("./errors"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./organizations.ts": () => import("./organizations"),
  "./users.ts": () => import("./users"),
};

type TestIdentity = {
  issuer: string;
  subject: string;
  tokenIdentifier: string;
  name: string;
  email?: string;
  emailVerified?: boolean;
};

const identity = (
  subject: string,
  email?: string,
  emailVerified?: boolean,
): TestIdentity => ({
  issuer: "https://identity.example.test",
  subject,
  tokenIdentifier: `https://identity.example.test|${subject}`,
  name: subject,
  ...(email ? { email } : {}),
  ...(emailVerified === undefined ? {} : { emailVerified }),
});

const createInstitutionRef = makeFunctionReference<
  "action",
  { name: string; slug: string },
  Id<"institutions">
>("cohorts:createInstitution");
const createCohortRef = makeFunctionReference<
  "mutation",
  {
    institutionId: Id<"institutions">;
    title: string;
    term: string;
    startsAt: string;
    endsAt: string;
  },
  Id<"cohorts">
>("cohorts:createCohort");
const addMemberRef = makeFunctionReference<
  "mutation",
  { cohortId: Id<"cohorts">; userId: Id<"users"> },
  null
>("cohorts:addMember");
const inviteMembersRef = makeFunctionReference<
  "mutation",
  {
    institutionId: Id<"institutions">;
    cohortId?: Id<"cohorts">;
    invites: { email: string; role: "learner" | "instructor" | "admin" }[];
    expiresAt?: string;
  },
  { email: string; role: "learner" | "instructor" | "admin"; token: string }[]
>("cohorts:inviteMembers");
const acceptInviteRef = makeFunctionReference<
  "mutation",
  { token: string },
  {
    institutionId: Id<"institutions">;
    cohortId?: Id<"cohorts">;
    role: "learner" | "instructor" | "admin";
  }
>("cohorts:acceptInvite");
const membersRef = makeFunctionReference<
  "query",
  { institutionId: Id<"institutions">; search?: string },
  {
    membershipId: Id<"institutionMemberships">;
    userId: Id<"users">;
    displayName: string;
    role: "learner" | "instructor" | "admin";
    status: "active" | "suspended";
    expiresAt?: string;
  }[]
>("users:listOrganizationMembers");
const legacySetInstitutionMemberRef = makeFunctionReference<
  "mutation",
  {
    institutionId: Id<"institutions">;
    userId: Id<"users">;
    role: "learner" | "instructor" | "admin";
  },
  null
>("cohorts:setInstitutionMember");
const legacySetRoleRef = makeFunctionReference<
  "mutation",
  { userId: Id<"users">; role: "student" | "instructor" | "admin" },
  null
>("users:setRole");
const legacySetMonthlyBudgetRef = makeFunctionReference<
  "mutation",
  { userId: Id<"users">; monthlyAiBudgetCents: number },
  null
>("users:setMonthlyAiBudget");
const legacyListUsersRef = makeFunctionReference<
  "query",
  { search?: string },
  {
    id: Id<"users">;
    authSubject: string;
    displayName: string;
    role: "student" | "instructor" | "admin";
    monthlyAiBudgetCents: number;
    currentMonthAiSpendCents: number;
  }[]
>("users:list");
const updateMemberRef = makeFunctionReference<
  "mutation",
  {
    institutionId: Id<"institutions">;
    membershipId: Id<"institutionMemberships">;
    role: "learner" | "instructor" | "admin";
    status: "active" | "suspended";
    expiresAt?: string;
  },
  null
>("users:updateOrganizationMember");
const setBudgetRef = makeFunctionReference<
  "mutation",
  { institutionId: Id<"institutions">; monthlyAiBudgetCents: number },
  null
>("users:setOrganizationBudget");

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect((caught as { data?: AppErrorData }).data?.code).toBe(code);
  return (caught as { data: AppErrorData }).data;
}

function tokenFrom(invite: { token: string } | undefined) {
  if (!invite) throw new Error("Expected an invite token");
  return invite.token;
}

async function seedFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const user = async (subject: string) =>
      ctx.db.insert("users", {
        authSubject: identity(subject).tokenIdentifier,
        displayName: subject,
        monthlyAiBudgetCents: 0,
      });
    const [admin, secondAdmin, instructor, learner, foreignLearner, suspended] =
      await Promise.all([
        user("organization-admin"),
        user("second-admin"),
        user("organization-instructor"),
        user("organization-learner"),
        user("foreign-learner"),
        user("suspended-learner"),
      ]);
    const institution = async (
      name: string,
      slug: string,
      kind: "shared" | "personal" = "shared",
    ) =>
      ctx.db.insert("institutions", {
        kind,
        ...(kind === "personal" ? { personalOwnerUserId: admin } : {}),
        createdAt: new Date().toISOString(),
        name,
        slug,
        status: "active",
        monthlyAiBudgetCents: 0,
      });
    const [organizationA, organizationB, personalOrganization] =
      await Promise.all([
        institution("Organization A", "cohorts-organization-a"),
        institution("Organization B", "cohorts-organization-b"),
        institution("Personal Organization", "cohorts-personal", "personal"),
      ]);
    const membership = (
      institutionId: Id<"institutions">,
      userId: Id<"users">,
      role: "learner" | "instructor" | "admin",
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
    const [
      adminMembership,
      secondAdminMembership,
      instructorMembership,
      learnerMembership,
      adminBMembership,
    ] = await Promise.all([
      membership(organizationA, admin, "admin"),
      membership(organizationA, secondAdmin, "admin", "suspended"),
      membership(organizationA, instructor, "instructor"),
      membership(organizationA, learner, "learner"),
      membership(organizationB, admin, "learner"),
      membership(organizationB, foreignLearner, "learner"),
      membership(organizationA, suspended, "learner", "suspended"),
      membership(personalOrganization, admin, "admin"),
    ]).then(([a, b, c, d, e]) => [a, b, c, d, e] as const);
    const cohort = async (institutionId: Id<"institutions">, title: string) =>
      ctx.db.insert("cohorts", {
        institutionId,
        title,
        term: "Fall 2026",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-12-31T00:00:00.000Z",
        archived: false,
      });
    const [cohortA, cohortB] = await Promise.all([
      cohort(organizationA, "Cohort A"),
      cohort(organizationB, "Cohort B"),
    ]);
    await ctx.db.insert("cohortMemberships", {
      cohortId: cohortB,
      userId: admin,
      role: "admin",
    });
    return {
      admin,
      secondAdmin,
      instructor,
      learner,
      foreignLearner,
      suspended,
      organizationA,
      organizationB,
      personalOrganization,
      adminMembership,
      secondAdminMembership,
      instructorMembership,
      learnerMembership,
      adminBMembership,
      cohortA,
      cohortB,
    };
  });
}

describe("cohort and organization membership cutover", () => {
  it("delegates legacy organization creation and omits legacy cohort roles on new rows", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const createdId = await t
      .withIdentity(identity("organization-admin"))
      .action(createInstitutionRef, {
        name: "  New Organization  ",
        slug: "new-organization",
      });
    const created = await t.run((ctx) => ctx.db.get(createdId));
    expect(created).toMatchObject({
      name: "New Organization",
      slug: "new-organization",
      kind: "shared",
      monthlyAiBudgetCents: 0,
    });

    const cohortId = await t
      .withIdentity(identity("organization-instructor"))
      .mutation(createCohortRef, {
        institutionId: fixture.organizationA,
        title: "New teaching cohort",
        term: "Fall 2026",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-12-31T00:00:00.000Z",
      });
    const creatorEnrollment = await t.run((ctx) =>
      ctx.db
        .query("cohortMemberships")
        .withIndex("by_cohort_user", (index) =>
          index.eq("cohortId", cohortId).eq("userId", fixture.instructor),
        )
        .unique(),
    );
    expect(creatorEnrollment).toMatchObject({
      cohortId,
      userId: fixture.instructor,
    });
    expect(creatorEnrollment?.role).toBeUndefined();

    await t
      .withIdentity(identity("organization-admin"))
      .mutation(addMemberRef, {
        cohortId: fixture.cohortA,
        userId: fixture.learner,
      });
    const learnerEnrollment = await t.run((ctx) =>
      ctx.db
        .query("cohortMemberships")
        .withIndex("by_cohort_user", (index) =>
          index.eq("cohortId", fixture.cohortA).eq("userId", fixture.learner),
        )
        .unique(),
    );
    expect(learnerEnrollment?.role).toBeUndefined();
    const enrollmentAudit = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_action", (index) =>
          index.eq("action", "cohort.member_enrolled"),
        )
        .collect()
        .then((events) =>
          events.find(
            (event) =>
              event.cohortId === fixture.cohortA &&
              event.targetTable === "cohortMemberships",
          ),
        ),
    );
    expect(enrollmentAudit?.targetId).toBe(learnerEnrollment?._id);
    await expectCode(
      t.withIdentity(identity("organization-admin")).mutation(addMemberRef, {
        cohortId: fixture.cohortA,
        userId: fixture.foreignLearner,
      }),
      "NOT_FOUND",
    );
    await expectCode(
      t.withIdentity(identity("organization-admin")).mutation(addMemberRef, {
        cohortId: fixture.cohortA,
        userId: fixture.suspended,
      }),
      "NOT_FOUND",
    );
    const suspendedEnrollments = await t.run((ctx) =>
      ctx.db
        .query("cohortMemberships")
        .withIndex("by_cohort_user", (index) =>
          index.eq("cohortId", fixture.cohortA).eq("userId", fixture.suspended),
        )
        .collect(),
    );
    expect(suspendedEnrollments).toHaveLength(0);
  });

  it("limits invites by organization role and validates normalized email and expiry", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    await t.run((ctx) =>
      ctx.db.patch(fixture.adminBMembership, { role: "admin" }),
    );
    const asInstructor = t.withIdentity(identity("organization-instructor"));
    const [invite] = await asInstructor.mutation(inviteMembersRef, {
      institutionId: fixture.organizationA,
      cohortId: fixture.cohortA,
      invites: [{ email: "  Student@Example.EDU ", role: "learner" }],
    });
    expect(invite?.email).toBe("student@example.edu");
    expect(invite?.token).toMatch(/^[0-9a-f]{64}$/);
    const inviteRow = await t.run(async (ctx) => {
      const invites = await ctx.db
        .query("enrollmentInvites")
        .withIndex("by_email", (index) =>
          index.eq("email", "student@example.edu"),
        )
        .collect();
      return invites[0];
    });
    expect(inviteRow?.expiresAt).toBeDefined();
    const expiry = Date.parse(inviteRow?.expiresAt ?? "");
    expect(expiry).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);
    expect(expiry).toBeLessThanOrEqual(
      Date.now() + 14 * 24 * 60 * 60 * 1000 + 1000,
    );

    await expectCode(
      asInstructor.mutation(inviteMembersRef, {
        institutionId: fixture.organizationA,
        invites: [{ email: "teacher@example.edu", role: "instructor" }],
      }),
      "AUTH_UNAUTHORIZED_ROLE",
    );
    await expectCode(
      asInstructor.mutation(inviteMembersRef, {
        institutionId: fixture.organizationA,
        invites: [{ email: "admin@example.edu", role: "admin" }],
      }),
      "AUTH_UNAUTHORIZED_ROLE",
    );
    await expectCode(
      asInstructor.mutation(inviteMembersRef, {
        institutionId: fixture.organizationA,
        invites: [{ email: "bad@example.edu", role: "learner" }],
        expiresAt: "2999-01-01 00:00:00",
      }),
      "VALIDATION_ERROR",
    );
    await expectCode(
      t
        .withIdentity(identity("organization-admin"))
        .mutation(inviteMembersRef, {
          institutionId: fixture.personalOrganization,
          invites: [{ email: "private@example.edu", role: "learner" }],
        }),
      "VALIDATION_ERROR",
    );
    await expectCode(
      t
        .withIdentity(identity("organization-admin"))
        .mutation(inviteMembersRef, {
          institutionId: fixture.organizationA,
          cohortId: fixture.cohortB,
          invites: [{ email: "cross@example.edu", role: "learner" }],
        }),
      "CONFLICT",
    );
  });

  it("requires verified matching email, consumes once, and never restores suspended membership", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const admin = t.withIdentity(identity("organization-admin"));
    const [acceptedInvite] = await admin.mutation(inviteMembersRef, {
      institutionId: fixture.organizationA,
      cohortId: fixture.cohortA,
      invites: [{ email: "learner@example.edu", role: "learner" }],
    });
    const [unverifiedInvite] = await admin.mutation(inviteMembersRef, {
      institutionId: fixture.organizationA,
      invites: [{ email: "unverified@example.edu", role: "learner" }],
    });
    const [mismatchInvite] = await admin.mutation(inviteMembersRef, {
      institutionId: fixture.organizationA,
      invites: [{ email: "different@example.edu", role: "learner" }],
    });
    const [suspendedInvite] = await admin.mutation(inviteMembersRef, {
      institutionId: fixture.organizationA,
      invites: [{ email: "suspended@example.edu", role: "learner" }],
    });

    await expectCode(
      t
        .withIdentity(
          identity("unverified-user", "unverified@example.edu", false),
        )
        .mutation(acceptInviteRef, { token: tokenFrom(unverifiedInvite) }),
      "AUTH_REQUIRED",
    );
    await expectCode(
      t
        .withIdentity(identity("mismatch-user", "other@example.edu", true))
        .mutation(acceptInviteRef, { token: tokenFrom(mismatchInvite) }),
      "INVITE_EMAIL_MISMATCH",
    );
    const accepted = await t
      .withIdentity(identity("accepted-user", " LEARNER@EXAMPLE.EDU ", true))
      .mutation(acceptInviteRef, { token: tokenFrom(acceptedInvite) });
    expect(accepted).toMatchObject({
      institutionId: fixture.organizationA,
      cohortId: fixture.cohortA,
      role: "learner",
    });
    await expectCode(
      t
        .withIdentity(identity("accepted-user", "learner@example.edu", true))
        .mutation(acceptInviteRef, { token: tokenFrom(acceptedInvite) }),
      "INVITE_ALREADY_ACCEPTED",
    );

    const acceptedUser = await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const user = users.find(
        (candidate) =>
          candidate.authSubject === identity("accepted-user").tokenIdentifier,
      );
      expect(user?.role).toBeUndefined();
      const enrollments = user
        ? await ctx.db
            .query("cohortMemberships")
            .withIndex("by_cohort_user", (index) =>
              index.eq("cohortId", fixture.cohortA).eq("userId", user._id),
            )
            .collect()
        : [];
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]?.role).toBeUndefined();
      return user;
    });
    expect(acceptedUser).toBeDefined();

    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.suspended, {
        authSubject: identity("suspended-user").tokenIdentifier,
        displayName: "suspended@example.edu",
      });
    });
    await expectCode(
      t
        .withIdentity(identity("suspended-user", "suspended@example.edu", true))
        .mutation(acceptInviteRef, { token: tokenFrom(suspendedInvite) }),
      "NOT_FOUND",
    );
    const suspendedMembership = await t.run((ctx) =>
      ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index
            .eq("institutionId", fixture.organizationA)
            .eq("userId", fixture.suspended),
        )
        .unique(),
    );
    expect(suspendedMembership?.status).toBe("suspended");

    const expiredToken = "already-expired-token";
    await t.run(async (ctx) => {
      await ctx.db.insert("enrollmentInvites", {
        institutionId: fixture.organizationA,
        email: "expired@example.edu",
        role: "learner",
        tokenHash: toDeterministicId(expiredToken),
        expiresAt: "2000-01-01T00:00:00.000Z",
        createdByUserId: fixture.admin,
        createdAt: new Date().toISOString(),
      });
    });
    await expectCode(
      t
        .withIdentity(identity("expired-user", "expired@example.edu", true))
        .mutation(acceptInviteRef, { token: expiredToken }),
      "INVITE_EXPIRED",
    );
  });

  it("protects the last admin, keeps personal owner membership immutable, and scopes budgets", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const asAdmin = t.withIdentity(identity("organization-admin"));
    const members = await asAdmin.query(membersRef, {
      institutionId: fixture.organizationA,
    });
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          membershipId: fixture.adminMembership,
          userId: fixture.admin,
          role: "admin",
          status: "active",
        }),
      ]),
    );
    expect(members.some((member) => "authSubject" in member)).toBe(false);

    await asAdmin.mutation(setBudgetRef, {
      institutionId: fixture.organizationA,
      monthlyAiBudgetCents: 1234,
    });
    const updatedBudget = await t.run(
      async (ctx) =>
        (await ctx.db.get(fixture.organizationA))?.monthlyAiBudgetCents,
    );
    expect(updatedBudget).toBe(1234);
    await expectCode(
      asAdmin.mutation(setBudgetRef, {
        institutionId: fixture.organizationA,
        monthlyAiBudgetCents: -1,
      }),
      "VALIDATION_ERROR",
    );

    await expectCode(
      asAdmin.mutation(updateMemberRef, {
        institutionId: fixture.organizationA,
        membershipId: fixture.adminMembership,
        role: "learner",
        status: "active",
      }),
      "CONFLICT",
    );
    await asAdmin.mutation(updateMemberRef, {
      institutionId: fixture.organizationA,
      membershipId: fixture.secondAdminMembership,
      role: "admin",
      status: "active",
    });
    await asAdmin.mutation(updateMemberRef, {
      institutionId: fixture.organizationA,
      membershipId: fixture.adminMembership,
      role: "learner",
      status: "active",
    });

    const ownerMembershipId = await t.run((ctx) =>
      ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index
            .eq("institutionId", fixture.personalOrganization)
            .eq("userId", fixture.admin),
        )
        .unique()
        .then((membership) => {
          if (!membership) throw new Error("Fixture owner membership missing");
          return membership._id;
        }),
    );
    await expectCode(
      asAdmin.mutation(updateMemberRef, {
        institutionId: fixture.personalOrganization,
        membershipId: ownerMembershipId,
        role: "learner",
        status: "suspended",
      }),
      "VALIDATION_ERROR",
    );
  });

  it("leaves direct legacy role, membership, budget, and global listing endpoints disabled", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const asAdmin = t.withIdentity(identity("organization-admin"));
    await expectCode(
      asAdmin.mutation(legacySetRoleRef, {
        userId: fixture.foreignLearner,
        role: "admin",
      }),
      "VALIDATION_ERROR",
    );
    await expectCode(
      asAdmin.mutation(legacySetInstitutionMemberRef, {
        institutionId: fixture.organizationA,
        userId: fixture.foreignLearner,
        role: "admin",
      }),
      "VALIDATION_ERROR",
    );
    await expectCode(
      asAdmin.mutation(legacySetMonthlyBudgetRef, {
        userId: fixture.foreignLearner,
        monthlyAiBudgetCents: 50000,
      }),
      "VALIDATION_ERROR",
    );
    await expectCode(asAdmin.query(legacyListUsersRef, {}), "VALIDATION_ERROR");

    const [legacyUser, memberships] = await t.run(async (ctx) => [
      await ctx.db.get(fixture.foreignLearner),
      await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index
            .eq("institutionId", fixture.organizationA)
            .eq("userId", fixture.foreignLearner),
        )
        .collect(),
    ]);
    expect(legacyUser?.role).toBeUndefined();
    expect(legacyUser?.monthlyAiBudgetCents).toBe(0);
    expect(memberships).toHaveLength(0);
  });
});
