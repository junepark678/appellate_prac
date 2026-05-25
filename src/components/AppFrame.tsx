import { Link } from '@tanstack/react-router'
import {
  ClerkLoaded,
  ClerkLoading,
  SignInButton,
  UserButton,
  useUser,
} from '@clerk/tanstack-react-start'
import { useConvexAuth, useMutation } from 'convex/react'
import { useEffect, type ReactNode } from 'react'
import { BookOpen, GraduationCap, Shield } from 'lucide-react'

import { api } from '../../convex/_generated/api'

export function AppFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const { isSignedIn } = useUser()
  const convexAuth = useConvexAuth()
  const upsertCurrentUser = useMutation(api.users.upsertCurrentUser)

  useEffect(() => {
    if (isSignedIn && convexAuth.isAuthenticated) {
      void upsertCurrentUser({})
    }
  }, [convexAuth.isAuthenticated, isSignedIn, upsertCurrentUser])

  return (
    <main className="min-h-screen bg-stone-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/app" className="text-sm font-semibold">
            Appellate Practice Simulator
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/app"
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Learner
            </Link>
            <Link
              to="/instructor"
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
            >
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Instructor
            </Link>
            <Link
              to="/admin"
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
            >
              <Shield className="h-4 w-4" aria-hidden="true" />
              Admin
            </Link>
          </nav>
          <ClerkLoading>
            <span className="text-sm text-slate-500">Loading</span>
          </ClerkLoading>
          <ClerkLoaded>
            {isSignedIn ? (
              <UserButton />
            ) : (
              <SignInButton mode="modal">
                <button className="rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white">
                  Sign in
                </button>
              </SignInButton>
            )}
          </ClerkLoaded>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
        <div className="mt-5">{children}</div>
      </section>
    </main>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
      {children}
    </div>
  )
}
