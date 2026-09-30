/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Link } from '@tanstack/react-router'
import {
  ClerkLoaded,
  ClerkLoading,
  SignInButton,
  SignOutButton,
  UserButton,
  useUser,
} from '@clerk/tanstack-react-start'
import { useConvexAuth, useMutation } from 'convex/react'
import { useEffect, type ReactNode } from 'react'
import { BookOpen, GraduationCap, LogOut, Shield } from 'lucide-react'

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
              Practice
            </Link>
            <Link
              to="/instructor"
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
            >
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Courses
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
              <div className="flex items-center gap-2">
                <UserButton />
                <SignOutButton redirectUrl="/">
                  <button
                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100"
                    type="button"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Log out
                  </button>
                </SignOutButton>
              </div>
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
