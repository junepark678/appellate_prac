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
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type {
  OrganizationContextDTO,
  OrganizationMemberDTO,
} from "../../convex/organizationContracts";
import { AppFrame } from "./AppFrame";
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
): OrganizationContextDTO {
  return {
    institutionId: institutionId as Id<"institutions">,
    name,
    kind,
    role,
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
let latestCapture: ReturnType<
  ReturnType<typeof useOrganizationContext>["captureOrganizationContext"]
>;
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
  const context = useOrganizationContext();
  latestCapture = context.captureOrganizationContext();
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
    search: {
      middlewares: [retainSearchParams(["organizationId"])],
    },
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
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: appFrame("Study"),
  });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app",
    component: appFrame(appTitle),
  });
  const assignmentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/assignments/$assignmentId",
    component: appFrame("Private assignment"),
  });
  const instructorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/instructor",
    component: appFrame("Courses"),
  });
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: appFrame("Organization administration"),
  });
  const legalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/legal/privacy",
    component: appFrame("Privacy Notice"),
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    appRoute,
    assignmentRoute,
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
  listedOrganizations = [member("org-a", "Org A", "admin")];
  getOrganizationContext = async (id) =>
    organization(id, `Org ${id.slice(-1).toUpperCase()}`, "admin");
  cancellationSpy = vi.fn();
  cancellationRegistrationCount = 0;
  latestCapture = null;
  isCaptureCurrent = () => false;
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

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
    expect(cancellationRegistrationCount).toBeGreaterThan(0);
    const capture = latestCapture;
    expect(capture).not.toBeNull();

    await act(async () => {
      const watch = contextWatches.get("org-a");
      if (!watch) throw new Error("Expected the organization context watch");
      watch.error = new Error("NOT_FOUND");
      watch.result = undefined;
      for (const listener of watch.listeners) listener();
    });

    expect((await screen.findByRole("alert")).textContent).toMatch(
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
      member("org-a", "Org A", "learner"),
      member("org-b", "Org B", "instructor"),
    ];
    getOrganizationContext = async (id) =>
      organization(id, id === "org-a" ? "Org A" : "Org B");
    const { router } = renderOrganizationApp("/app?organizationId=org-a");

    expect(await screen.findByText("Org A content (learner)")).toBeTruthy();
    await act(async () => {
      await router.navigate({ to: "/instructor" } as never);
    });
    expect(await screen.findByText("Org A content (learner)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");

    await act(async () => {
      await router.navigate({
        to: "/admin",
        search: { organizationId: "org-b" },
      } as never);
    });
    expect(await screen.findByText("Org B content (learner)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-b");

    await act(async () => {
      router.history.back();
    });
    expect(await screen.findByText("Org A content (learner)")).toBeTruthy();
    expect(
      (router.state.location.search as Record<string, unknown>).organizationId,
    ).toBe("org-a");
    await act(async () => {
      router.history.forward();
    });
    expect(await screen.findByText("Org B content (learner)")).toBeTruthy();
  });

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
    expect(cancellationRegistrationCount).toBeGreaterThan(0);
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
    expect(cancellationRegistrationCount).toBeGreaterThan(0);
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
    expect(cancellationRegistrationCount).toBeGreaterThan(0);

    await act(async () => {
      await router.navigate({ to: "/legal/privacy" } as never);
    });

    expect(router.state.location.pathname).toBe("/legal/privacy");
    expect(cancellationSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels registered work when the shared route subtree unmounts", async () => {
    const rendered = renderOrganizationApp("/app?organizationId=org-a");
    expect(await screen.findByText("Org A content (admin)")).toBeTruthy();
    expect(cancellationRegistrationCount).toBeGreaterThan(0);

    rendered.unmount();

    expect(cancellationSpy).toHaveBeenCalledTimes(1);
  });
});
