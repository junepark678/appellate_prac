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

import {
  HeadContent,
  Scripts,
  createRootRoute,
  retainSearchParams,
} from '@tanstack/react-router'
import { ClerkProvider } from '@clerk/tanstack-react-start'
import { useAuth } from '@clerk/tanstack-react-start'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { lazy, Suspense, type ReactNode } from 'react'

import appCss from '../styles.css?url'
import { convex } from '../convex'
import { OrganizationContextProvider } from '../components/OrganizationContext'

const AppDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('../components/devtools/AppDevtools').then((module) => ({
        default: module.AppDevtools,
      })),
    )
  : null

import { RouteErrorBoundary } from '../components/RouteErrorBoundary'

export const Route = createRootRoute({
  search: {
    middlewares: [retainSearchParams(['organizationId'])],
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Appellate Practice Simulator',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  errorComponent: RouteErrorBoundary,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClerkProvider>
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            <OrganizationContextProvider>{children}</OrganizationContextProvider>
            {AppDevtools ? (
              <Suspense fallback={null}>
                <AppDevtools />
              </Suspense>
            ) : null}
          </ConvexProviderWithClerk>
        </ClerkProvider>
        <Scripts />
      </body>
    </html>
  )
}
