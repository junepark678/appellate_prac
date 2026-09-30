import { describe, expect, it } from "vitest";

import { courtPacks } from "../packs";
import { ca4CourtSourceVersions } from "./ca4-source-profile";
import {
  evaluateReleaseGate,
  sourceFreshnessStatuses,
} from "./source-governance";

describe("source governance release gate", () => {
  it("accepts the bundled CA4 beta sources when hashes are fetched and published", () => {
    const result = evaluateReleaseGate({ mode: "beta" });

    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.sourceStatuses.every((status) => status.published)).toBe(
      true,
    );
    expect(result.sourceStatuses.every((status) => !status.stale)).toBe(true);
  });

  it("reports source freshness with current vs bundled hashes", () => {
    const [source] = ca4CourtSourceVersions;
    const statuses = sourceFreshnessStatuses(ca4CourtSourceVersions, [
      {
        sourceVersionId: source.sourceVersionId,
        contentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fetchedAt: "2026-05-25T00:00:00.000Z",
        reviewStatus: "published",
      },
    ]);

    expect(statuses[0]?.fetchedHash).toBe(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(statuses[0]?.bundledHash).toBe(source.contentHash);
    expect(statuses[0]?.stale).toBe(true);
    expect(statuses[0]?.staleReason).toContain("differs");
  });

  it("rejects active court packs that reference stale manual source hashes", () => {
    const [source, ...rest] = ca4CourtSourceVersions;
    const result = evaluateReleaseGate({
      mode: "beta",
      sourceVersions: [
        {
          ...source,
          contentHash: "manual-frap-2025-12-01",
        },
        ...rest,
      ],
    });

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("not a fetched sha256 hash");
  });

  it("blocks production release until court pack status, eval, and env evidence are present", () => {
    const result = evaluateReleaseGate({
      mode: "production",
      env: {},
    });

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("production_approved");
    expect(result.issues.join("\n")).toContain("latest simulation eval run");
    expect(result.issues.join("\n")).toContain("CLERK_PUBLISHABLE_KEY");
  });

  it("passes production when approval, eval thresholds, env, and sources are satisfied", () => {
    const result = evaluateReleaseGate({
      mode: "production",
      now: "2026-05-25T12:00:00.000Z",
      courtPacks: courtPacks.map((pack) =>
        pack.id === "us-federal-ca4-civil-appeal"
          ? { ...pack, releaseStatus: "production_approved" as const }
          : pack,
      ),
      latestEval: {
        createdAt: "2026-05-25T00:00:00.000Z",
        criticalFailureCount: 0,
        validTurnRate: 0.99,
        hallucinatedSourceRate: 0,
        roleAuthorityFailureRate: 0,
        pass: true,
      },
      env: {
        CLERK_PUBLISHABLE_KEY: "pk_live_test",
        CLERK_SECRET_KEY: "sk_live_test",
        CLERK_AUTHORIZED_PARTIES: "https://example.edu",
        VITE_CONVEX_URL: "https://example.convex.cloud",
        CONVEX_DEPLOY_KEY: "deploy-key",
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_MODEL: "model",
      },
    });

    expect(result.pass).toBe(true);
  });
});

const now = "2026-09-30T04:00:00.000Z";
const validEval = {
  createdAt: now,
  criticalFailureCount: 0,
  validTurnRate: 0.99,
  hallucinatedSourceRate: 0,
  roleAuthorityFailureRate: 0,
  pass: true,
};
const webEnv = {
  CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
  CLERK_SECRET_KEY: "sk_test_fixture",
  CLERK_AUTHORIZED_PARTIES: "https://example.edu",
  VITE_CONVEX_URL: "https://example.convex.cloud",
};
const productionOptions = {
  mode: "production" as const,
  target: "web" as const,
  now,
  latestEval: validEval,
  courtPacks: courtPacks.map((pack) => ({
    ...pack,
    releaseStatus: "production_approved" as const,
  })),
  env: webEnv,
};

describe("production release evidence validation", () => {
  it.each([
    null,
    [],
    "pass",
    {},
    { pass: true },
    { ...validEval, pass: "true" },
    { ...validEval, pass: false },
    { ...validEval, criticalFailureCount: -1 },
    { ...validEval, criticalFailureCount: 0.5 },
    { ...validEval, criticalFailureCount: "0" },
    { ...validEval, criticalFailureCount: 1 },
    { ...validEval, validTurnRate: undefined },
    { ...validEval, validTurnRate: NaN },
    { ...validEval, validTurnRate: Infinity },
    { ...validEval, validTurnRate: 1.1 },
    { ...validEval, validTurnRate: 0.97 },
    { ...validEval, hallucinatedSourceRate: null },
    { ...validEval, hallucinatedSourceRate: -0.1 },
    { ...validEval, hallucinatedSourceRate: 0.02 },
    { ...validEval, roleAuthorityFailureRate: "0" },
    { ...validEval, roleAuthorityFailureRate: 0.01 },
    { ...validEval, createdAt: "not a date" },
    { ...validEval, createdAt: "2026-02-30T04:00:00.000Z" },
    { ...validEval, createdAt: "2026-09-30" },
    { ...validEval, createdAt: "2026-09-30T04:00:00.001Z" },
    { ...validEval, createdAt: "2026-09-29T03:59:59.999Z" },
  ])("fails closed for invalid or failing snapshot %#", (latestEval) => {
    expect(evaluateReleaseGate({ ...productionOptions, latestEval }).pass).toBe(
      false,
    );
  });

  it("accepts the default age boundary and rejects an invalid clock", () => {
    expect(
      evaluateReleaseGate({
        ...productionOptions,
        latestEval: { ...validEval, createdAt: "2026-09-29T04:00:00Z" },
      }).pass,
    ).toBe(true);
    expect(
      evaluateReleaseGate({ ...productionOptions, now: "invalid" }).pass,
    ).toBe(false);
  });

  it("uses the configured maximum age and rejects invalid limits", () => {
    const latestEval = { ...validEval, createdAt: "2026-09-29T04:00:00.000Z" };
    expect(
      evaluateReleaseGate({
        ...productionOptions,
        latestEval,
        maxEvalAgeMs: 3_600_000,
      }).pass,
    ).toBe(false);
    for (const maxEvalAgeMs of [0, -1, NaN, Infinity]) {
      expect(
        evaluateReleaseGate({ ...productionOptions, maxEvalAgeMs }).pass,
      ).toBe(false);
    }
  });

  it("does not demand backend secrets for web releases", () => {
    expect(evaluateReleaseGate(productionOptions).pass).toBe(true);
  });

  it("requires only deployment credentials in the backend release runner", () => {
    expect(
      evaluateReleaseGate({
        ...productionOptions,
        target: "backend",
        env: { CONVEX_DEPLOY_KEY: "fixture" },
      }).pass,
    ).toBe(true);
    expect(
      evaluateReleaseGate({ ...productionOptions, target: "backend", env: {} })
        .issues,
    ).toContain("Production backend release requires CONVEX_DEPLOY_KEY.");
  });

  it("defaults to checking both runners and rejects blank configuration", () => {
    expect(
      evaluateReleaseGate({ ...productionOptions, target: undefined }).pass,
    ).toBe(false);
    expect(
      evaluateReleaseGate({
        ...productionOptions,
        env: { ...webEnv, CLERK_SECRET_KEY: "   " },
      }).pass,
    ).toBe(false);
  });

  it("keeps the bundled beta court pack blocked even with otherwise valid evidence", () => {
    const result = evaluateReleaseGate({ ...productionOptions, courtPacks });
    expect(result.pass).toBe(false);
    expect(result.issues.join(" ")).toContain("production_approved");
  });
});

describe("release command target wiring", () => {
  it("keeps web build and backend deployment environment checks separate", async () => {
    const { default: manifest } = await import("../../../package.json");
    expect(manifest.scripts["release:vercel"]).toContain(
      "release:check --production --target=web",
    );
    expect(manifest.scripts["release:cloudflare"]).toContain(
      "release:check --production --target=web",
    );
    expect(manifest.scripts["deploy:backend"]).toContain(
      "release:check --production --target=backend",
    );
  });
});
