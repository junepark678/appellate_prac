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

import { ConvexError as ConvexValuesError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { attachGeneratedPackBundleZip, bundleZipPayload } from "./admin";
import { AppErrorCode, type AppErrorData } from "./errors";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./authz.ts": () => import("./authz"),
  "./authHelpers.ts": () => import("./authHelpers"),
  "./organizationContracts.ts": () => import("./organizationContracts"),
  "./errors.ts": () => import("./errors"),
  "./admin.ts": () => import("./admin"),
  "./adminPackBundles.ts": () => import("./adminPackBundles"),
};

type TestIdentity = {
  issuer: string;
  subject: string;
  tokenIdentifier: string;
  name: string;
};

const identity = (subject: string): TestIdentity => ({
  issuer: "https://identity.example.test",
  subject,
  tokenIdentifier: `https://identity.example.test|${subject}`,
  name: subject,
});

type RegisteredHandler = {
  _handler: (...args: never[]) => Promise<unknown>;
};

async function expectActionError(
  promise: Promise<unknown>,
  expected: { code: AppErrorCode; message: string },
) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ConvexValuesError);
  const error = caught as ConvexValuesError<AppErrorData>;
  expect(error.data).toMatchObject(expected);
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("registered legacy pack-bundle ZIP action", () => {
  it("rejects every identity before payload, network, ZIP, storage, or attachment work", async () => {
    const t = convexTest(schema, modules);
    const ordinary = identity("ordinary-user");
    const legacyAdmin = identity("legacy-global-admin");

    // This full fixture lets a regression traverse the old generation path,
    // while all rows and bytes remain inside convex-test's ephemeral storage.
    const fixture = await t.run(async (ctx) => {
      const ordinaryUserId = await ctx.db.insert("users", {
        authSubject: ordinary.tokenIdentifier,
        displayName: ordinary.name,
        role: "student",
        monthlyAiBudgetCents: 250,
      });
      await ctx.db.insert("users", {
        authSubject: legacyAdmin.tokenIdentifier,
        displayName: legacyAdmin.name,
        role: "admin",
        monthlyAiBudgetCents: 250,
      });
      const rawStorageId = await ctx.storage.store(
        new Blob(["ephemeral source fixture"], { type: "application/pdf" }),
      );
      const artifactId = await ctx.db.insert("sourceArtifacts", {
        sourceVersionId: "fixture-source-v1",
        label: "Fixture source",
        url: "https://example.test/fixture.pdf",
        fetchedAt: "2026-10-03T00:00:00.000Z",
        contentHash: "sha256:fixture",
        parserVersion: "fixture-parser",
        mediaType: "application/pdf",
        rawStorageId,
        reviewStatus: "published",
      });
      const bundleId = await ctx.db.insert("packBundles", {
        courtPackId: "fixture-court-pack",
        bundleVersion: "1.0.0",
        label: "Fixture bundle",
        manifestJson: JSON.stringify({ rulePacks: [] }),
        sourceVersionIds: [],
        componentModuleIds: [],
        artifactIds: [artifactId],
        status: "indexed",
        createdByUserId: ordinaryUserId,
        createdAt: "2026-10-03T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
      });
      return { bundleId, rawStorageId };
    });

    const before = await t.run(async (ctx) => ({
      bundle: await ctx.db.get(fixture.bundleId),
      storageIds: (await ctx.db.system.query("_storage").collect()).map(
        (item) => item._id,
      ),
      auditCount: (await ctx.db.query("auditLog").collect()).length,
    }));

    const fetchMock = vi.fn(async () => new Response("ephemeral PDF bytes"));
    vi.stubGlobal("fetch", fetchMock);
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest");
    const encoderSpy = vi.spyOn(globalThis, "TextEncoder");
    const payloadQuerySpy = vi.spyOn(
      bundleZipPayload as unknown as RegisteredHandler,
      "_handler",
    );
    const attachMutationSpy = vi.spyOn(
      attachGeneratedPackBundleZip as unknown as RegisteredHandler,
      "_handler",
    );

    const actionArgs = { bundleId: fixture.bundleId as Id<"packBundles"> };
    const unauthenticatedError = await expectActionError(
      t.action(api.adminPackBundles.generatePackBundleZip, actionArgs),
      {
        code: AppErrorCode.AUTH_REQUIRED,
        message: "Authentication required",
      },
    );
    expect(unauthenticatedError.data.metadata).toBeUndefined();

    await expectActionError(
      t
        .withIdentity(ordinary)
        .action(api.adminPackBundles.generatePackBundleZip, actionArgs),
      {
        code: AppErrorCode.VALIDATION_ERROR,
        message: "Use organization membership management",
      },
    );
    await expectActionError(
      t
        .withIdentity(legacyAdmin)
        .action(api.adminPackBundles.generatePackBundleZip, actionArgs),
      {
        code: AppErrorCode.VALIDATION_ERROR,
        message: "Use organization membership management",
      },
    );

    expect(payloadQuerySpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(encoderSpy).not.toHaveBeenCalled();
    expect(digestSpy).not.toHaveBeenCalled();
    expect(attachMutationSpy).not.toHaveBeenCalled();

    const after = await t.run(async (ctx) => ({
      bundle: await ctx.db.get(fixture.bundleId),
      storageIds: (await ctx.db.system.query("_storage").collect()).map(
        (item) => item._id,
      ),
      auditCount: (await ctx.db.query("auditLog").collect()).length,
    }));
    expect(after).toEqual(before);
    expect(fixture.rawStorageId).toBeDefined();
  });
});
