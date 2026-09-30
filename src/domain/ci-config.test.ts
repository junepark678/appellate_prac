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
    expect(security).not.toContain("continue-on-error");
    expect(security).toContain("uses: gitleaks/gitleaks-action@v2");
  });
});
