import { createFileRoute } from '@tanstack/react-router'

import { AppFrame } from '../components/AppFrame'

export const Route = createFileRoute('/legal/terms')({ component: Terms })

function Terms() {
  return (
    <AppFrame title="Terms of Use">
      <article className="prose max-w-none rounded border border-slate-200 bg-white p-6">
        <p>
          Access is limited to authorized institutional courses and support
          operations. The product supports appellate practice education and does
          not provide legal advice or live case assistance.
        </p>
        <p>
          Users must follow course policies, upload only permitted training
          materials, and use export features for institutional assessment only.
        </p>
      </article>
    </AppFrame>
  )
}
