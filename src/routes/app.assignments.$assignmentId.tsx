import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Play, Send } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/app/assignments/$assignmentId')({
  component: AssignmentDetail,
})

function AssignmentDetail() {
  const { assignmentId } = Route.useParams()
  const assignment = useQuery(api.assignments.get, {
    assignmentId: assignmentId as Id<'assignments'>,
  })
  const startSession = useMutation(api.assignments.startSession)
  const submitSession = useMutation(api.assignments.submitSession)

  if (assignment === undefined) return <AppFrame title="Assignment">Loading</AppFrame>
  if (assignment === null) {
    return (
      <AppFrame title="Assignment">
        <EmptyState>Assignment not found.</EmptyState>
      </AppFrame>
    )
  }

  return (
    <AppFrame title={assignment.title}>
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{assignment.scenarioTitle}</p>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="font-medium">Due</dt>
              <dd className="text-slate-600">{assignment.dueAt ?? 'No due date'}</dd>
            </div>
            <div>
              <dt className="font-medium">Autonomy</dt>
              <dd className="text-slate-600">{assignment.autonomyMode ?? 'paused'}</dd>
            </div>
            <div>
              <dt className="font-medium">Status</dt>
              <dd className="text-slate-600">{assignment.status.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt className="font-medium">AI budget cap</dt>
              <dd className="text-slate-600">
                {typeof assignment.budgetCapCents === 'number'
                  ? `$${(assignment.budgetCapCents / 100).toFixed(2)}`
                  : 'Default'}
              </dd>
            </div>
          </dl>
        </div>
        <aside className="rounded border border-slate-200 bg-white p-4">
          {assignment.caseSessionId ? (
            <div className="grid gap-2">
              <Link
                to="/app/sessions/$caseSessionId"
                params={{ caseSessionId: assignment.caseSessionId }}
                className="inline-flex items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Open session
              </Link>
              <button
                disabled={assignment.status === 'submitted' || assignment.status === 'reviewed'}
                className="inline-flex items-center justify-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() =>
                  assignment.caseSessionId
                    ? void submitSession({
                        assignmentId: assignment.id as Id<'assignments'>,
                        caseSessionId: assignment.caseSessionId,
                      })
                    : undefined
                }
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Submit
              </button>
            </div>
          ) : (
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white"
              onClick={() =>
                void startSession({ assignmentId: assignment.id as Id<'assignments'> })
              }
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Start session
            </button>
          )}
          {assignment.instructorNote ? (
            <p className="mt-4 text-sm text-slate-700">{assignment.instructorNote}</p>
          ) : null}
        </aside>
      </section>
    </AppFrame>
  )
}
