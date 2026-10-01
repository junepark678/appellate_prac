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

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCurrentUser } from "./authHelpers";
import { requireCohortRole, writeAuditLog } from "./authz";
import { appendCaseSessionEvent } from "./caseSessionEventLog";
import {
  AppErrorCode,
  ConvexError,
  notFound,
  sessionLocked,
  validationError,
} from "./errors";
import { isOrganizationMembershipActive } from "./organizationContracts";
import {
  createInitialSession,
  createInitialSessionForScenario,
} from "../src/domain/simulation";
import { inferProcedureState } from "../src/domain/procedure/state-machine";
import type { Scenario } from "../src/domain/types";
import scenarioSeed from "../src/domain/scenarios.seed.json";

type ReadCtx = QueryCtx | MutationCtx;
type CohortRole = "learner" | "instructor" | "admin";

function scenarioVisibility(doc: Doc<"scenarios">) {
  return doc.visibility ?? (doc.ownerUserId ? "private" : "public_template");
}

function scenarioRevisionStatus(doc: Doc<"scenarios">) {
  return doc.revisionStatus ?? (doc.published ? "published" : "draft");
}

const autonomyModeValidator = v.union(
  v.literal("paused"),
  v.literal("supervised"),
  v.literal("autonomous"),
);

const assignmentStatusValidator = v.union(
  v.literal("not_started"),
  v.literal("in_progress"),
  v.literal("submitted"),
  v.literal("reviewed"),
);
const seedScenarios = scenarioSeed as Scenario[];

function seedScenarioDoc(scenario: Scenario) {
  return {
    scenarioKey: scenario.id,
    title: scenario.title,
    source: scenario.source,
    courtPackId: scenario.courtPackId,
    shortCaption: scenario.shortCaption,
    lowerTribunal: scenario.lowerTribunal,
    natureOfSuit: scenario.natureOfSuit,
    proceduralPosture: scenario.proceduralPosture,
    issuesPresented: scenario.issuesPresented,
    meritsRecord: scenario.meritsRecord,
    ...(scenario.training
      ? { trainingJson: JSON.stringify(scenario.training) }
      : {}),
    ...(scenario.trialDocket
      ? { trialDocketJson: JSON.stringify(scenario.trialDocket) }
      : {}),
    ...(scenario.documentAssets
      ? { documentAssetsJson: JSON.stringify(scenario.documentAssets) }
      : {}),
    ...(scenario.sourceCaseUrl
      ? { sourceCaseUrl: scenario.sourceCaseUrl }
      : {}),
    visibility: "public_template" as const,
    scenarioFamilyKey: scenario.id,
    revision: 1,
    revisionStatus: "published" as const,
    published: true,
  };
}

function parseOptionalJsonField<T>(
  json: string | undefined,
  label: string,
): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`Invalid persisted JSON for ${label}.`);
  }
}

function scenarioModelFromDoc(doc: Doc<"scenarios">): Scenario {
  const training = parseOptionalJsonField<Scenario["training"]>(
    doc.trainingJson,
    `scenario ${doc._id} training`,
  );
  const trialDocket = parseOptionalJsonField<Scenario["trialDocket"]>(
    doc.trialDocketJson,
    `scenario ${doc._id} trial docket`,
  );

  return {
    id: doc.scenarioKey,
    visibility: scenarioVisibility(doc),
    ...(doc.ownerUserId ? { ownerUserId: doc.ownerUserId } : {}),
    scenarioFamilyKey: doc.scenarioFamilyKey ?? doc.scenarioKey,
    revision: doc.revision ?? 1,
    revisionStatus: scenarioRevisionStatus(doc),
    ...(doc.createdFromScenarioId
      ? { createdFromScenarioId: doc.createdFromScenarioId }
      : {}),
    ...(doc.supersededByScenarioId
      ? { supersededByScenarioId: doc.supersededByScenarioId }
      : {}),
    title: doc.title,
    source: doc.source,
    courtPackId: doc.courtPackId,
    shortCaption: doc.shortCaption,
    lowerTribunal: doc.lowerTribunal,
    natureOfSuit: doc.natureOfSuit,
    proceduralPosture: doc.proceduralPosture,
    issuesPresented: doc.issuesPresented,
    meritsRecord: doc.meritsRecord,
    ...(training ? { training } : {}),
    ...(trialDocket ? { trialDocket } : {}),
    ...(doc.sourceCaseUrl ? { sourceCaseUrl: doc.sourceCaseUrl } : {}),
  };
}

function createInitialSessionForScenarioDoc(doc: Doc<"scenarios">) {
  const bundledScenario = seedScenarios.some(
    (scenario) => scenario.id === doc.scenarioKey,
  );
  return bundledScenario
    ? createInitialSession(doc.scenarioKey)
    : createInitialSessionForScenario(scenarioModelFromDoc(doc));
}

async function requireAssignmentRole(
  ctx: ReadCtx,
  assignmentId: Id<"assignments">,
  roles: CohortRole[],
) {
  const assignment = await ctx.db.get(assignmentId);
  if (!assignment || assignment.archivedAt) {
    throw notFound("Assignment");
  }
  let access;
  try {
    access = await requireCohortRole(ctx, assignment.cohortId, roles);
  } catch (error) {
    if (
      error instanceof ConvexError &&
      error.data.code === AppErrorCode.NOT_FOUND
    ) {
      throw notFound("Assignment");
    }
    throw error;
  }
  return { assignment, ...access };
}

async function getAssignmentSession(
  ctx: ReadCtx,
  assignmentId: Id<"assignments">,
  userId: Id<"users">,
) {
  const sessions = await listAssignmentSessionsForUser(
    ctx,
    assignmentId,
    userId,
  );
  return sessions[0] ?? null;
}

async function listAssignmentSessionsForUser(
  ctx: ReadCtx,
  assignmentId: Id<"assignments">,
  userId: Id<"users">,
) {
  const sessions = await ctx.db
    .query("assignmentSessions")
    .withIndex("by_assignment_user", (index) =>
      index.eq("assignmentId", assignmentId).eq("userId", userId),
    )
    .collect();
  return sessions.sort((a, b) => a._creationTime - b._creationTime);
}

async function requireScenarioForAssignment(
  ctx: MutationCtx,
  args: {
    scenarioId?: Id<"scenarios">;
    scenarioKey?: string;
  },
) {
  if (args.scenarioId) {
    const scenario = await ctx.db.get(args.scenarioId);
    if (!scenario) {
      throw notFound("Scenario");
    }
    return scenario;
  }

  if (!args.scenarioKey) {
    throw notFound("Scenario");
  }

  const scenarioKey = args.scenarioKey;
  const existing = await ctx.db
    .query("scenarios")
    .withIndex("by_scenario_key", (index) =>
      index.eq("scenarioKey", scenarioKey),
    )
    .unique();
  const bundled = seedScenarios.find((scenario) => scenario.id === scenarioKey);
  if (existing) {
    if (bundled) {
      await ctx.db.patch(existing._id, seedScenarioDoc(bundled));
      const updated = await ctx.db.get(existing._id);
      if (!updated) {
        throw notFound("Scenario");
      }
      return updated;
    }
    return existing;
  }

  if (!bundled) {
    throw notFound("Scenario");
  }
  const scenarioId = await ctx.db.insert("scenarios", seedScenarioDoc(bundled));
  const scenario = await ctx.db.get(scenarioId);
  if (!scenario) {
    throw notFound("Scenario");
  }
  return scenario;
}

function isSubmittedLockActive(
  session: Pick<Doc<"assignmentSessions">, "submittedAt" | "reopenedAt"> | null,
) {
  return Boolean(
    session?.submittedAt &&
    (!session.reopenedAt || session.reopenedAt <= session.submittedAt),
  );
}

function statusForAssignmentSession(session: Doc<"assignmentSessions"> | null) {
  if (!session) return "not_started" as const;
  if (session.reviewedAt) return "reviewed" as const;
  if (isSubmittedLockActive(session)) return "submitted" as const;
  return "in_progress" as const;
}

function canViewUnpublishedAssignment(
  membership: Doc<"institutionMemberships">,
) {
  return membership.role === "instructor" || membership.role === "admin";
}

async function insertInitialSessionState(
  ctx: MutationCtx,
  caseSessionId: Id<"caseSessions">,
  initialSession: ReturnType<typeof createInitialSession>,
) {
  const procedureState = inferProcedureState(initialSession);
  await ctx.db.patch(caseSessionId, {
    status: initialSession.status,
    procedureState,
    simulatedDate: initialSession.simulatedDate,
    courtPackId: initialSession.courtPackId,
    autonomyMode: initialSession.autonomyMode,
    turnPolicy: initialSession.turnPolicy,
    ...(initialSession.sourceProfileId
      ? { sourceProfileId: initialSession.sourceProfileId }
      : {}),
    qualityState: initialSession.qualityState,
  });
  for (const participant of initialSession.participants) {
    await ctx.db.insert("participants", {
      caseSessionId,
      displayName: participant.displayName,
      role: participant.role,
    });
  }
  for (const entry of initialSession.docketEntries) {
    await ctx.db.insert("docketEntries", {
      caseSessionId,
      entryNumber: entry.entryNumber,
      filedAt: entry.filedAt,
      actorRole: entry.actorRole,
      title: entry.title,
      text: entry.text,
      ruleRefs: entry.ruleRefs,
    });
  }
  for (const deadline of initialSession.deadlines) {
    await ctx.db.insert("deadlines", {
      caseSessionId,
      label: deadline.label,
      dueDate: deadline.dueDate,
      targetEventId: deadline.targetEventId,
      status: deadline.status,
      sourceRuleRefs: deadline.sourceRuleRefs,
    });
  }
  await appendCaseSessionEvent(
    ctx,
    caseSessionId,
    "assignment_session_started",
    {
      scenarioKey: initialSession.scenario.id,
      procedureState,
    },
  );
}

export const create = mutation({
  args: {
    cohortId: v.id("cohorts"),
    scenarioId: v.optional(v.id("scenarios")),
    scenarioKey: v.optional(v.string()),
    title: v.string(),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    published: v.boolean(),
    autonomyMode: v.optional(autonomyModeValidator),
    maxTurnsPerRun: v.optional(v.number()),
    maxCostCentsPerRun: v.optional(v.number()),
    requireHumanApprovalFor: v.optional(v.array(v.string())),
    stopOnDeficiency: v.optional(v.boolean()),
    budgetCapCents: v.optional(v.number()),
    hideAiReasoning: v.optional(v.boolean()),
    allowedFilingEvents: v.optional(v.array(v.string())),
  },
  returns: v.id("assignments"),
  handler: async (ctx, args) => {
    const { user, cohort, institution } = await requireCohortRole(
      ctx,
      args.cohortId,
      ["instructor", "admin"],
    );
    const scenario = await requireScenarioForAssignment(ctx, args);
    const visibility = scenarioVisibility(scenario);
    const revisionStatus = scenarioRevisionStatus(scenario);
    if (scenario.institutionId && scenario.institutionId !== institution._id) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Scenario organization scope mismatch",
      );
    }
    const canAssignPrivateScenario =
      visibility === "private" &&
      scenario.institutionId === institution._id &&
      scenario.ownerUserId === user._id;
    const canAssignPublishedTemplate =
      visibility === "public_template" &&
      revisionStatus === "published" &&
      scenario.published;
    if (!canAssignPrivateScenario && !canAssignPublishedTemplate) {
      throw notFound("Scenario");
    }

    let simulationPolicyId;
    if (args.autonomyMode) {
      simulationPolicyId = await ctx.db.insert("simulationPolicies", {
        scope: "assignment",
        scopeId: "pending",
        autonomyMode: args.autonomyMode,
        maxTurnsPerRun: args.maxTurnsPerRun ?? 6,
        maxCostCentsPerRun:
          args.maxCostCentsPerRun ?? args.budgetCapCents ?? 25,
        requireHumanApprovalFor: args.requireHumanApprovalFor ?? [
          "disposeCase",
          "enterJudgment",
        ],
        stopOnDeficiency: args.stopOnDeficiency ?? true,
        createdByUserId: user._id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const now = new Date().toISOString();
    const assignmentId = await ctx.db.insert("assignments", {
      cohortId: args.cohortId,
      scenarioId: scenario._id,
      title: args.title,
      ...(args.dueAt ? { dueAt: args.dueAt } : {}),
      ...(args.rubricId ? { rubricId: args.rubricId } : {}),
      published: args.published,
      autonomyMode: args.autonomyMode ?? "paused",
      ...(simulationPolicyId ? { simulationPolicyId } : {}),
      ...(typeof args.budgetCapCents === "number"
        ? { budgetCapCents: args.budgetCapCents }
        : {}),
      ...(typeof args.hideAiReasoning === "boolean"
        ? { hideAiReasoning: args.hideAiReasoning }
        : {}),
      ...(args.allowedFilingEvents
        ? { allowedFilingEvents: args.allowedFilingEvents }
        : {}),
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    if (simulationPolicyId) {
      await ctx.db.patch(simulationPolicyId, { scopeId: assignmentId });
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: args.cohortId,
      action: "assignment.created",
      targetTable: "assignments",
      targetId: assignmentId,
      metadata: { published: args.published },
    });
    return assignmentId;
  },
});

export const update = mutation({
  args: {
    assignmentId: v.id("assignments"),
    title: v.optional(v.string()),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    autonomyMode: v.optional(autonomyModeValidator),
    budgetCapCents: v.optional(v.number()),
    hideAiReasoning: v.optional(v.boolean()),
    allowedFilingEvents: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["instructor", "admin"],
    );
    await ctx.db.patch(args.assignmentId, {
      ...(args.title ? { title: args.title } : {}),
      ...(args.dueAt !== undefined ? { dueAt: args.dueAt || undefined } : {}),
      ...(args.rubricId !== undefined
        ? { rubricId: args.rubricId || undefined }
        : {}),
      ...(args.autonomyMode ? { autonomyMode: args.autonomyMode } : {}),
      ...(typeof args.budgetCapCents === "number"
        ? { budgetCapCents: args.budgetCapCents }
        : {}),
      ...(typeof args.hideAiReasoning === "boolean"
        ? { hideAiReasoning: args.hideAiReasoning }
        : {}),
      ...(args.allowedFilingEvents
        ? { allowedFilingEvents: args.allowedFilingEvents }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    if (assignment.simulationPolicyId && args.autonomyMode) {
      await ctx.db.patch(assignment.simulationPolicyId, {
        autonomyMode: args.autonomyMode,
        updatedAt: new Date().toISOString(),
      });
    }
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      action: "assignment.updated",
      targetTable: "assignments",
      targetId: args.assignmentId,
    });
    return null;
  },
});

export const publish = mutation({
  args: {
    assignmentId: v.id("assignments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["instructor", "admin"],
    );
    await ctx.db.patch(args.assignmentId, {
      published: true,
      updatedAt: new Date().toISOString(),
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      action: "assignment.published",
      targetTable: "assignments",
      targetId: args.assignmentId,
    });
    return null;
  },
});

export const archive = mutation({
  args: {
    assignmentId: v.id("assignments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["instructor", "admin"],
    );
    await ctx.db.patch(args.assignmentId, {
      published: false,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      action: "assignment.archived",
      targetTable: "assignments",
      targetId: args.assignmentId,
    });
    return null;
  },
});

export const listForCohort = query({
  args: {
    cohortId: v.id("cohorts"),
  },
  returns: v.array(
    v.object({
      id: v.id("assignments"),
      title: v.string(),
      published: v.boolean(),
      dueAt: v.optional(v.string()),
      autonomyMode: v.optional(autonomyModeValidator),
      budgetCapCents: v.optional(v.number()),
      hideAiReasoning: v.optional(v.boolean()),
      archivedAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const { membership } = await requireCohortRole(ctx, args.cohortId, [
      "learner",
      "instructor",
      "admin",
    ]);
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_cohort", (index) => index.eq("cohortId", args.cohortId))
      .collect();
    return assignments
      .filter((assignment) =>
        membership.role === "learner"
          ? assignment.published && !assignment.archivedAt
          : true,
      )
      .map((assignment) => ({
        id: assignment._id,
        title: assignment.title,
        published: assignment.published,
        ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
        ...(assignment.autonomyMode
          ? { autonomyMode: assignment.autonomyMode }
          : {}),
        ...(typeof assignment.budgetCapCents === "number"
          ? { budgetCapCents: assignment.budgetCapCents }
          : {}),
        ...(typeof assignment.hideAiReasoning === "boolean"
          ? { hideAiReasoning: assignment.hideAiReasoning }
          : {}),
        ...(assignment.archivedAt ? { archivedAt: assignment.archivedAt } : {}),
      }));
  },
});

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("assignments"),
      cohortId: v.id("cohorts"),
      cohortTitle: v.string(),
      institutionName: v.string(),
      title: v.string(),
      published: v.boolean(),
      dueAt: v.optional(v.string()),
      autonomyMode: v.optional(autonomyModeValidator),
      status: assignmentStatusValidator,
      caseSessionId: v.optional(v.id("caseSessions")),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireCurrentUser(ctx);
    const enrollments = await ctx.db
      .query("cohortMemberships")
      .withIndex("by_user", (index) => index.eq("userId", user._id))
      .collect();
    const rows = [];
    const seenCohorts = new Set<string>();
    for (const enrollment of enrollments) {
      const cohort = await ctx.db.get(enrollment.cohortId);
      if (!cohort || cohort.archived) continue;
      const institution = await ctx.db.get(cohort.institutionId);
      const organizationMemberships = await ctx.db
        .query("institutionMemberships")
        .withIndex("by_institution_user", (index) =>
          index
            .eq("institutionId", cohort.institutionId)
            .eq("userId", user._id),
        )
        .collect();
      const activeMemberships = organizationMemberships.filter(
        (organizationMembership) =>
          isOrganizationMembershipActive(
            institution,
            organizationMembership,
            Date.now(),
          ),
      );
      if (activeMemberships.length > 1) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Organization membership is ambiguous",
        );
      }
      if (!activeMemberships[0]) continue;
      const cohortKey = cohort._id as string;
      if (seenCohorts.has(cohortKey)) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Cohort enrollment is ambiguous",
        );
      }
      seenCohorts.add(cohortKey);
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_cohort", (index) => index.eq("cohortId", cohort._id))
        .collect();
      for (const assignment of assignments) {
        if (!assignment.published || assignment.archivedAt) continue;
        const session = await getAssignmentSession(
          ctx,
          assignment._id,
          user._id,
        );
        rows.push({
          id: assignment._id,
          cohortId: cohort._id,
          cohortTitle: cohort.title,
          institutionName: institution?.name ?? "Institution",
          title: assignment.title,
          published: assignment.published,
          ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
          ...(assignment.autonomyMode
            ? { autonomyMode: assignment.autonomyMode }
            : {}),
          status: statusForAssignmentSession(session),
          ...(session?.caseSessionId
            ? { caseSessionId: session.caseSessionId }
            : {}),
          ...(session?.submittedAt ? { submittedAt: session.submittedAt } : {}),
          ...(session?.reviewedAt ? { reviewedAt: session.reviewedAt } : {}),
        });
      }
    }
    return rows.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  },
});

export const get = query({
  args: {
    assignmentId: v.id("assignments"),
  },
  returns: v.union(
    v.object({
      id: v.id("assignments"),
      cohortId: v.id("cohorts"),
      title: v.string(),
      dueAt: v.optional(v.string()),
      rubricId: v.optional(v.string()),
      published: v.boolean(),
      autonomyMode: v.optional(autonomyModeValidator),
      budgetCapCents: v.optional(v.number()),
      hideAiReasoning: v.optional(v.boolean()),
      allowedFilingEvents: v.optional(v.array(v.string())),
      scenarioTitle: v.string(),
      scenarioKey: v.string(),
      status: assignmentStatusValidator,
      caseSessionId: v.optional(v.id("caseSessions")),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
      instructorNote: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { assignment, user, membership } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["learner", "instructor", "admin"],
    );
    if (!assignment.published && !canViewUnpublishedAssignment(membership))
      return null;
    const scenario = await ctx.db.get(assignment.scenarioId);
    const session = await getAssignmentSession(ctx, assignment._id, user._id);
    return {
      id: assignment._id,
      cohortId: assignment.cohortId,
      title: assignment.title,
      ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
      ...(assignment.rubricId ? { rubricId: assignment.rubricId } : {}),
      published: assignment.published,
      ...(assignment.autonomyMode
        ? { autonomyMode: assignment.autonomyMode }
        : {}),
      ...(typeof assignment.budgetCapCents === "number"
        ? { budgetCapCents: assignment.budgetCapCents }
        : {}),
      ...(typeof assignment.hideAiReasoning === "boolean"
        ? { hideAiReasoning: assignment.hideAiReasoning }
        : {}),
      ...(assignment.allowedFilingEvents
        ? { allowedFilingEvents: assignment.allowedFilingEvents }
        : {}),
      scenarioTitle: scenario?.title ?? "Scenario",
      scenarioKey: scenario?.scenarioKey ?? "",
      status: statusForAssignmentSession(session),
      ...(session?.caseSessionId
        ? { caseSessionId: session.caseSessionId }
        : {}),
      ...(session?.submittedAt ? { submittedAt: session.submittedAt } : {}),
      ...(session?.reviewedAt ? { reviewedAt: session.reviewedAt } : {}),
      ...(session?.instructorNote
        ? { instructorNote: session.instructorNote }
        : {}),
    };
  },
});

export const startSession = mutation({
  args: {
    assignmentId: v.id("assignments"),
  },
  returns: v.id("caseSessions"),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["learner"],
    );
    if (!assignment.published) {
      throw validationError("Assignment is not published");
    }
    const existing = await getAssignmentSession(ctx, assignment._id, user._id);
    if (existing) {
      return existing.caseSessionId;
    }
    const scenario = await ctx.db.get(assignment.scenarioId);
    if (!scenario) {
      throw notFound("Scenario");
    }
    const initialSession = createInitialSessionForScenarioDoc(scenario);
    const caseSessionId = await ctx.db.insert("caseSessions", {
      scenarioId: assignment.scenarioId,
      userId: user._id,
      courtPackId: initialSession.courtPackId,
      status: initialSession.status,
      procedureState: inferProcedureState(initialSession),
      autonomyMode: assignment.autonomyMode ?? "paused",
      turnPolicy: initialSession.turnPolicy,
      ...(initialSession.sourceProfileId
        ? { sourceProfileId: initialSession.sourceProfileId }
        : {}),
      qualityState: initialSession.qualityState,
      simulatedDate: initialSession.simulatedDate,
      nextEventSequence: 1,
    });
    await insertInitialSessionState(ctx, caseSessionId, initialSession);
    if (assignment.simulationPolicyId) {
      const policy = await ctx.db.get(assignment.simulationPolicyId);
      if (policy) {
        await ctx.db.patch(caseSessionId, {
          autonomyMode: policy.autonomyMode,
          turnPolicy: {
            maxTurnsPerRun: policy.maxTurnsPerRun,
            requireHumanApprovalFor: policy.requireHumanApprovalFor,
            stopOnDeficiency: policy.stopOnDeficiency,
          },
        });
      }
    }
    await ctx.db.insert("assignmentSessions", {
      assignmentId: assignment._id,
      caseSessionId,
      userId: user._id,
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId,
      action: "assignment_session.started",
      targetTable: "assignments",
      targetId: assignment._id,
    });
    return caseSessionId;
  },
});

export const attachSession = mutation({
  args: {
    assignmentId: v.id("assignments"),
    caseSessionId: v.id("caseSessions"),
  },
  returns: v.id("caseSessions"),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["learner"],
    );
    if (!assignment.published) {
      throw validationError("Assignment is not published");
    }
    const caseSession = await ctx.db.get(args.caseSessionId);
    if (!caseSession || caseSession.userId !== user._id) {
      throw notFound("Case session");
    }
    if (caseSession.scenarioId !== assignment.scenarioId) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Case session scenario mismatch",
      );
    }
    const existing = await getAssignmentSession(ctx, assignment._id, user._id);
    if (existing) {
      if (existing.caseSessionId !== args.caseSessionId) {
        throw new ConvexError(
          AppErrorCode.CONFLICT,
          "Assignment session already exists",
        );
      }
      return existing.caseSessionId;
    }
    const linkedAssignmentSessions = await ctx.db
      .query("assignmentSessions")
      .withIndex("by_case", (index) =>
        index.eq("caseSessionId", args.caseSessionId),
      )
      .collect();
    const linkedToAnotherAssignment = linkedAssignmentSessions.some(
      (assignmentSession) =>
        assignmentSession.assignmentId !== args.assignmentId,
    );
    if (linkedToAnotherAssignment) {
      throw new ConvexError(
        AppErrorCode.CONFLICT,
        "Case session is already attached",
      );
    }
    const policy = assignment.simulationPolicyId
      ? await ctx.db.get(assignment.simulationPolicyId)
      : null;
    if (policy) {
      await ctx.db.patch(args.caseSessionId, {
        autonomyMode: policy.autonomyMode,
        turnPolicy: {
          maxTurnsPerRun: policy.maxTurnsPerRun,
          requireHumanApprovalFor: policy.requireHumanApprovalFor,
          stopOnDeficiency: policy.stopOnDeficiency,
        },
      });
    }
    await ctx.db.insert("assignmentSessions", {
      assignmentId: args.assignmentId,
      caseSessionId: args.caseSessionId,
      userId: user._id,
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: args.caseSessionId,
      action: "assignment_session.attached",
      targetTable: "assignments",
      targetId: args.assignmentId,
    });
    return args.caseSessionId;
  },
});

export const submitSession = mutation({
  args: {
    assignmentId: v.id("assignments"),
    caseSessionId: v.id("caseSessions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      args.assignmentId,
      ["learner"],
    );
    const assignmentSessions = await listAssignmentSessionsForUser(
      ctx,
      assignment._id,
      user._id,
    );
    const assignmentSession = assignmentSessions.find(
      (candidate) => candidate.caseSessionId === args.caseSessionId,
    );
    if (!assignmentSession) {
      throw notFound("Assignment session");
    }
    if (isSubmittedLockActive(assignmentSession)) {
      throw sessionLocked();
    }
    const submittedAt = new Date().toISOString();
    await ctx.db.patch(assignmentSession._id, { submittedAt });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: args.caseSessionId,
      action: "assignment_session.submitted",
      targetTable: "assignmentSessions",
      targetId: assignmentSession._id,
    });
    return null;
  },
});

export const reopenSession = mutation({
  args: {
    assignmentSessionId: v.id("assignmentSessions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assignmentSession = await ctx.db.get(args.assignmentSessionId);
    if (!assignmentSession) {
      throw notFound("Assignment session");
    }
    const { assignment, user, cohort } = await requireAssignmentRole(
      ctx,
      assignmentSession.assignmentId,
      ["instructor", "admin"],
    );
    await ctx.db.patch(args.assignmentSessionId, {
      reopenedAt: new Date().toISOString(),
      reopenedByUserId: user._id,
    });
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: assignmentSession.caseSessionId,
      action: "assignment_session.reopened",
      targetTable: "assignmentSessions",
      targetId: args.assignmentSessionId,
    });
    return null;
  },
});
