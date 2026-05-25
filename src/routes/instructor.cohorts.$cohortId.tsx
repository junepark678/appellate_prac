import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/instructor/cohorts/$cohortId')({
  component: CohortDetail,
})

function CohortDetail() {
  const { cohortId } = Route.useParams()
  const assignments = useQuery(api.assignments.listForCohort, {
    cohortId: cohortId as Id<'cohorts'>,
  })
  const scenarios = useQuery(api.scenarios.listPublishedRecords, {})
  const createAssignment = useMutation(api.assignments.create)
  const inviteMembers = useMutation(api.cohorts.inviteMembers)
  const cohorts = useQuery(api.cohorts.listMine, {})
  const cohort = cohorts?.find((candidate) => candidate.id === cohortId)
  const [title, setTitle] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteToken, setInviteToken] = useState('')

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
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
              aria-label="Scenario"
            >
              <option value="">Scenario</option>
              {scenarios?.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
            <button
              className="inline-flex items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!title || !scenarioId}
              onClick={() =>
                void createAssignment({
                  cohortId: cohortId as Id<'cohorts'>,
                  scenarioId: scenarioId as Id<'scenarios'>,
                  title,
                  published: false,
                  autonomyMode: 'paused',
                  hideAiReasoning: true,
                }).then(() => setTitle(''))
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create draft
            </button>
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Invite learner</h2>
          <div className="mt-3 grid gap-2">
            <input
              className="rounded border border-slate-300 px-3 py-2"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="student@example.edu"
            />
            <button
              className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={!inviteEmail || !cohort}
              onClick={() =>
                cohort
                  ? void inviteMembers({
                      institutionId: cohort.institutionId,
                      cohortId: cohortId as Id<'cohorts'>,
                      invites: [{ email: inviteEmail, role: 'learner' }],
                    }).then((result) => setInviteToken(result[0]?.token ?? ''))
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
      <div className="grid gap-3">
        {assignments?.length === 0 ? <EmptyState>No assignments yet.</EmptyState> : null}
        {assignments?.map((assignment) => (
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
          </Link>
        ))}
      </div>
    </AppFrame>
  )
}
