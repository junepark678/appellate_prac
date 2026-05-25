import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/instructor/sessions/$caseSessionId/review')({
  component: ReviewSession,
})

function ReviewSession() {
  const { caseSessionId } = Route.useParams()
  const replay = useQuery(api.instructor.getSessionReplay, {
    caseSessionId: caseSessionId as Id<'caseSessions'>,
  })
  const [assignmentSessionId, setAssignmentSessionId] = useState('')
  const [note, setNote] = useState('')
  const [score, setScore] = useState('')
  const review = useMutation(api.instructor.reviewAssignmentSession)

  return (
    <AppFrame title="Session Review">
      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Replay</h2>
          {replay?.length === 0 ? <EmptyState>No events recorded.</EmptyState> : null}
          <ol className="mt-3 divide-y divide-slate-100">
            {replay?.map((event) => (
              <li key={event.sequence} className="py-3 text-sm">
                <div className="flex justify-between gap-4">
                  <strong>{event.sequence}. {event.eventType}</strong>
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
          <h2 className="font-semibold">Review note</h2>
          <input
            className="mt-3 w-full rounded border border-slate-300 px-3 py-2"
            value={assignmentSessionId}
            onChange={(event) => setAssignmentSessionId(event.target.value)}
            placeholder="Assignment session id"
          />
          <input
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            placeholder="Score"
          />
          <textarea
            className="mt-2 h-32 w-full rounded border border-slate-300 p-3"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Instructor note"
          />
          <button
            className="mt-2 w-full rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!assignmentSessionId || !note}
            onClick={() =>
              void review({
                assignmentSessionId: assignmentSessionId as Id<'assignmentSessions'>,
                instructorNote: note,
                ...(score ? { score: Number(score) } : {}),
              })
            }
          >
            Save review
          </button>
        </aside>
      </section>
    </AppFrame>
  )
}
