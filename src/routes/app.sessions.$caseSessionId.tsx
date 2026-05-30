import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/app/sessions/$caseSessionId')({
  component: SessionView,
})

function SessionView() {
  const { caseSessionId } = Route.useParams()
  const session = useQuery(api.caseSessions.getForCurrentUser, {
    caseSessionId: caseSessionId as Id<'caseSessions'>,
  })

  if (session === undefined) return <AppFrame title="Session">Loading</AppFrame>
  if (session === null) {
    return (
      <AppFrame title="Session">
        <EmptyState>Session not found.</EmptyState>
      </AppFrame>
    )
  }

  return (
    <AppFrame title={session.scenario.shortCaption}>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Appeals Docket</h2>
          <ol className="mt-3 divide-y divide-slate-100">
            {session.docketEntries.map((entry) => (
              <li key={entry.id} className="py-3 text-sm">
                <div className="flex justify-between gap-4">
                  <strong>#{entry.entryNumber} {entry.title}</strong>
                  <span className="text-slate-500">{entry.filedAt.slice(0, 10)}</span>
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
              {session.filings.length === 0 ? <li className="text-slate-500">None yet</li> : null}
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
  )
}
