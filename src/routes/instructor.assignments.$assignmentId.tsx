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
import { Archive, CheckCircle2, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AppFrame, EmptyState } from "../components/AppFrame";
import {
  type OrganizationContextCapture,
  useOrganizationContext,
} from "../components/OrganizationContext";

export const Route = createFileRoute("/instructor/assignments/$assignmentId")({
  search: {
    middlewares: [retainSearchParams(["organizationId"])],
  },
  validateSearch: (search: Record<string, unknown>) => ({
    organizationId:
      typeof search.organizationId === "string"
        ? search.organizationId
        : undefined,
    cohortId: typeof search.cohortId === "string" ? search.cohortId : undefined,
  }),
  component: InstructorAssignment,
});

function InstructorAssignment() {
  const { assignmentId } = Route.useParams();
  const { cohortId } = Route.useSearch();
  return (
    <InstructorAssignmentPage
      assignmentId={assignmentId as Id<"assignments">}
      cohortId={cohortId}
    />
  );
}

export function InstructorAssignmentPage({
  assignmentId,
  cohortId,
}: {
  assignmentId: Id<"assignments">;
  cohortId?: string;
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
      <AppFrame title="Assignment">
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          Assignment management is available to instructors and organization
          admins.
        </p>
      </AppFrame>
    );
  }

  if (!canTeach || !capture) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading selected organization…</p>
      </AppFrame>
    );
  }

  return (
    <InstructorAssignmentForOrganization
      key={`${scopeKey(capture)}:${String(assignmentId)}`}
      capture={capture}
      assignmentId={assignmentId}
      cohortId={cohortId}
    />
  );
}

function InstructorAssignmentForOrganization({
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
      ? cohortAssignments?.find((candidate) => candidate.id === assignmentId)
      : undefined;
  const assignment = useQuery(
    api.assignments.get,
    assignmentSummary ? { assignmentId } : "skip",
  );
  const sessions = useQuery(
    api.instructor.listAssignmentSessions,
    assignmentSummary ? { assignmentId } : "skip",
  );
  const csv = useQuery(
    api.instructor.exportAssignmentCsv,
    assignmentSummary ? { assignmentId } : "skip",
  );
  const publish = useMutation(api.assignments.publish);
  const archive = useMutation(api.assignments.archive);
  const reopen = useMutation(api.assignments.reopenSession);
  const update = useMutation(api.assignments.update);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [rubricId, setRubricId] = useState("");
  const [autonomyMode, setAutonomyMode] = useState<
    "paused" | "supervised" | "autonomous"
  >("paused");
  const [budgetCapDollars, setBudgetCapDollars] = useState("");
  const [hideAiReasoning, setHideAiReasoning] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!assignment || !organization.isCurrentOrganizationContext(capture))
      return;
    setTitle(assignment.title);
    setDueAt(assignment.dueAt ? assignment.dueAt.slice(0, 16) : "");
    setRubricId(assignment.rubricId ?? "");
    setAutonomyMode(assignment.autonomyMode ?? "paused");
    setBudgetCapDollars(
      typeof assignment.budgetCapCents === "number"
        ? (assignment.budgetCapCents / 100).toFixed(2)
        : "",
    );
    setHideAiReasoning(assignment.hideAiReasoning ?? true);
  }, [
    assignment,
    capture.organizationId,
    capture.generation,
    organization.isCurrentOrganizationContext,
  ]);

  const summary = useMemo(() => {
    const rows = sessions ?? [];
    return {
      started: rows.length,
      submitted: rows.filter((session) => session.status === "submitted")
        .length,
      reviewed: rows.filter((session) => session.status === "reviewed").length,
      inProgress: rows.filter((session) => session.status === "in_progress")
        .length,
      validationIssues: rows.reduce(
        (count, session) => count + session.validationIssueCount,
        0,
      ),
    };
  }, [sessions]);
  const canMutate =
    isCurrent &&
    Boolean(assignmentSummary) &&
    Boolean(assignment) &&
    assignment !== null;

  async function performMutation(action: () => Promise<unknown>) {
    if (!canMutate || !organization.isCurrentOrganizationContext(capture))
      return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (organization.isCurrentOrganizationContext(capture)) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to update assignment",
        );
      }
    } finally {
      if (organization.isCurrentOrganizationContext(capture)) setPending(false);
    }
  }

  if (!cohortId) {
    return (
      <AppFrame title="Assignment">
        <EmptyState>
          Open this assignment from Courses to confirm its organization.
        </EmptyState>
      </AppFrame>
    );
  }
  if (!isCurrent) {
    return (
      <AppFrame title="Assignment">
        <p role="status">Loading assignment…</p>
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
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <section className="mb-5 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Assignment settings</h2>
          <div className="mt-3 grid gap-3">
            <input
              className="rounded border border-slate-300 px-3 py-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Assignment title"
              aria-label="Assignment title"
            />
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Due date</span>
                <input
                  className="rounded border border-slate-300 px-3 py-2"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Rubric</span>
                <input
                  className="rounded border border-slate-300 px-3 py-2"
                  value={rubricId}
                  onChange={(event) => setRubricId(event.target.value)}
                  placeholder="Rubric id"
                  aria-label="Rubric"
                />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Simulation mode</span>
                <select
                  className="rounded border border-slate-300 px-3 py-2"
                  value={autonomyMode}
                  onChange={(event) =>
                    setAutonomyMode(event.target.value as typeof autonomyMode)
                  }
                  aria-label="Simulation mode"
                >
                  <option value="paused">Paused</option>
                  <option value="supervised">Supervised</option>
                  <option value="autonomous">Autonomous</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">AI budget cap</span>
                <input
                  className="rounded border border-slate-300 px-3 py-2"
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetCapDollars}
                  onChange={(event) => setBudgetCapDollars(event.target.value)}
                  placeholder="Default"
                  aria-label="AI budget cap"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideAiReasoning}
                onChange={(event) => setHideAiReasoning(event.target.checked)}
              />
              Hide AI reasoning from learners
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={!canMutate || pending || !title.trim()}
                onClick={() =>
                  void performMutation(() =>
                    update({
                      assignmentId,
                      title: title.trim(),
                      dueAt: dueAt ? new Date(dueAt).toISOString() : "",
                      rubricId,
                      autonomyMode,
                      ...(budgetCapDollars
                        ? {
                            budgetCapCents: Math.round(
                              Number(budgetCapDollars) * 100,
                            ),
                          }
                        : {}),
                      hideAiReasoning,
                    }),
                  )
                }
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save settings
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={!canMutate || pending || assignment.published}
                onClick={() =>
                  void performMutation(() => publish({ assignmentId }))
                }
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Publish
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={!canMutate || pending}
                onClick={() =>
                  void performMutation(() => archive({ assignmentId }))
                }
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Archive
              </button>
            </div>
          </div>
        </div>
        <aside className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Submission summary</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Started</dt>
              <dd className="text-lg font-semibold">{summary.started}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Submitted</dt>
              <dd className="text-lg font-semibold">{summary.submitted}</dd>
            </div>
            <div>
              <dt className="text-slate-500">In progress</dt>
              <dd className="text-lg font-semibold">{summary.inProgress}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Reviewed</dt>
              <dd className="text-lg font-semibold">{summary.reviewed}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-slate-500">Validation issues</dt>
              <dd className="text-lg font-semibold">
                {summary.validationIssues}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-semibold">Submissions</h2>
        </div>
        {sessions?.length === 0 ? (
          <EmptyState>No started sessions.</EmptyState>
        ) : null}
        {sessions === undefined ? (
          <p role="status" className="p-4 text-sm text-slate-600">
            Loading submissions…
          </p>
        ) : null}
        <div className="divide-y divide-slate-100">
          {sessions?.map((session) => (
            <div
              key={session.assignmentSessionId}
              className="grid gap-3 p-4 md:grid-cols-5"
            >
              <div className="md:col-span-2">
                <p className="font-medium">{session.accountName}</p>
                <p className="text-sm text-slate-600">{session.status}</p>
              </div>
              <p className="text-sm text-slate-600">
                {session.submittedAt ?? "Not submitted"}
              </p>
              <p className="text-sm text-slate-600">
                {typeof session.score === "number" ? session.score : "No score"}
              </p>
              <div className="flex gap-2 md:justify-end">
                <Link
                  to="/instructor/sessions/$caseSessionId/review"
                  params={{ caseSessionId: session.caseSessionId }}
                  search={{
                    organizationId: String(capture.organizationId),
                    cohortId: String(cohortId),
                    assignmentId: String(assignmentId),
                  }}
                  className="rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white"
                >
                  Review
                </Link>
                <button
                  type="button"
                  className="rounded border border-slate-300 p-2 disabled:opacity-50"
                  aria-label="Reopen session"
                  disabled={!canMutate || pending}
                  onClick={() =>
                    void performMutation(() =>
                      reopen({
                        assignmentSessionId: session.assignmentSessionId,
                      }),
                    )
                  }
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {csv ? (
        <textarea
          className="mt-5 h-40 w-full rounded border border-slate-300 p-3 font-mono text-xs"
          readOnly
          value={csv}
          aria-label="Assignment CSV export"
        />
      ) : null}
    </AppFrame>
  );
}

function scopeKey(capture: OrganizationContextCapture) {
  return `${String(capture.organizationId)}:${capture.generation}`;
}
