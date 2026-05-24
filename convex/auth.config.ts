import type { AuthConfig } from 'convex/server'

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be configured in Convex before auth can start`)
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
