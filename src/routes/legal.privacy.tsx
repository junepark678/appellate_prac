import { createFileRoute } from '@tanstack/react-router'

import { AppFrame } from '../components/AppFrame'

export const Route = createFileRoute('/legal/privacy')({ component: Privacy })

function Privacy() {
  return (
    <AppFrame title="Privacy Notice">
      <article className="prose max-w-none rounded border border-slate-200 bg-white p-6">
        <p>
          The simulator is an institutional training product. Student uploads,
          filings, notes, receipts, and assessment records are treated as
          education records and scoped to the learner's institution and cohort.
        </p>
        <p>
          Support access is time-bound, purpose-limited, and audited. AI and
          CourtListener integrations are disabled unless configured and enabled
          by an administrator.
        </p>
      </article>
    </AppFrame>
  )
}
