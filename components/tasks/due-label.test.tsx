// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DueLabel } from "./due-label";

/**
 * The clock is pinned in local time, not UTC. A date-only due value is a
 * calendar day, so only a local pin makes the day delta the same number in
 * every timezone this suite might run in.
 */
function at(now: string, due: string, props: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  try {
    render(<DueLabel due={due} {...props} />);
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DueLabel", () => {
  it("says how far away the day is instead of printing a machine date", () => {
    at("2026-07-13T12:00:00", "2026-07-15");
    expect(screen.getByText("in 2 days")).toBeInTheDocument();
  });

  it("keeps the absolute day in the title, so precision is one hover away", () => {
    at("2026-07-13T12:00:00", "2026-07-15");
    expect(screen.getByTitle("15 Jul 2026")).toHaveAttribute("datetime", "2026-07-15");
  });

  it("marks a passed day so it cannot read like a future one", () => {
    at("2026-07-20T12:00:00", "2026-07-15");
    expect(screen.getByText("5 days ago")).toHaveClass("text-warn");
  });

  it("leaves a day that has not passed unmarked, including today", () => {
    at("2026-07-15T12:00:00", "2026-07-15");
    const label = screen.getByText("today");
    expect(label).not.toHaveClass("text-warn");
  });

  it("renders the caller's prefix ahead of the label", () => {
    at("2026-07-13T12:00:00", "2026-07-14", { prefix: "Due " });
    expect(screen.getByText("Due tomorrow")).toBeInTheDocument();
  });

  it("leaves an unparseable value alone rather than rendering Invalid Date", () => {
    at("2026-07-13T12:00:00", "not a date");
    expect(screen.getByText("not a date")).toBeInTheDocument();
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
  });
});
