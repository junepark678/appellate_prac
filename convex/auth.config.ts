import type { AuthConfig } from 'convex/server'

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    return 'https://first-elk-63.clerk.accounts.dev'
  }
  return value
}

export default {
  providers: [
    {
      domain: requireEnv('CLERK_JWT_ISSUER_DOMAIN'),
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
