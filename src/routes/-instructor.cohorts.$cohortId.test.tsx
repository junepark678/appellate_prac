/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  context: null as Record<string, any> | null,
}));

vi.mock("convex/react", () => queryMocks);

vi.mock("../components/OrganizationContext", () => ({
  useOrganizationContext: () => queryMocks.context,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  const React = await import("react");
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) =>
      React.createElement("a", { href: "#" }, children),
    useRouterState: () => ({ location: { pathname: "/instructor" } }),
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
const organizationId = "teaching-institution-test" as Id<"institutions">;
const otherOrganizationId = "other-institution-test" as Id<"institutions">;
let queryValues: Record<string, unknown>;

function makeContext(role: "learner" | "instructor" | "admin") {
  const generation = 1;
  return {
    organizationId,
    organization: {
      institutionId: organizationId,
      name: "Teaching Institution",
      kind: "shared",
      role,
      capabilities: {
        learn: true,
        teach: role !== "learner",
        manageMembers: role === "admin",
      },
    },
    capabilities: {
      learn: true,
      teach: role !== "learner",
      manageMembers: role === "admin",
    },
    status: "ready",
    captureOrganizationContext: () => ({ organizationId, generation }),
    isCurrentOrganizationContext: (capture: {
      organizationId: string;
      generation: number;
    }) =>
      capture.organizationId === organizationId &&
      capture.generation === generation,
    registerOrganizationCancellation: () => () => undefined,
  };
}

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

function cohort(
  role: "learner" | "instructor" | "admin",
  institutionId = organizationId,
) {
  return {
    id: cohortId,
    institutionId,
    institutionName:
      institutionId === organizationId
        ? "Teaching Institution"
        : "Other Institution",
    title: "Civil Appeals Course",
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
  };
}

beforeEach(() => {
  queryValues = {};
  queryMocks.context = makeContext("instructor");
  queryMocks.useQuery.mockReset();
  queryMocks.useQuery.mockImplementation(
    (reference: Parameters<typeof getFunctionName>[0]) =>
      queryValues[getFunctionName(reference)],
  );
  queryMocks.useMutation.mockReset();
  queryMocks.useMutation.mockImplementation(() =>
    vi.fn().mockResolvedValue(undefined),
  );
});

afterEach(() => cleanup());

describe("instructor course routes", () => {
  it("denies direct course access to learners before course reads run", () => {
    queryMocks.context = makeContext("learner");
    setQueryValues(detailQueryValues("learner"));
    render(<CohortDetailPage cohortId={cohortId} />);

    expect(screen.getByRole("alert").textContent).toMatch(
      /available to instructors/i,
    );
    expect(queryArgsFor("cohorts:listMine")).toHaveLength(0);
    expect(queryArgsFor("assignments:listForCohort")).toHaveLength(0);
    expect(queryArgsFor("cohorts:listRoster")).toHaveLength(0);
  });

  it.each(["instructor", "admin"] as const)(
    "loads selected organization course controls for %s memberships",
    (role) => {
      queryMocks.context = makeContext(role);
      setQueryValues(detailQueryValues(role));
      render(<CohortDetailPage cohortId={cohortId} />);

      expect(
        screen.getByRole("heading", { name: "Civil Appeals Course" }),
      ).toBeTruthy();
      expect(queryArgsFor("cohorts:listMine").at(-1)).toEqual({
        institutionId: "teaching-institution-test",
      });
      expect(queryArgsFor("assignments:listForCohort").at(-1)).toEqual({
        cohortId,
      });
      expect(queryArgsFor("cohorts:listRoster").at(-1)).toEqual({ cohortId });
      expect(screen.getByText("Create assignment")).toBeTruthy();
      expect(screen.getByText("Invite collaborators")).toBeTruthy();
      expect(screen.getByText("Organization role: learner")).toBeTruthy();
      const options = within(
        screen.getByRole("combobox", { name: "Invite role" }),
      )
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(options).toEqual(
        role === "admin" ? ["Learner", "Instructor"] : ["Learner"],
      );
    },
  );

  it("filters the course list to the selected organization and creates there", async () => {
    queryMocks.context = makeContext("instructor");
    setQueryValues({
      "cohorts:listMine": [
        cohort("instructor"),
        { ...cohort("admin", otherOrganizationId), id: "foreign-course" },
      ],
    });
    const createCohort = vi.fn().mockResolvedValue(undefined);
    queryMocks.useMutation.mockReturnValue(createCohort);
    render(<InstructorDashboard />);

    expect(screen.getByText("Civil Appeals Course")).toBeTruthy();
    expect(screen.queryByText("Other Institution")).toBeNull();
    expect(queryArgsFor("cohorts:listMine").at(-1)).toEqual({
      institutionId: "teaching-institution-test",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Course title" }), {
      target: { value: "Selected organization course" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(createCohort).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionId: organizationId,
        title: "Selected organization course",
      }),
    );
  });
});
