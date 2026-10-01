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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("continuous integration configuration", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  it("verifies pushes to the repository default branch", () => {
    const pushConfiguration = workflow.match(
      /\n  push:\n([\s\S]*?)(?=\n\S)/,
    )?.[1];

    expect(pushConfiguration).toMatch(/\n\s+- master(?:\n|$)/);
  });

  it("allows CodeQL to check out the private repository with its job token", () => {
    const codeql = workflow.match(/\n  codeql:\n([\s\S]*?)(?=\n  \w+:|$)/)?.[1];
    expect(codeql).toMatch(/\n      contents: read(?:\n|$)/);
    expect(codeql).toMatch(/\n      security-events: write(?:\n|$)/);
    expect(codeql).toMatch(/\n      actions: read(?:\n|$)/);
  });

  it("allows GitLeaks to read repository contents and pull request commits", () => {
    const security = workflow.match(
      /\n  security:\n([\s\S]*?)(?=\n  \w+:|$)/,
    )?.[1];
    expect(security).toMatch(/\n      contents: read(?:\n|$)/);
    expect(security).toMatch(/\n      pull-requests: read(?:\n|$)/);
    expect(security).toMatch(
      /uses: actions\/checkout@v6\n        with:\n          fetch-depth: 0(?:\n|$)/,
    );
    expect(security).not.toContain("continue-on-error");
    expect(security).toContain("uses: gitleaks/gitleaks-action@v2");
  });
});

describe("blocking dependency audit workflow", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const security =
    workflow.match(/\n  security:\n([\s\S]*?)(?=\n  \w+:|$)/)?.[1] ?? "";

  it("runs the bounded audit gate unconditionally without masking failures", () => {
    expect(security).toContain(
      "- name: Audit dependencies\n        timeout-minutes: 3\n        run: bun scripts/dependency-audit.ts\n",
    );
    expect(security).not.toMatch(
      /continue-on-error|\|\||\bif:|bun pm audit|--ignore|--audit-level|--prod/,
    );
    expect(security).toContain("bun-version: 1.3.11");
    expect(security).toContain("run: bun install --frozen-lockfile");
    expect(security.indexOf("bun install --frozen-lockfile")).toBeLessThan(
      security.indexOf("bun scripts/dependency-audit.ts"),
    );
  });

  it("preserves standard runners, triggers, and the existing verification/scanner steps", () => {
    expect(workflow.match(/runs-on: .+/g)).toEqual([
      "runs-on: ubuntu-latest",
      "runs-on: ubuntu-latest",
      "runs-on: ubuntu-latest",
    ]);
    expect(workflow).toContain("  pull_request:");
    expect(workflow).toContain("      - main");
    expect(workflow).toContain("      - master");
    for (const command of [
      "bun run typecheck",
      "bun run test",
      "bun run build",
    ])
      expect(workflow).toContain(`- run: ${command}`);
    expect(workflow).toContain("uses: gitleaks/gitleaks-action@v2");
    expect(workflow).toContain("uses: github/codeql-action/analyze@v3");
  });
});
