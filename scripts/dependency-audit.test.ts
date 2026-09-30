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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_ARGS,
  AUDIT_BUN_VERSION,
  AUDIT_TIMEOUT_MS,
  AUDIT_MAX_OUTPUT_BYTES,
  auditConfigurationPaths,
  evaluateAudit,
  runDependencyAudit,
  validateAuditConfiguration,
  validateAuditInputs,
} from "./dependency-audit";

const manifest = () => ({
  packageManager: "bun@1.3.11",
  dependencies: { example: "1.0.0" },
});
const lock = () => ({
  lockfileVersion: 1,
  configVersion: 1,
  workspaces: { "": { dependencies: { example: "1.0.0" } } },
  packages: { example: ["example@1.0.0", "", {}, "sha512-Zml4dHVyZQ=="] },
});
const clean = () => ({
  status: 0,
  signal: null,
  stdout: "{}",
  stderr: "",
  pid: 1,
  output: [],
});
const advisory = (severity: string) =>
  JSON.stringify({
    example: [
      {
        id: 1,
        severity,
        title: "Fixture advisory",
        url: "https://example.org/advisory",
      },
    ],
  });
const temporaryPaths: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dependency-audit-test-"));
  temporaryPaths.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest()));
  writeFileSync(join(root, "bun.lock"), JSON.stringify(lock()));
  const execute = vi.fn(() => clean());
  const runtime = {
    version: AUDIT_BUN_VERSION,
    parseLockfile: JSON.parse,
    execute,
    configurationPaths: [] as string[],
    environment: {},
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  return { root, execute, runtime };
}

describe("dependency audit verdicts", () => {
  it("accepts only explicit empty JSON plus successful exit", () => {
    expect(evaluateAudit(clean())).toMatchObject({
      outcome: "clean",
      exitCode: 0,
    });
    expect(
      evaluateAudit({
        ...clean(),
        stdout: " \n{}\n",
        stderr: "\x1b[1mbun audit \x1b[0mv1.3.11 (af24e281)\n",
      }),
    ).toMatchObject({ outcome: "clean", exitCode: 0 });
  });
  it.each(["low", "moderate", "high", "critical", "info"])(
    "blocks %s even if the child reports exit 0",
    (severity) => {
      for (const status of [0, 1])
        expect(
          evaluateAudit({ ...clean(), status, stdout: advisory(severity) }),
        ).toMatchObject({ outcome: "advisories", exitCode: 1 });
    },
  );
  it.each([
    "",
    " \n",
    "null",
    "[]",
    "false",
    "42",
    "{} trailing",
    "{broken",
    '{"error":"registry unavailable"}',
    '{"example":[]}',
    '{"example":[{}]}',
    '"No vulnerabilities found"',
  ])("rejects unavailable or malformed response %j", (stdout) => {
    expect(evaluateAudit({ ...clean(), stdout })).toMatchObject({
      outcome: "unverified",
      exitCode: 1,
    });
  });
  it.each([1, 2, 127])(
    "does not override exit %d with an empty report",
    (status) =>
      expect(evaluateAudit({ ...clean(), status })).toMatchObject({
        outcome: "unverified",
        exitCode: 1,
      }),
  );
  it.each(["SIGTERM", "SIGKILL"])("blocks interruption %s", (signal) =>
    expect(evaluateAudit({ ...clean(), signal })).toMatchObject({
      outcome: "unverified",
      exitCode: 1,
    }),
  );
  it.each(["ENOENT", "ETIMEDOUT", "ENOBUFS"])(
    "blocks process failure %s",
    (code) =>
      expect(
        evaluateAudit({
          ...clean(),
          error: Object.assign(new Error(code), { code }),
        }),
      ).toMatchObject({ outcome: "unverified", exitCode: 1 }),
  );
  it("blocks missing exit status", () =>
    expect(evaluateAudit({ ...clean(), status: null })).toMatchObject({
      outcome: "unverified",
      exitCode: 1,
    }));
  it.each([
    "Skipped private-package",
    "error: audit request failed (status 503)",
    "warning: partial response",
  ])("does not ignore diagnostics %s", (stderr) =>
    expect(evaluateAudit({ ...clean(), stderr })).toMatchObject({
      outcome: "unverified",
      exitCode: 1,
    }),
  );
});

describe("complete current-lockfile coverage", () => {
  it("accepts pinned public npm resolutions", () => {
    expect(() =>
      validateAuditInputs(manifest(), lock(), "1.3.11"),
    ).not.toThrow();
    const scoped = lock();
    scoped.packages.example[0] = "@scope/example@1.0.0-beta.1+build";
    expect(() =>
      validateAuditInputs(manifest(), scoped, "1.3.11"),
    ).not.toThrow();
  });
  it.each([
    null,
    {},
    { ...lock(), lockfileVersion: 2 },
    { ...lock(), configVersion: 2 },
    { ...lock(), packages: {} },
    { ...lock(), workspaces: {} },
    { ...lock(), workspaces: { "": {}, other: {} } },
    { ...lock(), overrides: {} },
  ])("rejects unsupported lockfile %j", (value) =>
    expect(() => validateAuditInputs(manifest(), value, "1.3.11")).toThrow(),
  );
  it.each([
    null,
    {},
    { ...manifest(), packageManager: "bun@latest" },
    { ...manifest(), dependencies: { example: "2.0.0" } },
    { ...manifest(), workspaces: [] },
    { ...manifest(), overrides: {} },
    { ...manifest(), patchedDependencies: {} },
  ])("rejects unsupported manifest %j", (value) =>
    expect(() => validateAuditInputs(value, lock(), "1.3.11")).toThrow(),
  );
  it("requires the reviewed runtime", () =>
    expect(() => validateAuditInputs(manifest(), lock(), "1.4.2")).toThrow());
  it.each([
    ["example@file:../local", "", {}, "sha512-Zml4dHVyZQ=="],
    ["example@github:owner/repo", "", {}, "sha512-Zml4dHVyZQ=="],
    [
      "example@1.0.0",
      "https://other.example/package.tgz",
      {},
      "sha512-Zml4dHVyZQ==",
    ],
    ["example@1.0.0", "", {}, ""],
    ["example@1.0.0", "", {}],
  ])("rejects resolution skipped by public-registry auditing %#", (...entry) =>
    expect(() =>
      validateAuditInputs(
        manifest(),
        { ...lock(), packages: { example: entry } },
        "1.3.11",
      ),
    ).toThrow(),
  );
  it("rejects configuration files and environment overrides without printing their values", () => {
    const { root } = fixture();
    const config = join(root, ".npmrc");
    writeFileSync(config, "@scope:registry=https://private.example");
    expect(() => validateAuditConfiguration([config], {})).toThrow();
    for (const key of [
      "NPM_CONFIG_REGISTRY",
      "npm_config_userconfig",
      "BUN_CONFIG_FILE",
      "BUN_INSTALL_REGISTRY",
    ])
      expect(() =>
        validateAuditConfiguration([], { [key]: "secret-fixture" }),
      ).toThrow(/configuration/);
    expect(() =>
      validateAuditConfiguration([], { HTTPS_PROXY: "proxy", PATH: "/bin" }),
    ).not.toThrow();
    const paths = auditConfigurationPaths(root, {
      XDG_CONFIG_HOME: "/fixture-config",
    });
    expect(paths).toContain(join(root, "bunfig.toml"));
    expect(paths).toContain("/.npmrc");
    expect(paths).toContain("/fixture-config/.bunfig.toml");
  });
});

describe("audit process boundary (offline)", () => {
  it("executes the supported unfiltered command once with bounds and never writes inputs", () => {
    const { root, execute, runtime } = fixture();
    const before = [
      readFileSync(join(root, "package.json"), "utf8"),
      readFileSync(join(root, "bun.lock"), "utf8"),
    ];
    expect(runDependencyAudit(root, runtime)).toMatchObject({
      outcome: "clean",
      exitCode: 0,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [...AUDIT_ARGS],
      {
        cwd: root,
        encoding: "utf8",
        timeout: AUDIT_TIMEOUT_MS,
        maxBuffer: AUDIT_MAX_OUTPUT_BYTES,
        killSignal: "SIGKILL",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {},
      },
    );
    expect(AUDIT_ARGS).toEqual(["audit", "--json"]);
    expect(AUDIT_TIMEOUT_MS).toBe(120000);
    expect([
      readFileSync(join(root, "package.json"), "utf8"),
      readFileSync(join(root, "bun.lock"), "utf8"),
    ]).toEqual(before);
  });
  it.each([
    "missing-lock",
    "invalid-lock",
    "missing-manifest",
    "invalid-manifest",
    "version",
    "config",
  ])("never invokes the network process on %s", (failure) => {
    const { root, runtime, execute } = fixture();
    if (failure === "missing-lock") rmSync(join(root, "bun.lock"));
    if (failure === "invalid-lock")
      writeFileSync(join(root, "bun.lock"), "{invalid");
    if (failure === "missing-manifest") rmSync(join(root, "package.json"));
    if (failure === "invalid-manifest")
      writeFileSync(join(root, "package.json"), "null");
    if (failure === "version") runtime.version = "wrong";
    if (failure === "config")
      runtime.environment = { NPM_CONFIG_REGISTRY: "secret-fixture" };
    expect(runDependencyAudit(root, runtime)).toMatchObject({
      outcome: "unverified",
      exitCode: 1,
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("catches spawn errors without retry or a successful skip", () => {
    const { root, runtime, execute } = fixture();
    execute.mockImplementation(() => {
      throw new Error("command unavailable");
    });
    expect(runDependencyAudit(root, runtime)).toMatchObject({
      outcome: "unverified",
      exitCode: 1,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("records advisory JSON without interpreting newlines as workflow commands", () => {
    const { root, runtime, execute } = fixture();
    execute.mockReturnValue({
      ...clean(),
      status: 1,
      stdout: advisory("high") + "\n",
    });
    expect(runDependencyAudit(root, runtime)).toMatchObject({
      outcome: "advisories",
      exitCode: 1,
    });
    expect(console.log).toHaveBeenCalledWith(
      "Audit stdout (JSON encoded):",
      JSON.stringify(advisory("high") + "\n"),
    );
  });
});
