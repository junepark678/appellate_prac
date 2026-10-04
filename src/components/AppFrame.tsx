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

import { Link, useRouterState } from '@tanstack/react-router'
import {
  ClerkLoaded,
  ClerkLoading,
  SignInButton,
  SignOutButton,
  UserButton,
  useUser,
} from '@clerk/tanstack-react-start'
import { type ReactNode } from 'react'
import {
  BookOpen,
  Database,
  GraduationCap,
  Library,
  LogOut,
  Shield,
} from 'lucide-react'

import { useOrganizationContext } from './OrganizationContext'

export function AppFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const { isSignedIn } = useUser()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const organizationContext = useOrganizationContext()
  const requiresOrganization =
    pathname === '/app' ||
    pathname.startsWith('/app/') ||
    pathname === '/instructor' ||
    pathname.startsWith('/instructor/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  const organizationReady = organizationContext.status === 'ready'
  const canShowChildren = !requiresOrganization || organizationReady
  const visibleTitle = canShowChildren
    ? title
    : organizationContext.status === 'loading'
      ? 'Workspace'
      : 'Organization unavailable'

  return (
    <main className="min-h-screen bg-stone-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link
            to="/app"
            search={(previous) =>
              organizationContext.organizationId
                ? {
                    ...previous,
                    organizationId: organizationContext.organizationId,
                  }
                : previous
            }
            className="text-sm font-semibold"
          >
            Appellate Practice Simulator
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {organizationReady ? (
              <Link
                to="/app"
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
                search={(previous) =>
                  organizationContext.organizationId
                    ? {
                        ...previous,
                        organizationId: organizationContext.organizationId,
                      }
                    : previous
                }
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Study
              </Link>
            ) : (
              <span
                role="link"
                aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-1 rounded px-2 py-1 text-slate-400"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Study
              </span>
            )}
            {organizationReady && organizationContext.capabilities.teach ? (
              <Link
                to="/instructor"
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
                search={(previous) =>
                  organizationContext.organizationId
                    ? {
                        ...previous,
                        organizationId: organizationContext.organizationId,
                      }
                    : previous
                }
              >
                <GraduationCap className="h-4 w-4" aria-hidden="true" />
                Courses
              </Link>
            ) : null}
            {organizationReady &&
            organizationContext.capabilities.manageMembers &&
            organizationContext.organization?.kind === 'shared' ? (
              <Link
                to="/admin"
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100"
                search={(previous) =>
                  organizationContext.organizationId
                    ? {
                        ...previous,
                        organizationId: organizationContext.organizationId,
                      }
                    : previous
                }
              >
                <Shield className="h-4 w-4" aria-hidden="true" />
                Organization administration
              </Link>
            ) : null}
            <button
              type="button"
              disabled
              title="Data routes are not available yet"
              className="inline-flex cursor-not-allowed items-center gap-1 rounded px-2 py-1 text-slate-400"
            >
              <Database className="h-4 w-4" aria-hidden="true" />
              Data
            </button>
            <button
              type="button"
              disabled
              title="Catalog routes are not available yet"
              className="inline-flex cursor-not-allowed items-center gap-1 rounded px-2 py-1 text-slate-400"
            >
              <Library className="h-4 w-4" aria-hidden="true" />
              Catalog
            </button>
          </nav>
          {requiresOrganization ? (
            <div className="flex items-center gap-2">
              <label htmlFor="organization-context" className="sr-only">
                Organization
              </label>
              <select
                id="organization-context"
                aria-label="Organization"
                value={organizationContext.organizationId ?? ''}
                disabled={organizationContext.organizationsStatus !== 'ready'}
                onChange={(event) =>
                  organizationContext.selectOrganization(
                    event.target.value as NonNullable<
                      typeof organizationContext.organizationId
                    >,
                  )
                }
                className="max-w-52 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:text-slate-500"
              >
                {organizationContext.organizationId &&
                !organizationContext.organizations.some(
                  (item) =>
                    item.institutionId === organizationContext.organizationId,
                ) ? (
                  <option value={organizationContext.organizationId}>
                    {organizationContext.status === 'unavailable'
                      ? 'Organization unavailable'
                      : 'Loading organization'}
                  </option>
                ) : null}
                {!organizationContext.organizationId ? (
                  <option value="">
                    {organizationContext.organizationsStatus === 'loading'
                      ? 'Loading organizations…'
                      : 'Choose organization'}
                  </option>
                ) : null}
                {organizationContext.organizations.map((item) => (
                  <option key={item.institutionId} value={item.institutionId}>
                    {item.kind === 'personal'
                      ? 'Personal workspace'
                      : item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
        <h1 className="text-2xl font-semibold tracking-normal">
          {visibleTitle}
        </h1>
        <div className="mt-5">
          {canShowChildren ? (
            children
          ) : organizationContext.status === 'loading' ? (
            <p
              role="status"
              className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600"
            >
              Loading organization…
            </p>
          ) : (
            <div
              role="alert"
              className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            >
              {organizationContext.unavailableMessage ??
                'This organization is unavailable. Choose an organization you can access.'}
              {organizationContext.canRetryOrganizationBootstrap ? (
                <button
                  type="button"
                  onClick={organizationContext.retryOrganizationBootstrap}
                  className="ml-2 rounded border border-amber-700 px-2 py-1 font-medium hover:bg-amber-100"
                >
                  Try again
                </button>
              ) : null}
            </div>
          )}
        </div>
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
