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
} from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type {
  OrganizationContextDTO,
  OrganizationMemberDTO,
} from "../../convex/organizationContracts";
import { AppFrame, OrganizationRouteGate } from "./AppFrame";
import {
  type OrganizationContextCapture,
  OrganizationContextProvider,
  ensurePersonalSingleFlight,
  useOrganizationContext,
} from "./OrganizationContext";

const mocks = vi.hoisted(() => ({
  user: {
    isLoaded: true,
    isSignedIn: true,
    user: { id: "account-a" },
  },
  convexAuth: { isAuthenticated: true, isLoading: false },
  client: {
    watchQuery: vi.fn(),
    query: vi.fn(),
    mutation: vi.fn(),
  },
  upsertCurrentUser: vi.fn(),
}));

vi.mock("@clerk/tanstack-react-start", async () => {
  const React = await import("react");
  return {
    useUser: () => mocks.user,
    ClerkLoaded: ({ children }: { children: React.ReactNode }) =>
      mocks.user.isLoaded
        ? React.createElement(React.Fragment, null, children)
        : null,
    ClerkLoading: ({ children }: { children: React.ReactNode }) =>
      mocks.user.isLoaded
        ? null
        : React.createElement(React.Fragment, null, children),
    SignInButton: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SignOutButton: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    UserButton: () => null,
  };
});

vi.mock("convex/react", () => ({
  useConvex: () => mocks.client,
  useConvexAuth: () => mocks.convexAuth,
  useMutation: () => mocks.upsertCurrentUser,
}));

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

function organization(
  institutionId: string,
  name: string,
  role: OrganizationContextDTO["role"] = "learner",
  kind: OrganizationContextDTO["kind"] = "shared",
  expiresAt?: string,
): OrganizationContextDTO {
  return {
    institutionId: institutionId as Id<"institutions">,
    name,
    kind,
    role,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    capabilities: {
      manageMembers: role === "admin",
      teach: role === "admin" || role === "instructor",
      learn: true,
    },
  };
}

function member(
  institutionId: string,
  name: string,
  role: OrganizationMemberDTO["role"] = "learner",
  kind: OrganizationMemberDTO["kind"] = "shared",
): OrganizationMemberDTO {
  return {
    institutionId: institutionId as Id<"institutions">,
    name,
    role,
    kind,
  };
}

let listedOrganizations: OrganizationMemberDTO[];
let getOrganizationContext: (id: string) => Promise<OrganizationContextDTO>;
let cancellationSpy: () => void;
let cancellationRegistrationCount: number;
let routeContentRenderCount: number;
let latestCapture: ReturnType<
  ReturnType<typeof useOrganizationContext>["captureOrganizationContext"]
>;
let captureOrganizationContext: ReturnType<
  typeof useOrganizationContext
>["captureOrganizationContext"];
let isCaptureCurrent: (capture: OrganizationContextCapture) => boolean;
let contextWatches: Map<
  string,
  {
    result?: OrganizationContextDTO;
    error?: unknown;
    listeners: Set<() => void>;
    notifications: Set<() => void>;
  }
>;

function CancellationRegistration({
  context,
}: {
  context: ReturnType<typeof useOrganizationContext>;
}) {
  useEffect(() => {
    if (context.status !== "ready") return;
    cancellationRegistrationCount += 1;
    return context.registerOrganizationCancellation(cancellationSpy);
  }, [context.registerOrganizationCancellation, context.status]);
  return null;
}

function OrganizationContents() {
  routeContentRenderCount += 1;
  const context = useOrganizationContext();
  latestCapture = context.captureOrganizationContext();
  captureOrganizationContext = context.captureOrganizationContext;
  isCaptureCurrent = context.isCurrentOrganizationContext;

  return (
    <div data-testid="organization-content">
      {context.organization?.name} content ({context.organization?.role})
      <CancellationRegistration context={context} />
    </div>
  );
}

function createTestRouter(initialEntry: string, appTitle = "Assignments") {
  const rootRoute = createRootRoute({
    component: () => (
      <OrganizationContextProvider>
        <Outlet />
      </OrganizationContextProvider>
    ),
  });
  const appFrame = (title: string) => () => (
    <AppFrame title={title}>
      <OrganizationContents />
    </AppFrame>
  );
  const gatedAppFrame = (
    title: string,
    capability: "learn" | "teach" | "manageMembers",
  ) => {
    const Content = appFrame(title);
    return () => (
      <OrganizationRouteGate title={title} capability={capability}>
        <Content />
      </OrganizationRouteGate>
    );
  };
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: appFrame("Study"),
  });
  const AppBase = appFrame(appTitle);
  const AppRouteContent = () => {
    const pathname = useRouterState({
      select: (state) => state.location.pathname,
    });
    return pathname === "/app" ? <AppBase /> : <Outlet />;
  };
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app",
    search: {
      middlewares: [retainSearchParams(["organizationId"])],
    },
    component: () => (
      <OrganizationRouteGate title={appTitle} capability="learn">
        <AppRouteContent />
      </OrganizationRouteGate>
    ),
  });
  const assignmentRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/assignments/$assignmentId",
    component: gatedAppFrame("Private assignment", "learn"),
  });
  const instructorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/instructor",
    search: {
      middlewares: [retainSearchParams(["organizationId"])],
    },
    component: gatedAppFrame("Courses", "teach"),
  });
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    search: {
      middlewares: [retainSearchParams(["organizationId"])],
    },
    component: gatedAppFrame("Organization administration", "manageMembers"),
  });
  const legalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/legal/privacy",
    component: appFrame("Privacy Notice"),
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    appRoute.addChildren([assignmentRoute]),
    instructorRoute,
    adminRoute,
    legalRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  return router;
}

function renderOrganizationApp(
  initialEntry: string,
  strict = false,
  appTitle?: string,
) {
  const router = createTestRouter(initialEntry, appTitle);
  const app = <RouterProvider router={router} />;
  const rendered = render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { ...rendered, router };
}

beforeEach(() => {
  mocks.user.isLoaded = true;
  mocks.user.isSignedIn = true;
  mocks.user.user = { id: "account-a" };
  mocks.convexAuth.isAuthenticated = true;
  mocks.convexAuth.isLoading = false;
  mocks.upsertCurrentUser.mockReset().mockResolvedValue({
    id: "user-a",
    displayName: "User A",
  });
  contextWatches = new Map();
  mocks.client.watchQuery
    .mockReset()
    .mockImplementation((_reference, args: { institutionId?: string }) => {
      if (!args?.institutionId) {
        let result: OrganizationMemberDTO[] | undefined;
        let error: unknown;
        const listeners = new Set<() => void>();
        const watch = {
          onUpdate(callback: () => void) {
            listeners.add(callback);
            void Promise.resolve(listedOrganizations)
              .then((items) => {
                result = items;
                for (const listener of listeners) listener();
              })
              .catch((reason) => {
                error = reason;
                for (const listener of listeners) listener();
              });
            return () => listeners.delete(callback);
          },
          localQueryResult() {
            if (error) throw error;
            return result;
          },
        };
        return watch;
      }

      const id = args.institutionId;
      const state: {
        result?: OrganizationContextDTO;
        error?: unknown;
        listeners: Set<() => void>;
        notifications: Set<() => void>;
      } = { listeners: new Set(), notifications: new Set() };
      contextWatches.set(id, state);
      const watch = {
        onUpdate(callback: () => void) {
          state.listeners.add(callback);
          state.notifications.add(callback);
          void getOrganizationContext(id)
            .then((result) => {
              state.result = result;
              for (const listener of state.notifications) listener();
            })
            .catch((error) => {
              state.error = error;
              for (const listener of state.notifications) listener();
            });
          return () => state.listeners.delete(callback);
        },
        localQueryResult() {
          if (state.error) throw state.error;
          return state.result;
        },
      };
      return watch;
    });
  mocks.client.mutation
    .mockReset()
    .mockResolvedValue({ institutionId: "org-personal" as Id<"institutions"> });
  mocks.client.query
    .mockReset()
    .mockImplementation(async () => listedOrganizations);
  listedOrganizations = [member("org-a", "Org A", "admin")];
  getOrganizationContext = async (id) =>
    organization(id, `Org ${id.slice(-1).toUpperCase()}`, "admin");
  cancellationSpy = vi.fn();
  cancellationRegistrationCount = 0;
  routeContentRenderCount = 0;
  latestCapture = null;
  isCaptureCurrent = () => false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

async function flushAsyncUpdates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OrganizationContextProvider", () => {
  it("does not initialize or query organization context outside organization routes", async () => {
    const { router } = renderOrganizationApp("/");

    expect(await screen.findByTestId("organization-content")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(mocks.upsertCurrentUser).not.toHaveBeenCalled();
    expect(mocks.client.watchQuery).not.toHaveBeenCalled();
    expect(mocks.client.mutation).not.toHaveBeenCalled();
  });

  it("does not offer bootstrap retry to a signed-out user", async () => {
    mocks.user.isSignedIn = false;
    mocks.convexAuth.isAuthenticated = false;
    renderOrganizationApp("/app");

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /sign in to choose an organization/i,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.upsertCurrentUser).not.toHaveBeenCalled();
    expect(mocks.client.watchQuery).not.toHaveBeenCalled();
    expect(mocks.client.mutation).not.toHaveBeenCalled();
  });

  it("retries transient signed-in user initialization failures", async () => {
    mocks.upsertCurrentUser
      .mockRejectedValueOnce(new Error("temporary backend failure"))
      .mockResolvedValueOnce({ id: "user-a", displayName: "User A" });
    getOrganizationContext = async (id) =>
      organization(id, "Personal workspace", "admin", "personal");
    renderOrganizationApp("/app");

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /account could not be initialized/i,
    );
    expect(screen.queryByTestId("organization-content")).toBeNull();
    expect(mocks.client.watchQuery).not.toHaveBeenCalled();
    expect(mocks.client.mutation).not.toHaveBeenCalled();
    expect(mocks.upsertCurrentUser).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(mocks.upsertCurrentUser).toHaveBeenCalledTimes(2);
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
  });

  it("uses read-only list and getContext for direct URLs, keeping revoked IDs unavailable in place", async () => {
    listedOrganizations = [member("org-a", "Org A", "admin")];
    getOrganizationContext = async (id) => {
      if (id === "revoked-org") throw new Error("NOT_FOUND");
      return organization(id, "Org A", "admin");
    };

    const { router } = renderOrganizationApp("/app?organizationId=revoked-org");

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /organization is unavailable/i,
    );
    expect(
      (screen.getByLabelText("Organization") as HTMLSelectElement).value,
    ).toBe("revoked-org");
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("revoked-org");
    expect(mocks.client.mutation).not.toHaveBeenCalled();
    expect(mocks.client.watchQuery).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(screen.queryByRole("link", { name: "Courses" })).toBeNull();
  });

  it("clears a live context and local work when the organization becomes unavailable", async () => {
    const { router } = renderOrganizationApp("/app?organizationId=org-a");
    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    await waitFor(() =>
      expect(cancellationRegistrationCount).toBeGreaterThan(0),
    );
    const capture = latestCapture;
    expect(capture).not.toBeNull();

    await act(async () => {
      const watch = contextWatches.get("org-a");
      if (!watch) throw new Error("Expected the organization context watch");
      watch.error = new Error("NOT_FOUND");
      watch.result = undefined;
      for (const listener of watch.listeners) listener();
    });

    expect(screen.getByRole("alert").textContent).toMatch(
      /organization is unavailable/i,
    );
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
    expect(isCaptureCurrent(capture!)).toBe(false);
    const watch = contextWatches.get("org-a");
    expect(watch).toBeTruthy();
    await act(async () => {
      watch!.error = undefined;
      watch!.result = organization("org-a", "Recovered Org A", "admin");
      for (const listener of watch!.listeners) listener();
    });
    expect(
      await screen.findByText("Recovered Org A content (admin)"),
    ).toBeTruthy();
    expect(latestCapture).not.toBeNull();
    expect(latestCapture!.generation).not.toBe(capture!.generation);
    expect(isCaptureCurrent(latestCapture!)).toBe(true);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");
  });

  it.each(["instructor", "learner"] as const)(
    "invalidates captures and cancels work when authorization changes to %s in place",
    async (role) => {
      const { router } = renderOrganizationApp("/app?organizationId=org-a");
      expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
      await waitFor(() =>
        expect(cancellationRegistrationCount).toBeGreaterThan(0),
      );
      const capture = latestCapture;
      expect(capture).not.toBeNull();
      expect(isCaptureCurrent(capture!)).toBe(true);

      await act(async () => {
        const watch = contextWatches.get("org-a");
        if (!watch) throw new Error("Expected the organization context watch");
        watch.result = organization("org-a", "Org A", role);
        for (const listener of watch.notifications) listener();
      });

      expect(screen.getByText(`Org A content (${role})`)).toBeTruthy();
      expect(router.state.location.pathname).toBe("/app");
      expect(isCaptureCurrent(capture!)).toBe(false);
      expect(cancellationSpy).toHaveBeenCalledTimes(1);
      expect(latestCapture).not.toBeNull();
      expect(latestCapture!.generation).not.toBe(capture!.generation);
      expect(isCaptureCurrent(latestCapture!)).toBe(true);
    },
  );

  it("invalidates captures and cancels registered work at the membership expiry boundary", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T12:00:00.000Z").valueOf();
    const expiresAt = new Date(now + 1_000).toISOString();
    vi.setSystemTime(now);
    getOrganizationContext = async (id) =>
      organization(id, "Org A", "admin", "shared", expiresAt);
    renderOrganizationApp("/app?organizationId=org-a");

    await flushAsyncUpdates();
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(latestCapture).not.toBeNull();
    const capture = latestCapture!;
    expect(isCaptureCurrent(capture)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(isCaptureCurrent(capture)).toBe(true);
    expect(cancellationSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(isCaptureCurrent(capture)).toBe(false);
    expect(cancellationSpy).toHaveBeenCalledTimes(1);

    // A stale cached watch value can notify again after expiry, but must never
    // restore authorization.
    const watch = contextWatches.get("org-a");
    expect(watch).toBeTruthy();
    await act(async () => {
      watch!.error = undefined;
      watch!.result = organization(
        capture.organizationId,
        "Stale Org A",
        "admin",
        "shared",
        expiresAt,
      );
      for (const listener of watch!.notifications) listener();
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(screen.queryByText("Stale Org A content (admin)")).toBeNull();
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
  });

  it("replaces an expiry timer when the membership is renewed", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T12:00:00.000Z").valueOf();
    const firstExpiry = new Date(now + 1_000).toISOString();
    const renewedExpiry = new Date(now + 2_000).toISOString();
    const renewedAgainExpiry = new Date(now + 3_000).toISOString();
    vi.setSystemTime(now);
    getOrganizationContext = async (id) =>
      organization(id, "Org A", "admin", "shared", firstExpiry);
    renderOrganizationApp("/app?organizationId=org-a");
    await flushAsyncUpdates();
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const watch = contextWatches.get("org-a");
    expect(watch).toBeTruthy();
    await act(async () => {
      watch!.error = undefined;
      watch!.result = organization(
        "org-a",
        "Org A",
        "admin",
        "shared",
        renewedExpiry,
      );
      for (const listener of watch!.notifications) listener();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(cancellationSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
    expect(mocks.client.query).toHaveBeenCalledTimes(1);

    await act(async () => {
      const watch = contextWatches.get("org-a");
      if (!watch) throw new Error("Expected the organization context watch");
      watch.error = undefined;
      watch.result = organization(
        "org-a",
        "Org A",
        "admin",
        "shared",
        renewedAgainExpiry,
      );
      for (const listener of watch.notifications) listener();
    });
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(mocks.client.query).toHaveBeenCalledTimes(2);
    expect(cancellationSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes a selected sole membership at expiry and recovers to Personal", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T12:00:00.000Z").valueOf();
    const expiresAt = new Date(now + 1_000).toISOString();
    vi.setSystemTime(now);
    listedOrganizations = [member("org-a", "Org A", "admin")];
    mocks.client.query.mockImplementation(async () =>
      Date.now() < Date.parse(expiresAt) ? listedOrganizations : [],
    );
    getOrganizationContext = async (id) =>
      id === "org-a"
        ? organization(id, "Org A", "admin", "shared", expiresAt)
        : organization(id, "Personal workspace", "admin", "personal");
    const { router } = renderOrganizationApp("/app?organizationId=org-a");
    await flushAsyncUpdates();

    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Org A" })).toBeTruthy();
    expect(mocks.client.query).not.toHaveBeenCalled();
    expect(mocks.client.mutation).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.getByRole("option", { name: "Org A" })).toBeTruthy();
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(mocks.client.query).not.toHaveBeenCalled();
    expect(mocks.client.mutation).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /organization is unavailable/i,
    );
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(screen.queryByRole("option", { name: "Org A" })).toBeNull();
    expect(mocks.client.query).toHaveBeenCalledTimes(1);
    expect(mocks.client.mutation).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Use personal workspace" }),
    );
    await flushAsyncUpdates();
    expect(screen.getByText("Personal workspace content (admin)")).toBeTruthy();
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-personal");
  });

  it("retries the expiry list refresh after the context watch recovers", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T12:00:00.000Z").valueOf();
    const expiresAt = new Date(now + 1_000).toISOString();
    vi.setSystemTime(now);
    mocks.client.query.mockRejectedValueOnce(
      new Error("temporary list refresh failure"),
    );
    getOrganizationContext = async (id) =>
      organization(id, "Org A", "admin", "shared", expiresAt);
    renderOrganizationApp("/app?organizationId=org-a");
    await flushAsyncUpdates();
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();

    const watch = contextWatches.get("org-a");
    expect(watch).toBeTruthy();
    await act(async () => {
      watch!.error = new Error("temporary context failure");
      watch!.result = undefined;
      for (const listener of watch!.notifications) listener();
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(mocks.client.query).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      watch!.error = undefined;
      watch!.result = organization(
        "org-a",
        "Org A",
        "admin",
        "shared",
        expiresAt,
      );
      for (const listener of watch!.notifications) listener();
    });
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(mocks.client.query).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(mocks.client.query).toHaveBeenCalledTimes(2);
  });

  it("rejects captures when expiry has passed before a delayed timer runs", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T12:00:00.000Z").valueOf();
    const expiresAt = new Date(now + 1_000).toISOString();
    vi.setSystemTime(now);
    getOrganizationContext = async (id) =>
      organization(id, "Org A", "admin", "shared", expiresAt);
    renderOrganizationApp("/app?organizationId=org-a");
    await flushAsyncUpdates();
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    expect(cancellationRegistrationCount).toBeGreaterThan(0);
    const capture = latestCapture!;
    expect(capture).not.toBeNull();
    expect(isCaptureCurrent(capture)).toBe(true);

    // Move wall-clock time past expiry without advancing the scheduled timer.
    vi.setSystemTime(now + 1_001);
    expect(captureOrganizationContext()).toBeNull();
    expect(isCaptureCurrent(capture)).toBe(false);
    expect(cancellationSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /organization is unavailable/i,
    );
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
  });

  it("clears pending expiry work on organization switch and signout", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T12:00:00.000Z").valueOf();
    vi.setSystemTime(now);
    listedOrganizations = [
      member("org-a", "Org A", "admin"),
      member("org-b", "Org B", "admin"),
    ];
    getOrganizationContext = async (id) =>
      organization(
        id,
        id === "org-a" ? "Org A" : "Org B",
        "admin",
        "shared",
        new Date(now + (id === "org-a" ? 1_000 : 5_000)).toISOString(),
      );
    const router = createTestRouter("/app?organizationId=org-a");
    const rendered = render(<RouterProvider router={router} />);
    await flushAsyncUpdates();
    expect(screen.getByText("Org A content (admin)")).toBeTruthy();
    const oldCapture = latestCapture!;

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-b" },
    });
    await flushAsyncUpdates();
    expect(screen.getByText("Org B content (admin)")).toBeTruthy();
    expect(isCaptureCurrent(oldCapture)).toBe(false);
    expect(cancellationSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.user.isSignedIn = false;
      mocks.convexAuth.isAuthenticated = false;
      rendered.rerender(<RouterProvider router={router} key="signed-out" />);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /sign in to choose/i,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /sign in to choose/i,
    );
    expect(screen.queryByTestId("organization-content")).toBeNull();
    expect(cancellationSpy).toHaveBeenCalledTimes(2);
  });

  it("single-flights first Study bootstrap, replaces the URL, and reuses it after reload", async () => {
    listedOrganizations = [
      member("org-z", "Zulu Org", "instructor"),
      member("org-personal", "Personal workspace", "admin", "personal"),
      member("org-a", "Alpha Org", "learner"),
    ];
    getOrganizationContext = async (id) =>
      organization(
        id,
        id === "org-personal" ? "Personal workspace" : "Unexpected",
        "admin",
        "personal",
      );

    const rendered = renderOrganizationApp("/app", true);
    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(
      (rendered.router.state.location.search as Record<string, unknown>)
        .organizationId,
    ).toBe("org-personal");
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
    const selector = screen.getByLabelText("Organization") as HTMLSelectElement;
    expect(selector.value).toBe("org-personal");
    expect(
      Array.from(selector.options, (option) => option.textContent),
    ).toEqual(["Personal workspace", "Alpha Org", "Zulu Org"]);
    expect(screen.getByRole("link", { name: "Courses" })).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Organization administration" }),
    ).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Data" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Catalog" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    const reloadedEntry = `${rendered.router.state.location.pathname}?organizationId=${(rendered.router.state.location.search as Record<string, unknown>).organizationId}`;
    rendered.unmount();
    renderOrganizationApp(reloadedEntry);

    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight ensurePersonal mutation between concurrent callers", async () => {
    const mutationResult = deferred<{
      institutionId: Id<"institutions">;
    }>();
    mocks.client.mutation.mockReturnValue(mutationResult.promise);
    const client = mocks.client as unknown as Parameters<
      typeof ensurePersonalSingleFlight
    >[0];

    const first = ensurePersonalSingleFlight(client, "account-a");
    const second = ensurePersonalSingleFlight(client, "account-a");

    expect(second).toBe(first);
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
    await act(async () => {
      mutationResult.resolve({
        institutionId: "org-personal" as Id<"institutions">,
      });
      await expect(Promise.all([first, second])).resolves.toEqual([
        "org-personal",
        "org-personal",
      ]);
    });
  });

  it("reattaches an interrupted Study bootstrap after leaving and returning", async () => {
    const pendingBootstrap = deferred<{
      institutionId: Id<"institutions">;
    }>();
    mocks.client.mutation.mockReturnValue(pendingBootstrap.promise);
    getOrganizationContext = async (id) =>
      organization(id, "Personal workspace", "admin", "personal");
    const { router } = renderOrganizationApp("/app");

    await waitFor(() => expect(mocks.client.mutation).toHaveBeenCalledTimes(1));
    await act(async () => {
      await router.navigate({ to: "/legal/privacy" });
    });
    expect(router.state.location.pathname).toBe("/legal/privacy");
    expect(mocks.client.watchQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      await router.navigate({ to: "/app" });
    });
    await waitFor(() =>
      expect(mocks.upsertCurrentUser).toHaveBeenCalledTimes(2),
    );
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingBootstrap.resolve({
        institutionId: "org-personal" as Id<"institutions">,
      });
      await pendingBootstrap.promise;
    });
    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-personal");
  });

  it("allows retry after personal workspace bootstrap fails", async () => {
    mocks.client.mutation
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        institutionId: "org-personal" as Id<"institutions">,
      });
    getOrganizationContext = async (id) =>
      organization(id, "Personal workspace", "admin", "personal");
    renderOrganizationApp("/app");

    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(mocks.client.mutation).toHaveBeenCalledTimes(2);
  });

  it("keeps a revoked sole organization in the URL until explicit personal recovery", async () => {
    listedOrganizations = [];
    let initiallyReadable = true;
    getOrganizationContext = async (id) => {
      if (id === "revoked-org" && initiallyReadable) {
        initiallyReadable = false;
        return organization(id, "Former Org", "admin");
      }
      if (id === "org-personal") {
        return organization(id, "Personal workspace", "admin", "personal");
      }
      throw new Error("NOT_FOUND");
    };
    const { router } = renderOrganizationApp(
      "/instructor?organizationId=revoked-org&view=records",
    );

    expect(await screen.findByText("Former Org content (admin)")).toBeTruthy();
    const formerCapture = latestCapture;
    const revokedWatch = contextWatches.get("revoked-org");
    expect(revokedWatch).toBeTruthy();

    await act(async () => {
      revokedWatch!.error = new Error("NOT_FOUND");
      revokedWatch!.result = undefined;
      for (const listener of revokedWatch!.notifications) listener();
    });

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /organization is unavailable/i,
    );
    expect(router.state.location.pathname).toBe("/instructor");
    expect(router.state.location.search as Record<string, unknown>).toEqual({
      organizationId: "revoked-org",
      view: "records",
    });
    expect(mocks.client.mutation).not.toHaveBeenCalled();
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
    expect(isCaptureCurrent(formerCapture!)).toBe(false);

    const pendingBootstrap = deferred<{
      institutionId: Id<"institutions">;
    }>();
    mocks.client.mutation.mockReturnValue(pendingBootstrap.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Use personal workspace" }),
    );

    await waitFor(() => expect(mocks.client.mutation).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe("/app");
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBeUndefined();
    expect(
      (router.state.location.search as Record<string, unknown>).view,
    ).toBeUndefined();
    expect(screen.queryByText("Personal workspace content (admin)")).toBeNull();

    await act(async () => {
      pendingBootstrap.resolve({
        institutionId: "org-personal" as Id<"institutions">,
      });
      await pendingBootstrap.promise;
    });
    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-personal");
  });

  it("can retry personal bootstrap after explicit recovery from a revoked organization", async () => {
    listedOrganizations = [];
    getOrganizationContext = async (id) => {
      if (id === "org-personal") {
        return organization(id, "Personal workspace", "admin", "personal");
      }
      throw new Error("NOT_FOUND");
    };
    mocks.client.mutation
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        institutionId: "org-personal" as Id<"institutions">,
      });
    const { router } = renderOrganizationApp("/app?organizationId=revoked-org");

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /organization is unavailable/i,
    );
    expect(mocks.client.mutation).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use personal workspace" }),
    );

    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/app");
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBeUndefined();
    expect(mocks.client.mutation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Personal workspace content (admin)"),
    ).toBeTruthy();
    expect(mocks.client.mutation).toHaveBeenCalledTimes(2);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-personal");
  });

  it("does not retarget a pending personal bootstrap after choosing another organization", async () => {
    listedOrganizations = [member("org-b", "Org B", "admin")];
    getOrganizationContext = async (id) => {
      if (id === "org-b") return organization(id, "Org B", "admin");
      throw new Error("NOT_FOUND");
    };
    const pendingBootstrap = deferred<{
      institutionId: Id<"institutions">;
    }>();
    mocks.client.mutation.mockReturnValue(pendingBootstrap.promise);
    const { router } = renderOrganizationApp("/app?organizationId=revoked-org");

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /organization is unavailable/i,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use personal workspace" }),
    );
    await waitFor(() => expect(mocks.client.mutation).toHaveBeenCalledTimes(1));
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-b" },
    });
    expect(await screen.findByText("Org B content (admin)")).toBeTruthy();

    await act(async () => {
      pendingBootstrap.resolve({
        institutionId: "org-personal" as Id<"institutions">,
      });
      await pendingBootstrap.promise;
    });

    expect(screen.getByText("Org B content (admin)")).toBeTruthy();
    expect(screen.queryByText("Personal workspace content (admin)")).toBeNull();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-b");
    expect(contextWatches.has("org-personal")).toBe(false);
  });

  it.each(["/instructor", "/admin"])(
    "bootstraps a personal workspace on %s when the account has no organizations",
    async (path) => {
      listedOrganizations = [];
      getOrganizationContext = async (id) =>
        organization(id, "Personal workspace", "admin", "personal");
      const { router } = renderOrganizationApp(path);

      expect(
        await screen.findByText("Personal workspace content (admin)"),
      ).toBeTruthy();
      expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
      expect(
        (router.state.location.search as Record<string, unknown>)
          .organizationId,
      ).toBe("org-personal");
    },
  );

  it("keeps the organization query on workflow navigation and honors explicit selections through history", async () => {
    listedOrganizations = [
      member("org-a", "Org A", "instructor"),
      member("org-b", "Org B", "admin"),
    ];
    getOrganizationContext = async (id) =>
      organization(
        id,
        id === "org-a" ? "Org A" : "Org B",
        id === "org-a" ? "instructor" : "admin",
      );
    const { router } = renderOrganizationApp("/app?organizationId=org-a");

    expect(await screen.findByText("Org A content (instructor)")).toBeTruthy();
    await act(async () => {
      await router.navigate({
        to: "/app/assignments/assignment-new",
      } as never);
    });
    expect(await screen.findByText("Org A content (instructor)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");
    await act(async () => {
      await router.navigate({ to: "/instructor" } as never);
    });
    expect(await screen.findByText("Org A content (instructor)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");

    await act(async () => {
      await router.navigate({
        to: "/admin",
        search: { organizationId: "org-b" },
      } as never);
    });
    expect(await screen.findByText("Org B content (admin)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-b");

    await act(async () => {
      router.history.back();
    });
    expect(await screen.findByText("Org A content (instructor)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");
    await act(async () => {
      router.history.forward();
    });
    expect(await screen.findByText("Org B content (admin)")).toBeTruthy();
  });

  it.each(["/", "/legal/privacy"])(
    "drops organization context when navigating to public route %s",
    async (path) => {
      const { router } = renderOrganizationApp("/app?organizationId=org-a");

      expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
      await act(async () => {
        await router.navigate({ to: path } as never);
      });

      expect(router.state.location.pathname).toBe(path);
      expect(
        (router.state.location.search as Record<string, unknown>)
          .organizationId,
      ).toBeUndefined();
      expect(
        screen.getByRole("heading", {
          name: path === "/" ? "Study" : "Privacy Notice",
        }),
      ).toBeTruthy();
      expect(screen.getByRole("link", { name: "Study" }).tagName).toBe("A");
      expect(mocks.client.mutation).not.toHaveBeenCalled();
    },
  );

  it.each(["Appellate Practice Simulator", "Study"])(
    "clears a stale public-route organization ID through the %s link",
    async (linkName) => {
      getOrganizationContext = async (id) => {
        if (id === "org-personal") {
          return organization(id, "Personal workspace", "admin", "personal");
        }
        throw new Error("NOT_FOUND");
      };
      const { router } = renderOrganizationApp(
        "/legal/privacy?organizationId=stale-org&view=records",
      );

      expect(
        await screen.findByRole("heading", { name: "Privacy Notice" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("link", { name: linkName }));

      expect(router.state.location.pathname).toBe("/app");
      expect(
        await screen.findByText("Personal workspace content (admin)"),
      ).toBeTruthy();
      expect(
        (router.state.location.search as Record<string, unknown>)
          .organizationId,
      ).toBe("org-personal");
      expect(contextWatches.has("stale-org")).toBe(false);
      expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      path: "/app",
      role: "instructor" as const,
      capabilities: { learn: false, teach: true, manageMembers: false },
    },
    {
      path: "/instructor",
      role: "learner" as const,
      capabilities: { learn: true, teach: false, manageMembers: false },
    },
    {
      path: "/admin",
      role: "instructor" as const,
      capabilities: { learn: true, teach: true, manageMembers: false },
    },
  ])(
    "blocks $path section content without the required capability",
    async ({ path, role, capabilities }) => {
      listedOrganizations = [member("org-a", "Org A", role)];
      getOrganizationContext = async (id) => ({
        ...organization(id, "Org A", role),
        capabilities,
      });
      renderOrganizationApp(`${path}?organizationId=org-a`);

      expect((await screen.findByRole("alert")).textContent).toMatch(
        /does not have access to this section/i,
      );
      expect(screen.queryByTestId("organization-content")).toBeNull();
      expect(routeContentRenderCount).toBe(0);
      expect(mocks.client.mutation).not.toHaveBeenCalled();
    },
  );

  it("shows capability navigation from the selected organization role", async () => {
    listedOrganizations = [
      member("org-a", "Org A", "learner"),
      member("org-b", "Org B", "instructor"),
      member("org-c", "Org C", "admin"),
    ];
    getOrganizationContext = async (id) => {
      const selected = listedOrganizations.find(
        (item) => item.institutionId === id,
      );
      return organization(
        id,
        selected?.name ?? "Unknown",
        selected?.role ?? "learner",
      );
    };
    const { router } = renderOrganizationApp("/app?organizationId=org-a");

    expect(await screen.findByText("Org A content (learner)")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Courses" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Organization administration" }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-b" },
    });
    expect(await screen.findByText("Org B content (instructor)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Courses" })).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Organization administration" }),
    ).toBeNull();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-b");

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-c" },
    });
    expect(await screen.findByText("Org C content (admin)")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Organization administration" }),
    ).toBeTruthy();
  });

  it("hides the previous organization, cancels local work, and ignores late results after repeated switches", async () => {
    listedOrganizations = [
      member("org-a", "Org A", "admin"),
      member("org-b", "Org B", "admin"),
      member("org-c", "Org C", "admin"),
    ];
    const contextB = deferred<OrganizationContextDTO>();
    getOrganizationContext = async (id) => {
      if (id === "org-b") return contextB.promise;
      return organization(id, id === "org-a" ? "Org A" : "Org C", "admin");
    };
    const { router } = renderOrganizationApp(
      "/app?organizationId=org-a&view=records",
      false,
      "Org A private case title",
    );
    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    await waitFor(() =>
      expect(cancellationRegistrationCount).toBeGreaterThan(0),
    );
    const oldCapture = latestCapture;
    expect(oldCapture).not.toBeNull();
    expect(isCaptureCurrent(oldCapture!)).toBe(true);

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-b" },
    });
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(
      /loading organization/i,
    );
    expect(
      screen.queryByRole("heading", { name: "Org A private case title" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-b");
    expect((router.state.location.search as Record<string, unknown>).view).toBe(
      "records",
    );
    expect(isCaptureCurrent(oldCapture!)).toBe(false);

    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-c" },
    });
    expect(await screen.findByText("Org C content (admin)")).toBeTruthy();
    await act(async () => {
      contextB.resolve(organization("org-b", "Stale Org B", "admin"));
      await contextB.promise;
    });

    expect(screen.getByText("Org C content (admin)")).toBeTruthy();
    expect(screen.queryByText("Stale Org B content (admin)")).toBeNull();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-c");
  });

  it("returns to the section root and drops resource state when switching organizations from a nested route", async () => {
    listedOrganizations = [
      member("org-a", "Org A", "admin"),
      member("org-b", "Org B", "admin"),
    ];
    getOrganizationContext = async (id) =>
      organization(id, id === "org-a" ? "Org A" : "Org B", "admin");
    const { router } = renderOrganizationApp(
      "/app/assignments/assignment-old?organizationId=org-a&view=private",
    );

    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Private assignment" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-b" },
    });

    expect(screen.queryByText("Org A content (admin)")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Private assignment" }),
    ).toBeNull();
    expect(await screen.findByText("Org B content (admin)")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/app");
    expect(router.state.location.search as Record<string, unknown>).toEqual({
      organizationId: "org-b",
    });
  });

  it("follows browser back and forward without reusing a stale organization context", async () => {
    listedOrganizations = [
      member("org-a", "Org A", "learner"),
      member("org-b", "Org B", "instructor"),
    ];
    getOrganizationContext = async (id) =>
      organization(
        id,
        id === "org-a" ? "Org A" : "Org B",
        id === "org-a" ? "learner" : "instructor",
      );
    const { router } = renderOrganizationApp("/app?organizationId=org-a");

    expect(await screen.findByText("Org A content (learner)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "org-b" },
    });
    expect(await screen.findByText("Org B content (instructor)")).toBeTruthy();
    expect(cancellationSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      router.history.back();
    });
    expect(await screen.findByText("Org A content (learner)")).toBeTruthy();
    expect(cancellationSpy).toHaveBeenCalledTimes(2);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");

    await act(async () => {
      router.history.forward();
    });
    expect(await screen.findByText("Org B content (instructor)")).toBeTruthy();
    expect(cancellationSpy).toHaveBeenCalledTimes(3);
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-b");
  });

  it("clears local work on sign-out and ignores a query that completes afterward", async () => {
    listedOrganizations = [member("org-a", "Org A", "admin")];
    getOrganizationContext = async () =>
      organization("org-a", "Org A", "admin");
    const router = createTestRouter("/app?organizationId=org-a");
    const rendered = render(<RouterProvider router={router} />);

    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    await waitFor(() =>
      expect(cancellationRegistrationCount).toBeGreaterThan(0),
    );
    const capture = latestCapture;
    const watch = contextWatches.get("org-a");
    expect(watch).toBeTruthy();

    await act(async () => {
      mocks.user.isSignedIn = false;
      mocks.convexAuth.isAuthenticated = false;
      rendered.rerender(<RouterProvider router={router} key="signed-out" />);
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /sign in to choose/i,
    );
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
    expect(isCaptureCurrent(capture!)).toBe(false);

    await act(async () => {
      watch!.result = organization("org-a", "Stale Org A", "admin");
      for (const listener of watch!.notifications) listener();
    });
    expect(screen.queryByText("Stale Org A content (admin)")).toBeNull();
    expect(screen.queryByText("Org A content (admin)")).toBeNull();
  });

  it("cancels registered work when navigation leaves organization scope", async () => {
    const { router } = renderOrganizationApp("/app?organizationId=org-a");
    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    await waitFor(() =>
      expect(cancellationRegistrationCount).toBeGreaterThan(0),
    );

    await act(async () => {
      await router.navigate({ to: "/legal/privacy" } as never);
    });

    expect(router.state.location.pathname).toBe("/legal/privacy");
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels registered work when the shared route subtree unmounts", async () => {
    const rendered = renderOrganizationApp("/app?organizationId=org-a");
    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    await waitFor(() =>
      expect(cancellationRegistrationCount).toBeGreaterThan(0),
    );

    rendered.unmount();

    expect(cancellationSpy).toHaveBeenCalledTimes(1);
  });
});
