import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'

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
  const context = useQuery(api.instructor.getReviewContext, {
    caseSessionId: caseSessionId as Id<'caseSessions'>,
  })
  const [note, setNote] = useState('')
  const [score, setScore] = useState('')
  const review = useMutation(api.instructor.reviewAssignmentSession)

  useEffect(() => {
    if (!context) return
    setNote(context.instructorNote ?? '')
    setScore(typeof context.score === 'number' ? String(context.score) : '')
  }, [context])

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
          <h2 className="font-semibold">Review</h2>
          {context === null ? <EmptyState>Assignment session not found.</EmptyState> : null}
          {context ? (
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="font-medium">Learner</dt>
                <dd className="text-slate-600">{context.accountName}</dd>
              </div>
              <div>
                <dt className="font-medium">Assignment</dt>
                <dd className="text-slate-600">{context.assignmentTitle}</dd>
              </div>
              <div>
                <dt className="font-medium">Status</dt>
                <dd className="text-slate-600">{context.status.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt className="font-medium">Submitted</dt>
                <dd className="text-slate-600">{context.submittedAt ?? 'Not submitted'}</dd>
              </div>
            </dl>
          ) : null}
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
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!context || !note}
            onClick={() =>
              context
                ? void review({
                    assignmentSessionId: context.assignmentSessionId,
                    instructorNote: note,
                    ...(score ? { score: Number(score) } : {}),
                  })
                : undefined
            }
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save review
          </button>
          {context ? (
            <Link
              to="/instructor/assignments/$assignmentId"
              params={{ assignmentId: context.assignmentId }}
              className="mt-2 inline-flex w-full items-center justify-center rounded border border-slate-300 px-3 py-2 text-sm font-medium"
            >
              Back to assignment
            </Link>
          ) : null}
        </aside>
      </section>
    </AppFrame>
  )
}
