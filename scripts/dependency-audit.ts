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

import { spawnSync } from "node:child_process";
import type {
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const AUDIT_BUN_VERSION = "1.3.11";
export const AUDIT_TIMEOUT_MS = 120_000;
export const AUDIT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const AUDIT_ARGS = ["audit", "--json"] as const;

type AuditProcess = {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
};
export type AuditResult = {
  outcome: "clean" | "advisories" | "unverified";
  exitCode: 0 | 1;
  message: string;
};
const blocked = (message: string): AuditResult => ({
  outcome: "unverified",
  exitCode: 1,
  message,
});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Restrict coverage to the repository's current, single-workspace public npm
 * lock format. Unsupported configurations must be reviewed, never skipped. */
export function validateAuditInputs(
  manifest: unknown,
  lock: unknown,
  runtimeVersion: string,
): void {
  if (
    runtimeVersion !== AUDIT_BUN_VERSION ||
    !object(manifest) ||
    manifest.packageManager !== `bun@${AUDIT_BUN_VERSION}`
  )
    throw new Error("Unsupported Bun runtime or packageManager pin");
  if (
    !object(lock) ||
    lock.lockfileVersion !== 1 ||
    lock.configVersion !== 1 ||
    !object(lock.workspaces) ||
    Object.keys(lock.workspaces).length !== 1 ||
    !object(lock.workspaces[""]) ||
    !object(lock.packages) ||
    Object.keys(lock.packages).length === 0
  )
    throw new Error("Missing, empty or unsupported bun.lock format");
  for (const field of [
    "workspaces",
    "overrides",
    "resolutions",
    "patchedDependencies",
  ]) {
    if (Object.hasOwn(manifest, field))
      throw new Error("Unsupported package resolution configuration");
  }
  if (
    Object.keys(lock).some(
      (key) =>
        ![
          "lockfileVersion",
          "configVersion",
          "workspaces",
          "packages",
        ].includes(key),
    )
  )
    throw new Error("Unsupported lockfile coverage configuration");
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const declared = manifest[section] ?? {};
    const locked = lock.workspaces[""][section] ?? {};
    if (
      !object(declared) ||
      !object(locked) ||
      Object.keys(declared).length !== Object.keys(locked).length ||
      Object.entries(declared).some(
        ([key, value]) => typeof value !== "string" || locked[key] !== value,
      )
    )
      throw new Error(
        "Package manifest and lockfile dependency declarations differ",
      );
  }
  for (const entry of Object.values(lock.packages)) {
    // Bun skips non-npm resolutions and non-default registry scopes in audit.
    if (
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      typeof entry[0] !== "string" ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
        entry[0],
      ) ||
      entry[1] !== "" ||
      !object(entry[2]) ||
      typeof entry[3] !== "string" ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(entry[3])
    )
      throw new Error(
        "Unsupported non-default-npm lockfile resolution; audit coverage unverified",
      );
  }
}

/** Evaluate the complete result, not just Bun's exit status. Pinned Bun treats
 * empty HTTP bodies as success; only an explicit empty object is clean. */
export function evaluateAudit(result: AuditProcess): AuditResult {
  if (result.error || result.signal || result.status === null)
    return blocked(
      "Audit process failed, timed out, exceeded output limits or was interrupted; no clean verdict",
    );
  let report: unknown;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return blocked(
      "Audit returned empty or invalid JSON; service availability and coverage are unverified",
    );
  }
  if (!object(report))
    return blocked(
      "Audit returned an unexpected response shape; no clean verdict",
    );
  if (Object.keys(report).length > 0) {
    const severities = ["low", "moderate", "high", "critical", "info"];
    const advisories = Object.values(report);
    if (
      (result.status === 0 || result.status === 1) &&
      advisories.every(
        (value) =>
          Array.isArray(value) &&
          value.length > 0 &&
          value.every(
            (item) =>
              object(item) &&
              typeof item.severity === "string" &&
              severities.includes(item.severity) &&
              typeof item.title === "string" &&
              typeof item.url === "string",
          ),
      )
    )
      return {
        outcome: "advisories",
        exitCode: 1,
        message:
          "Dependency advisories reported; every severity blocks. Review the raw report; no automatic fixes or waivers.",
      };
    return blocked(
      "Audit returned a nonempty or unrecognized report; no clean verdict",
    );
  }
  if (result.status !== 0)
    return blocked(
      "Audit process exited unsuccessfully despite an empty report; no clean verdict",
    );
  const stderr = result.stderr.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (stderr && !/^bun audit v1\.3\.11 \([a-f0-9]+\)$/.test(stderr))
    return blocked(
      "Audit emitted unexpected diagnostics; coverage is unverified",
    );
  return {
    outcome: "clean",
    exitCode: 0,
    message:
      "Dependency audit PASS: explicit empty advisory report and successful process exit.",
  };
}

/** Reject configuration that could silently change the registry or audit set.
 * Values are never included in diagnostics because they can contain tokens. */
export function validateAuditConfiguration(
  paths: string[],
  environment: NodeJS.ProcessEnv,
): void {
  if (paths.some((path) => existsSync(path)))
    throw new Error(
      "Custom npm/Bun configuration is unsupported by this public-registry audit gate",
    );
  if (
    Object.keys(environment).some((key) =>
      /^(npm_config_|bun_config_|bun_install_)/i.test(key),
    )
  )
    throw new Error(
      "Custom package-manager environment configuration is unsupported by this audit gate",
    );
}

export function auditConfigurationPaths(
  root: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  const paths = new Set<string>();
  for (let current = resolve(root); ; current = dirname(current)) {
    for (const file of [".npmrc", "bunfig.toml", ".bunfig.toml"])
      paths.add(join(current, file));
    if (dirname(current) === current) break;
  }
  paths.add(join(homedir(), ".npmrc"));
  paths.add(join(homedir(), ".bunfig.toml"));
  if (environment.XDG_CONFIG_HOME)
    paths.add(join(environment.XDG_CONFIG_HOME, ".bunfig.toml"));
  return [...paths];
}

type AuditRuntime = {
  version: string;
  parseLockfile: (text: string) => unknown;
  execute: (
    executable: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ) => SpawnSyncReturns<string>;
  configurationPaths: string[];
  environment: NodeJS.ProcessEnv;
};

/** Dependency injection exists for offline regressions only. The CLI below
 * fixes the runtime, parser, command, timeout and policy; it accepts no flags. */
export function runDependencyAudit(
  root: string,
  runtime: AuditRuntime,
): AuditResult {
  try {
    validateAuditConfiguration(runtime.configurationPaths, runtime.environment);
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    const lock = runtime.parseLockfile(
      readFileSync(join(root, "bun.lock"), "utf8"),
    );
    validateAuditInputs(manifest, lock, runtime.version);
    const result = runtime.execute(process.execPath, [...AUDIT_ARGS], {
      cwd: root,
      encoding: "utf8",
      timeout: AUDIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: AUDIT_MAX_OUTPUT_BYTES,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: runtime.environment,
    });
    // Raw advisory evidence stays in existing job logs, not new stored artifacts.
    // Strip workflow command interpretation of untrusted report text.
    if (result.stdout)
      console.log(
        "Audit stdout (JSON encoded):",
        JSON.stringify(result.stdout),
      );
    if (result.stderr)
      console.error(
        "Audit stderr (JSON encoded):",
        JSON.stringify(result.stderr),
      );
    return evaluateAudit({
      status: result.status,
      signal: result.signal,
      error: result.error,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    });
  } catch (error) {
    return blocked(
      `Audit could not run: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  }
}

if (import.meta.main) {
  if (process.argv.length !== 2) {
    console.error(
      "Dependency audit accepts no policy overrides or command arguments",
    );
    process.exitCode = 1;
  } else {
    const result = runDependencyAudit(process.cwd(), {
      version: Bun.version,
      parseLockfile: Bun.JSONC.parse,
      execute: spawnSync,
      configurationPaths: auditConfigurationPaths(process.cwd(), process.env),
      environment: process.env,
    });
    console.log(`${result.outcome.toUpperCase()}: ${result.message}`);
    process.exitCode = result.exitCode;
  }
}
