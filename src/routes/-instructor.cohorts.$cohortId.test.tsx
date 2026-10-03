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

import { cleanup, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("convex/react", () => queryMocks);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  const React = await import("react");
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) =>
      React.createElement("a", { href: "#" }, children),
  };
});

vi.mock("../components/AppFrame", async () => {
  const React = await import("react");
  return {
    AppFrame: ({
      title,
      children,
    }: {
      title: string;
      children: React.ReactNode;
    }) =>
      React.createElement(
        "main",
        null,
        React.createElement("h1", null, title),
        children,
      ),
    EmptyState: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
  };
});

import { CohortDetailPage } from "./instructor.cohorts.$cohortId";
import { InstructorDashboard } from "./instructor";

const cohortId = "cohort-route-test" as Id<"cohorts">;
const instructorInstitutionId =
  "instructor-institution-test" as Id<"institutions">;
const learnerInstitutionId = "learner-institution-test" as Id<"institutions">;
let queryValues: Record<string, unknown>;

function setQueryValues(values: Record<string, unknown>) {
  queryValues = values;
}

function queryArgsFor(functionName: string) {
  return queryMocks.useQuery.mock.calls
    .filter(
      ([reference]) =>
        getFunctionName(reference as Parameters<typeof getFunctionName>[0]) ===
        functionName,
    )
    .map(([, args]) => args);
}

function cohort(role: "learner" | "instructor" | "admin") {
  return {
    id: cohortId,
    institutionId: instructorInstitutionId,
    institutionName: "Teaching Institution",
    title: "Civil Appeals Cohort",
    term: "Fall 2026",
    role,
    archived: false,
  };
}

const publishedAssignment = {
  id: "assignment-route-test" as Id<"assignments">,
  cohortId,
  title: "Published learner assignment",
  published: true,
  autonomyMode: "supervised" as const,
  status: "not_started" as const,
};

function detailQueryValues(role?: "learner" | "instructor" | "admin") {
  return {
    "cohorts:listMine": role ? [cohort(role)] : undefined,
    "assignments:listForCohort": [publishedAssignment],
    "cohorts:listRoster": [
      {
        userId: "roster-user" as Id<"users">,
        displayName: "Roster Member",
        organizationRole: "learner",
      },
    ],
    "scenarios:listPublishedRecords": [
      { scenarioKey: "synthetic-case", title: "Synthetic Case" },
    ],
  };
}

beforeEach(() => {
  queryValues = {};
  queryMocks.useQuery.mockReset();
  queryMocks.useQuery.mockImplementation(
    (reference: Parameters<typeof getFunctionName>[0]) =>
      queryValues[getFunctionName(reference)],
  );
  queryMocks.useMutation.mockReset();
  queryMocks.useMutation.mockImplementation(() => vi.fn());
});

afterEach(() => cleanup());

describe("instructor cohort routes", () => {
  it("skips instructor-only reads while the cohort role loads and for learners", () => {
    setQueryValues(detailQueryValues());
    const view = render(<CohortDetailPage cohortId={cohortId} />);

    expect(queryArgsFor("cohorts:listRoster").at(-1)).toBe("skip");
    expect(queryArgsFor("scenarios:listPublishedRecords").at(-1)).toBe("skip");
    expect(queryArgsFor("assignments:listForCohort").at(-1)).toEqual({
      cohortId,
    });
    expect(screen.queryByText("Create assignment")).toBeNull();
    expect(screen.queryByText("Invite collaborators")).toBeNull();
    expect(screen.queryByText("Roster")).toBeNull();

    setQueryValues(detailQueryValues("learner"));
    view.rerender(<CohortDetailPage cohortId={cohortId} />);

    expect(
      screen.getByRole("heading", { name: "Civil Appeals Cohort" }),
    ).toBeTruthy();
    expect(screen.getByText("Published learner assignment")).toBeTruthy();
    expect(queryArgsFor("cohorts:listRoster").at(-1)).toBe("skip");
    expect(queryArgsFor("scenarios:listPublishedRecords").at(-1)).toBe("skip");
    expect(screen.queryByText("Create assignment")).toBeNull();
    expect(screen.queryByText("Invite collaborators")).toBeNull();
    expect(screen.queryByText("Roster")).toBeNull();
  });

  it.each(["instructor", "admin"] as const)(
    "loads the roster and shows teaching controls for %s cohorts",
    (role) => {
      setQueryValues(detailQueryValues(role));
      render(<CohortDetailPage cohortId={cohortId} />);

      expect(queryArgsFor("cohorts:listRoster").at(-1)).toEqual({ cohortId });
      expect(queryArgsFor("scenarios:listPublishedRecords").at(-1)).toEqual({});
      expect(screen.getByText("Create assignment")).toBeTruthy();
      expect(screen.getByText("Invite collaborators")).toBeTruthy();
      expect(screen.getByText("Roster Member")).toBeTruthy();
      const roleOptions = within(
        screen.getByRole("combobox", { name: "Invite role" }),
      ).getAllByRole("option");
      expect(roleOptions.map((option) => option.textContent)).toEqual(
        role === "admin" ? ["Learner", "Instructor"] : ["Learner"],
      );
    },
  );

  it("hides cohort creation and skips institution reads while learner capability is unresolved or absent", () => {
    setQueryValues({
      "cohorts:listMine": [cohort("learner")],
      "organizations:listMine": undefined,
      "cohorts:listInstitutions": [
        {
          id: learnerInstitutionId,
          name: "Learner Institution",
          slug: "learner-institution",
          status: "active",
        },
      ],
    });
    const view = render(<InstructorDashboard />);

    expect(queryArgsFor("cohorts:listInstitutions").at(-1)).toBe("skip");
    expect(screen.queryByText("Create cohort")).toBeNull();
    expect(screen.getByText("Civil Appeals Cohort")).toBeTruthy();

    setQueryValues({
      "cohorts:listMine": [cohort("learner")],
      "organizations:listMine": [
        {
          institutionId: learnerInstitutionId,
          name: "Learner Institution",
          kind: "shared",
          role: "learner",
        },
      ],
      "cohorts:listInstitutions": [],
    });
    view.rerender(<InstructorDashboard />);

    expect(queryArgsFor("cohorts:listInstitutions").at(-1)).toBe("skip");
    expect(screen.queryByText("Create cohort")).toBeNull();
    expect(screen.getByText("Civil Appeals Cohort")).toBeTruthy();
  });

  it.each(["instructor", "admin"] as const)(
    "limits cohort creation choices to institutions where the actor is %s or admin",
    (role) => {
      setQueryValues({
        "cohorts:listMine": [cohort(role)],
        "organizations:listMine": [
          {
            institutionId: instructorInstitutionId,
            name: "Teaching Institution",
            kind: "shared",
            role,
          },
          {
            institutionId: learnerInstitutionId,
            name: "Learner Institution",
            kind: "shared",
            role: "learner",
          },
        ],
        "cohorts:listInstitutions": [
          {
            id: instructorInstitutionId,
            name: "Teaching Institution",
            slug: "teaching-institution",
            status: "active",
          },
          {
            id: learnerInstitutionId,
            name: "Learner Institution",
            slug: "learner-institution",
            status: "active",
          },
        ],
      });
      render(<InstructorDashboard />);

      expect(queryArgsFor("cohorts:listInstitutions").at(-1)).toEqual({});
      expect(screen.getByText("Create cohort")).toBeTruthy();
      const institutionOptions = within(
        screen.getByRole("combobox", { name: "Institution" }),
      )
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(institutionOptions).toEqual([
        "Institution",
        "Teaching Institution",
      ]);
    },
  );
});
