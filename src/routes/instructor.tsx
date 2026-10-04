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
  Outlet,
  createFileRoute,
  Link,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import {
  AppFrame,
  EmptyState,
  OrganizationRouteGate,
} from "../components/AppFrame";
import {
  type OrganizationContextCapture,
  useOrganizationContext,
} from "../components/OrganizationContext";

export const Route = createFileRoute("/instructor")({
  search: {
    middlewares: [retainSearchParams(["organizationId"])],
  },
  component: InstructorSection,
});

function InstructorSection() {
  return (
    <OrganizationRouteGate title="Course Dashboard" capability="teach">
      <InstructorHome />
    </OrganizationRouteGate>
  );
}

function InstructorHome() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (pathname !== "/instructor") {
    return <Outlet />;
  }
  return <InstructorDashboard />;
}

export function InstructorDashboard() {
  const organization = useOrganizationContext();
  const capture = organization.captureOrganizationContext();
  const hasTeachingAccess =
    organization.status === "ready" &&
    capture !== null &&
    organization.capabilities.teach &&
    organization.isCurrentOrganizationContext(capture);

  if (organization.status === "ready" && !organization.capabilities.teach) {
    return (
      <AppFrame title="Courses">
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          Courses are available to instructors and organization admins.
        </p>
      </AppFrame>
    );
  }

  if (!hasTeachingAccess || !capture) {
    return (
      <AppFrame title="Courses">
        <p role="status">Loading selected organization…</p>
      </AppFrame>
    );
  }

  return (
    <InstructorDashboardForOrganization
      key={scopeKey(capture)}
      capture={capture}
    />
  );
}

function InstructorDashboardForOrganization({
  capture,
}: {
  capture: OrganizationContextCapture;
}) {
  const organization = useOrganizationContext();
  const isCurrent = organization.isCurrentOrganizationContext(capture);
  const cohortsQuery = useQuery(
    api.cohorts.listMine,
    isCurrent ? { institutionId: capture.organizationId } : "skip",
  );
  const cohorts =
    isCurrent && cohortsQuery !== undefined
      ? cohortsQuery.filter(
          (cohort) => cohort.institutionId === capture.organizationId,
        )
      : undefined;
  const createCohort = useMutation(api.cohorts.createCohort);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function createSelectedOrganizationCohort() {
    if (!organization.isCurrentOrganizationContext(capture) || !title.trim()) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await createCohort({
        institutionId: capture.organizationId,
        title: title.trim(),
        term: "GA v1",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120).toISOString(),
      });
      if (organization.isCurrentOrganizationContext(capture)) setTitle("");
    } catch (cause) {
      if (organization.isCurrentOrganizationContext(capture)) {
        setError(
          cause instanceof Error ? cause.message : "Unable to create course",
        );
      }
    } finally {
      if (organization.isCurrentOrganizationContext(capture)) setPending(false);
    }
  }

  return (
    <AppFrame title="Courses">
      <section className="mb-5 rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Create course</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Course title"
            aria-label="Course title"
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!title.trim() || pending || !isCurrent}
            onClick={() => void createSelectedOrganizationCohort()}
            type="button"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {pending ? "Creating…" : "Create"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>
      <div className="grid gap-3">
        {cohorts?.length === 0 ? (
          <EmptyState>No courses available.</EmptyState>
        ) : null}
        {cohorts?.map((cohort) => (
          <Link
            key={cohort.id}
            to="/instructor/cohorts/$cohortId"
            params={{ cohortId: cohort.id }}
            className="rounded border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <p className="text-xs uppercase text-slate-500">
              {cohort.institutionName}
            </p>
            <h2 className="mt-1 font-semibold">{cohort.title}</h2>
            <p className="text-sm text-slate-600">
              {cohort.term} / Your organization role: {cohort.role}
            </p>
          </Link>
        ))}
      </div>
    </AppFrame>
  );
}

function scopeKey(capture: OrganizationContextCapture) {
  return `${String(capture.organizationId)}:${capture.generation}`;
}
