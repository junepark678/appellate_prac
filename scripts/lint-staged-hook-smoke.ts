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
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

const repositoryRoot = resolve(import.meta.dir, "..");
const bunVersion = "1.3.11";
const maxOutputBytes = 8 * 1024 * 1024;

function describe(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim().slice(-8_000);
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: maxOutputBytes,
  });

  if (result.error)
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    };

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function requireSuccess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): CommandResult {
  const result = run(command, args, cwd, env);
  if (result.error || result.status !== 0)
    throw new Error(
      `Expected ${command} ${args.join(" ")} to succeed.\n${describe(result)}`,
    );
  return result;
}

function copyTrackedRepository(destination: string): void {
  const tracked = requireSuccess(
    "git",
    ["ls-files", "-z"],
    repositoryRoot,
    process.env,
  ).stdout;

  for (const relativePath of tracked.split("\0").filter(Boolean)) {
    const source = resolve(repositoryRoot, relativePath);
    const target = resolve(destination, relativePath);
    if (target !== destination && !target.startsWith(`${destination}${sep}`))
      throw new Error(
        `Refusing to copy a path outside the fixture: ${relativePath}`,
      );

    const metadata = lstatSync(source);
    mkdirSync(dirname(target), { recursive: true });
    if (metadata.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target);
      continue;
    }
    if (!metadata.isFile()) continue;

    copyFileSync(source, target);
    chmodSync(target, metadata.mode & 0o777);
  }
}

function createFixture(): { path: string; env: NodeJS.ProcessEnv } {
  const fixture = mkdtempSync(join(tmpdir(), "appellate-issue89-hook-"));
  const home = join(fixture, "home");
  mkdirSync(home);
  copyTrackedRepository(fixture);
  symlinkSync(
    resolve(repositoryRoot, "node_modules"),
    join(fixture, "node_modules"),
    "dir",
  );

  const env: NodeJS.ProcessEnv = {
    CI: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: home,
    LANG: "C.UTF-8",
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    TMPDIR: fixture,
  };

  requireSuccess("git", ["init", "--quiet"], fixture, env);
  requireSuccess(
    "git",
    ["config", "user.name", "Issue 89 Fixture"],
    fixture,
    env,
  );
  requireSuccess(
    "git",
    ["config", "user.email", "issue-89-fixture@example.test"],
    fixture,
    env,
  );
  requireSuccess("bun", ["run", "prepare"], fixture, env);

  return { path: fixture, env };
}

function verifySuccessfulHook(): void {
  const fixture = createFixture();
  const relativePath = "src/issue 89 hook smoke.ts";
  const file = join(fixture.path, relativePath);

  try {
    writeFileSync(file, "export const stagedValue={answer:42};\n");
    requireSuccess(
      "git",
      ["add", "--", relativePath],
      fixture.path,
      fixture.env,
    );
    appendFileSync(
      file,
      "export const unstagedValue='keep this unstaged edit';\n",
    );

    requireSuccess(
      "git",
      ["commit", "-m", "verify staged hook behavior"],
      fixture.path,
      fixture.env,
    );

    const committed = requireSuccess(
      "git",
      ["show", `HEAD:${relativePath}`],
      fixture.path,
      fixture.env,
    ).stdout;
    const worktree = readFileSync(file, "utf8");

    if (!committed.includes("export const stagedValue = { answer: 42 };"))
      throw new Error(
        "The hook did not format and commit the staged TypeScript file.",
      );
    if (committed.includes("unstagedValue"))
      throw new Error(
        "The hook included the unstaged same-file edit in the commit.",
      );
    if (
      !worktree.includes(
        "export const unstagedValue='keep this unstaged edit';",
      )
    )
      throw new Error("The hook did not preserve the unstaged same-file edit.");
    if (
      run(
        "git",
        ["diff", "--quiet", "--", relativePath],
        fixture.path,
        fixture.env,
      ).status === 0
    )
      throw new Error(
        "The fixture's unstaged edit disappeared after the hook ran.",
      );
  } finally {
    rmSync(fixture.path, { recursive: true, force: true });
  }
}

function verifyFailurePropagates(): void {
  const fixture = createFixture();
  const relativePath = "src/issue89-hook-failure.ts";
  const file = join(fixture.path, relativePath);

  try {
    writeFileSync(
      file,
      'export const failingValue: number = "not a number";\n',
    );
    requireSuccess(
      "git",
      ["add", "--", relativePath],
      fixture.path,
      fixture.env,
    );

    const commit = run(
      "git",
      ["commit", "-m", "expected hook failure"],
      fixture.path,
      fixture.env,
    );
    if (commit.error || commit.status === 0)
      throw new Error(
        `The failing typecheck did not stop the fixture commit.\n${describe(commit)}`,
      );
    if (!describe(commit).includes("not assignable to type 'number'"))
      throw new Error(
        `The fixture commit failed for an unexpected reason.\n${describe(commit)}`,
      );

    const head = run(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      fixture.path,
      fixture.env,
    );
    if (head.status === 0)
      throw new Error(
        "The fixture created a commit despite the failing typecheck.",
      );
    const staged = requireSuccess(
      "git",
      ["diff", "--cached", "--name-only"],
      fixture.path,
      fixture.env,
    ).stdout;
    if (!staged.split("\n").includes(relativePath))
      throw new Error(
        "The failing fixture file was unexpectedly removed from the index.",
      );
  } finally {
    rmSync(fixture.path, { recursive: true, force: true });
  }
}

if (Bun.version !== bunVersion)
  throw new Error(
    `This hook smoke check requires Bun ${bunVersion}; found ${Bun.version}.`,
  );

verifySuccessfulHook();
verifyFailurePropagates();
console.log(
  `PASS: Husky pre-commit works with Bun ${Bun.version}; staged paths with spaces are formatted, failures block commits, and unstaged edits are preserved.`,
);
