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

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CaseSession } from "../domain/types";
import { AppFrame, EmptyState } from "../components/AppFrame";
import {
  type OrganizationContextCapture,
  useOrganizationContext,
} from "../components/OrganizationContext";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";

export const Route = createFileRoute("/app/sessions/$caseSessionId")({
  validateSearch: (search: Record<string, unknown>) => ({
    organizationId:
      typeof search.organizationId === "string"
        ? search.organizationId
        : undefined,
  }),
  component: SessionRoute,
  errorComponent: SessionRouteErrorBoundary,
});

function SessionRoute() {
  const { caseSessionId } = Route.useParams();
  return <SessionPage caseSessionId={caseSessionId} />;
}

export function SessionPage({ caseSessionId }: { caseSessionId: string }) {
  const organization = useOrganizationContext();
  const capture = organization.captureOrganizationContext();
  const canStudy =
    organization.status === "ready" &&
    capture !== null &&
    organization.capabilities.learn &&
    organization.isCurrentOrganizationContext(capture);

  if (organization.status === "ready" && !organization.capabilities.learn) {
    return (
      <AppFrame title="Session">
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
      <AppFrame title="Session">
        <p role="status">Loading selected organization…</p>
      </AppFrame>
    );
  }

  return (
    <ScopedSessionPage
      key={`${scopeKey(capture)}:${caseSessionId}`}
      capture={capture}
      caseSessionId={caseSessionId as Id<"caseSessions">}
    />
  );
}

function ScopedSessionPage({
  capture,
  caseSessionId,
}: {
  capture: OrganizationContextCapture;
  caseSessionId: Id<"caseSessions">;
}) {
  const organization = useOrganizationContext();
  const queryResult = useQuery(
    api.caseSessions.getForCurrentUser,
    organization.isCurrentOrganizationContext(capture)
      ? { caseSessionId, institutionId: capture.organizationId }
      : "skip",
  );
  const session = organization.isCurrentOrganizationContext(capture)
    ? queryResult
    : undefined;

  if (!organization.isCurrentOrganizationContext(capture)) {
    return (
      <AppFrame title="Session">
        <p role="status">Loading session…</p>
      </AppFrame>
    );
  }
  if (session === undefined)
    return (
      <AppFrame title="Session">
        <p role="status">Loading session…</p>
      </AppFrame>
    );
  if (session === null) {
    return (
      <AppFrame title="Session">
        <EmptyState>Session not found.</EmptyState>
      </AppFrame>
    );
  }

  return <SessionContent session={session} />;
}

function SessionContent({ session }: { session: CaseSession }) {
  return (
    <AppFrame title={session.scenario.shortCaption}>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Appeals Docket</h2>
          <ol className="mt-3 divide-y divide-slate-100">
            {session.docketEntries.map((entry) => (
              <li key={entry.id} className="py-3 text-sm">
                <div className="flex justify-between gap-4">
                  <strong>
                    #{entry.entryNumber} {entry.title}
                  </strong>
                  <span className="text-slate-500">
                    {entry.filedAt.slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{entry.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <aside className="grid gap-4">
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Deadlines</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {session.deadlines.map((deadline) => (
                <li key={deadline.id} className="flex justify-between gap-4">
                  <span>{deadline.label}</span>
                  <span className="text-slate-600">{deadline.dueDate}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Filings</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {session.filings.length === 0 ? (
                <li className="text-slate-500">None yet</li>
              ) : null}
              {session.filings.map((filing) => (
                <li key={filing.id}>
                  {filing.title} / {filing.outcome}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </AppFrame>
  );
}

function isConvexNotFound(error: unknown) {
  if (!(error instanceof Error) || !("data" in error)) return false;
  const data = (error as { data?: unknown }).data;
  return Boolean(
    data &&
    typeof data === "object" &&
    "code" in data &&
    data.code === "NOT_FOUND",
  );
}

export function SessionRouteErrorBoundary({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  if (isConvexNotFound(error)) {
    return (
      <AppFrame title="Session">
        <EmptyState>Session not found.</EmptyState>
      </AppFrame>
    );
  }
  return <RouteErrorBoundary error={error} reset={reset} />;
}

function scopeKey(capture: OrganizationContextCapture) {
  return `${String(capture.organizationId)}:${capture.generation}`;
}
