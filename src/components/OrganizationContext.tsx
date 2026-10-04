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
  canRecoverUnavailableOrganization: boolean;
  recoverToPersonalWorkspace: () => void;
  canRetryUserInitialization: boolean;
  retryUserInitialization: () => void;
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
const MAX_TIMEOUT_MS = 2_147_483_647;

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null,
);

type PendingSelection = {
  organizationId: string | null;
  sequence: number;
  pathname: string;
  targetPathname: string;
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

function organizationSectionRoot(pathname: string) {
  if (pathname === "/instructor" || pathname.startsWith("/instructor/"))
    return "/instructor";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "/admin";
  return "/app";
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
  const callbacks = [...work];
  work.clear();
  for (const cancel of callbacks) {
    try {
      cancel();
    } catch {
      // A local cancellation callback must not block the organization switch.
    }
  }
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
  const [userInitializationRetrySequence, setUserInitializationRetrySequence] =
    useState(0);
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
  const providerActiveRef = useRef(true);

  useEffect(() => {
    providerActiveRef.current = true;
    return () => {
      providerActiveRef.current = false;
      cancelRegisteredWork(cancellationsRef.current);
    };
  }, []);

  const activePendingSelection =
    (pendingSelection?.pathname === pathname ||
      pendingSelection?.targetPathname === pathname) &&
    pendingSelection.organizationId !== urlOrganizationId
      ? pendingSelection
      : null;
  const selectedOrganizationId = inOrganizationScope
    ? activePendingSelection
      ? activePendingSelection.organizationId
      : urlOrganizationId
    : null;
  const currentResolvedContext =
    resolvedContext?.sessionKey === sessionKey &&
    resolvedContext.organizationId === selectedOrganizationId &&
    resolvedContext.generation === generation
      ? resolvedContext
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
  }, [
    authReady,
    authenticated,
    inOrganizationScope,
    scopeEpoch,
    sessionKey,
    userInitializationRetrySequence,
  ]);

  const userReady =
    inOrganizationScope &&
    authenticated &&
    sessionKey !== null &&
    userState?.sessionKey === sessionKey &&
    userState.scopeEpoch === scopeEpoch &&
    userState.status === "ready";

  const canRetryUserInitialization =
    inOrganizationScope &&
    authenticated &&
    sessionKey !== null &&
    userState?.sessionKey === sessionKey &&
    userState.scopeEpoch === scopeEpoch &&
    userState.status === "unavailable";
  const retryUserInitialization = useCallback(() => {
    if (!canRetryUserInitialization || !sessionKey) return;
    setUserState({ sessionKey, scopeEpoch, status: "loading" });
    setUserInitializationRetrySequence((current) => current + 1);
  }, [canRetryUserInitialization, scopeEpoch, sessionKey]);

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
      ? (organizationList.value ?? []).filter(
          (item) =>
            !(
              currentResolvedContext?.status === "unavailable" &&
              item.institutionId === selectedOrganizationId
            ),
        )
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
      if (!userReady || !sessionKey || pendingSelectionRef.current) return;
      const nextId = String(nextOrganizationId);
      const currentIntent = urlOrganizationId;
      if (nextId === currentIntent) return;

      const targetPathname = organizationSectionRoot(pathname);
      const nextSelection: PendingSelection = {
        organizationId: nextId,
        sequence: ++sequenceRef.current,
        pathname,
        targetPathname,
      };
      pendingSelectionRef.current = nextSelection;
      setPendingSelection(nextSelection);
      identityRef.current = { organizationId: nextId, sessionKey };
      invalidateContext();

      const navigation =
        pathname === targetPathname
          ? writeOrganizationToUrl(router, targetPathname, nextId, false)
          : router.navigate({
              to: targetPathname,
              search: { organizationId: nextId },
              replace: false,
            } as never);
      void navigation.catch(() => {
        if (pendingSelectionRef.current?.sequence !== nextSelection.sequence)
          return;
        pendingSelectionRef.current = null;
        setPendingSelection(null);
        identityRef.current = {
          organizationId: urlOrganizationId,
          sessionKey,
        };
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
  const shouldBootstrapPersonal =
    !selectedOrganizationId &&
    !activePendingSelection &&
    (isStudyPath(pathname) ||
      (organizationsStatus === "ready" && organizations.length === 0));
  const retryOrganizationBootstrap = useCallback(() => {
    if (
      !inOrganizationScope ||
      !shouldBootstrapPersonal ||
      selectedOrganizationId
    )
      return;
    bootstrapAttemptRef.current = null;
    setBootstrapErrorSession(null);
    setBootstrapRetrySequence((current) => current + 1);
  }, [inOrganizationScope, selectedOrganizationId, shouldBootstrapPersonal]);

  useEffect(() => {
    if (
      !inOrganizationScope ||
      !userReady ||
      !sessionKey ||
      !shouldBootstrapPersonal ||
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
    shouldBootstrapPersonal,
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
      sessionKey,
    };
    let active = true;
    let watchFailed = false;
    let contextExpired = false;
    let lastAuthorizationSnapshot: string | null = null;
    let organizationListRefreshStarted = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let expiryTimerSequence = 0;
    const clearExpiryTimer = () => {
      expiryTimerSequence += 1;
      if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    };
    const refreshOrganizationList = () => {
      if (organizationListRefreshStarted) return;
      organizationListRefreshStarted = true;
      void convex
        .query(api.organizations.listMine, {})
        .then((items) => {
          if (
            !active ||
            identityRef.current.organizationId !== request.organizationId ||
            identityRef.current.sessionKey !== request.sessionKey
          ) {
            return;
          }
          setOrganizationList({
            sessionKey,
            scopeEpoch,
            status: "ready",
            value: sortOrganizations(items),
          });
        })
        .catch(() => {
          // The selected context stays unavailable if the refresh also fails.
        });
    };
    const setContextUnavailable = () => {
      if (!contextExpired) {
        contextExpired = true;
        generationRef.current += 1;
        setGeneration(generationRef.current);
        cancelRegisteredWork(cancellationsRef.current);
        refreshOrganizationList();
      }
      setResolvedContext({
        sessionKey,
        organizationId: request.organizationId,
        generation: generationRef.current,
        status: "unavailable",
      });
    };
    const scheduleExpiration = (expiresAt: number) => {
      clearExpiryTimer();
      const sequence = expiryTimerSequence;
      const checkExpiration = () => {
        if (
          !active ||
          sequence !== expiryTimerSequence ||
          identityRef.current.organizationId !== request.organizationId ||
          identityRef.current.sessionKey !== request.sessionKey
        ) {
          return;
        }
        const remaining = expiresAt - Date.now();
        if (remaining > 0) {
          expiryTimer = setTimeout(
            checkExpiration,
            Math.min(remaining, MAX_TIMEOUT_MS),
          );
          return;
        }
        expiryTimer = null;
        setContextUnavailable();
      };
      expiryTimer = setTimeout(
        checkExpiration,
        Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMEOUT_MS),
      );
    };
    const watch = convex.watchQuery(api.organizations.getContext, {
      institutionId: request.organizationId as Id<"institutions">,
    });
    const applyLatestContext = () => {
      if (
        !active ||
        identityRef.current.organizationId !== request.organizationId ||
        identityRef.current.sessionKey !== request.sessionKey
      ) {
        return;
      }
      try {
        const organization = watch.localQueryResult();
        if (organization !== undefined) {
          const expiresAt =
            organization.expiresAt === undefined
              ? null
              : Date.parse(organization.expiresAt);
          if (
            expiresAt !== null &&
            (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
          ) {
            clearExpiryTimer();
            watchFailed = false;
            setContextUnavailable();
            return;
          }
          watchFailed = false;
          contextExpired = false;
          const authorizationSnapshot = JSON.stringify({
            kind: organization.kind,
            role: organization.role,
            capabilities: organization.capabilities,
          });
          if (
            lastAuthorizationSnapshot !== null &&
            authorizationSnapshot !== lastAuthorizationSnapshot
          ) {
            generationRef.current += 1;
            setGeneration(generationRef.current);
            cancelRegisteredWork(cancellationsRef.current);
          }
          lastAuthorizationSnapshot = authorizationSnapshot;
          if (expiresAt === null) clearExpiryTimer();
          else scheduleExpiration(expiresAt);
          setResolvedContext({
            sessionKey,
            organizationId: request.organizationId,
            generation: generationRef.current,
            status: "ready",
            organization,
          });
        }
      } catch {
        clearExpiryTimer();
        if (!watchFailed) {
          watchFailed = true;
          generationRef.current += 1;
          setGeneration(generationRef.current);
          cancelRegisteredWork(cancellationsRef.current);
          refreshOrganizationList();
        }
        setResolvedContext({
          sessionKey,
          organizationId: request.organizationId,
          generation: generationRef.current,
          status: "unavailable",
        });
      }
    };
    const unsubscribe = watch.onUpdate(applyLatestContext);
    applyLatestContext();

    return () => {
      active = false;
      clearExpiryTimer();
      unsubscribe();
    };
  }, [
    convex,
    inOrganizationScope,
    selectedOrganizationId,
    sessionKey,
    userReady,
  ]);

  const organizationExpiryRef = useRef<{
    organizationId: string;
    sessionKey: string;
    expiresAt: number | null;
  } | null>(null);
  organizationExpiryRef.current =
    currentResolvedContext?.status === "ready" &&
    currentResolvedContext.organization
      ? {
          organizationId: currentResolvedContext.organizationId,
          sessionKey: currentResolvedContext.sessionKey,
          expiresAt:
            currentResolvedContext.organization.expiresAt === undefined
              ? null
              : Date.parse(currentResolvedContext.organization.expiresAt),
        }
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
      unavailableMessage = "Your account could not be initialized. Try again.";
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
      } else if (!shouldBootstrapPersonal) {
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
    shouldBootstrapPersonal &&
    !selectedOrganizationId &&
    bootstrapErrorSession !== null &&
    bootstrapErrorSession === sessionKey;

  const canRecoverUnavailableOrganization =
    inOrganizationScope &&
    userReady &&
    selectedOrganizationId !== null &&
    currentResolvedContext?.status === "unavailable" &&
    !activePendingSelection &&
    pendingSelection === null;

  const recoverToPersonalWorkspace = useCallback(() => {
    if (
      !canRecoverUnavailableOrganization ||
      !sessionKey ||
      !selectedOrganizationId ||
      pendingSelectionRef.current
    ) {
      return;
    }

    const previousOrganizationId = selectedOrganizationId;
    const nextSelection: PendingSelection = {
      organizationId: null,
      sequence: ++sequenceRef.current,
      pathname,
      targetPathname: "/app",
    };

    // Invalidate captures and cancel local work before clearing the selection.
    invalidateContext();
    identityRef.current = { organizationId: null, sessionKey };
    pendingSelectionRef.current = nextSelection;
    setPendingSelection(nextSelection);

    const search = { organizationId: undefined };
    void router
      .navigate({ to: "/app", search, replace: false } as never)
      .catch(() => {
        if (pendingSelectionRef.current?.sequence !== nextSelection.sequence) {
          return;
        }
        pendingSelectionRef.current = null;
        setPendingSelection(null);
        identityRef.current = {
          organizationId: previousOrganizationId,
          sessionKey,
        };
        invalidateContext();
        setResolvedContext((current) =>
          current?.sessionKey === sessionKey &&
          current.organizationId === previousOrganizationId
            ? {
                ...current,
                generation: generationRef.current,
                status: "unavailable",
              }
            : current,
        );
      });
  }, [
    canRecoverUnavailableOrganization,
    invalidateContext,
    pathname,
    router,
    selectedOrganizationId,
    sessionKey,
  ]);

  const organization =
    status === "ready" ? (currentResolvedContext?.organization ?? null) : null;
  const captureOrganizationContext = useCallback(() => {
    if (status !== "ready" || !organization) return null;
    const expiry = organizationExpiryRef.current;
    if (
      !expiry ||
      expiry.organizationId !== String(organization.institutionId) ||
      expiry.sessionKey !== identityRef.current.sessionKey ||
      (expiry.expiresAt !== null &&
        (!Number.isFinite(expiry.expiresAt) || Date.now() >= expiry.expiresAt))
    ) {
      return null;
    }
    return {
      organizationId: organization.institutionId,
      generation,
    };
  }, [generation, organization, status]);

  const isCurrentOrganizationContext = useCallback(
    (capture: OrganizationContextCapture) =>
      providerActiveRef.current &&
      statusRef.current === "ready" &&
      identityRef.current.organizationId === String(capture.organizationId) &&
      generationRef.current === capture.generation &&
      (() => {
        const expiry = organizationExpiryRef.current;
        return (
          expiry !== null &&
          expiry.organizationId === String(capture.organizationId) &&
          expiry.sessionKey === identityRef.current.sessionKey &&
          (expiry.expiresAt === null ||
            (Number.isFinite(expiry.expiresAt) &&
              Date.now() < expiry.expiresAt))
        );
      })(),
    [],
  );

  const registerOrganizationCancellation = useCallback(
    (cancel: () => void) => {
      if (status !== "ready") {
        cancel();
        return () => {};
      }
      cancellationsRef.current.add(cancel);
      return () => {
        if (!cancellationsRef.current.delete(cancel)) return;
        try {
          cancel();
        } catch {
          // A local cancellation callback must not block component cleanup.
        }
      };
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
      canRecoverUnavailableOrganization,
      recoverToPersonalWorkspace,
      canRetryUserInitialization,
      retryUserInitialization,
      organizations,
      organizationsStatus,
      selectOrganization,
      captureOrganizationContext,
      isCurrentOrganizationContext,
      registerOrganizationCancellation,
    }),
    [
      activePendingSelection,
      canRecoverUnavailableOrganization,
      canRetryOrganizationBootstrap,
      canRetryUserInitialization,
      captureOrganizationContext,
      isCurrentOrganizationContext,
      organization,
      organizations,
      organizationsStatus,
      registerOrganizationCancellation,
      retryOrganizationBootstrap,
      recoverToPersonalWorkspace,
      retryUserInitialization,
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
