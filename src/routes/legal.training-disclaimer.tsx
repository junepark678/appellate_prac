import { createFileRoute } from '@tanstack/react-router'

import { AppFrame } from '../components/AppFrame'

export const Route = createFileRoute('/legal/training-disclaimer')({
  component: TrainingDisclaimer,
})

function TrainingDisclaimer() {
  return (
    <AppFrame title="Training Disclaimer">
      <article className="prose max-w-none rounded border border-slate-200 bg-white p-6">
        <p>
          This simulator is limited to Fourth Circuit and federal appellate
          practice training. It is not legal advice, does not form an
          attorney-client relationship, and must not be used for live client
          matters.
        </p>
        <p>
          AI-generated actions remain subject to deterministic validation before
          docket state changes, and instructors control assignment autonomy
          settings.
        </p>
      </article>
    </AppFrame>
  )
}
