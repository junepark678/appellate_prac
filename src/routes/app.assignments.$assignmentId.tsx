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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Play, Send } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AppFrame, EmptyState } from "../components/AppFrame";
import {
  type OrganizationContextCapture,
  useOrganizationContext,
} from "../components/OrganizationContext";

export const Route = createFileRoute("/app/assignments/$assignmentId")({
  validateSearch: (search: Record<string, unknown>) => ({
    cohortId: typeof search.cohortId === "string" ? search.cohortId : undefined,
    organizationId:
      typeof search.organizationId === "string"
        ? search.organizationId
        : undefined,
  }),
  component: AssignmentDetail,
});

function AssignmentDetail() {
  const { assignmentId } = Route.useParams();
  const { cohortId } = Route.useSearch();
  return (
    <AssignmentDetailPage
      assignmentId={assignmentId as Id<"assignments">}
      cohortId={cohortId}
    />
  );
}

export function AssignmentDetailPage({
  assignmentId,
  cohortId,
}: {
  assignmentId: Id<"assignments">;
  cohortId?: string;
}) {
  const organization = useOrganizationContext();
  const capture = organization.captureOrganizationContext();
  const canStudy =
    organization.status === "ready" &&
    capture !== null &&
    organization.capabilities.learn &&
    organization.isCurrentOrganizationContext(capture);

  if (organization.status === "ready" && !organization.capabilities.learn) {
    return (
      <AppFrame title="Assignment">
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          Study is unavailable for this organization membership.
        </p>
      </AppFrame>
    );
  }

  if (!canStudy || !capture) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading selected organization…</p>
      </AppFrame>
    );
  }

  return (
    <AssignmentDetailForOrganization
      key={`${scopeKey(capture)}:${String(assignmentId)}`}
      capture={capture}
      assignmentId={assignmentId}
      cohortId={cohortId}
    />
  );
}

function AssignmentDetailForOrganization({
  capture,
  assignmentId,
  cohortId,
}: {
  capture: OrganizationContextCapture;
  assignmentId: Id<"assignments">;
  cohortId?: string;
}) {
  const organization = useOrganizationContext();
  const isCurrent = organization.isCurrentOrganizationContext(capture);
  const cohortsQuery = useQuery(
    api.cohorts.listMine,
    isCurrent && cohortId ? { institutionId: capture.organizationId } : "skip",
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
    selectedCohort ? { cohortId: selectedCohort.id } : "skip",
  );
  const assignmentSummary =
    isCurrent && selectedCohort
      ? cohortAssignments?.find(
          (assignment) =>
            assignment.id === assignmentId && assignment.published,
        )
      : undefined;
  const assignment = useQuery(
    api.assignments.get,
    assignmentSummary ? { assignmentId } : "skip",
  );
  const startSession = useMutation(api.assignments.startSession);
  const submitSession = useMutation(api.assignments.submitSession);
  const canMutate =
    isCurrent && Boolean(assignmentSummary) && Boolean(assignment);
  const visibleAssignment = canMutate ? assignment : undefined;

  async function startAssignmentSession() {
    if (!canMutate || !organization.isCurrentOrganizationContext(capture))
      return;
    await startSession({ assignmentId });
  }

  async function submitAssignmentSession() {
    if (
      !visibleAssignment?.caseSessionId ||
      !organization.isCurrentOrganizationContext(capture)
    ) {
      return;
    }
    await submitSession({
      assignmentId,
      caseSessionId: visibleAssignment.caseSessionId,
    });
  }

  if (!isCurrent) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading assignment…</p>
      </AppFrame>
    );
  }
  if (!cohortId) {
    return (
      <AppFrame title="Assignment">
        <EmptyState>
          Open this assignment from Study to confirm its organization.
        </EmptyState>
      </AppFrame>
    );
  }
  if (cohortsQuery === undefined) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading course…</p>
      </AppFrame>
    );
  }
  if (!selectedCohort) {
    return (
      <AppFrame title="Assignment">
        <EmptyState>Assignment not found in this organization.</EmptyState>
      </AppFrame>
    );
  }
  if (cohortAssignments === undefined) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading assignment…</p>
      </AppFrame>
    );
  }
  if (!assignmentSummary) {
    return (
      <AppFrame title="Assignment">
        <EmptyState>Assignment not found in this organization.</EmptyState>
      </AppFrame>
    );
  }
  if (assignment === undefined) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading assignment…</p>
      </AppFrame>
    );
  }
  if (assignment === null) {
    return (
      <AppFrame title="Assignment">
        <EmptyState>Assignment not found in this organization.</EmptyState>
      </AppFrame>
    );
  }

  return (
    <AppFrame title={assignment.title}>
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{assignment.scenarioTitle}</p>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="font-medium">Due</dt>
              <dd className="text-slate-600">
                {assignment.dueAt ?? "No due date"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Autonomy</dt>
              <dd className="text-slate-600">
                {assignment.autonomyMode ?? "paused"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Status</dt>
              <dd className="text-slate-600">
                {assignment.status.replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="font-medium">AI budget cap</dt>
              <dd className="text-slate-600">
                {typeof assignment.budgetCapCents === "number"
                  ? `$${(assignment.budgetCapCents / 100).toFixed(2)}`
                  : "Default"}
              </dd>
            </div>
          </dl>
        </div>
        <aside className="rounded border border-slate-200 bg-white p-4">
          {assignment.caseSessionId ? (
            <div className="grid gap-2">
              <Link
                to="/app/sessions/$caseSessionId"
                params={{ caseSessionId: assignment.caseSessionId }}
                search={{ organizationId: String(capture.organizationId) }}
                className="inline-flex items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Open session
              </Link>
              <button
                type="button"
                disabled={
                  !canMutate ||
                  assignment.status === "submitted" ||
                  assignment.status === "reviewed"
                }
                className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void submitAssignmentSession()}
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Submit
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!canMutate}
              onClick={() => void startAssignmentSession()}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Start session
            </button>
          )}
          {assignment.instructorNote ? (
            <p className="mt-4 text-sm text-slate-700">
              {assignment.instructorNote}
            </p>
          ) : null}
        </aside>
      </section>
    </AppFrame>
  );
}

function scopeKey(capture: OrganizationContextCapture) {
  return `${String(capture.organizationId)}:${capture.generation}`;
}
