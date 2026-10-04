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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { useUser } from "@clerk/tanstack-react-start";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  OrganizationContextDTO,
  OrganizationMemberDTO,
} from "../../convex/organizationContracts";

export type OrganizationContextStatus = "loading" | "ready" | "unavailable";

export type OrganizationContextCapture = {
  organizationId: Id<"institutions">;
  generation: number;
};

type OrganizationCapabilities = OrganizationContextDTO["capabilities"];

type OrganizationContextValue = {
  organizationId: Id<"institutions"> | null;
  organization: OrganizationContextDTO | null;
  capabilities: OrganizationCapabilities;
  status: OrganizationContextStatus;
  unavailableMessage: string | null;
  canRetryOrganizationBootstrap: boolean;
  retryOrganizationBootstrap: () => void;
  organizations: OrganizationMemberDTO[];
  organizationsStatus: OrganizationContextStatus;
  selectOrganization: (organizationId: Id<"institutions">) => void;
  captureOrganizationContext: () => OrganizationContextCapture | null;
  isCurrentOrganizationContext: (
    capture: OrganizationContextCapture,
  ) => boolean;
  registerOrganizationCancellation: (cancel: () => void) => () => void;
};

const noCapabilities: OrganizationCapabilities = {
  manageMembers: false,
  teach: false,
  learn: false,
};

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null,
);

type PendingSelection = {
  organizationId: string;
  sequence: number;
  pathname: string;
};

type SessionResult<T> = {
  sessionKey: string;
  scopeEpoch: number;
  status: "loading" | "ready" | "unavailable";
  value?: T;
};

type ResolvedContext = {
  sessionKey: string;
  organizationId: string;
  generation: number;
  status: "ready" | "unavailable";
  organization?: OrganizationContextDTO;
};

const ensurePersonalFlights = new WeakMap<
  object,
  Map<string, Promise<Id<"institutions">>>
>();

export function ensurePersonalSingleFlight(
  client: ReturnType<typeof useConvex>,
  sessionKey: string,
) {
  let sessions = ensurePersonalFlights.get(client);
  if (!sessions) {
    sessions = new Map();
    ensurePersonalFlights.set(client, sessions);
  }

  const pending = sessions.get(sessionKey);
  if (pending) return pending;

  const request = client
    .mutation(api.organizations.ensurePersonal, {})
    .then(({ institutionId }) => institutionId)
    .finally(() => {
      if (sessions?.get(sessionKey) === request) sessions.delete(sessionKey);
    });
  sessions.set(sessionKey, request);
  return request;
}

function readOrganizationId(search: Record<string, unknown>) {
  const value = search.organizationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sortOrganizations(organizations: OrganizationMemberDTO[]) {
  return [...organizations].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "personal" ? -1 : 1;
    return (
      left.name.localeCompare(right.name) ||
      String(left.institutionId).localeCompare(String(right.institutionId))
    );
  });
}

function isOrganizationPath(pathname: string) {
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/instructor" ||
    pathname.startsWith("/instructor/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

function isStudyPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function writeOrganizationToUrl(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  organizationId: string,
  replace: boolean,
) {
  const currentSearch = router.state.location.search as Record<string, unknown>;
  const search = { ...currentSearch, organizationId };

  return router.navigate({ to: pathname, search, replace } as never);
}

function cancelRegisteredWork(work: Set<() => void>) {
  for (const cancel of [...work]) {
    try {
      cancel();
    } catch {
      // A local cancellation callback must not block the organization switch.
    }
  }
  work.clear();
}

export function OrganizationContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const pathname = location.pathname;
  const inOrganizationScope = isOrganizationPath(pathname);
  const wasInOrganizationScopeRef = useRef(false);
  const scopeEpochRef = useRef(0);
  if (inOrganizationScope && !wasInOrganizationScopeRef.current) {
    scopeEpochRef.current += 1;
  }
  wasInOrganizationScopeRef.current = inOrganizationScope;
  const scopeEpoch = scopeEpochRef.current;
  const urlOrganizationId = readOrganizationId(
    location.search as Record<string, unknown>,
  );
  const convex = useConvex();
  const convexAuth = useConvexAuth();
  const { isLoaded, isSignedIn, user } = useUser();
  const upsertCurrentUser = useMutation(api.users.upsertCurrentUser);
  const upsertCurrentUserRef = useRef(upsertCurrentUser);
  upsertCurrentUserRef.current = upsertCurrentUser;

  const authenticated = isSignedIn === true && convexAuth.isAuthenticated;
  const authReady = isLoaded && !convexAuth.isLoading;
  const sessionKey = authenticated
    ? (user?.id ?? "authenticated-session")
    : null;
  const [userState, setUserState] = useState<SessionResult<null> | null>(null);
  const [organizationList, setOrganizationList] = useState<SessionResult<
    OrganizationMemberDTO[]
  > | null>(null);
  const [resolvedContext, setResolvedContext] =
    useState<ResolvedContext | null>(null);
  const [bootstrapErrorSession, setBootstrapErrorSession] = useState<
    string | null
  >(null);
  const [bootstrapRetrySequence, setBootstrapRetrySequence] = useState(0);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);

  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  const sequenceRef = useRef(0);
  const generationRef = useRef(0);
  const [generation, setGeneration] = useState(0);
  const statusRef = useRef<OrganizationContextStatus>("loading");
  const identityRef = useRef<{
    organizationId: string | null;
    sessionKey: string | null;
  }>({
    organizationId: null,
    sessionKey: null,
  });
  const cancellationsRef = useRef(new Set<() => void>());

  const activePendingSelection =
    pendingSelection?.pathname === pathname &&
    pendingSelection.organizationId !== urlOrganizationId
      ? pendingSelection
      : null;
  const selectedOrganizationId = inOrganizationScope
    ? (activePendingSelection?.organizationId ?? urlOrganizationId)
    : null;

  const invalidateContext = useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
    cancelRegisteredWork(cancellationsRef.current);
  }, []);

  useEffect(() => {
    const currentSessionKey =
      inOrganizationScope && authenticated ? sessionKey : null;
    if (
      identityRef.current.sessionKey !== currentSessionKey ||
      identityRef.current.organizationId !== selectedOrganizationId
    ) {
      identityRef.current = {
        organizationId: selectedOrganizationId,
        sessionKey: currentSessionKey,
      };
      invalidateContext();
    }
  }, [
    authenticated,
    inOrganizationScope,
    invalidateContext,
    selectedOrganizationId,
    sessionKey,
  ]);

  useEffect(() => {
    if (!authReady || !inOrganizationScope) return;
    if (!authenticated || !sessionKey) {
      setUserState({ sessionKey: "", scopeEpoch, status: "unavailable" });
      setOrganizationList({
        sessionKey: "",
        scopeEpoch,
        status: "unavailable",
        value: [],
      });
      return;
    }

    let active = true;
    setUserState({ sessionKey, scopeEpoch, status: "loading" });
    void upsertCurrentUserRef
      .current({})
      .then(() => {
        if (active)
          setUserState({
            sessionKey,
            scopeEpoch,
            status: "ready",
            value: null,
          });
      })
      .catch(() => {
        if (active)
          setUserState({ sessionKey, scopeEpoch, status: "unavailable" });
      });

    return () => {
      active = false;
    };
  }, [authReady, authenticated, inOrganizationScope, scopeEpoch, sessionKey]);

  const userReady =
    inOrganizationScope &&
    authenticated &&
    sessionKey !== null &&
    userState?.sessionKey === sessionKey &&
    userState.scopeEpoch === scopeEpoch &&
    userState.status === "ready";

  useEffect(() => {
    if (!inOrganizationScope || !userReady || !sessionKey) return;
    let active = true;
    setOrganizationList({
      sessionKey,
      scopeEpoch,
      status: "loading",
      value: [],
    });
    const watch = convex.watchQuery(api.organizations.listMine, {});
    const applyLatestList = () => {
      if (!active) return;
      try {
        const items = watch.localQueryResult();
        if (items !== undefined) {
          setOrganizationList({
            sessionKey,
            scopeEpoch,
            status: "ready",
            value: sortOrganizations(items),
          });
        }
      } catch {
        setOrganizationList({
          sessionKey,
          scopeEpoch,
          status: "unavailable",
          value: [],
        });
      }
    };
    const unsubscribe = watch.onUpdate(applyLatestList);
    applyLatestList();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [convex, inOrganizationScope, scopeEpoch, sessionKey, userReady]);

  const organizations =
    organizationList?.sessionKey === sessionKey &&
    organizationList.scopeEpoch === scopeEpoch &&
    organizationList.status === "ready"
      ? (organizationList.value ?? [])
      : [];
  const organizationsStatus: OrganizationContextStatus = !inOrganizationScope
    ? "unavailable"
    : organizationList?.sessionKey === sessionKey &&
        organizationList.scopeEpoch === scopeEpoch
      ? organizationList.status
      : userReady
        ? "loading"
        : "unavailable";

  useEffect(() => {
    if (!pendingSelection) return;
    if (urlOrganizationId === pendingSelection.organizationId) {
      pendingSelectionRef.current = null;
      setPendingSelection(null);
    }
  }, [pendingSelection, urlOrganizationId]);

  useEffect(() => {
    if (!pendingSelection) return;
    const interruptSelection = () => {
      if (pendingSelectionRef.current?.sequence !== pendingSelection.sequence)
        return;
      pendingSelectionRef.current = null;
      setPendingSelection(null);
      sequenceRef.current += 1;
      invalidateContext();
    };
    window.addEventListener("popstate", interruptSelection);
    return () => window.removeEventListener("popstate", interruptSelection);
  }, [invalidateContext, pendingSelection]);

  const selectOrganization = useCallback(
    (nextOrganizationId: Id<"institutions">) => {
      if (!userReady || !sessionKey) return;
      const nextId = String(nextOrganizationId);
      const currentIntent =
        pendingSelectionRef.current?.organizationId ?? urlOrganizationId;
      if (nextId === currentIntent) return;

      const nextSelection: PendingSelection = {
        organizationId: nextId,
        sequence: ++sequenceRef.current,
        pathname,
      };
      pendingSelectionRef.current = nextSelection;
      setPendingSelection(nextSelection);
      identityRef.current = { organizationId: nextId, sessionKey };
      invalidateContext();

      void writeOrganizationToUrl(router, pathname, nextId, false).catch(() => {
        if (pendingSelectionRef.current?.sequence !== nextSelection.sequence)
          return;
        pendingSelectionRef.current = null;
        setPendingSelection(null);
        identityRef.current = { organizationId: urlOrganizationId, sessionKey };
        invalidateContext();
      });
    },
    [
      invalidateContext,
      pathname,
      router,
      sessionKey,
      urlOrganizationId,
      userReady,
    ],
  );

  const bootstrapAttemptRef = useRef<string | null>(null);
  const retryOrganizationBootstrap = useCallback(() => {
    if (
      !inOrganizationScope ||
      !isStudyPath(pathname) ||
      selectedOrganizationId
    )
      return;
    bootstrapAttemptRef.current = null;
    setBootstrapErrorSession(null);
    setBootstrapRetrySequence((current) => current + 1);
  }, [inOrganizationScope, pathname, selectedOrganizationId]);

  useEffect(() => {
    if (
      !inOrganizationScope ||
      !userReady ||
      !sessionKey ||
      !isStudyPath(pathname) ||
      selectedOrganizationId
    ) {
      return;
    }

    const attemptKey = `${sessionKey}:${scopeEpoch}:${pathname}:${bootstrapRetrySequence}`;
    if (bootstrapAttemptRef.current === attemptKey) return;
    bootstrapAttemptRef.current = attemptKey;
    setBootstrapErrorSession(null);
    let active = true;
    const attemptGeneration = generationRef.current;

    void ensurePersonalSingleFlight(convex, sessionKey)
      .then((organizationId) => {
        if (
          !active ||
          !authenticated ||
          identityRef.current.sessionKey !== sessionKey ||
          identityRef.current.organizationId !== null ||
          generationRef.current !== attemptGeneration
        ) {
          return;
        }
        void writeOrganizationToUrl(
          router,
          pathname,
          String(organizationId),
          true,
        ).catch(() => {
          if (active) {
            if (bootstrapAttemptRef.current === attemptKey)
              bootstrapAttemptRef.current = null;
            setBootstrapErrorSession(sessionKey);
          }
        });
      })
      .catch(() => {
        if (active) {
          if (bootstrapAttemptRef.current === attemptKey)
            bootstrapAttemptRef.current = null;
          setBootstrapErrorSession(sessionKey);
        }
      });

    return () => {
      active = false;
      if (bootstrapAttemptRef.current === attemptKey)
        bootstrapAttemptRef.current = null;
    };
  }, [
    authenticated,
    convex,
    inOrganizationScope,
    pathname,
    bootstrapRetrySequence,
    router,
    scopeEpoch,
    selectedOrganizationId,
    sessionKey,
    userReady,
  ]);

  useEffect(() => {
    if (
      !inOrganizationScope ||
      !userReady ||
      !sessionKey ||
      !selectedOrganizationId
    )
      return;
    const request = {
      organizationId: selectedOrganizationId,
      generation,
      sessionKey,
    };
    let active = true;
    const watch = convex.watchQuery(api.organizations.getContext, {
      institutionId: request.organizationId as Id<"institutions">,
    });
    const applyLatestContext = () => {
      if (
        !active ||
        identityRef.current.organizationId !== request.organizationId ||
        identityRef.current.sessionKey !== request.sessionKey ||
        generationRef.current !== request.generation
      ) {
        return;
      }
      try {
        const organization = watch.localQueryResult();
        if (organization !== undefined) {
          setResolvedContext({
            sessionKey,
            organizationId: request.organizationId,
            generation: request.generation,
            status: "ready",
            organization,
          });
        }
      } catch {
        cancelRegisteredWork(cancellationsRef.current);
        generationRef.current += 1;
        setResolvedContext({
          sessionKey,
          organizationId: request.organizationId,
          generation: request.generation,
          status: "unavailable",
        });
      }
    };
    const unsubscribe = watch.onUpdate(applyLatestContext);
    applyLatestContext();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    convex,
    generation,
    inOrganizationScope,
    selectedOrganizationId,
    sessionKey,
    userReady,
  ]);

  const currentResolvedContext =
    resolvedContext?.sessionKey === sessionKey &&
    resolvedContext.organizationId === selectedOrganizationId &&
    resolvedContext.generation === generation
      ? resolvedContext
      : null;

  let status: OrganizationContextStatus = "loading";
  let unavailableMessage: string | null = null;
  if (!inOrganizationScope) {
    status = "unavailable";
  } else if (authReady && !authenticated) {
    status = "unavailable";
    unavailableMessage = "Sign in to choose an organization.";
  } else if (
    authenticated &&
    userState?.sessionKey === sessionKey &&
    userState.scopeEpoch === scopeEpoch
  ) {
    if (userState.status === "unavailable") {
      status = "unavailable";
      unavailableMessage =
        "Your account could not be initialized. Try again after signing in.";
    } else if (
      userReady &&
      selectedOrganizationId &&
      currentResolvedContext &&
      !activePendingSelection
    ) {
      status = currentResolvedContext.status;
      if (status === "unavailable") {
        unavailableMessage =
          "This organization is unavailable. Choose an organization you can access.";
      }
    } else if (userReady && !selectedOrganizationId) {
      if (bootstrapErrorSession === sessionKey) {
        status = "unavailable";
        unavailableMessage =
          "A personal workspace could not be selected. Choose an organization or try again.";
      } else if (!isStudyPath(pathname)) {
        status = "unavailable";
        unavailableMessage = "Choose an organization to continue.";
      }
    }
  }
  statusRef.current = status;
  const canRetryOrganizationBootstrap =
    inOrganizationScope &&
    userReady &&
    sessionKey !== null &&
    isStudyPath(pathname) &&
    !selectedOrganizationId &&
    bootstrapErrorSession !== null &&
    bootstrapErrorSession === sessionKey;

  const organization =
    status === "ready" ? (currentResolvedContext?.organization ?? null) : null;
  const captureOrganizationContext = useCallback(() => {
    if (status !== "ready" || !organization) return null;
    return {
      organizationId: organization.institutionId,
      generation,
    };
  }, [generation, organization, status]);

  const isCurrentOrganizationContext = useCallback(
    (capture: OrganizationContextCapture) =>
      statusRef.current === "ready" &&
      identityRef.current.organizationId === String(capture.organizationId) &&
      generationRef.current === capture.generation,
    [],
  );

  const registerOrganizationCancellation = useCallback(
    (cancel: () => void) => {
      if (status !== "ready") {
        cancel();
        return () => {};
      }
      cancellationsRef.current.add(cancel);
      return () => cancellationsRef.current.delete(cancel);
    },
    [status],
  );

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizationId:
        inOrganizationScope && selectedOrganizationId
          ? (selectedOrganizationId as Id<"institutions">)
          : null,
      organization,
      capabilities: organization?.capabilities ?? noCapabilities,
      status,
      unavailableMessage,
      canRetryOrganizationBootstrap,
      retryOrganizationBootstrap,
      organizations,
      organizationsStatus,
      selectOrganization,
      captureOrganizationContext,
      isCurrentOrganizationContext,
      registerOrganizationCancellation,
    }),
    [
      activePendingSelection,
      canRetryOrganizationBootstrap,
      captureOrganizationContext,
      isCurrentOrganizationContext,
      organization,
      organizations,
      organizationsStatus,
      registerOrganizationCancellation,
      retryOrganizationBootstrap,
      selectOrganization,
      selectedOrganizationId,
      status,
      unavailableMessage,
    ],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganizationContext() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error(
      "useOrganizationContext must be used within OrganizationContextProvider",
    );
  }
  return context;
}
