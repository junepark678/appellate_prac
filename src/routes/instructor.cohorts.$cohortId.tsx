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

import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Plus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/instructor/cohorts/$cohortId')({
  component: CohortDetail,
})

type AssignmentAutonomyMode = 'paused' | 'supervised' | 'autonomous'
type InviteRole = 'learner' | 'instructor'

function CohortDetail() {
  const { cohortId } = Route.useParams()
  const assignments = useQuery(api.assignments.listForCohort, {
    cohortId: cohortId as Id<'cohorts'>,
  })
  const roster = useQuery(api.cohorts.listRoster, {
    cohortId: cohortId as Id<'cohorts'>,
  })
  const scenarios = useQuery(api.scenarios.listPublishedRecords, {})
  const createAssignment = useMutation(api.assignments.create)
  const inviteMembers = useMutation(api.cohorts.inviteMembers)
  const cohorts = useQuery(api.cohorts.listMine, {})
  const cohort = cohorts?.find((candidate) => candidate.id === cohortId)
  const activeAssignments = assignments?.filter((assignment) => !assignment.archivedAt)
  const [title, setTitle] = useState('')
  const [scenarioKey, setScenarioKey] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [rubricId, setRubricId] = useState('fourth-circuit-civil-appeal')
  const [autonomyMode, setAutonomyMode] = useState<AssignmentAutonomyMode>('paused')
  const [budgetCapDollars, setBudgetCapDollars] = useState('')
  const [hideAiReasoning, setHideAiReasoning] = useState(true)
  const [publishImmediately, setPublishImmediately] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('learner')
  const [inviteToken, setInviteToken] = useState('')

  const createDisabled = !title || !scenarioKey || Number(budgetCapDollars || 0) < 0

  return (
    <AppFrame title={cohort?.title ?? 'Cohort'}>
      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Create assignment</h2>
          <div className="mt-3 grid gap-2">
            <input
              className="rounded border border-slate-300 px-3 py-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Assignment title"
            />
            <select
              className="rounded border border-slate-300 px-3 py-2"
              value={scenarioKey}
              onChange={(event) => setScenarioKey(event.target.value)}
              aria-label="Scenario"
            >
              <option value="">Scenario</option>
              {scenarios?.map((scenario) => (
                <option key={scenario.scenarioKey} value={scenario.scenarioKey}>
                  {scenario.title}
                </option>
              ))}
            </select>
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
                    setAutonomyMode(event.target.value as AssignmentAutonomyMode)
                  }
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publishImmediately}
                onChange={(event) => setPublishImmediately(event.target.checked)}
              />
              Publish immediately
            </label>
            <button
              className="inline-flex items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={createDisabled}
              onClick={() =>
                void createAssignment({
                  cohortId: cohortId as Id<'cohorts'>,
                  scenarioKey,
                  title,
                  published: publishImmediately,
                  autonomyMode,
                  ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
                  ...(rubricId ? { rubricId } : {}),
                  ...(budgetCapDollars
                    ? { budgetCapCents: Math.round(Number(budgetCapDollars) * 100) }
                    : {}),
                  hideAiReasoning,
                }).then(() => {
                  setTitle('')
                  setDueAt('')
                  setScenarioKey('')
                  setPublishImmediately(false)
                })
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {publishImmediately ? 'Create and publish' : 'Create draft'}
            </button>
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Invite collaborators</h2>
          <div className="mt-3 grid gap-2">
            <input
              className="rounded border border-slate-300 px-3 py-2"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="account@example.edu"
            />
            <select
              className="rounded border border-slate-300 px-3 py-2"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as InviteRole)}
              aria-label="Invite role"
            >
              <option value="learner">Learner</option>
              <option value="instructor">Instructor</option>
            </select>
            <button
              className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={!inviteEmail || !cohort}
              onClick={() =>
                cohort
                  ? void inviteMembers({
                      institutionId: cohort.institutionId,
                      cohortId: cohortId as Id<'cohorts'>,
                      invites: [{ email: inviteEmail, role: inviteRole }],
                    }).then((result) => {
                      setInviteToken(result[0]?.token ?? '')
                      setInviteEmail('')
                    })
                  : undefined
              }
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create invite
            </button>
            {inviteToken ? (
              <p className="break-all rounded bg-slate-100 p-2 text-xs">{inviteToken}</p>
            ) : null}
          </div>
        </div>
      </section>
      <section className="mb-5 rounded border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 p-4">
          <Users className="h-4 w-4" aria-hidden="true" />
          <h2 className="font-semibold">Roster</h2>
        </div>
        {roster?.length === 0 ? <EmptyState>No members yet.</EmptyState> : null}
        <div className="divide-y divide-slate-100">
          {roster?.map((member) => (
            <div
              key={member.userId}
              className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_160px_160px]"
            >
              <p className="font-medium">{member.displayName}</p>
              <p className="text-slate-600">{member.cohortRole}</p>
              <p className="text-slate-600">{member.accountRole}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-3">
        {activeAssignments?.length === 0 ? <EmptyState>No assignments yet.</EmptyState> : null}
        {activeAssignments?.map((assignment) => (
          <Link
            key={assignment.id}
            to="/instructor/assignments/$assignmentId"
            params={{ assignmentId: assignment.id }}
            className="rounded border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <h2 className="font-semibold">{assignment.title}</h2>
            <p className="text-sm text-slate-600">
              {assignment.published ? 'Published' : 'Draft'} / {assignment.autonomyMode ?? 'paused'}
            </p>
            <p className="text-sm text-slate-600">{assignment.dueAt ?? 'No due date'}</p>
          </Link>
        ))}
      </div>
    </AppFrame>
  )
}
