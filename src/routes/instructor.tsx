import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/instructor')({ component: InstructorHome })

function InstructorHome() {
  const cohorts = useQuery(api.cohorts.listMine, {})
  const institutions = useQuery(api.cohorts.listInstitutions, {})
  const createCohort = useMutation(api.cohorts.createCohort)
  const [title, setTitle] = useState('')
  const [institutionId, setInstitutionId] = useState('')

  return (
    <AppFrame title="Instructor Dashboard">
      <section className="mb-5 rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Create cohort</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <select
            className="rounded border border-slate-300 px-3 py-2"
            value={institutionId}
            onChange={(event) => setInstitutionId(event.target.value)}
            aria-label="Institution"
          >
            <option value="">Institution</option>
            {institutions?.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name}
              </option>
            ))}
          </select>
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Cohort title"
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!institutionId || !title}
            onClick={() =>
              void createCohort({
                institutionId: institutionId as Id<'institutions'>,
                title,
                term: 'GA v1',
                startsAt: new Date().toISOString(),
                endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120).toISOString(),
              }).then(() => setTitle(''))
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create
          </button>
        </div>
      </section>
      <div className="grid gap-3">
        {cohorts?.length === 0 ? <EmptyState>No cohorts available.</EmptyState> : null}
        {cohorts?.map((cohort) => (
          <Link
            key={cohort.id}
            to="/instructor/cohorts/$cohortId"
            params={{ cohortId: cohort.id }}
            className="rounded border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <p className="text-xs uppercase text-slate-500">{cohort.institutionName}</p>
            <h2 className="mt-1 font-semibold">{cohort.title}</h2>
            <p className="text-sm text-slate-600">{cohort.term} / {cohort.role}</p>
          </Link>
        ))}
      </div>
    </AppFrame>
  )
}
