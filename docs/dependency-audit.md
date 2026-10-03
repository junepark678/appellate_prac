# Blocking dependency audit

[Issue #80](https://github.com/junepark678/appellate_prac/issues/80) corrects the unsupported `bun pm audit || true` step. The supported command on the existing pinned Bun **1.3.11** is `bun audit --json`. CI invokes it through:

```sh
bun scripts/dependency-audit.ts
```

The wrapper accepts no command-line overrides. It does not install, update, fix, suppress or write dependencies, and package.json/bun.lock remain unchanged. It uses the existing public `ubuntu-latest` security job and permissions. GitLeaks, CodeQL, frozen install, typecheck, tests and build stay enabled.

## Verdict policy

| Condition                                                                                               | Verdict and exit                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Normal child exit 0, stdout is explicitly `{}`, stderr absent or the expected Bun version banner        | CLEAN / PASS, 0                             |
| Advisory report at any severity (including development/transitive dependencies)                         | ADVISORIES, 1                               |
| Empty/whitespace output, malformed JSON, array/null/scalar, error object or unfamiliar report           | UNVERIFIED, 1                               |
| Unsupported/missing command or runtime, failed spawn, nonzero exit, signal, timeout or excessive output | UNVERIFIED, 1                               |
| Registry, DNS, TLS or HTTP failure; unexpected diagnostics or incomplete coverage                       | UNVERIFIED, 1                               |
| Missing/malformed/unsupported lockfile or package configuration                                         | UNVERIFIED before the network subprocess, 1 |

No clean verdict is inferred from an unavailable service or a previous run. No severity threshold, ignore list, production-only filter, omission flag, automatic upgrade, exception or successful skip exists. A finding remains blocking even if the subprocess incorrectly reports exit 0.

The child has a **120-second timeout**, SIGKILL on timeout, and a **10 MiB output buffer bound**. The workflow step has a **three-minute timeout**. There are no wrapper retries or alternative advisory providers. If the registry is unavailable, root may rerun the failed job after recovery and must use that new result as evidence. No credentials, paid infrastructure or service purchases are part of recovery.

Raw stdout/stderr are JSON-encoded in existing job logs to retain evidence and prevent embedded newlines from becoming GitHub workflow commands. The wrapper then prints the verdict and exits nonzero on any failure. No extra report artifacts, caches of verdicts or storage services are created.

## Coverage boundary

Bun's audit reads the current `bun.lock`; it does not require node_modules and queries the npm advisory endpoint. The gate uses the same pinned Bun binary, with exactly `audit --json`, after CI's frozen install. It includes the current lockfile's development and production package set, without filters.

Bun 1.3.11 can silently omit non-npm or non-default-registry packages, so this gate intentionally supports only the repository's current public npm configuration:

- Exactly Bun/packageManager 1.3.11 and the reviewed lockfile/config versions (1/1).
- One root workspace and a nonempty package table; root dependency declarations must match package.json.
- Exact npm semver resolution tuples with the default registry marker and an integrity hash. File/git/custom-registry resolutions fail rather than being treated as audited.
- No workspace, override, patched dependency, unfamiliar lockfile metadata, or custom resolution setup without a separately reviewed extension of the coverage contract.
- No `.npmrc`, `bunfig.toml` or `.bunfig.toml` in the project/ancestor configuration paths, user npm/Bun configuration, or configured XDG Bun file. Package-manager configuration environment variables (`npm_config_*`, `bun_config_*`, `bun_install_*`, case-insensitive) also block. Configuration values are not printed.

This strict configuration boundary can block a local environment that uses harmless package-manager settings too. That result is **unverified**, not a security finding. Use a clean approved invocation with those irrelevant environment settings absent; do not change credentials or silently bypass a private-registry coverage requirement. Proxy/TLS infrastructure environment settings are preserved. A future Bun or registry change requires reviewing the pinned implementation and tests before broadening support.

The endpoint's explicit empty report is trusted as the advisory service's answer for the submitted package set. It is not proof of absence of unknown vulnerabilities, nor a replacement for GitLeaks or CodeQL.

## Why exit status alone is insufficient

The [pinned Bun implementation](https://github.com/oven-sh/bun/blob/bun-v1.3.11/src/cli/audit_command.zig) can return 0 for an empty response body. The wrapper therefore requires a parsed empty object and successful exit together. A nonempty object is never clean. The current [Bun documentation](https://bun.sh/docs/pm/cli/audit) documents the supported audit command, but describes newer versions too; this gate relies on observed 1.3.11 behavior and pinned source for compatibility.

## Verification and existing findings

Unit tests use offline injected process results and temporary local files. They cover all severities, missing/empty/malformed responses, false successful exits, process errors, interruptions, timeout/output-limit failures, configuration/coverage rejection, fixed unfiltered arguments, bounded execution, input preservation, and log encoding. Workflow tests protect unconditional blocking execution and retain existing checks/runners/permissions/triggers. Unit tests never invoke an advisory service.

On 2026-09-30, the real audit of master `d6273048a30b7cfb0817e8f1be20a9b482bd8efe` reported advisories and exited 1. The new wrapper likewise reported **ADVISORIES** and exited 1 when run with the execution workspace's unrelated `NPM_CONFIG_AUDIT`, `NPM_CONFIG_PREFIX`, and `NPM_CONFIG_FUND` settings absent. The ordinary inherited environment was correctly reported **UNVERIFIED** because of the strict configuration boundary. Counts and exact-head hosted results belong in the PR evidence because the advisory database can change.

Existing findings are not repaired in this detector-only issue. Keep the draft's failing audit visible; dependency remediation requires separate bounded changes and review. Do not claim the required security job passed merely because the detector correctly failed. Root coordinates independent review, merge eligibility, remediation and any post-merge verification. Build-integrity milestone state must reflect outstanding required work; the prior three completed fixes and their evidence remain intact.

No deployment, live migration, organization-data operation, paid provider, runner upgrade or purchased credits are authorized by this change. The software remains AGPL-3.0-or-later, Copyright (C) 2026 Rhajune Park; this does not relicense third-party advisories or packages.

## Remediation: lint-staged tooling closure

Issue [#89](https://github.com/junepark678/appellate_prac/issues/89) removes the only reported vulnerable closure by pinning the development-only `lint-staged` dependency to the released exact version `17.6.0`. Before the change, the only locked `micromatch` parent was `lint-staged@15.5.2`, which resolved `micromatch@4.0.8` and `braces@3.0.3`. The official [GHSA-vfj7-8cjw-p6xm advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects braces versions through `3.0.3`; it has no patched release. The unmerged upstream fix is not used.

The registry's [published lint-staged 17.6.0 metadata](https://registry.npmjs.org/lint-staged/17.6.0) records Node `>=22.22.1`, dependencies on `picomatch`, `string-argv` and `tinyexec` (plus optional `yaml`), and the tarball integrity `sha512-nOhBfYkZEwkFtNzD5pK9s9LkcWoxJ+whLzEnhqi9nl7zTB5n7tg8+9iYgMGx2Wm3VlLu8cbNj0RACzY+nWi5iQ==`. The [upstream v17.6.0 package manifest](https://github.com/lint-staged/lint-staged/blob/v17.6.0/package.json) corroborates the published release metadata. The lockfile is regenerated by pinned Bun 1.3.11 and retains the registry integrity. The resulting locked package table contains neither `micromatch` nor `braces`; its `lint-staged` entry resolves to `17.6.0` and `picomatch`, so no alias, override, or alternate registry source conceals the old closure.

This tool remains development-only. The app's dependencies and runtime are unchanged. The existing Husky hook still invokes `bun run lint-staged`; the `lint-staged` patterns and their `bun run typecheck` and `prettier --write` tasks are unchanged. The checked-in hook smoke script runs that real hook in temporary Git repositories, including a staged filename with spaces, a failing typecheck that must abort commit, and an unstaged same-file edit that must remain in the worktree. The standard verify job runs this smoke check after the frozen install. Direct Node invocation of `lint-staged@17.6.0` requires Node `>=22.22.1`; hook verification uses the repository's pinned Bun `1.3.11` invocation.
