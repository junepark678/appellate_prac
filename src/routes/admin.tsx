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

import { AppFrame, OrganizationRouteGate } from "../components/AppFrame";

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

function AdminHome() {
  return (
    <AppFrame title="Organization administration">
      <section className="rounded border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">
          Organization administration is coming in the next dependent PR.
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This legacy global administration panel is unavailable during the
          organization-scoped access cutover.
        </p>
      </section>
    </AppFrame>
  );
}
