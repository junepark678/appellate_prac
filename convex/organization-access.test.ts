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
import { AppErrorCode, type AppErrorData } from "./errors";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authz.ts": () => import("./authz"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./errors.ts": () => import("./errors"),
  "./cohorts.ts": () => import("./cohorts"),
  "./assignments.ts": () => import("./assignments"),
  "./instructor.ts": () => import("./instructor"),
  "./users.ts": () => import("./users"),
  "./admin.ts": () => import("./admin"),
  "./adminSources.ts": () => import("./adminSources"),
  "./scenarioDrafts.ts": () => import("./scenarioDrafts"),
};

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

const listRosterRef = makeFunctionReference<
  "query",
  { cohortId: Id<"cohorts"> },
  {
    userId: Id<"users">;
    displayName: string;
    organizationRole: "learner" | "instructor" | "admin";
  }[]
>("cohorts:listRoster");
const listMineRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    id: Id<"cohorts">;
    institutionId: Id<"institutions">;
    institutionName: string;
    title: string;
    term: string;
    role: "learner" | "instructor" | "admin";
    archived: boolean;
  }[]
>("cohorts:listMine");
const listForCohortRef = makeFunctionReference<
  "query",
  { cohortId: Id<"cohorts"> },
  {
    id: Id<"assignments">;
    title: string;
    published: boolean;
    archivedAt?: string;
  }[]
>("assignments:listForCohort");
const listMyAssignmentsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    id: Id<"assignments">;
    cohortId: Id<"cohorts">;
    title: string;
    published: boolean;
  }[]
>("assignments:listMine");
const getAssignmentRef = makeFunctionReference<
  "query",
  { assignmentId: Id<"assignments"> },
  { id: Id<"assignments">; title: string; published: boolean } | null
>("assignments:get");
const startSessionRef = makeFunctionReference<
  "mutation",
  { assignmentId: Id<"assignments"> },
  Id<"caseSessions">
>("assignments:startSession");
const submitSessionRef = makeFunctionReference<
  "mutation",
  { assignmentId: Id<"assignments">; caseSessionId: Id<"caseSessions"> },
  null
>("assignments:submitSession");
const exportCsvRef = makeFunctionReference<
  "query",
  { assignmentId: Id<"assignments"> },
  string
>("instructor:exportAssignmentCsv");
const setBudgetRef = makeFunctionReference<
  "mutation",
  { institutionId: Id<"institutions">; monthlyAiBudgetCents: number },
  null
>("users:setOrganizationBudget");
const grantSupportAccessRef = makeFunctionReference<
  "mutation",
  {
    institutionId: Id<"institutions">;
    supportUserId: Id<"users">;
    reason: string;
    expiresAt: string;
  },
  Id<"supportAccessGrants">
>("admin:grantSupportAccess");
const adminDashboardRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    institutions: number;
    users: number;
    activeSupportGrants: number;
    courtPacksPendingProduction: number;
    recentAuditEvents: {
      action: string;
      createdAt: string;
      actorUserId?: Id<"users">;
      institutionId?: Id<"institutions">;
    }[];
  }
>("admin:dashboard");
const sourceArtifactsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    id: Id<"sourceArtifacts">;
    sourceVersionId: string;
    label: string;
    url: string;
    contentHash: string;
    parserVersion: string;
    fetchedAt: string;
    mediaType?: string;
    rawStorageId?: Id<"_storage">;
    fileUrl?: string;
    reviewStatus: "draft" | "reviewed" | "published" | "rejected";
  }[]
>("adminSources:listSourceArtifacts");
const scenarioDraftsRef = makeFunctionReference<
  "query",
  { reviewStatus?: "draft" | "reviewed" | "published" | "rejected" },
  {
    id: Id<"scenarioDrafts">;
    title: string;
    courtPackId: string;
    reviewStatus: "draft" | "reviewed" | "published" | "rejected";
    sourceSystem: "courtlistener" | "recap" | "manual";
    createdAt: string;
  }[]
>("scenarioDrafts:list");
const updateMemberRef = makeFunctionReference<
  "mutation",
  {
    institutionId: Id<"institutions">;
    membershipId: Id<"institutionMemberships">;
    role: "learner" | "instructor" | "admin";
    status: "active" | "suspended";
  },
  null
>("users:updateOrganizationMember");

async function expectError(promise: Promise<unknown>, code: AppErrorCode) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  const data = (caught as { data?: AppErrorData }).data;
  expect(data?.code).toBe(code);
  return data;
}

async function seedAccessFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const user = async (
      subject: string,
      legacyRole?: "student" | "instructor" | "admin",
    ) =>
      ctx.db.insert("users", {
        authSubject: identity(subject).tokenIdentifier,
        displayName: subject,
        ...(legacyRole ? { role: legacyRole } : {}),
        monthlyAiBudgetCents: 0,
      });
    const [
      actor,
      memberA,
      memberB,
      inactive,
      expiredActor,
      invalidActor,
      pausedActor,
      archivedActor,
    ] = await Promise.all([
      user("matrix-actor", "admin"),
      user("member-a"),
      user("member-b"),
      user("inactive-actor", "admin"),
      user("expired-actor", "admin"),
      user("invalid-expiry-actor", "admin"),
      user("paused-organization-actor", "admin"),
      user("archived-organization-actor", "admin"),
    ]);
    const organization = async (
      name: string,
      slug: string,
      status: "active" | "paused" | "archived" = "active",
    ) =>
      ctx.db.insert("institutions", {
        kind: "shared",
        createdAt: new Date().toISOString(),
        name,
        slug,
        status,
        monthlyAiBudgetCents: 0,
      });
    const [
      organizationA,
      organizationB,
      foreignOrganization,
      pausedOrganization,
      archivedOrganization,
    ] = await Promise.all([
      organization("Organization A", "access-org-a"),
      organization("Organization B", "access-org-b"),
      organization("Foreign Organization Secret", "access-org-foreign"),
      organization("Paused Organization Secret", "access-org-paused", "paused"),
      organization(
        "Archived Organization Secret",
        "access-org-archived",
        "archived",
      ),
    ]);
    const addOrganizationMembership = (
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
    const [adminA, learnerB, memberAMembership, memberBMembership] =
      await Promise.all([
        addOrganizationMembership(organizationA, actor, "admin"),
        addOrganizationMembership(organizationB, actor, "learner"),
        addOrganizationMembership(organizationA, memberA, "learner"),
        addOrganizationMembership(organizationB, memberB, "learner"),
        addOrganizationMembership(
          organizationA,
          inactive,
          "learner",
          "suspended",
        ),
        addOrganizationMembership(
          organizationA,
          expiredActor,
          "admin",
          "active",
          "2000-01-01T00:00:00.000Z",
        ),
        addOrganizationMembership(
          organizationA,
          invalidActor,
          "admin",
          "active",
          "2999-01-01 00:00:00",
        ),
        addOrganizationMembership(pausedOrganization, pausedActor, "admin"),
        addOrganizationMembership(archivedOrganization, archivedActor, "admin"),
      ]).then(([a, b, c, d]) => [a, b, c, d] as const);
    const cohort = (institutionId: Id<"institutions">, title: string) =>
      ctx.db.insert("cohorts", {
        institutionId,
        title,
        term: "Fall 2026",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-12-31T00:00:00.000Z",
        archived: false,
      });
    const [
      cohortA,
      cohortB,
      foreignCohort,
      pausedCohort,
      suspendedCohort,
      expiredCohort,
      invalidCohort,
      archivedCohort,
    ] = await Promise.all([
      cohort(organizationA, "Cohort A secret title"),
      cohort(organizationB, "Cohort B secret title"),
      cohort(foreignOrganization, "Foreign Cohort Secret Title"),
      cohort(pausedOrganization, "Paused Cohort Secret Title"),
      cohort(organizationA, "Suspended Cohort Secret Title"),
      cohort(organizationA, "Expired Cohort Secret Title"),
      cohort(organizationA, "Invalid Expiry Cohort Secret Title"),
      cohort(archivedOrganization, "Archived Cohort Secret Title"),
    ]);
    const missingCohort = await cohort(
      organizationA,
      "Deleted Cohort Secret Title",
    );
    await ctx.db.delete(missingCohort);

    await ctx.db.insert("cohortMemberships", {
      cohortId: cohortB,
      userId: actor,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: cohortA,
      userId: memberA,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: foreignCohort,
      userId: actor,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: pausedCohort,
      userId: pausedActor,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: suspendedCohort,
      userId: inactive,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: expiredCohort,
      userId: expiredActor,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: invalidCohort,
      userId: invalidActor,
      role: "admin",
    });
    await ctx.db.insert("cohortMemberships", {
      cohortId: archivedCohort,
      userId: archivedActor,
      role: "admin",
    });
    await ctx.db.insert("supportAccessGrants", {
      institutionId: foreignOrganization,
      supportUserId: actor,
      grantedByUserId: actor,
      reason: "wire regression fixture",
      expiresAt: "2999-01-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
    });

    const scenarioId = await ctx.db.insert("scenarios", {
      scenarioKey: "synthetic-employment-retaliation",
      title: "Retaliation Summary Judgment Appeal",
      source: "synthetic",
      courtPackId: "us-federal-ca4-civil-appeal",
      shortCaption: "Jordan v. Meridian Analytics, Inc.",
      lowerTribunal: "U.S. District Court",
      natureOfSuit: "Civil Rights - Employment",
      proceduralPosture: "Summary judgment appeal",
      issuesPresented: ["Whether summary judgment was proper."],
      meritsRecord: ["Synthetic test record."],
      published: true,
    });
    const assignment = async (
      cohortId: Id<"cohorts">,
      title: string,
      published: boolean,
    ) =>
      ctx.db.insert("assignments", {
        cohortId,
        scenarioId,
        title,
        published,
        createdByUserId: actor,
        createdAt: new Date().toISOString(),
      });
    const [publishedA, draftA, publishedB, draftB] = await Promise.all([
      assignment(cohortA, "Published A", true),
      assignment(cohortA, "Draft A Secret", false),
      assignment(cohortB, "Published B", true),
      assignment(cohortB, "Draft B Secret", false),
    ]);
    return {
      actor,
      memberA,
      memberB,
      inactive,
      expiredActor,
      invalidActor,
      pausedActor,
      archivedActor,
      organizationA,
      organizationB,
      foreignOrganization,
      pausedOrganization,
      archivedOrganization,
      adminA,
      learnerB,
      memberAMembership,
      memberBMembership,
      cohortA,
      cohortB,
      foreignCohort,
      pausedCohort,
      suspendedCohort,
      expiredCohort,
      invalidCohort,
      archivedCohort,
      missingCohort,
      publishedA,
      draftA,
      publishedB,
      draftB,
    };
  });
}

describe("registered organization-scoped authorization", () => {
  it("keeps missing, foreign, suspended, expired, invalid, and paused cohorts indistinguishable", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAccessFixture(t);
    const actor = t.withIdentity(identity("matrix-actor"));
    const inaccessible = await Promise.all(
      [fixture.missingCohort, fixture.foreignCohort, fixture.pausedCohort].map(
        (cohortId) =>
          expectError(
            actor.query(listRosterRef, { cohortId }),
            AppErrorCode.NOT_FOUND,
          ),
      ),
    );
    expect(inaccessible[0]).toEqual(inaccessible[1]);
    expect(inaccessible[1]).toEqual(inaccessible[2]);
    expect(inaccessible[0]).toEqual({
      code: AppErrorCode.NOT_FOUND,
      message: "Cohort not found",
    });

    const inactiveCases = [
      ["inactive-actor", fixture.suspendedCohort],
      ["expired-actor", fixture.expiredCohort],
      ["invalid-expiry-actor", fixture.invalidCohort],
      ["paused-organization-actor", fixture.pausedCohort],
      ["archived-organization-actor", fixture.archivedCohort],
    ] as const;
    for (const [subject, cohortId] of inactiveCases) {
      const errorData = await expectError(
        t.withIdentity(identity(subject)).query(listRosterRef, { cohortId }),
        AppErrorCode.NOT_FOUND,
      );
      expect(errorData).toEqual(inaccessible[0]);
    }

    for (const secret of [
      "Foreign Organization Secret",
      "Foreign Cohort Secret Title",
      "Paused Organization Secret",
      "Paused Cohort Secret Title",
      "Archived Organization Secret",
      "Archived Cohort Secret Title",
    ]) {
      expect(JSON.stringify(inaccessible)).not.toContain(secret);
    }
  });

  it("enforces the two-organization operation matrix and separates teaching from enrollment", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAccessFixture(t);
    const actor = t.withIdentity(identity("matrix-actor"));

    const organizationCohorts = await actor.query(listMineRef, {});
    expect(organizationCohorts.map((cohort) => cohort.id)).toContain(
      fixture.cohortA,
    );
    expect(organizationCohorts.map((cohort) => cohort.id)).toContain(
      fixture.cohortB,
    );
    const ownOrgAssignments = await actor.query(listForCohortRef, {
      cohortId: fixture.cohortA,
    });
    expect(ownOrgAssignments.map((assignment) => assignment.title)).toEqual(
      expect.arrayContaining(["Published A", "Draft A Secret"]),
    );
    const learnerOrgAssignments = await actor.query(listForCohortRef, {
      cohortId: fixture.cohortB,
    });
    expect(learnerOrgAssignments.map((assignment) => assignment.title)).toEqual(
      ["Published B"],
    );
    expect(
      (await actor.query(listMyAssignmentsRef, {})).map(
        (assignment) => assignment.title,
      ),
    ).toEqual(["Published B"]);
    expect(
      await actor.query(getAssignmentRef, { assignmentId: fixture.draftA }),
    ).toMatchObject({ title: "Draft A Secret", published: false });
    expect(
      await actor.query(getAssignmentRef, { assignmentId: fixture.draftB }),
    ).toBeNull();

    const rosterA = await actor.query(listRosterRef, {
      cohortId: fixture.cohortA,
    });
    expect(rosterA).toEqual([
      {
        userId: fixture.memberA,
        displayName: "member-a",
        organizationRole: "learner",
      },
    ]);
    await expectError(
      actor.query(listRosterRef, { cohortId: fixture.cohortB }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );
    expect(
      await actor.query(exportCsvRef, { assignmentId: fixture.publishedA }),
    ).toContain(
      "accountName,status,submittedAt,reviewedAt,score,validationIssueCount,caseSessionId",
    );
    await expectError(
      actor.query(exportCsvRef, { assignmentId: fixture.publishedB }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );

    await actor.mutation(setBudgetRef, {
      institutionId: fixture.organizationA,
      monthlyAiBudgetCents: 900,
    });
    await expectError(
      actor.mutation(setBudgetRef, {
        institutionId: fixture.organizationB,
        monthlyAiBudgetCents: 900,
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );
    await actor.mutation(updateMemberRef, {
      institutionId: fixture.organizationA,
      membershipId: fixture.memberAMembership,
      role: "instructor",
      status: "active",
    });
    await expectError(
      actor.mutation(updateMemberRef, {
        institutionId: fixture.organizationB,
        membershipId: fixture.memberBMembership,
        role: "admin",
        status: "active",
      }),
      AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    );

    await expectError(
      actor.mutation(startSessionRef, { assignmentId: fixture.publishedA }),
      AppErrorCode.NOT_FOUND,
    );
    const learner = t.withIdentity(identity("matrix-actor"));
    const caseSessionId = await learner.mutation(startSessionRef, {
      assignmentId: fixture.publishedB,
    });
    await learner.mutation(submitSessionRef, {
      assignmentId: fixture.publishedB,
      caseSessionId,
    });
    await expectError(
      learner.mutation(submitSessionRef, {
        assignmentId: fixture.publishedB,
        caseSessionId,
      }),
      AppErrorCode.SESSION_LOCKED,
    );
  });

  it("preserves AUTH_REQUIRED and does not return foreign cohort metadata", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAccessFixture(t);
    const unauthenticated = await expectError(
      t.query(listRosterRef, { cohortId: fixture.cohortA }),
      AppErrorCode.AUTH_REQUIRED,
    );
    expect(unauthenticated).toEqual({
      code: AppErrorCode.AUTH_REQUIRED,
      message: "Authentication required",
    });
  });

  it("fails closed on legacy global admin, source, and scenario review entrypoints", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAccessFixture(t);
    const actor = t.withIdentity(identity("matrix-actor"));
    const grantCountBefore = await t.run((ctx) =>
      ctx.db
        .query("supportAccessGrants")
        .collect()
        .then((grants) => grants.length),
    );
    await expectError(
      actor.mutation(grantSupportAccessRef, {
        institutionId: fixture.foreignOrganization,
        supportUserId: fixture.memberA,
        reason: "legacy global role must not grant access",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      AppErrorCode.VALIDATION_ERROR,
    );
    await expectError(
      actor.query(adminDashboardRef, {}),
      AppErrorCode.VALIDATION_ERROR,
    );
    await expectError(
      actor.query(sourceArtifactsRef, {}),
      AppErrorCode.VALIDATION_ERROR,
    );
    await expectError(
      actor.query(scenarioDraftsRef, {}),
      AppErrorCode.VALIDATION_ERROR,
    );
    const grantCountAfter = await t.run((ctx) =>
      ctx.db
        .query("supportAccessGrants")
        .collect()
        .then((grants) => grants.length),
    );
    expect(grantCountAfter).toBe(grantCountBefore);
  });
});
