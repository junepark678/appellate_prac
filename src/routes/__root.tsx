import {
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { ClerkProvider } from '@clerk/tanstack-react-start'
import { useAuth } from '@clerk/tanstack-react-start'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import type { ReactNode } from 'react'

import appCss from '../styles.css?url'
import { convex } from '../convex'

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
            <TanStackDevtools
              config={{
                position: 'bottom-right',
              }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          </ConvexProviderWithClerk>
        </ClerkProvider>
        <Scripts />
      </body>
    </html>
  )
}
