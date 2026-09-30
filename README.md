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

## Seed Convex

Static rule packs, rule items, court packs, and bundled scenarios are seeded with
an idempotent Convex mutation:

```bash
bunx convex run --push seed:all --identity '{"tokenIdentifier":"seed:convex-cli","name":"Convex Seeder"}'
bunx convex run seed:status
```

## Deploy

Both deployment targets use Convex as the source of truth for authenticated beta
state. Deploy Convex from an explicit release job with:

```bash
bun run deploy:backend
```

Keep `CONVEX_DEPLOY_KEY` in the backend release environment rather than web-host
preview builds. Production release checks also require `SIMULATION_EVAL_SNAPSHOT_JSON`
with the latest simulation-eval result. The release scripts select `--target=web`
or `--target=backend`; a direct production check defaults to `--target=all`.

### Release environment and evidence

- Web release runner: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `CLERK_AUTHORIZED_PARTIES`, and `VITE_CONVEX_URL`
- Backend release runner: `CONVEX_DEPLOY_KEY`
- Convex runtime (configure in Convex, not the web host):
  `CLERK_JWT_ISSUER_DOMAIN`; `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` when
  enabling live AI; `COURTLISTENER_TOKEN` when enabling CourtListener

The gate checks required runner configuration is nonblank. It does not validate
credentials or inspect remote Convex runtime configuration; verify those settings
and exercise authenticated integrations before launch.

`SIMULATION_EVAL_SNAPSHOT_JSON` must contain a boolean `pass`, a non-negative
integer `criticalFailureCount`, numeric rates between 0 and 1 for `validTurnRate`,
`hallucinatedSourceRate`, and `roleAuthorityFailureRate`, and a valid UTC ISO
`createdAt` timestamp (for example `2026-09-30T04:00:00.000Z`). Missing, malformed,
non-finite, failing, future-dated, or expired evidence blocks production.
The conservative default maximum age is 24 hours, an explicit release policy
chosen for this gate; set `SIMULATION_EVAL_MAX_AGE_HOURS` to a finite positive
number to use the team's approved release window. Metric thresholds remain
unchanged. The administrator court-pack promotion action applies the same schema
and thresholds with the default 24-hour window after administrator authorization and before its existing source-review checks
can permit a promotion.

This snapshot is supplied by the release operator; the current schema does not
cryptographically attest provenance or bind it to the current commit, model,
and court-pack revision. Independently verify that the eval covers those exact
release inputs. The bundled CA4 court pack remains `beta_approved`; passing
evidence does not promote it, and production remains blocked until its reviewed
approval is recorded in the bundled pack.

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
- Feature-gated live AI procedural advancement through authenticated Convex actions.
- Feature-gated CourtListener/RECAP docket search and source import through Convex.
- Clerk authentication with signed-in simulator access and signed-out entry actions.
- Convex schema for users, rule packs, case sessions, filings, documents, docket entries, AI runs, and assessments.

## Main Files

- `src/routes/index.tsx` - primary app interface.
- `src/domain/types.ts` - jurisdiction-neutral domain model.
- `src/domain/packs.ts` - seed Fourth Circuit/FRAP court and rule packs.
- `src/domain/simulation.ts` - deterministic filing, docket, deadline, AI-tool validation engine.
- `src/integrations/openrouter.ts` - current low-level AI chat-completions adapter.
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
- Set `VITE_ENABLE_OPENROUTER=true`, plus Convex env vars `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, to enable live AI events through the configured chat-completions provider.
- Set `VITE_ENABLE_COURTLISTENER=true`, plus Convex env var `COURTLISTENER_TOKEN`, to enable live CourtListener requests.
- Keep AI-generated procedural actions behind `validateToolCall` before writing any docket entry.

## License

Appellate Practice Simulator: Copyright (C) 2026 Rhajune Park.

The project-authored software is free software licensed under the
[GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.en.html),
either version 3 of the License, or (at your option) any later version
(`AGPL-3.0-or-later`). See [LICENSE](LICENSE) for the complete terms.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.

Third-party dependencies and independently sourced legal materials retain their
respective rights and notices. The program copyright above does not replace
those notices or the Free Software Foundation's copyright in the license text.

Before deploying a modified version for remote users, review section 13 of the
license and provide those users an appropriate way to obtain the Corresponding
Source for the version they use. A private repository link alone does not provide
source access to users who cannot access that repository.
