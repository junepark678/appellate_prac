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

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({ useQuery: vi.fn() }));

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

import {
  SessionPage,
  SessionRouteErrorBoundary,
} from "./app.sessions.$caseSessionId";

beforeEach(() => queryMocks.useQuery.mockReset());
afterEach(() => cleanup());

describe("session deep-link route errors", () => {
  it.each(["missing", "foreign", "legacy unscoped"])(
    "shows a generic empty state for %s NOT_FOUND responses",
    async () => {
      const error = Object.assign(new Error("Sensitive resource details"), {
        data: { code: "NOT_FOUND", message: "Organization A private case" },
      });
      render(
        <SessionRouteErrorBoundary error={error} reset={() => undefined} />,
      );

      expect(await screen.findByText("Session not found.")).toBeTruthy();
      expect(
        screen.queryByText(/Sensitive resource|Organization A/),
      ).toBeNull();
    },
  );

  it("continues to render a valid session", () => {
    queryMocks.useQuery.mockReturnValue({
      scenario: { shortCaption: "Example v. State" },
      docketEntries: [
        {
          id: "entry-1",
          entryNumber: 1,
          title: "Notice of appeal",
          filedAt: "2026-10-01T00:00:00.000Z",
          text: "Notice filed.",
        },
      ],
      deadlines: [
        { id: "deadline-1", label: "Opening brief", dueDate: "2026-11-01" },
      ],
      filings: [],
    });

    render(<SessionPage caseSessionId="session-valid" />);

    expect(
      screen.getByRole("heading", { name: "Example v. State" }),
    ).toBeTruthy();
    expect(screen.getByText(/Notice of appeal/)).toBeTruthy();
  });

  it.each([
    Object.assign(new Error("Authentication required"), {
      data: { code: "AUTH_REQUIRED" },
    }),
    new Error("Connection failed"),
  ])(
    "delegates authentication and unrelated errors to the existing route boundary",
    async (error) => {
      render(
        <SessionRouteErrorBoundary error={error} reset={() => undefined} />,
      );

      expect(
        screen.getByRole("heading", { name: "Something went wrong" }),
      ).toBeTruthy();
      expect(screen.getByText(error.message)).toBeTruthy();
      expect(screen.queryByText("Session not found.")).toBeNull();
    },
  );
});
