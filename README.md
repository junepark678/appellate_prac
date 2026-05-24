# Appellate Practice Simulator

TanStack Start prototype for practicing federal appellate procedure through a simulated e-filing and docket system.

## Run

```bash
bun install
cp .env.example .env
bun run dev:convex
bun run dev
```

The dev server defaults to `http://localhost:3000`.
Fill `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env` with real keys from
the Clerk dashboard. Production deployments should use `pk_live...` and
`sk_live...` values in the host environment. Without configured keys, Clerk can
run local development in keyless mode and prompt you to claim generated keys.
Set `VITE_CONVEX_URL` to the local or hosted Convex deployment URL. The app fails
fast when this is missing.

## Verify

```bash
bun run typecheck
bun run test
bun run build
```

## Deploy

Both deployment targets use Convex as the source of truth for authenticated beta
state. Set `CONVEX_DEPLOY_KEY` in the host environment so release scripts can run
`convex deploy` before the web build.

### Vercel

Use `vercel.json` as committed. The build command runs:

```bash
DEPLOY_TARGET=vercel bun run release:vercel
```

Set Vercel env vars from `.env.example`, including `VITE_CONVEX_URL`,
Clerk production keys, `CLERK_AUTHORIZED_PARTIES`, and feature flags.

### Cloudflare Workers

Use `wrangler.jsonc` as committed. The release command runs:

```bash
DEPLOY_TARGET=cloudflare bun run release:cloudflare
```

Set the same app env vars in Cloudflare Workers. Keep Convex service secrets in
Convex deployment env vars, not in client-visible `VITE_` variables.

## What Is Implemented

- Fourth Circuit federal civil-appeal MVP.
- Jurisdiction-neutral core types for future state courts and trial courts.
- Versioned rule-pack model for FRAP, local rules, and future overlays.
- Strict filing validation with clerk deficiency and rejection behavior.
- PDF upload metadata handling in the browser.
- Persisted signed-in sessions backed by Convex.
- Manual “next expected document” simulator advancement through Convex mutations.
- Feature-gated OpenRouter procedural advancement through authenticated Convex actions.
- Feature-gated CourtListener/RECAP docket search and source import through Convex.
- Clerk authentication with signed-in simulator access and signed-out entry actions.
- Convex schema for users, rule packs, case sessions, filings, documents, docket entries, AI runs, and assessments.

## Main Files

- `src/routes/index.tsx` - primary app interface.
- `src/domain/types.ts` - jurisdiction-neutral domain model.
- `src/domain/packs.ts` - seed Fourth Circuit/FRAP court and rule packs.
- `src/domain/simulation.ts` - deterministic filing, docket, deadline, AI-tool validation engine.
- `src/integrations/openrouter.ts` - low-level OpenRouter tool-call adapter.
- `src/integrations/courtlistener.ts` - low-level CourtListener/RECAP search adapter.
- `convex/integrations.ts` - authenticated Convex actions for live integrations.
- `convex/auth.config.ts` - Clerk JWT provider configuration for Convex.
- `src/start.ts` - Clerk request middleware for TanStack Start.
- `convex/schema.ts` - Convex persistence schema.

## Integration Notes

To connect live services:

- Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from `.env.example` for real Clerk authentication.
- Create a Clerk JWT template named `convex` with audience `convex`, then set `CLERK_JWT_ISSUER_DOMAIN` in Convex.
- Set `VITE_CONVEX_URL` for the React app.
- Set `VITE_ENABLE_OPENROUTER=true`, plus Convex env vars `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, to enable the OpenRouter event button.
- Set `VITE_ENABLE_COURTLISTENER=true`, plus Convex env var `COURTLISTENER_TOKEN`, to enable live CourtListener requests.
- Keep AI-generated procedural actions behind `validateToolCall` before writing any docket entry.
