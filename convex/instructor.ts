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

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCohortRole, writeAuditLog } from "./authz";
import { appendCaseSessionEvent } from "./caseSessionEventLog";
import { AppErrorCode, ConvexError, notFound } from "./errors";

type ReadCtx = QueryCtx | MutationCtx;
type ReviewStatus = "in_progress" | "submitted" | "reviewed";

function isScopeAccessError(error: unknown): error is ConvexError {
  return (
    error instanceof ConvexError &&
    (error.data.code === AppErrorCode.NOT_FOUND ||
      error.data.code === AppErrorCode.AUTH_UNAUTHORIZED_ROLE)
  );
}

function isSubmittedLockActive(
  session: Pick<Doc<"assignmentSessions">, "submittedAt" | "reopenedAt">,
) {
  return Boolean(
    session.submittedAt &&
    (!session.reopenedAt || session.reopenedAt <= session.submittedAt),
  );
}

function csvCell(value: string | number | undefined) {
  const stringValue = String(value ?? "");
  return /[",\n]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
}

async function requireAssignmentInstructor(
  ctx: ReadCtx,
  assignmentId: Id<"assignments">,
) {
  const assignment = await ctx.db.get(assignmentId);
  if (!assignment) throw notFound("Assignment", assignmentId);
  let access;
  try {
    access = await requireCohortRole(ctx, assignment.cohortId, [
      "instructor",
      "admin",
    ]);
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

export const listAssignmentSessions = query({
  args: {
    assignmentId: v.id("assignments"),
  },
  returns: v.array(
    v.object({
      assignmentSessionId: v.id("assignmentSessions"),
      caseSessionId: v.id("caseSessions"),
      userId: v.id("users"),
      accountName: v.string(),
      status: v.union(
        v.literal("in_progress"),
        v.literal("submitted"),
        v.literal("reviewed"),
      ),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
      instructorNote: v.optional(v.string()),
      score: v.optional(v.number()),
      validationIssueCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAssignmentInstructor(ctx, args.assignmentId);
    const sessions = await ctx.db
      .query("assignmentSessions")
      .withIndex("by_assignment", (index) =>
        index.eq("assignmentId", args.assignmentId),
      )
      .collect();

    const rows = [];
    for (const session of sessions) {
      const user = await ctx.db.get(session.userId);
      const filings = await ctx.db
        .query("filings")
        .withIndex("by_case", (index) =>
          index.eq("caseSessionId", session.caseSessionId),
        )
        .collect();
      const status: ReviewStatus = session.reviewedAt
        ? "reviewed"
        : isSubmittedLockActive(session)
          ? "submitted"
          : "in_progress";
      rows.push({
        assignmentSessionId: session._id,
        caseSessionId: session.caseSessionId,
        userId: session.userId,
        accountName: user?.displayName ?? "Account",
        status,
        ...(session.submittedAt ? { submittedAt: session.submittedAt } : {}),
        ...(session.reviewedAt ? { reviewedAt: session.reviewedAt } : {}),
        ...(session.instructorNote
          ? { instructorNote: session.instructorNote }
          : {}),
        ...(typeof session.score === "number" ? { score: session.score } : {}),
        validationIssueCount: filings.reduce(
          (count, filing) => count + filing.validationIssues.length,
          0,
        ),
      });
    }
    return rows;
  },
});

export const getSessionReplay = query({
  args: {
    caseSessionId: v.id("caseSessions"),
  },
  returns: v.array(
    v.object({
      sequence: v.number(),
      eventType: v.string(),
      payloadJson: v.string(),
      createdAt: v.string(),
      actorUserId: v.optional(v.id("users")),
    }),
  ),
  handler: async (ctx, args) => {
    const assignmentSessions = await ctx.db
      .query("assignmentSessions")
      .withIndex("by_case", (index) =>
        index.eq("caseSessionId", args.caseSessionId),
      )
      .collect();
    if (!assignmentSessions.length)
      throw notFound("Assignment session", args.caseSessionId);

    let permissionError: Error | null = null;
    let hasAccess = false;
    for (const assignmentSession of assignmentSessions) {
      try {
        await requireAssignmentInstructor(ctx, assignmentSession.assignmentId);
        hasAccess = true;
        break;
      } catch (error) {
        if (!isScopeAccessError(error)) throw error;
        permissionError = error;
      }
    }
    if (!hasAccess) {
      throw (
        permissionError ?? notFound("Assignment session", args.caseSessionId)
      );
    }

    const events = await ctx.db
      .query("caseSessionEvents")
      .withIndex("by_case_sequence", (index) =>
        index.eq("caseSessionId", args.caseSessionId),
      )
      .collect();
    return events.map((event) => ({
      sequence: event.sequence,
      eventType: event.eventType,
      payloadJson: event.payloadJson,
      createdAt: event.createdAt,
      ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
    }));
  },
});

export const getReviewContext = query({
  args: {
    caseSessionId: v.id("caseSessions"),
  },
  returns: v.union(
    v.object({
      assignmentSessionId: v.id("assignmentSessions"),
      assignmentId: v.id("assignments"),
      assignmentTitle: v.string(),
      accountName: v.string(),
      status: v.union(
        v.literal("in_progress"),
        v.literal("submitted"),
        v.literal("reviewed"),
      ),
      submittedAt: v.optional(v.string()),
      reviewedAt: v.optional(v.string()),
      instructorNote: v.optional(v.string()),
      score: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const assignmentSessions = await ctx.db
      .query("assignmentSessions")
      .withIndex("by_case", (index) =>
        index.eq("caseSessionId", args.caseSessionId),
      )
      .collect();

    let permissionError: Error | null = null;
    for (const assignmentSession of assignmentSessions) {
      try {
        const { assignment } = await requireAssignmentInstructor(
          ctx,
          assignmentSession.assignmentId,
        );
        const user = await ctx.db.get(assignmentSession.userId);
        const status: ReviewStatus = assignmentSession.reviewedAt
          ? "reviewed"
          : isSubmittedLockActive(assignmentSession)
            ? "submitted"
            : "in_progress";
        return {
          assignmentSessionId: assignmentSession._id,
          assignmentId: assignment._id,
          assignmentTitle: assignment.title,
          accountName: user?.displayName ?? "Account",
          status,
          ...(assignmentSession.submittedAt
            ? { submittedAt: assignmentSession.submittedAt }
            : {}),
          ...(assignmentSession.reviewedAt
            ? { reviewedAt: assignmentSession.reviewedAt }
            : {}),
          ...(assignmentSession.instructorNote
            ? { instructorNote: assignmentSession.instructorNote }
            : {}),
          ...(typeof assignmentSession.score === "number"
            ? { score: assignmentSession.score }
            : {}),
        };
      } catch (error) {
        if (!isScopeAccessError(error)) throw error;
        permissionError = error;
      }
    }

    if (assignmentSessions.length > 0) {
      throw (
        permissionError ?? notFound("Assignment session", args.caseSessionId)
      );
    }
    return null;
  },
});

export const reviewAssignmentSession = mutation({
  args: {
    assignmentSessionId: v.id("assignmentSessions"),
    instructorNote: v.string(),
    score: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assignmentSession = await ctx.db.get(args.assignmentSessionId);
    if (!assignmentSession)
      throw notFound("Assignment session", args.assignmentSessionId);
    const { assignment, user, cohort } = await requireAssignmentInstructor(
      ctx,
      assignmentSession.assignmentId,
    );
    await ctx.db.patch(args.assignmentSessionId, {
      instructorNote: args.instructorNote,
      ...(typeof args.score === "number" ? { score: args.score } : {}),
      reviewedAt: new Date().toISOString(),
      reviewerUserId: user._id,
    });
    await appendCaseSessionEvent(
      ctx,
      assignmentSession.caseSessionId,
      "instructor_review_submitted",
      {
        assignmentSessionId: args.assignmentSessionId,
        score: args.score ?? null,
      },
      user._id,
    );
    await writeAuditLog(ctx, {
      actorUserId: user._id,
      institutionId: cohort.institutionId,
      cohortId: assignment.cohortId,
      caseSessionId: assignmentSession.caseSessionId,
      action: "assignment_session.reviewed",
      targetTable: "assignmentSessions",
      targetId: args.assignmentSessionId,
      metadata: { score: args.score ?? null },
    });
    return null;
  },
});

export const exportAssignmentCsv = query({
  args: {
    assignmentId: v.id("assignments"),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireAssignmentInstructor(ctx, args.assignmentId);
    const sessions = await ctx.db
      .query("assignmentSessions")
      .withIndex("by_assignment", (index) =>
        index.eq("assignmentId", args.assignmentId),
      )
      .collect();
    const rows = [
      [
        "accountName",
        "status",
        "submittedAt",
        "reviewedAt",
        "score",
        "validationIssueCount",
        "caseSessionId",
      ],
    ];
    for (const session of sessions) {
      const user = await ctx.db.get(session.userId);
      const filings = await ctx.db
        .query("filings")
        .withIndex("by_case", (index) =>
          index.eq("caseSessionId", session.caseSessionId),
        )
        .collect();
      rows.push([
        user?.displayName ?? "Account",
        session.reviewedAt
          ? "reviewed"
          : isSubmittedLockActive(session)
            ? "submitted"
            : "in_progress",
        session.submittedAt ?? "",
        session.reviewedAt ?? "",
        typeof session.score === "number" ? String(session.score) : "",
        String(
          filings.reduce(
            (count, filing) => count + filing.validationIssues.length,
            0,
          ),
        ),
        session.caseSessionId,
      ]);
    }
    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
  },
});
