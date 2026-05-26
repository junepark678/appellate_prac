import {
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { ClerkProvider } from '@clerk/tanstack-react-start'
import { useAuth } from '@clerk/tanstack-react-start'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { lazy, Suspense, type ReactNode } from 'react'

import appCss from '../styles.css?url'
import { convex } from '../convex'

const AppDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('../components/devtools/AppDevtools').then((module) => ({
        default: module.AppDevtools,
      })),
    )
  : null

import { RouteErrorBoundary } from '../components/RouteErrorBoundary'

export const Route = createRootRoute({
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
            {children}
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
