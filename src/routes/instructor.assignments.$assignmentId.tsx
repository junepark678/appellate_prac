import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Archive, CheckCircle2, RotateCcw } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/instructor/assignments/$assignmentId')({
  component: InstructorAssignment,
})

function InstructorAssignment() {
  const { assignmentId } = Route.useParams()
  const assignment = useQuery(api.assignments.get, {
    assignmentId: assignmentId as Id<'assignments'>,
  })
  const sessions = useQuery(api.instructor.listAssignmentSessions, {
    assignmentId: assignmentId as Id<'assignments'>,
  })
  const csv = useQuery(api.instructor.exportAssignmentCsv, {
    assignmentId: assignmentId as Id<'assignments'>,
  })
  const publish = useMutation(api.assignments.publish)
  const archive = useMutation(api.assignments.archive)
  const reopen = useMutation(api.assignments.reopenSession)

  return (
    <AppFrame title={assignment?.title ?? 'Assignment'}>
      <section className="mb-5 flex flex-wrap gap-2 rounded border border-slate-200 bg-white p-4">
        <button
          className="inline-flex items-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white"
          onClick={() => void publish({ assignmentId: assignmentId as Id<'assignments'> })}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Publish
        </button>
        <button
          className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium"
          onClick={() => void archive({ assignmentId: assignmentId as Id<'assignments'> })}
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
          Archive
        </button>
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-semibold">Submissions</h2>
        </div>
        {sessions?.length === 0 ? <EmptyState>No started sessions.</EmptyState> : null}
        <div className="divide-y divide-slate-100">
          {sessions?.map((session) => (
            <div key={session.assignmentSessionId} className="grid gap-3 p-4 md:grid-cols-5">
              <div className="md:col-span-2">
                <p className="font-medium">{session.accountName}</p>
                <p className="text-sm text-slate-600">{session.status}</p>
              </div>
              <p className="text-sm text-slate-600">{session.submittedAt ?? 'Not submitted'}</p>
              <p className="text-sm text-slate-600">
                {typeof session.score === 'number' ? session.score : 'No score'}
              </p>
              <div className="flex gap-2 md:justify-end">
                <Link
                  to="/instructor/sessions/$caseSessionId/review"
                  params={{ caseSessionId: session.caseSessionId }}
                  className="rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white"
                >
                  Review
                </Link>
                <button
                  className="rounded border border-slate-300 p-2"
                  aria-label="Reopen session"
                  onClick={() =>
                    void reopen({ assignmentSessionId: session.assignmentSessionId })
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
  )
}
