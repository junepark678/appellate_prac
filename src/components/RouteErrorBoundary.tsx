import { Link } from '@tanstack/react-router'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'

export function RouteErrorBoundary({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  const isDev = import.meta.env.DEV

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 text-slate-950">
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-8 w-8 text-red-600" aria-hidden="true" />
        </div>

        <h1 className="text-2xl font-semibold tracking-normal">
          Something went wrong
        </h1>

        <p className="mt-3 text-sm text-slate-600">
          {isDev
            ? error.message || 'An unexpected error occurred.'
            : 'An unexpected error occurred. Please try again or return to the home page.'}
        </p>

        {isDev && error.stack && (
          <pre className="mt-4 max-h-64 overflow-auto rounded border border-slate-200 bg-white p-4 text-left text-xs text-red-700">
            {error.stack}
          </pre>
        )}

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try Again
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-950 hover:bg-slate-100"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Go Home
          </Link>
        </div>
      </div>
    </main>
  )
}
