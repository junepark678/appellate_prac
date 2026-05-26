# Appellate-Prac — Unified Code Review Report

**Review date:** May 26, 2026
**Repository root:** /home/june/.t3/worktrees/appellate_prac/t3code-778f7fa7
**Source files reviewed:** 112 TypeScript/TSX source files (across ~4,974 total files in repo)
**Review methodology:** 22 specialized subagents + reconciliation agent
**Stack:** Convex (backend/database), TanStack Start (React Router + SSR), Clerk (auth), Tailwind v4 (CSS), Vite (build), dual-deploy Vercel + Cloudflare. TypeScript 6.0.2 strict mode.

---

## 1. Executive Summary

The Appellate-Prac codebase is ambitious in scope — a full-featured federal appellate simulation platform with AI-generated actor work products, an ECF filing workflow, panel deliberation mechanics, and a constraint-based evaluation engine. The architecture is sensibly layered (domain model, Convex backend, TanStack frontend), and the use of Convex for real-time state synchronization with a React SSR shell is a solid technical fit for a classroom simulation tool. The codebase shows evidence of careful design in the domain model, particularly around the constraint catalog, actor state machines, and filing workflow.

However, the project carries significant production risk. The most critical finding is **zero backend test coverage** — all 12 test files in the repository exercise only frontend logic. The simulation engine (`convex/` mutations/queries), constraint evaluator, ECF filing state machine, panel deliberation, and merit review logic have no automated tests whatsoever. This is compounded by a non-cryptographic hash used in auth-adjacent code, an inconsistent error-handling architecture that mixes multiple patterns, and an absence of timeouts, circuit-breakers, or fallbacks for AI provider calls that could stall an entire classroom session. There is no error monitoring, no logging framework, and no observability infrastructure.

Three files exceed healthy size limits: `src/routes/index.tsx` (2,677 lines), `src/domain/packs.ts` (2,553 lines), and `convex/validators.ts` (1,125 lines). Validation patterns are inconsistently applied across backend handlers. The simulation engine is tightly coupled to Convex data access, making it impossible to unit-test without a live database.

The overall risk profile is **HIGH** — the codebase is functional and well-designed in concept but lacks the testing, error handling, observability, and safety mechanisms required for production deployment in a classroom setting where dozens of concurrent students depend on reliability.

---

## 2. Critical Issues (5 findings)

### C1. Non-cryptographic hash used for session-sensitive data

**Severity:** HIGH
**File:** `convex/authz.ts:17`

`simpleHash()` implements a trivial string-manipulation hash (character code arithmetic, no avalanche, no collision resistance, no preimage resistance). It appears in a module dealing with authorization and session token handling. This is unsuitable for any security-related purpose.

**Impact:** If this hash is used for session identification, token validation, or any auth decision, it is trivially forgeable. An attacker who observes one hash value can craft collisions or reverse-engineer the input.

**Recommendation:** Determine the actual purpose of this hash. If it's a deterministic ID generator for non-security use, rename it (for example, `toDeterministicId`), add a clear comment stating it is not cryptographic, and ensure it never crosses an auth boundary. If session handling is the actual need, replace it with Convex's built-in auth primitives or Web Crypto-based approach.

### C2. No Convex backend tests (zero coverage for server-side logic)

**Severity:** CRITICAL
**Location:** Entire `convex/` directory — 0 test files

All 12 test files in the repository are frontend Vitest tests under `src/`. The following have zero test coverage:

- All Convex mutations and queries (case lifecycle, filing, actor generation, scoring)
- Simulation engine state machine
- Constraint evaluation and validation
- ECF filing workflow orchestration
- Panel deliberation logic
- Merit review scoring
- Auth/authorization logic
- Seed data generation

**Impact:** This is the single largest risk factor. Regression bugs in backend logic are undetectable without manual testing. The simulation engine, constraint rules, and filing workflow are the product’s core and are untested.

**Recommendation:** Add Convex integration tests for:

- case session lifecycle (create → run → complete)
- ECF filing submission workflow end-to-end
- constraint rule evaluation with known inputs/outputs
- actor work product orchestration

Aim for a substantial backend test suite in the first pass and run it in CI.

### C3. Inconsistent error handling architecture across backend

**Severity:** HIGH
**Location:** Across all `convex/` files

At least five patterns coexist:

1. Return `null` on failure
2. Throw `ConvexError`
3. Return `Result` unions
4. Throw untyped errors
5. Let errors propagate silently

This makes frontend error handling unpredictable and debugging difficult.

**Impact:** Inconsistent error shapes cause brittle UI error handling, missed errors, and uneven resilience across endpoints.

**Recommendation:** Adopt one pattern across all `convex/` functions. Prefer `ConvexError` for expected failures with structured error codes and add a shared error wrapper to standardize shape/logging.

### C4. No timeout guards, circuit-breakers, or fallbacks for AI provider calls

**Severity:** HIGH
**Location:** Actor work product generation calls to OpenAI/Anthropic

AI provider calls have no timeout, no circuit breaker, and no fallback. If a provider degrades, a single call can block an entire classroom simulation.

**Impact:** Simulations can stall indefinitely on external API outages.

**Recommendation:** Add hard timeouts (around 30s), implement provider circuit-breakers with exponential backoff, and provide a degraded mode fallback using template output when providers are unavailable.

### C5. No error tracking, monitoring, or observability infrastructure

**Severity:** MEDIUM (elevated to HIGH in production)
**Location:** Across system

No Sentry, OpenTelemetry, or equivalent integration was found. Logging relies on ad-hoc `console` statements.

**Impact:** Failures are hard to diagnose in production; no root-cause tracing.

**Recommendation:** Add Sentry (frontend + Convex), structured logging with request IDs, and tracing instrumentation.

---

## 3. Warnings (13 findings)

### W1. Three files exceed healthy size limits and need decomposition

**Files:**

- `src/routes/index.tsx` (2,677 lines)
- `src/domain/packs.ts` (2,553 lines)
- `convex/validators.ts` (1,125 lines)

**Recommendation:** split routes per top-level route, split pack definitions from instantiation logic, and split validators by domain.

### W2. Inconsistent validation patterns across the backend

**Files:** multiple `convex/` handlers, `convex/validators.ts`

**Impact:** Malformed payloads can reach handlers; data integrity risk.

**Recommendation:** enforce one validation pattern and require validator usage across all mutations/queries.

### W3. No environment-specific configuration or staging environment

**Files:** `convex/seed.ts` and deployment configs

Court/judge data is hardcoded and no environment-aware seeding exists.

**Recommendation:** externalize seed/reference data, add staging-parity deploy flow.

### W4. Large schema file with potential normalization gaps

**File:** `convex/schema.ts` (895 lines)

**Impact:** possible missing compound indexes and polymorphism complexity for `actorWorkProducts`.

**Recommendation:** review query patterns and add indexes; consider clearer polymorphic work product modeling.

### W5. Dead code and unused fields in domain types

**Files:** `src/domain/types.ts`, `src/domain/rules/constraint-catalog.ts`

**Recommendation:** remove unused fields and retire gate-unimplemented circuit rules.

### W6. Simulation engine tightly coupled to Convex data access

**File:** `src/domain/simulation.ts` (1,411 lines)

**Impact:** untestable unit logic without database.

**Recommendation:** introduce data-access repository abstraction.

### W7. No rate limiting on auth-dependent operations

**Recommendation:** rate-limit high-impact mutations (session creation, filings).

### W8. ECF filing validation duplicates constraint catalog logic

**Files:** `src/domain/filing/ecf.ts`, `src/domain/rules/constraint-catalog.ts`

**Recommendation:** make constraint catalog the single source of truth.

### W9. CI pipeline lacks security scanning and pre-commit hooks

**Recommendation:** add pre-commit hooks plus CodeQL/SAST scanning.

### W10. Manual Vite chunk splitting may become stale

**File:** `vite.config.ts`

**Recommendation:** use automatic chunking or add automated bundle analysis.

### W11. TypeScript strict-mode gaps

**File:** `tsconfig.json` and `any` usage

**Recommendation:** remove `any` where possible and confirm `noUncheckedSideEffectImports` is intentional.

### W12. Route-level error boundaries missing

**Recommendation:** add TanStack route-level error boundaries.

### W13. No instrumentation for bundle/performance metrics

**Recommendation:** add bundle visualizer and web-vitals reporting.

---

## 4. Suggestions (16 findings)

1. Add i18n infrastructure for user-facing messages.
2. Extract inline court/judge seed data to JSON files.
3. Add property-based/fuzz tests for constraints.
4. Implement degraded-mode AI fallback templates.
5. Add panel deliberation randomization.
6. Add document diff/versioning for submissions.
7. Add request tracing/logging with trace IDs.
8. Add staging environment with production parity.
9. Add husky/lint-staged pre-commit hooks.
10. Add bundle analysis tooling (`vite-plugin-visualizer`).
11. Add Clerk abstraction layer.
12. Add JSDoc for critical domain APIs/types.
13. Add full end-to-end simulation lifecycle integration test.
14. Add loading/skeleton states for all data-fetching routes.
15. Complete Tailwind v4 migration consistency pass.
16. Add periodic cleanup of stale/stuck simulation sessions.

---

## 5. Architecture Overview

### Strengths

- Layered domain/backend/frontend structure is coherent.
- Constraint catalog and actor state machine design are strong foundations.
- Convex + SSR frontend pairing is technically appropriate.
- Strict TypeScript config is a good base for maintainability.

### Risks

- Large untested backend surface.
- Inconsistent error contract patterns.
- AI failure mode fragility.
- Lack of observability and testing discipline.

### Patterns to Preserve

- Constraint-based filing engine and actor-oriented simulation model.
- Separation of route orchestration and domain behavior where present.

---

## 6. Coverage Gaps

### Not Tested

- `convex/` mutations/queries
- Simulation engine
- Constraint evaluation
- ECF workflow
- Panel deliberation
- Merit review
- Auth/authorization
- Seed generation

### Not Monitored

- Error tracking (Sentry)
- Structured logs
- Request tracing
- Bundle size trend
- Performance monitoring

### Not Documented

- Critical types/APIs docs
- ADRs and deployment runbooks
- Onboarding/developer docs for backend flows

---

## 7. Action Items

### Short-Term (Next Sprint)

- P0: Add Convex backend integration tests (critical paths).
- P0: Audit/remove/hash replacement in `convex/authz.ts`.
- P0: Add AI call timeouts + degraded-mode fallback.
- P1: Add Sentry/observability baseline.
- P1: Standardize Convex error handling pattern.
- P1: Split `src/routes/index.tsx`.
- P2: Add route-level error boundaries.
- P2: Add rate limits on key mutations.

### Medium-Term

- P1: Introduce simulation repository abstraction.
- P1: Consistent validation enforcement.
- P1: Consolidate ECF validation into constraints.
- P1: Add pre-commit hooks and CI security checks.
- P2: Externalize seed data + env-aware seeding.
- P2: Tune schema indexes and remove dead code.
- P2: Improve build/perf instrumentation.

### Long-Term

- P2–P3: staging rollout, deeper domain tests, i18n, fallback workflows, request tracing, auth abstraction, docs/versioning.

Estimated total effort: ~43–63 days across priorities if implemented comprehensively.

---

*Report generated from reconciled findings of 22 review subagents.*
