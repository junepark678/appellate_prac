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
} from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { CheckCircle2, Circle, FileText } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import {
  AppFrame,
  EmptyState,
  OrganizationRouteGate,
} from '../components/AppFrame'

export const Route = createFileRoute('/app')({
  search: {
    middlewares: [retainSearchParams(['organizationId'])],
  },
  component: StudySection,
})

function StudySection() {
  return (
    <OrganizationRouteGate title="Assignments" capability="learn">
      <LearnerHome />
    </OrganizationRouteGate>
  )
}

function LearnerHome() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const assignments = useQuery(api.assignments.listMine, {})
  const policies = useQuery(api.policies.listCurrent, {})
  const acceptPolicy = useMutation(api.policies.accept)
  const pendingPolicies = policies?.filter((policy) => !policy.acceptedAt) ?? []

  if (pathname !== '/app') {
    return <Outlet />
  }

  return (
    <AppFrame title="Assignments">
      {pendingPolicies.length ? (
        <section className="mb-5 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium">Required acknowledgments</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {pendingPolicies.map((policy) => (
              <button
                key={`${policy.policyKey}:${policy.version}`}
                className="flex items-center justify-between rounded border border-amber-200 bg-white px-3 py-2 text-left text-sm"
                onClick={() =>
                  void acceptPolicy({
                    policyKey: policy.policyKey,
                    version: policy.version,
                  })
                }
              >
                <span>{policy.title}</span>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-3">
        {assignments?.length === 0 ? (
          <EmptyState>No published assignments are available for your cohorts.</EmptyState>
        ) : null}
        {assignments?.map((assignment) => (
          <Link
            key={assignment.id}
            to="/app/assignments/$assignmentId"
            params={{ assignmentId: assignment.id }}
            className="rounded border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase text-slate-500">
                  {assignment.institutionName} / {assignment.cohortTitle}
                </p>
                <h2 className="mt-1 font-semibold">{assignment.title}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {assignment.dueAt ? `Due ${assignment.dueAt}` : 'No due date'}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs">
                {assignment.status === 'not_started' ? (
                  <Circle className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <FileText className="h-3 w-3" aria-hidden="true" />
                )}
                {assignment.status.replaceAll('_', ' ')}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </AppFrame>
  )
}
