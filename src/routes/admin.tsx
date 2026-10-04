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

import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  AppFrame,
  EmptyState,
  OrganizationRouteGate,
} from "../components/AppFrame";
import {
  type OrganizationContextCapture,
  useOrganizationContext,
} from "../components/OrganizationContext";

export const Route = createFileRoute("/admin")({
  search: {
    middlewares: [retainSearchParams(["organizationId"])],
  },
  component: AdminSection,
});

function AdminSection() {
  return (
    <OrganizationRouteGate
      title="Organization administration"
      capability="manageMembers"
    >
      <AdminHome />
    </OrganizationRouteGate>
  );
}

type MemberRole = "learner" | "instructor" | "admin";
type MemberStatus = "active" | "suspended";

type OrganizationMemberRow = {
  membershipId: Id<"institutionMemberships">;
  userId: Id<"users">;
  displayName: string;
  role: MemberRole;
  status: MemberStatus;
  expiresAt?: string;
};

const MAX_MEMBER_SEARCH_LENGTH = 120;

export function AdminHome() {
  const organization = useOrganizationContext();
  const capture = organization.captureOrganizationContext();
  const canManage =
    organization.status === "ready" &&
    capture !== null &&
    organization.capabilities.manageMembers &&
    organization.isCurrentOrganizationContext(capture);

  if (
    organization.status === "ready" &&
    !organization.capabilities.manageMembers
  ) {
    return (
      <AppFrame title="Organization administration">
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          Organization administration is available to organization admins.
        </p>
      </AppFrame>
    );
  }

  if (!canManage || !capture || !organization.organization) {
    return (
      <AppFrame title="Organization administration">
        <p role="status">Loading selected organization…</p>
      </AppFrame>
    );
  }

  if (organization.organization.kind === "personal") {
    return (
      <AppFrame title="Personal workspace">
        <section className="rounded border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Membership controls are unavailable</h2>
          <p className="mt-2 text-sm text-slate-600">
            Personal workspaces are owner-only. The owner membership cannot be
            edited and invitations are not available.
          </p>
        </section>
      </AppFrame>
    );
  }

  return <OrganizationMembers key={scopeKey(capture)} capture={capture} />;
}

function OrganizationMembers({
  capture,
}: {
  capture: OrganizationContextCapture;
}) {
  const organization = useOrganizationContext();
  const [search, setSearch] = useState("");
  const isCurrent = organization.isCurrentOrganizationContext(capture);
  const members = useQuery(
    api.users.listOrganizationMembers,
    isCurrent
      ? {
          institutionId: capture.organizationId,
          ...(search.trim() ? { search: search.trim() } : {}),
        }
      : "skip",
  );

  return (
    <AppFrame title="Organization administration">
      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-semibold">Selected organization members</h2>
          <label className="mt-3 grid gap-1 text-sm">
            <span className="font-medium">
              Search selected organization members
            </span>
            <input
              className="max-w-lg rounded border border-slate-300 px-3 py-2"
              type="search"
              maxLength={MAX_MEMBER_SEARCH_LENGTH}
              value={search}
              onChange={(event) =>
                setSearch(event.target.value.slice(0, MAX_MEMBER_SEARCH_LENGTH))
              }
              aria-label="Search selected organization members"
            />
          </label>
        </div>
        {!isCurrent || members === undefined ? (
          <p role="status" className="p-4 text-sm text-slate-600">
            Loading members…
          </p>
        ) : members.length === 0 ? (
          <EmptyState>No members found in this organization.</EmptyState>
        ) : (
          <div className="divide-y divide-slate-100">
            {(members as OrganizationMemberRow[]).map((member) => (
              <OrganizationMemberEditor
                key={member.membershipId}
                capture={capture}
                member={member}
              />
            ))}
          </div>
        )}
      </section>
    </AppFrame>
  );
}

function OrganizationMemberEditor({
  capture,
  member,
}: {
  capture: OrganizationContextCapture;
  member: OrganizationMemberRow;
}) {
  const organization = useOrganizationContext();
  const updateMember = useMutation(api.users.updateOrganizationMember);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [expiresAtInput, setExpiresAtInput] = useState(() =>
    toLocalDateTimeInput(member.expiresAt),
  );
  const [savedExpiresAtInput, setSavedExpiresAtInput] = useState(() =>
    toLocalDateTimeInput(member.expiresAt),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestedExpiry = expiresAtInput
    ? new Date(expiresAtInput).getTime()
    : undefined;
  const hasExpiryChange =
    expiresAtInput !== savedExpiresAtInput &&
    requestedExpiry !== undefined &&
    Number.isFinite(requestedExpiry) &&
    requestedExpiry > Date.now() &&
    requestedExpiry !== Date.parse(member.expiresAt ?? "");
  const invalidExpiryChange =
    expiresAtInput !== savedExpiresAtInput &&
    expiresAtInput !== "" &&
    (!Number.isFinite(requestedExpiry) ||
      (requestedExpiry !== undefined && requestedExpiry <= Date.now()));
  const reactivatingExpiredMembership =
    member.status === "suspended" &&
    status === "active" &&
    membershipExpiryIsInactive(member.expiresAt) &&
    !hasExpiryChange;
  const canSave =
    organization.isCurrentOrganizationContext(capture) &&
    (role !== member.role || status !== member.status || hasExpiryChange) &&
    !pending &&
    !invalidExpiryChange &&
    !reactivatingExpiredMembership;

  async function saveMember() {
    if (!organization.isCurrentOrganizationContext(capture) || !canSave) return;
    setPending(true);
    setError("");
    try {
      const nextExpiry = expiresAtInput ? new Date(expiresAtInput) : undefined;
      await updateMember({
        institutionId: capture.organizationId,
        membershipId: member.membershipId,
        role,
        status,
        ...(hasExpiryChange && nextExpiry
          ? { expiresAt: nextExpiry.toISOString() }
          : {}),
      });
      if (organization.isCurrentOrganizationContext(capture)) {
        if (hasExpiryChange) setSavedExpiresAtInput(expiresAtInput);
        else setExpiresAtInput(savedExpiresAtInput);
      }
    } catch (cause) {
      if (organization.isCurrentOrganizationContext(capture)) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to update organization member",
        );
      }
    } finally {
      if (organization.isCurrentOrganizationContext(capture)) setPending(false);
    }
  }

  return (
    <div className="grid gap-3 p-4 md:grid-cols-[1fr_150px_150px_240px_auto] md:items-center">
      <div>
        <p className="font-medium">{member.displayName}</p>
        <p className="text-xs text-slate-500">
          Organization member · Access: {effectiveMembershipStatus(member)}
        </p>
        {reactivatingExpiredMembership ? (
          <p className="mt-1 text-xs text-amber-700">
            Set a future expiry before reactivating this membership.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <label className="grid gap-1 text-xs text-slate-600">
        <span>Organization role</span>
        <select
          aria-label={`Role for ${member.displayName}`}
          className="rounded border border-slate-300 px-2 py-2 text-sm"
          disabled={
            !organization.isCurrentOrganizationContext(capture) || pending
          }
          value={role}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          <option value="learner">Learner</option>
          <option value="instructor">Instructor</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-slate-600">
        <span>Set or renew expiry (your local time)</span>
        <input
          aria-label={`Expiry for ${member.displayName}`}
          className="rounded border border-slate-300 px-2 py-2 text-sm"
          disabled={
            !organization.isCurrentOrganizationContext(capture) || pending
          }
          type="datetime-local"
          step="1"
          value={expiresAtInput}
          onChange={(event) => setExpiresAtInput(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs text-slate-600">
        <span>Membership status</span>
        <select
          aria-label={`Status for ${member.displayName}`}
          className="rounded border border-slate-300 px-2 py-2 text-sm"
          disabled={
            !organization.isCurrentOrganizationContext(capture) || pending
          }
          value={status}
          onChange={(event) => setStatus(event.target.value as MemberStatus)}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </label>
      <button
        type="button"
        className="rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={!canSave}
        onClick={() => void saveMember()}
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function toLocalDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 19);
}

function effectiveMembershipStatus(member: OrganizationMemberRow) {
  if (member.status !== "active") return "Suspended";
  if (!member.expiresAt) return "Active";
  if (!isOrganizationContractUtcTimestamp(member.expiresAt)) {
    return "Expiration invalid";
  }
  const expiresAt = Date.parse(member.expiresAt);
  if (!Number.isFinite(expiresAt)) return "Expiration invalid";
  return expiresAt <= Date.now() ? "Expired" : "Active";
}

function membershipExpiryIsInactive(value?: string) {
  if (!value) return false;
  if (!isOrganizationContractUtcTimestamp(value)) return true;
  const expiresAt = Date.parse(value);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

/** Match convex/organizationContracts.ts:isUtcTimestamp for admin expiry checks. */
function isOrganizationContractUtcTimestamp(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(
      value,
    )
  )
    return false;
  const normalized = value.replace(/\+00:00$/, "Z");
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) return false;
  const [seconds, fraction = ""] = normalized.slice(0, -1).split(".");
  return (
    new Date(time).toISOString() === `${seconds}.${fraction.padEnd(3, "0")}Z`
  );
}

function scopeKey(capture: OrganizationContextCapture) {
  return `${String(capture.organizationId)}:${capture.generation}`;
}
