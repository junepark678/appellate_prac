import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createStart } from '@tanstack/react-start'

function commaSeparatedEnv(name: string) {
  return process.env[name]?.split(',').map((value) => value.trim()).filter(Boolean)
}

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [
      clerkMiddleware({
        publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
        secretKey: process.env.CLERK_SECRET_KEY,
        signInUrl: process.env.CLERK_SIGN_IN_URL,
        signUpUrl: process.env.CLERK_SIGN_UP_URL,
        signInFallbackRedirectUrl: process.env.CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
        signUpFallbackRedirectUrl: process.env.CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
        authorizedParties: commaSeparatedEnv('CLERK_AUTHORIZED_PARTIES'),
      }),
    ],
  }
})
