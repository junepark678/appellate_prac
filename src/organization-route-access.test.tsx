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

// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import type { Id } from "../convex/_generated/dataModel";
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Home } from "./routes/index";
import { routeTree } from "./routeTree.gen";
import { createInitialSession } from "./domain/simulation";
import type { CaseSession, UploadedDocument } from "./domain/types";
import { documentUploadChunkBytes } from "./application/document-upload";

const mocks = vi.hoisted(() => ({
  context: null as Record<string, any> | null,
  contextListeners: new Set<() => void>(),
  queryResponses: new Map<string, (args: unknown) => unknown>(),
  queryCalls: [] as Array<{ name: string; args: unknown }>,
  mutationHandlers: new Map<string, (...args: any[]) => unknown>(),
  mutationCalls: [] as Array<{ name: string; args: unknown[] }>,
  actionHandlers: new Map<string, (...args: any[]) => unknown>(),
  actionCalls: [] as Array<{ name: string; args: unknown[] }>,
  organizationCancellations: new Set<() => void>(),
  getToken: vi.fn(async () => "convex-jwt"),
  pdfAnalyze: vi.fn(),
  auth: { isLoaded: true, isSignedIn: true, user: { id: "user-a" } },
  router: null as any,
}));

vi.mock("./convex", () => ({ convex: {} }));

vi.mock("./routes/__root", async () => {
  const React = await import("react");
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return {
    Route: createRootRoute({
      component: () => React.createElement(Outlet),
    }),
  };
});

vi.mock("./components/OrganizationContext", async () => {
  const React = await import("react");
  return {
    OrganizationContextProvider: ({
      children,
    }: {
      children: React.ReactNode;
    }) => React.createElement(React.Fragment, null, children),
    useOrganizationContext: () =>
      React.useSyncExternalStore(
        (listener) => {
          mocks.contextListeners.add(listener);
          return () => mocks.contextListeners.delete(listener);
        },
        () => mocks.context,
      ),
  };
});

vi.mock("convex/react", async () => {
  const { getFunctionName: functionName } = await import("convex/server");
  return {
    useAction: (reference: Parameters<typeof functionName>[0]) => {
      const name = functionName(reference);
      return (...args: any[]) => {
        mocks.actionCalls.push({ name, args });
        return mocks.actionHandlers.get(name)?.(...args);
      };
    },
    useConvexAuth: () => ({
      isLoading: false,
      isAuthenticated: mocks.auth.isSignedIn,
    }),
    useQuery: (
      reference: Parameters<typeof functionName>[0],
      args: unknown,
    ) => {
      const name = functionName(reference);
      mocks.queryCalls.push({ name, args });
      if (args === "skip") return undefined;
      return mocks.queryResponses.get(name)?.(args);
    },
    useMutation: (reference: Parameters<typeof functionName>[0]) => {
      const name = functionName(reference);
      return (...args: any[]) => {
        mocks.mutationCalls.push({ name, args });
        return mocks.mutationHandlers.get(name)?.(...args);
      };
    },
  };
});

vi.mock("@clerk/tanstack-react-start", async () => {
  const React = await import("react");
  const passThrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    ClerkProvider: passThrough,
    useAuth: () => ({
      isLoaded: true,
      isSignedIn: mocks.auth.isSignedIn,
      getToken: mocks.getToken,
    }),
    useUser: () => mocks.auth,
    Show: ({
      when,
      children,
    }: {
      when: "signed-in" | "signed-out";
      children: React.ReactNode;
    }) => {
      const visible =
        when === "signed-in" ? mocks.auth.isSignedIn : !mocks.auth.isSignedIn;
      return visible
        ? React.createElement(React.Fragment, null, children)
        : null;
    },
    ClerkLoaded: ({ children }: { children: React.ReactNode }) =>
      mocks.auth.isLoaded
        ? React.createElement(React.Fragment, null, children)
        : null,
    ClerkLoading: ({ children }: { children: React.ReactNode }) =>
      mocks.auth.isLoaded
        ? null
        : React.createElement(React.Fragment, null, children),
    SignInButton: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SignUpButton: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SignOutButton: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    UserButton: () => null,
  };
});

vi.mock("./modules/documents/pdfjs-analyzer", () => ({
  pdfJsAnalyzer: { analyze: mocks.pdfAnalyze },
}));

vi.mock("convex/react-clerk", async () => {
  const React = await import("react");
  return {
    ConvexProviderWithClerk: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

type Role = "learner" | "instructor" | "admin";
type ScopeStatus = "ready" | "loading" | "unavailable";

const roleByOrganization: Record<string, Role> = {
  "org-a": "learner",
  "org-b": "learner",
  "org-teaching": "instructor",
  "org-admin": "admin",
  "org-personal": "admin",
};

const cohortA = {
  id: "cohort-a" as Id<"cohorts">,
  institutionId: "org-a" as Id<"institutions">,
  institutionName: "Organization A",
  title: "A Civil Appeals Course",
  term: "Fall 2026",
  role: "learner" as Role,
  archived: false,
};
const cohortB = {
  ...cohortA,
  id: "cohort-b" as Id<"cohorts">,
  institutionId: "org-b" as Id<"institutions">,
  institutionName: "Organization B",
  title: "B Civil Appeals Course",
};
const teachingCohort = {
  ...cohortA,
  id: "cohort-teaching" as Id<"cohorts">,
  institutionId: "org-teaching" as Id<"institutions">,
  institutionName: "Teaching Organization",
  title: "Teaching Course",
  role: "instructor" as Role,
};
const assignmentA = {
  id: "assignment-a" as Id<"assignments">,
  cohortId: cohortA.id,
  title: "Organization A assignment",
  published: true,
  autonomyMode: "supervised" as const,
  status: "not_started" as const,
  dueAt: undefined,
  institutionName: "Organization A",
  cohortTitle: cohortA.title,
};
const assignmentB = {
  ...assignmentA,
  id: "assignment-b" as Id<"assignments">,
  cohortId: cohortB.id,
  title: "Organization B assignment",
  institutionName: "Organization B",
  cohortTitle: cohortB.title,
};
const assignmentBForSecondUser = {
  ...assignmentB,
  id: "assignment-user-b" as Id<"assignments">,
  title: "User B only assignment",
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function selectedOrganizationContext(
  organizationId: string | null,
  role: Role | null,
  generation: number,
  kind: "shared" | "personal" = "shared",
  status: ScopeStatus = "ready",
) {
  const organization =
    organizationId && role
      ? {
          institutionId: organizationId as Id<"institutions">,
          name:
            kind === "personal"
              ? "Personal workspace"
              : `Organization ${organizationId.slice(-1).toUpperCase()}`,
          kind,
          role,
          capabilities: {
            learn: true,
            teach: role === "instructor" || role === "admin",
            manageMembers: role === "admin",
          },
        }
      : null;
  const organizations = [
    {
      institutionId: "org-a",
      name: "Organization A",
      kind: "shared",
      role: "learner",
    },
    {
      institutionId: "org-b",
      name: "Organization B",
      kind: "shared",
      role: "learner",
    },
    {
      institutionId: "org-teaching",
      name: "Teaching Organization",
      kind: "shared",
      role: "instructor",
    },
    {
      institutionId: "org-admin",
      name: "Admin Organization",
      kind: "shared",
      role: "admin",
    },
    {
      institutionId: "org-personal",
      name: "Personal workspace",
      kind: "personal",
      role: "admin",
    },
  ];

  return {
    organizationId: organizationId as Id<"institutions"> | null,
    organization,
    capabilities: organization?.capabilities ?? {
      learn: false,
      teach: false,
      manageMembers: false,
    },
    status,
    unavailableMessage: null,
    canRecoverUnavailableOrganization: false,
    recoverToPersonalWorkspace: () => undefined,
    canRetryOrganizationBootstrap: false,
    retryOrganizationBootstrap: () => undefined,
    organizations,
    organizationsStatus: "ready" as const,
    selectOrganization: (nextId: Id<"institutions">) => {
      const nextRole = roleByOrganization[String(nextId)];
      publishContext(
        selectedOrganizationContext(
          String(nextId),
          nextRole,
          generation + 1,
          String(nextId) === "org-personal" ? "personal" : "shared",
        ),
      );
      const path = mocks.router?.state.location.pathname ?? "/app";
      const sectionRoot = path.startsWith("/instructor")
        ? "/instructor"
        : path.startsWith("/admin")
          ? "/admin"
          : "/app";
      void mocks.router?.navigate({
        to: sectionRoot,
        search: { organizationId: String(nextId) },
      } as never);
    },
    captureOrganizationContext: () => {
      const current = mocks.context;
      if (current?.status !== "ready" || !current.organizationId) return null;
      return {
        organizationId: current.organizationId,
        generation: current.generation,
      };
    },
    isCurrentOrganizationContext: (capture: {
      organizationId: string;
      generation: number;
    }) => {
      const current = mocks.context;
      return (
        current?.status === "ready" &&
        current.organizationId === capture.organizationId &&
        current.generation === capture.generation
      );
    },
    registerOrganizationCancellation: (cancel: () => void) => {
      mocks.organizationCancellations.add(cancel);
      return () => mocks.organizationCancellations.delete(cancel);
    },
  };
}

function publishContext(context: Record<string, any>) {
  mocks.context = context;
  for (const listener of mocks.contextListeners) listener();
  for (const cancel of mocks.organizationCancellations) cancel();
}

function setContext(
  organizationId: string | null,
  role: Role | null,
  generation = 1,
  kind: "shared" | "personal" = "shared",
  status: ScopeStatus = "ready",
) {
  publishContext(
    selectedOrganizationContext(organizationId, role, generation, kind, status),
  );
}

function setQueryResponse(
  name: string,
  response: unknown | ((args: unknown) => unknown),
) {
  mocks.queryResponses.set(
    name,
    typeof response === "function"
      ? (response as (args: unknown) => unknown)
      : () => response,
  );
}

function queryCalls(name: string) {
  return mocks.queryCalls.filter((call) => call.name === name);
}

function createTestRouter(initialEntry: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  mocks.router = router;
  return router;
}

function renderRoute(initialEntry: string) {
  const router = createTestRouter(initialEntry);
  return { router, ...render(<RouterProvider router={router} />) };
}

function renderHomeRoute() {
  return render(<Home />);
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mocks.contextListeners.clear();
  mocks.organizationCancellations.clear();
  mocks.queryResponses.clear();
  mocks.queryCalls.length = 0;
  mocks.mutationHandlers.clear();
  mocks.mutationCalls.length = 0;
  mocks.actionHandlers.clear();
  mocks.actionCalls.length = 0;
  mocks.getToken.mockReset();
  mocks.getToken.mockResolvedValue("convex-jwt");
  mocks.pdfAnalyze.mockReset();
  mocks.pdfAnalyze.mockImplementation(
    async (file: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }) => ({
      analyzerId: "route-fixture-analyzer",
      fileSizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      searchableText: true,
      normalizedText: `analysis for ${file.fileName}`,
      certificateOfServiceDetected: false,
      certificateOfComplianceDetected: false,
      sealedOrRedactionWarning: false,
      warnings: [],
    }),
  );
  mocks.auth.isLoaded = true;
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: "user-a" };
  setContext("org-a", "learner");

  setQueryResponse("cohorts:listMine", (args: unknown) => {
    const institutionId = (args as { institutionId?: string }).institutionId;
    const cohorts =
      mocks.auth.user.id === "user-b"
        ? [cohortB]
        : [cohortA, cohortB, teachingCohort];
    return institutionId
      ? cohorts.filter((row) => row.institutionId === institutionId)
      : cohorts;
  });
  setQueryResponse("assignments:listMine", (args: unknown) => {
    const institutionId = (args as { institutionId?: string }).institutionId;
    const assignments =
      mocks.auth.user.id === "user-b"
        ? [assignmentBForSecondUser]
        : [assignmentA, assignmentB];
    const cohortByOrganization: Record<string, string> = {
      "org-a": cohortA.id,
      "org-b": cohortB.id,
      "org-teaching": teachingCohort.id,
    };
    const selectedCohortId = institutionId
      ? cohortByOrganization[institutionId]
      : undefined;
    return selectedCohortId
      ? assignments.filter((row) => row.cohortId === selectedCohortId)
      : assignments;
  });
  setQueryResponse("policies:listCurrent", []);
  setQueryResponse("assignments:listForCohort", (args: unknown) => {
    const { cohortId } = args as { cohortId: string };
    return cohortId === cohortA.id
      ? [assignmentA]
      : cohortId === cohortB.id
        ? [
            mocks.auth.user.id === "user-b"
              ? assignmentBForSecondUser
              : assignmentB,
          ]
        : cohortId === teachingCohort.id
          ? [
              {
                ...assignmentA,
                id: "assignment-teaching",
                cohortId: teachingCohort.id,
              },
            ]
          : [];
  });
  setQueryResponse("cohorts:listRoster", [
    {
      userId: "roster-learner",
      displayName: "Learner One",
      organizationRole: "learner",
    },
  ]);
  setQueryResponse("scenarios:listPublishedRecords", [
    {
      scenarioKey: "bundled-civil-appeal",
      title: "Bundled Civil Appeal",
      courtPackId: "us-federal-ca4-civil-appeal",
      shortCaption: "Bundled v. United States",
      proceduralPosture: "Appeal",
    },
    {
      scenarioKey: "imported-organization-scenario",
      title: "Imported Organization Scenario",
      courtPackId: "us-federal-ca4-civil-appeal",
      shortCaption: "Imported v. Organization",
      proceduralPosture: "Appeal",
    },
  ]);
  setQueryResponse("users:listOrganizationMembers", (args: unknown) => {
    const institutionId = (args as { institutionId: string }).institutionId;
    return [
      {
        membershipId: `membership-${institutionId}`,
        userId: "member-user",
        displayName:
          institutionId === "org-b"
            ? "Organization B Member"
            : "Organization A Member",
        role: "admin",
        status: "active",
        ...(institutionId === "org-admin"
          ? { expiresAt: "2020-01-01T00:00:00.000Z" }
          : {}),
      },
    ];
  });
  setQueryResponse("assignments:get", (args: unknown) => {
    const { assignmentId } = args as { assignmentId: string };
    const summary =
      assignmentId === assignmentA.id
        ? assignmentA
        : assignmentId === assignmentBForSecondUser.id
          ? assignmentBForSecondUser
          : assignmentB;
    return {
      ...summary,
      brief: "Assignment instructions for the selected organization.",
      caseSessionId: undefined,
      rubricId: "civil-appeals",
      budgetCapCents: 500,
    };
  });
  mocks.mutationHandlers.set(
    "users:updateOrganizationMember",
    async () => undefined,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.router = null;
});

describe("organization scoped route access", () => {
  it("opens learner assignment cards in Study and restores the route with Back and Forward", async () => {
    setContext("org-a", "learner");
    const { router } = renderRoute("/app?organizationId=org-a");

    expect(await screen.findByText("Organization A assignment")).toBeTruthy();
    expect(screen.queryByText("Organization B assignment")).toBeNull();
    const card = screen.getByRole("link", {
      name: /Organization A assignment/,
    });
    fireEvent.click(card);

    expect(
      await screen.findByRole("heading", { name: "Organization A assignment" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(
      "/app/assignments/assignment-a",
    );
    expect(router.state.location.search).toMatchObject({
      cohortId: "cohort-a",
      organizationId: "org-a",
    });
    expect(queryCalls("assignments:get").at(-1)?.args).toEqual({
      assignmentId: assignmentA.id,
    });
    expect(queryCalls("cohorts:listMine").at(-1)?.args).toEqual({
      institutionId: "org-a",
    });
    expect(queryCalls("assignments:listMine").at(-1)?.args).toEqual({
      institutionId: "org-a",
    });

    await act(async () => router.history.back());
    expect(await screen.findByText("Organization A assignment")).toBeTruthy();
    await act(async () => router.history.forward());
    expect(
      await screen.findByRole("heading", { name: "Organization A assignment" }),
    ).toBeTruthy();
  });

  it("switches Study scope, filters account wide results, and clears organization data on signout", async () => {
    setContext("org-a", "learner");
    renderRoute("/app?organizationId=org-a");
    expect(await screen.findByText("Organization A assignment")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Organization" }), {
      target: { value: "org-b" },
    });
    expect(await screen.findByText("Organization B assignment")).toBeTruthy();
    expect(screen.queryByText("Organization A assignment")).toBeNull();
    expect(mocks.router.state.location.pathname).toBe("/app");
    expect(mocks.router.state.location.search).toMatchObject({
      organizationId: "org-b",
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Organization" }), {
      target: { value: "org-a" },
    });
    expect(await screen.findByText("Organization A assignment")).toBeTruthy();
    expect(screen.queryByText("Organization B assignment")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Organization" }), {
      target: { value: "org-b" },
    });
    expect(await screen.findByText("Organization B assignment")).toBeTruthy();
    expect(screen.queryByText("Organization A assignment")).toBeNull();

    mocks.auth.user = { id: "user-b" };
    setContext(null, null, 4, "shared", "loading");
    await waitFor(() => {
      expect(screen.queryByText("Organization B assignment")).toBeNull();
    });
    setContext("org-b", "learner", 5);
    expect(await screen.findByText("User B only assignment")).toBeTruthy();
    expect(screen.queryByText("Organization B assignment")).toBeNull();

    mocks.auth.isSignedIn = false;
    setContext(null, null, 6, "shared", "loading");
    await waitFor(() => {
      expect(screen.queryByText("User B only assignment")).toBeNull();
    });
    expect(
      screen.queryByText(
        "Assignment instructions for the selected organization.",
      ),
    ).toBeNull();
  });

  it("denies a direct instructor course URL to a learner before privileged queries run", async () => {
    setContext("org-a", "learner");
    renderRoute("/instructor/cohorts/cohort-teaching?organizationId=org-a");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByText(/does not have access to this section/i),
    ).toBeTruthy();
    expect(queryCalls("cohorts:listMine")).toHaveLength(0);
    expect(queryCalls("cohorts:listRoster")).toHaveLength(0);
    expect(queryCalls("instructor:getSessionReplay")).toHaveLength(0);
    expect(queryCalls("instructor:getReviewContext")).toHaveLength(0);
  });

  it("denies a direct review URL to a learner before review reads run", async () => {
    setContext("org-a", "learner");
    renderRoute(
      "/instructor/sessions/session-a/review?organizationId=org-a&cohortId=cohort-teaching&assignmentId=assignment-a",
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByText(/does not have access to this section/i),
    ).toBeTruthy();
    expect(queryCalls("cohorts:listMine")).toHaveLength(0);
    expect(queryCalls("instructor:listAssignmentSessions")).toHaveLength(0);
    expect(queryCalls("instructor:getSessionReplay")).toHaveLength(0);
    expect(queryCalls("instructor:getReviewContext")).toHaveLength(0);
  });

  it("skips privileged course detail reads for a course in another organization", async () => {
    setContext("org-teaching", "instructor");
    renderRoute("/instructor/cohorts/cohort-a?organizationId=org-teaching");

    expect(
      await screen.findByText("Course not found in this organization."),
    ).toBeTruthy();
    expect(queryCalls("cohorts:listMine").at(-1)?.args).toEqual({
      institutionId: "org-teaching",
    });
    expect(queryCalls("cohorts:listRoster").at(-1)?.args).toBe("skip");
    expect(queryCalls("assignments:listForCohort").at(-1)?.args).toBe("skip");
    expect(queryCalls("scenarios:listPublishedRecords").at(-1)?.args).toBe(
      "skip",
    );
  });

  it.each([
    ["instructor", ["Learner"]],
    ["admin", ["Learner", "Instructor"]],
  ] as const)(
    "shows selected organization teaching controls for %s role",
    async (role, expectedOptions) => {
      setContext("org-teaching", role);
      renderRoute(
        "/instructor/cohorts/cohort-teaching?organizationId=org-teaching",
      );

      expect(
        await screen.findByRole("heading", { name: "Teaching Course" }),
      ).toBeTruthy();
      expect(screen.getByText("Organization role: learner")).toBeTruthy();
      expect(queryCalls("cohorts:listMine").at(-1)?.args).toEqual({
        institutionId: "org-teaching",
      });
      expect(queryCalls("scenarios:listPublishedRecords").at(-1)?.args).toEqual(
        {},
      );
      const inviteOptions = within(
        screen.getByRole("combobox", { name: "Invite role" }),
      )
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(inviteOptions).toEqual(expectedOptions);
      expect(
        within(screen.getByRole("combobox", { name: "Scenario" })).getByRole(
          "option",
          { name: "Imported Organization Scenario" },
        ),
      ).toBeTruthy();
      expect(queryCalls("cohorts:listRoster").at(-1)?.args).toEqual({
        cohortId: teachingCohort.id,
      });
    },
  );

  it("keeps admin membership search and writes inside the selected shared organization", async () => {
    setContext("org-admin", "admin");
    renderRoute("/admin?organizationId=org-admin");
    expect(await screen.findByText("Organization A Member")).toBeTruthy();
    expect(queryCalls("users:listOrganizationMembers").at(-1)?.args).toEqual({
      institutionId: "org-admin",
    });

    const memberSearch = screen.getByRole("searchbox", {
      name: "Search selected organization members",
    });
    expect(memberSearch.getAttribute("maxlength")).toBe("120");
    fireEvent.change(memberSearch, {
      target: { value: "learner".padEnd(121, "x") },
    });
    await waitFor(() => {
      const searchArgs = queryCalls("users:listOrganizationMembers").at(-1)
        ?.args as { institutionId: string; search?: string };
      expect(searchArgs.institutionId).toBe("org-admin");
      expect(searchArgs.search).toHaveLength(120);
    });

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Status for Organization A Member",
      }),
      {
        target: { value: "suspended" },
      },
    );
    mocks.mutationHandlers.set("users:updateOrganizationMember", async () => {
      throw new Error("CONFLICT: Cannot suspend the last active admin");
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Cannot suspend the last active admin",
    );
    expect(mocks.mutationCalls.at(-1)).toEqual({
      name: "users:updateOrganizationMember",
      args: [
        {
          institutionId: "org-admin",
          membershipId: "membership-org-admin",
          role: "admin",
          status: "suspended",
        },
      ],
    });
  });

  it("shows expired admin access and renews membership expiry in the selected organization", async () => {
    setContext("org-admin", "admin");
    renderRoute("/admin?organizationId=org-admin");
    expect(await screen.findByText(/Access: Expired/)).toBeTruthy();

    const expiryInput = screen.getByLabelText(
      "Expiry for Organization A Member",
    );
    fireEvent.change(expiryInput, {
      target: { value: "2999-01-01T12:00:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.mutationCalls.at(-1)).toEqual({
        name: "users:updateOrganizationMember",
        args: [
          {
            institutionId: "org-admin",
            membershipId: "membership-org-admin",
            role: "admin",
            status: "active",
            expiresAt: new Date("2999-01-01T12:00:00").toISOString(),
          },
        ],
      });
    });
  });

  it("does not show a parseable non-UTC expiry as active access", async () => {
    setContext("org-admin", "admin");
    setQueryResponse("users:listOrganizationMembers", [
      {
        membershipId: "membership-org-admin",
        userId: "member-user",
        displayName: "Organization A Member",
        role: "learner",
        status: "active",
        expiresAt: "2999-01-01 00:00:00",
      },
    ]);
    renderRoute("/admin?organizationId=org-admin");

    expect(await screen.findByText(/Access: Expiration invalid/)).toBeTruthy();
  });

  it("requires a future expiry before reactivating a suspended expired membership", async () => {
    setContext("org-admin", "admin");
    setQueryResponse("users:listOrganizationMembers", [
      {
        membershipId: "membership-org-admin",
        userId: "member-user",
        displayName: "Organization A Member",
        role: "learner",
        status: "suspended",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    renderRoute("/admin?organizationId=org-admin");
    expect(await screen.findByText(/Access: Suspended/)).toBeTruthy();

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Status for Organization A Member",
      }),
      { target: { value: "active" } },
    );
    expect(
      screen.getByText(
        "Set a future expiry before reactivating this membership.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.change(
      screen.getByLabelText("Expiry for Organization A Member"),
      { target: { value: "2999-01-01T12:00:00" } },
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
      ).toBe(false);
    });
  });

  it("blocks reactivation when a suspended membership has a parseable non-UTC expiry", async () => {
    setContext("org-admin", "admin");
    setQueryResponse("users:listOrganizationMembers", [
      {
        membershipId: "membership-org-admin",
        userId: "member-user",
        displayName: "Organization A Member",
        role: "learner",
        status: "suspended",
        expiresAt: "2999-01-01 00:00:00",
      },
    ]);
    renderRoute("/admin?organizationId=org-admin");
    expect(await screen.findByText(/Access: Suspended/)).toBeTruthy();

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Status for Organization A Member",
      }),
      { target: { value: "active" } },
    );
    expect(
      screen.getByText(
        "Set a future expiry before reactivating this membership.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("hides personal owner membership controls and ignores a late response after switching organizations", async () => {
    setContext("org-admin", "admin");
    const lateUpdate = deferred<void>();
    mocks.mutationHandlers.set(
      "users:updateOrganizationMember",
      () => lateUpdate.promise,
    );
    renderRoute("/admin?organizationId=org-admin");
    expect(await screen.findByText("Organization A Member")).toBeTruthy();

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Status for Organization A Member",
      }),
      {
        target: { value: "suspended" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saving…")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Organization" }), {
      target: { value: "org-personal" },
    });
    expect(
      await screen.findByText("Membership controls are unavailable"),
    ).toBeTruthy();
    expect(screen.getByText(/owner-only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    const memberQueries = queryCalls("users:listOrganizationMembers");
    expect(
      memberQueries.every(
        ({ args }) =>
          args === "skip" ||
          (args as { institutionId?: string }).institutionId !== "org-personal",
      ),
    ).toBe(true);

    await act(async () => {
      lateUpdate.reject(new Error("stale last-admin error"));
      await lateUpdate.promise.catch(() => undefined);
    });
    expect(screen.queryByText("stale last-admin error")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not run privileged assignment or review queries for a cross organization direct URL", async () => {
    setContext("org-teaching", "instructor");
    renderRoute(
      "/instructor/assignments/assignment-a?organizationId=org-teaching&cohortId=cohort-a",
    );
    expect(
      await screen.findByText("Assignment not found in this organization."),
    ).toBeTruthy();
    expect(
      queryCalls("assignments:listForCohort").every(
        ({ args }) => args === "skip",
      ),
    ).toBe(true);
    expect(
      queryCalls("assignments:get").every(({ args }) => args === "skip"),
    ).toBe(true);
    expect(
      queryCalls("instructor:listAssignmentSessions").every(
        ({ args }) => args === "skip",
      ),
    ).toBe(true);
  });
});

function homeSession(id: string, title: string): CaseSession {
  const initial = createInitialSession();
  return {
    ...initial,
    id,
    institutionId: "org-a" as Id<"institutions">,
    scenario: {
      ...initial.scenario,
      title,
      shortCaption: title,
    },
  };
}

function recoveredPdf(
  id: string,
  fileName: string,
  bytes: Uint8Array,
): UploadedDocument {
  return {
    id,
    analysisId: `analysis-${id}`,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    extractedText: `persisted text for ${fileName}`,
    extractedSignals: ["fixture document"],
    analysis: {
      analyzerId: "route-fixture-analyzer",
      fileSizeBytes: bytes.byteLength,
      mimeType: "application/pdf",
      searchableText: true,
      normalizedText: `persisted text for ${fileName}`,
      certificateOfServiceDetected: false,
      certificateOfComplianceDetected: false,
      sealedOrRedactionWarning: false,
      warnings: [],
    },
  };
}

function rejectedFiling(document: UploadedDocument) {
  return {
    id: "rejected-filing-attempt",
    eventId: "notice_of_appeal",
    participantRole: "appellant" as const,
    title: "Rejected notice attempt",
    documents: [document],
    certificateOfService: true,
    certificateOfCompliance: false,
    sealed: false,
    notes: "",
    filedAt: "2026-10-04T12:00:00.000Z",
    outcome: "rejected" as const,
    validationIssues: [],
  };
}

function acceptedFiling(
  document: UploadedDocument,
): CaseSession["filings"][number] {
  return {
    ...rejectedFiling(document),
    id: "accepted-filing",
    outcome: "accepted",
  };
}

function installHomeQueries(
  sessions: CaseSession[],
  recoveredBySession: Map<string, UploadedDocument[]>,
) {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  const recoveryResults = new Map<
    string,
    { caseSessionId: string; documents: UploadedDocument[] }
  >();
  setQueryResponse("caseSessions:getForCurrentUser", (args: unknown) => {
    const caseSessionId = (args as { caseSessionId?: string }).caseSessionId;
    if (caseSessionId) return sessionsById.get(caseSessionId);
    return mocks.auth.user.id === "user-b"
      ? (sessions[1] ?? sessions[0])
      : sessions[0];
  });
  setQueryResponse(
    "caseSessions:listForCurrentUser",
    sessions.map((session) => ({
      id: session.id,
      scenarioTitle: session.scenario.title,
      shortCaption: session.scenario.shortCaption,
      status: session.status,
      simulatedDate: session.simulatedDate,
      createdAt: 1,
    })),
  );
  setQueryResponse("caseSessions:getTrialDocketForCurrentUser", undefined);
  setQueryResponse("caseSessions:getAvailableEcfEvents", []);
  setQueryResponse(
    "caseSessions:getUnfiledDocumentsForCurrentUser",
    (args: unknown) => {
      const caseSessionId = (args as { caseSessionId: string }).caseSessionId;
      let result = recoveryResults.get(caseSessionId);
      if (!result) {
        result = { caseSessionId, documents: [] };
        recoveryResults.set(caseSessionId, result);
      }
      result.documents = recoveredBySession.get(caseSessionId) ?? [];
      return result;
    },
  );
  setQueryResponse("scenarios:listAvailableForCurrentUser", []);
  setQueryResponse("integrations:getIntegrationStatus", {
    openRouterConfigured: false,
    courtListenerConfigured: false,
  });
  mocks.mutationHandlers.set("users:upsertCurrentUser", async () => undefined);
}

function installDocumentHandlers(
  recoveredBySession: Map<string, UploadedDocument[]>,
) {
  let intentSequence = 0;
  const receipts = new Map<
    string,
    { sizeBytes: number; sha256: string; fileName: string }
  >();
  mocks.mutationHandlers.set(
    "documentUploads:begin",
    async (args: {
      scope: { caseSessionId: string };
      fileName: string;
      sizeBytes: number;
      sha256: string;
    }) => {
      const intentId = `route-intent-${++intentSequence}`;
      receipts.set(intentId, args);
      return {
        intentId,
        chunkBytes: documentUploadChunkBytes,
        expiresAt: "2026-10-05T00:00:00.000Z",
      };
    },
  );
  mocks.actionHandlers.set(
    "documentUploadActions:complete",
    async ({ intentId }: { intentId: string }) => {
      const receipt = receipts.get(intentId);
      if (!receipt) throw new Error("Unknown fixture upload intent");
      return { intentId, ...receipt };
    },
  );
  mocks.actionHandlers.set("documentUploadActions:cancel", async () => null);
  mocks.mutationHandlers.set(
    "caseSessions:persistDocumentAnalysis",
    async (args: {
      caseSessionId: string;
      intentId: string;
      document: UploadedDocument;
    }) => {
      const receipt = receipts.get(args.intentId);
      if (!receipt) throw new Error("Unknown fixture upload intent");
      const document: UploadedDocument = {
        ...args.document,
        id: `route-document-${args.intentId}`,
        analysisId: `route-analysis-${args.intentId}`,
      };
      recoveredBySession.set(args.caseSessionId, [
        ...(recoveredBySession.get(args.caseSessionId) ?? []),
        document,
      ]);
      return { document, analysisId: document.analysisId };
    },
  );
  return receipts;
}

function chunkAcknowledgment(url: URL, bytes: Uint8Array) {
  return Response.json({
    intentId: url.searchParams.get("intentId"),
    index: Number(url.searchParams.get("index")),
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function privateDownloadResponse(bytes: Uint8Array) {
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="document.pdf"',
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/pdf",
      "X-Document-Size": String(bytes.byteLength),
    },
  });
}

function installRouteObjectUrlMocks() {
  let nextUrl = 0;
  const createObjectURL = vi.fn(() => `blob:route-${++nextUrl}`);
  const revokeObjectURL = vi.fn();
  const OriginalURL = URL;
  class RouteURL extends OriginalURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal("URL", RouteURL);
  return { createObjectURL, revokeObjectURL };
}

async function openDocumentStep() {
  fireEvent.click(await screen.findByRole("button", { name: "File" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Step 3 Documents/ }),
  );
  return screen.getByLabelText("PDF documents") as HTMLInputElement;
}

describe("document transport route integration", () => {
  it("resets the native PDF input and retries the same file after a chunk failure", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://fixture.convex.site");
    const session = homeSession("route-same-file-retry", "Same File Retry");
    const recoveredBySession = new Map<string, UploadedDocument[]>();
    installHomeQueries([session], recoveredBySession);
    const receipts = installDocumentHandlers(recoveredBySession);
    let postCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === "GET") {
          throw new Error("This test does not request a download.");
        }
        postCount += 1;
        if (postCount === 1) {
          return Response.json({ error: "temporary storage outage" }, { status: 503 });
        }
        const bytes = new Uint8Array(await (init?.body as Blob).arrayBuffer());
        return chunkAcknowledgment(url, bytes);
      }),
    );

    renderHomeRoute();
    expect(
      await screen.findByRole("heading", { name: "Same File Retry" }),
    ).toBeTruthy();
    const input = await openDocumentStep();
    const file = new File(["%PDF-1.7\nsame file retry"], "same.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(input.value).toBe("");
    expect(
      await screen.findByText(/private document service could not accept this request/i),
    ).toBeTruthy();
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { files: [file] } });
    expect(input.value).toBe("");
    expect(await screen.findByText("Main document: same.pdf")).toBeTruthy();
    expect(postCount).toBe(2);
    expect(receipts.size).toBe(1);
    expect(
      mocks.mutationCalls.filter((call) => call.name === "documentUploads:begin"),
    ).toHaveLength(1);
    expect(
      mocks.mutationCalls.filter(
        (call) => call.name === "caseSessions:persistDocumentAnalysis",
      ),
    ).toHaveLength(1);
  });

  it("does not attach a late server-committed completion after a session switch", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://fixture.convex.site");
    const sessionA = homeSession("route-completion-session-a", "Session A");
    const sessionB = homeSession("route-completion-session-b", "Session B");
    const recoveredBySession = new Map<string, UploadedDocument[]>();
    installHomeQueries([sessionA, sessionB], recoveredBySession);
    const receipts = installDocumentHandlers(recoveredBySession);
    const completionStarted = deferred<void>();
    const lostResponse = deferred<{
      intentId: string;
      sizeBytes: number;
      sha256: string;
      fileName: string;
    }>();
    let completionCalls = 0;
    let committedIntent: string | null = null;
    mocks.actionHandlers.set(
      "documentUploadActions:complete",
      ({ intentId }: { intentId: string }) => {
        completionCalls += 1;
        const receipt = receipts.get(intentId);
        if (!receipt) throw new Error("Unknown fixture upload intent");
        const committedReceipt = { intentId, ...receipt };
        if (completionCalls === 1) {
          committedIntent = intentId;
          completionStarted.resolve();
          return lostResponse.promise;
        }
        return committedReceipt;
      },
    );
    let postCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === "GET") {
          throw new Error("This test does not request a download.");
        }
        postCount += 1;
        const bytes = new Uint8Array(await (init?.body as Blob).arrayBuffer());
        return chunkAcknowledgment(url, bytes);
      }),
    );

    renderHomeRoute();
    expect(await screen.findByRole("heading", { name: "Session A" })).toBeTruthy();
    const file = new File(["%PDF-1.7\ncompletion recovery"], "recover.pdf", {
      type: "application/pdf",
    });
    const input = await openDocumentStep();
    fireEvent.change(input, { target: { files: [file] } });
    expect(input.value).toBe("");
    await completionStarted.promise;

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: sessionB.id },
    });
    expect(await screen.findByRole("heading", { name: "Session B" })).toBeTruthy();
    const switchedInput = await openDocumentStep();
    expect(switchedInput.disabled).toBe(false);
    expect(committedIntent).toBe("route-intent-1");
    expect(
      mocks.actionCalls.filter((call) => call.name === "documentUploadActions:cancel"),
    ).toHaveLength(0);
    lostResponse.resolve({
      intentId: "route-intent-1",
      fileName: "recover.pdf",
      sizeBytes: file.size,
      sha256: createHash("sha256")
        .update(new Uint8Array(await file.arrayBuffer()))
        .digest("hex"),
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(
      mocks.mutationCalls.filter(
        (call) => call.name === "caseSessions:persistDocumentAnalysis",
      ),
    ).toHaveLength(0);
    expect(screen.queryByText("Main document: recover.pdf")).toBeNull();
    expect(postCount).toBe(1);
    expect(receipts.size).toBe(1);
    expect(completionCalls).toBe(1);
  });

  it("keeps accepted filing PDFs downloadable in the filing view after reload without adding them to a draft", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://fixture.convex.site");
    const objectUrls = installRouteObjectUrlMocks();
    const bytes = new Uint8Array(Buffer.from("%PDF-1.7\naccepted filing"));
    const document = recoveredPdf("accepted-filed-document", "accepted.pdf", bytes);
    const session = homeSession("route-filed-document", "Filed Document");
    session.filings = [acceptedFiling(document)];
    installHomeQueries([session], new Map());
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).searchParams.get("documentId")).toBe(
        document.id,
      );
      return privateDownloadResponse(bytes);
    });
    vi.stubGlobal("fetch", fetcher);

    const firstRender = renderHomeRoute();
    expect(
      await screen.findByRole("heading", { name: "Filed Document" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(
      await screen.findByRole("heading", { name: "Accepted filing PDFs" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Step 3 Documents/ }),
    );
    expect(screen.queryByText("Main document: accepted.pdf")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add accepted.pdf to draft" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download accepted.pdf" }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(1);

    firstRender.unmount();
    renderHomeRoute();
    expect(
      await screen.findByRole("heading", { name: "Filed Document" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(
      await screen.findByRole("heading", { name: "Accepted filing PDFs" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Download accepted.pdf" }),
    );
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(2));
    expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("clears cancelled upload state on session change, protects a replacement operation, and permits download retry after signout", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://fixture.convex.site");
    const objectUrls = installRouteObjectUrlMocks();
    const sessionA = homeSession("route-session-a", "Session A");
    const sessionB = homeSession("route-session-b", "Session B");
    const recoveredBySession = new Map<string, UploadedDocument[]>();
    installHomeQueries([sessionA, sessionB], recoveredBySession);
    const receipts = installDocumentHandlers(recoveredBySession);
    const lateOldCancel = deferred<null>();
    mocks.actionHandlers.set(
      "documentUploadActions:cancel",
      ({ intentId }: { intentId: string }) =>
        intentId === "route-intent-1"
          ? lateOldCancel.promise
          : Promise.resolve(null),
    );

    const oldRequestStarted = deferred<void>();
    const replacementRequestStarted = deferred<void>();
    const releaseReplacement = deferred<void>();
    let postCount = 0;
    let replacementBytes = new Uint8Array();
    let downloadCount = 0;
    const cancelledDownloadStarted = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === "GET") {
          downloadCount += 1;
          if (downloadCount === 2) {
            cancelledDownloadStarted.resolve();
            return await new Promise<Response>((_resolve, reject) => {
              const signal = init.signal;
              const onAbort = () =>
                reject(new DOMException("aborted", "AbortError"));
              if (signal?.aborted) onAbort();
              else signal?.addEventListener("abort", onAbort, { once: true });
            });
          }
          return privateDownloadResponse(replacementBytes);
        }
        postCount += 1;
        if (postCount === 1) {
          oldRequestStarted.resolve();
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const onAbort = () =>
              reject(new DOMException("aborted", "AbortError"));
            if (signal?.aborted) onAbort();
            else signal?.addEventListener("abort", onAbort, { once: true });
          });
        }
        replacementBytes = new Uint8Array(
          await (init?.body as Blob).arrayBuffer(),
        );
        replacementRequestStarted.resolve();
        const acknowledgment = releaseReplacement.promise.then(() =>
          chunkAcknowledgment(url, replacementBytes),
        );
        return acknowledgment;
      }),
    );

    renderHomeRoute();
    expect(
      await screen.findByRole("heading", { name: "Session A" }),
    ).toBeTruthy();
    const firstInput = await openDocumentStep();
    fireEvent.change(firstInput, {
      target: {
        files: [
          new File(["%PDF-1.7\nold upload"], "old.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(firstInput.files).toHaveLength(1);
    await oldRequestStarted.promise;
    expect(firstInput.disabled).toBe(true);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: sessionB.id },
    });
    expect(
      await screen.findByRole("heading", { name: "Session B" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        mocks.actionCalls.some(
          (call) =>
            call.name === "documentUploadActions:cancel" &&
            (call.args[0] as { intentId?: string } | undefined)?.intentId ===
              "route-intent-1",
        ),
      ).toBe(true),
    );

    const secondInput = await openDocumentStep();
    expect(secondInput.disabled).toBe(false);
    fireEvent.change(secondInput, {
      target: {
        files: [
          new File(["%PDF-1.7\nreplacement"], "replacement.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await replacementRequestStarted.promise;
    expect(secondInput.disabled).toBe(true);

    await act(async () => {
      lateOldCancel.resolve(null);
      await lateOldCancel.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      screen.getByText("Extracting PDF text and storing upload..."),
    ).toBeTruthy();
    expect(secondInput.disabled).toBe(true);
    expect(
      mocks.mutationCalls
        .filter((call) => call.name === "caseSessions:persistDocumentAnalysis")
        .map(
          (call) =>
            (call.args[0] as { caseSessionId?: string } | undefined)
              ?.caseSessionId,
        ),
    ).toEqual([]);

    releaseReplacement.resolve();
    expect(
      await screen.findByText(/Main document: replacement\.pdf/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        mocks.mutationCalls
          .filter(
            (call) => call.name === "caseSessions:persistDocumentAnalysis",
          )
          .map(
            (call) =>
              (call.args[0] as { caseSessionId?: string } | undefined)
                ?.caseSessionId,
          ),
      ).toEqual([sessionB.id]),
    );
    await waitFor(() => expect(secondInput.disabled).toBe(false));
    expect(receipts.get("route-intent-2")?.fileName).toBe("replacement.pdf");

    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download replacement.pdf" }),
    );
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Download replacement.pdf" }),
    );
    await cancelledDownloadStarted.promise;
    mocks.auth.isSignedIn = false;
    publishContext(
      selectedOrganizationContext(null, null, 2, "shared", "loading"),
    );
    expect(
      (await screen.findAllByRole("button", { name: "Sign in" })).length,
    ).toBeGreaterThan(0);

    mocks.auth.isSignedIn = true;
    publishContext(selectedOrganizationContext("org-a", "learner", 3));
    expect(
      await screen.findByRole("heading", { name: "Session B" }),
    ).toBeTruthy();
    const signedBackInInput = await openDocumentStep();
    expect(signedBackInInput.disabled).toBe(false);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add replacement.pdf to draft",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Download replacement.pdf" }),
    );
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(2));
    expect(downloadCount).toBe(3);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalled();
  });

  it("ignores a late switch-during-persist result and recovers a rejected document for explicit selection after reset and reload", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://fixture.convex.site");
    installRouteObjectUrlMocks();
    const bytes = new Uint8Array(
      Buffer.from("%PDF-1.7\nrejected but recoverable"),
    );
    const canonical = recoveredPdf(
      "canonical-recovered-document",
      "rejected-attempt.pdf",
      bytes,
    );
    const sessionA = homeSession("route-session-a", "Session A");
    sessionA.filings = [rejectedFiling(canonical)];
    const sessionB = homeSession("route-session-b", "Session B");
    const recoveredBySession = new Map<string, UploadedDocument[]>();
    installHomeQueries([sessionA, sessionB], recoveredBySession);
    installDocumentHandlers(recoveredBySession);

    const persistStarted = deferred<{
      caseSessionId: string;
      intentId: string;
      document: UploadedDocument;
    }>();
    const persistResponse = deferred<{
      document: UploadedDocument;
      analysisId: string;
    }>();
    mocks.mutationHandlers.set(
      "caseSessions:persistDocumentAnalysis",
      (args: {
        caseSessionId: string;
        intentId: string;
        document: UploadedDocument;
      }) => {
        persistStarted.resolve(args);
        return persistResponse.promise;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const bytes = new Uint8Array(await (init?.body as Blob).arrayBuffer());
        return chunkAcknowledgment(url, bytes);
      }),
    );

    const rendered = renderHomeRoute();
    expect(
      await screen.findByRole("heading", { name: "Session A" }),
    ).toBeTruthy();
    const input = await openDocumentStep();
    fireEvent.change(input, {
      target: {
        files: [
          new File([bytes], "rejected-attempt.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    const dispatchedPersist = await persistStarted.promise;
    expect(dispatchedPersist.caseSessionId).toBe(sessionA.id);

    const committedDocument: UploadedDocument = {
      ...dispatchedPersist.document,
      id: canonical.id,
      analysisId: canonical.analysisId,
    };
    recoveredBySession.set(sessionA.id, [committedDocument]);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: sessionB.id },
    });
    expect(
      await screen.findByRole("heading", { name: "Session B" }),
    ).toBeTruthy();
    await act(async () => {
      persistResponse.resolve({
        document: committedDocument,
        analysisId: canonical.analysisId ?? "analysis-canonical",
      });
      await persistResponse.promise;
    });
    expect(
      screen.queryByText("Main document: rejected-attempt.pdf"),
    ).toBeNull();
    expect(
      mocks.mutationCalls
        .filter((call) => call.name === "caseSessions:persistDocumentAnalysis")
        .map(
          (call) =>
            (call.args[0] as { caseSessionId?: string } | undefined)
              ?.caseSessionId,
        ),
    ).toEqual([sessionA.id]);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: sessionA.id },
    });
    expect(
      await screen.findByRole("heading", { name: "Session A" }),
    ).toBeTruthy();
    const recoveredInput = await openDocumentStep();
    expect(recoveredInput.disabled).toBe(false);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add rejected-attempt.pdf to draft",
      }),
    );
    expect(
      await screen.findByText("Main document: rejected-attempt.pdf"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove rejected-attempt.pdf from draft",
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Add rejected-attempt.pdf to draft",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(
      screen.queryByText("Main document: rejected-attempt.pdf"),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Add rejected-attempt.pdf to draft",
      }),
    ).toBeTruthy();

    rendered.unmount();
    renderHomeRoute();
    expect(
      await screen.findByRole("heading", { name: "Session A" }),
    ).toBeTruthy();
    await openDocumentStep();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add rejected-attempt.pdf to draft",
      }),
    );
    expect(
      await screen.findByText("Main document: rejected-attempt.pdf"),
    ).toBeTruthy();
  });
});
