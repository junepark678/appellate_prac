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

import {
  createFileRoute,
  Link,
  retainSearchParams,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AppFrame, EmptyState } from "../components/AppFrame";
import {
  type OrganizationContextCapture,
  useOrganizationContext,
} from "../components/OrganizationContext";

export const Route = createFileRoute(
  "/instructor/sessions/$caseSessionId/review",
)({
  search: {
    middlewares: [retainSearchParams(["organizationId"])],
  },
  validateSearch: (search: Record<string, unknown>) => ({
    organizationId:
      typeof search.organizationId === "string"
        ? search.organizationId
        : undefined,
    cohortId: typeof search.cohortId === "string" ? search.cohortId : undefined,
    assignmentId:
      typeof search.assignmentId === "string" ? search.assignmentId : undefined,
  }),
  component: ReviewSession,
});

function ReviewSession() {
  const { caseSessionId } = Route.useParams();
  const { cohortId, assignmentId } = Route.useSearch();
  return (
    <ReviewSessionPage
      caseSessionId={caseSessionId as Id<"caseSessions">}
      cohortId={cohortId}
      assignmentId={assignmentId}
    />
  );
}

export function ReviewSessionPage({
  caseSessionId,
  cohortId,
  assignmentId,
}: {
  caseSessionId: Id<"caseSessions">;
  cohortId?: string;
  assignmentId?: string;
}) {
  const organization = useOrganizationContext();
  const capture = organization.captureOrganizationContext();
  const canTeach =
    organization.status === "ready" &&
    capture !== null &&
    organization.capabilities.teach &&
    organization.isCurrentOrganizationContext(capture);

  if (organization.status === "ready" && !organization.capabilities.teach) {
    return (
      <AppFrame title="Session review">
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          Session reviews are available to instructors and organization admins.
        </p>
      </AppFrame>
    );
  }

  if (!canTeach || !capture) {
    return (
      <AppFrame title="Session review">
        <p role="status">Loading selected organization…</p>
      </AppFrame>
    );
  }

  return (
    <ReviewSessionForOrganization
      key={`${scopeKey(capture)}:${String(caseSessionId)}`}
      capture={capture}
      caseSessionId={caseSessionId}
      cohortId={cohortId}
      assignmentId={assignmentId}
    />
  );
}

function ReviewSessionForOrganization({
  capture,
  caseSessionId,
  cohortId,
  assignmentId,
}: {
  capture: OrganizationContextCapture;
  caseSessionId: Id<"caseSessions">;
  cohortId?: string;
  assignmentId?: string;
}) {
  const organization = useOrganizationContext();
  const isCurrent = organization.isCurrentOrganizationContext(capture);
  const cohortsQuery = useQuery(
    api.cohorts.listMine,
    isCurrent && cohortId && assignmentId
      ? { institutionId: capture.organizationId }
      : "skip",
  );
  const selectedCohort =
    isCurrent && cohortId
      ? cohortsQuery?.find(
          (cohort) =>
            String(cohort.id) === cohortId &&
            cohort.institutionId === capture.organizationId,
        )
      : undefined;
  const cohortAssignments = useQuery(
    api.assignments.listForCohort,
    selectedCohort && assignmentId ? { cohortId: selectedCohort.id } : "skip",
  );
  const selectedAssignment =
    isCurrent && assignmentId && selectedCohort
      ? cohortAssignments?.find(
          (assignment) => String(assignment.id) === assignmentId,
        )
      : undefined;
  const assignmentSessions = useQuery(
    api.instructor.listAssignmentSessions,
    selectedAssignment ? { assignmentId: selectedAssignment.id } : "skip",
  );
  const authorizedSession =
    isCurrent && assignmentSessions !== undefined
      ? assignmentSessions.find(
          (session) => session.caseSessionId === caseSessionId,
        )
      : undefined;
  const replay = useQuery(
    api.instructor.getSessionReplay,
    authorizedSession ? { caseSessionId } : "skip",
  );
  const reviewContext = useQuery(
    api.instructor.getReviewContext,
    authorizedSession ? { caseSessionId } : "skip",
  );
  const review = useMutation(api.instructor.reviewAssignmentSession);
  const [note, setNote] = useState("");
  const [score, setScore] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!reviewContext || !organization.isCurrentOrganizationContext(capture)) {
      return;
    }
    setNote(reviewContext.instructorNote ?? "");
    setScore(
      typeof reviewContext.score === "number"
        ? String(reviewContext.score)
        : "",
    );
  }, [
    reviewContext?.assignmentSessionId,
    capture.organizationId,
    capture.generation,
    organization.isCurrentOrganizationContext,
  ]);
  const canSubmit =
    isCurrent &&
    Boolean(authorizedSession) &&
    Boolean(reviewContext) &&
    reviewContext !== null &&
    Boolean(note.trim()) &&
    (!score.trim() || Number.isFinite(Number(score))) &&
    !pending;

  async function submitReview() {
    if (
      !canSubmit ||
      !reviewContext ||
      !organization.isCurrentOrganizationContext(capture)
    ) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await review({
        assignmentSessionId: reviewContext.assignmentSessionId,
        instructorNote: note.trim(),
        ...(score ? { score: Number(score) } : {}),
      });
    } catch (cause) {
      if (organization.isCurrentOrganizationContext(capture)) {
        setError(
          cause instanceof Error ? cause.message : "Unable to save review",
        );
      }
    } finally {
      if (organization.isCurrentOrganizationContext(capture)) setPending(false);
    }
  }

  if (!isCurrent) {
    return (
      <AppFrame title="Session review">
        <p role="status">Loading review…</p>
      </AppFrame>
    );
  }
  if (!cohortId || !assignmentId) {
    return (
      <AppFrame title="Session review">
        <EmptyState>
          Open a review from an assignment in the selected course.
        </EmptyState>
      </AppFrame>
    );
  }
  if (cohortsQuery === undefined) {
    return (
      <AppFrame title="Session review">
        <p role="status">Loading course…</p>
      </AppFrame>
    );
  }
  if (!selectedCohort) {
    return (
      <AppFrame title="Session review">
        <EmptyState>Session not found in this organization.</EmptyState>
      </AppFrame>
    );
  }
  if (cohortAssignments === undefined) {
    return (
      <AppFrame title="Session review">
        <p role="status">Loading assignment…</p>
      </AppFrame>
    );
  }
  if (!selectedAssignment) {
    return (
      <AppFrame title="Session review">
        <EmptyState>Session not found in this organization.</EmptyState>
      </AppFrame>
    );
  }
  if (assignmentSessions === undefined) {
    return (
      <AppFrame title="Session review">
        <p role="status">Loading submissions…</p>
      </AppFrame>
    );
  }
  if (!authorizedSession) {
    return (
      <AppFrame title="Session review">
        <EmptyState>Session not found in this organization.</EmptyState>
      </AppFrame>
    );
  }
  if (replay === undefined || reviewContext === undefined) {
    return (
      <AppFrame title="Session review">
        <p role="status">Loading review…</p>
      </AppFrame>
    );
  }
  if (reviewContext === null) {
    return (
      <AppFrame title="Session review">
        <EmptyState>Session not found in this organization.</EmptyState>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Session Review">
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Replay</h2>
          {replay.length === 0 ? (
            <EmptyState>No events recorded.</EmptyState>
          ) : null}
          <ol className="mt-3 divide-y divide-slate-100">
            {replay.map((event) => (
              <li key={event.sequence} className="py-3 text-sm">
                <div className="flex justify-between gap-4">
                  <strong>
                    {event.sequence}. {event.eventType}
                  </strong>
                  <span className="text-slate-500">{event.createdAt}</span>
                </div>
                <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs">
                  {event.payloadJson}
                </pre>
              </li>
            ))}
          </ol>
        </div>
        <aside className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Review</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="font-medium">Learner</dt>
              <dd className="text-slate-600">{reviewContext.accountName}</dd>
            </div>
            <div>
              <dt className="font-medium">Assignment</dt>
              <dd className="text-slate-600">
                {reviewContext.assignmentTitle}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Status</dt>
              <dd className="text-slate-600">
                {reviewContext.status.replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Submitted</dt>
              <dd className="text-slate-600">
                {reviewContext.submittedAt ?? "Not submitted"}
              </dd>
            </div>
          </dl>
          <label className="mt-2 grid gap-1 text-sm">
            <span>Score</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={score}
              onChange={(event) => setScore(event.target.value)}
              placeholder="Score"
              aria-label="Review score"
            />
          </label>
          <label className="mt-2 grid gap-1 text-sm">
            <span>Instructor note</span>
            <textarea
              className="h-32 w-full rounded border border-slate-300 p-3"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Instructor note"
              aria-label="Instructor note"
            />
          </label>
          <button
            type="button"
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => void submitReview()}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {pending ? "Saving…" : "Save review"}
          </button>
          <Link
            to="/instructor/assignments/$assignmentId"
            params={{ assignmentId: reviewContext.assignmentId }}
            search={{
              organizationId: String(capture.organizationId),
              cohortId,
            }}
            className="mt-2 inline-flex w-full items-center justify-center rounded border border-slate-300 px-3 py-2 text-sm font-medium"
          >
            Back to assignment
          </Link>
        </aside>
      </section>
    </AppFrame>
  );
}

function scopeKey(capture: OrganizationContextCapture) {
  return `${String(capture.organizationId)}:${capture.generation}`;
}
