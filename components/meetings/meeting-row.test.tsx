// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeetingRow } from "./meeting-row";
import type { Person } from "@/lib/people/types";

/** What `resolvePerson` returns with PEOPLE_ENABLED off: the address itself. */
function flagOff(email: string): Person {
  return { email, name: email, initials: email.charAt(0).toUpperCase(), isSelf: false };
}
const FLAG_OFF_PEOPLE: Record<string, Person> = {
  "a@example.com": flagOff("a@example.com"),
  "b@example.com": flagOff("b@example.com"),
  "c@example.com": flagOff("c@example.com"),
};
const NAMED_PEOPLE: Record<string, Person> = {
  "a@example.com": { email: "a@example.com", name: "Maria Chen", initials: "MC", isSelf: false },
  "b@example.com": { email: "b@example.com", name: "Bo Li", initials: "BL", isSelf: false },
  "c@example.com": { email: "c@example.com", name: "Cass Ray", initials: "CR", isSelf: false },
};

const MEETING = {
  title: "Weekly Product Review",
  date: "2026-07-11T10:00:00Z",
  attendeeCount: 3,
  durationMinutes: 30,
  visibility: "restricted" as const,
  group: "Exec",
  href: "/kb/meetings/2026/weekly-product-review",
  notePath: "meetings/2026/weekly-product-review.md",
  visibilityGroups: ["exec"],
  attendees: ["a@example.com", "b@example.com", "c@example.com"],
};

describe("MeetingRow", () => {
  it("renders meeting metadata, visibility, and KB link", () => {
    render(<MeetingRow meeting={MEETING} people={FLAG_OFF_PEOPLE} />);
    expect(screen.getByText("Weekly Product Review")).toBeInTheDocument();
    // The count moved into the title. Who attended is the fact on screen now,
    // because clearance is derived from attendance.
    expect(screen.getByTitle("3 attendees")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /weekly product review/i })).toHaveAttribute(
      "href",
      "/kb/meetings/2026/weekly-product-review",
    );
    expect(screen.queryByText("Edit visibility")).not.toBeInTheDocument();
  });

  it("shows the re-clearance control only when the admin prop is supplied", () => {
    render(
      <MeetingRow
        meeting={MEETING}
        people={FLAG_OFF_PEOPLE}
        reclear={{ availableGroups: ["exec", "engineering"], unresolvedAttendees: ["b@example.com"] }}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit visibility" })).toBeInTheDocument();
  });

  it("names who attended, not just how many", () => {
    render(<MeetingRow meeting={MEETING} people={NAMED_PEOPLE} />);
    expect(screen.getByText("Maria Chen")).toBeInTheDocument();
    expect(screen.getByText("Bo Li")).toBeInTheDocument();
    expect(screen.getByText("Cass Ray")).toBeInTheDocument();
  });

  it("renders the bare address for every attendee when the people flag is off", () => {
    render(<MeetingRow meeting={MEETING} people={FLAG_OFF_PEOPLE} />);
    for (const email of MEETING.attendees) {
      expect(screen.getByText(email)).toBeInTheDocument();
    }
  });

  it("collapses past four attendees into a +N that names the rest on hover", () => {
    const attendees = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com", "f@example.com"];
    render(
      <MeetingRow
        meeting={{ ...MEETING, attendees, attendeeCount: attendees.length }}
        people={{ ...FLAG_OFF_PEOPLE, "d@example.com": flagOff("d@example.com") }}
      />,
    );
    expect(screen.getByText("+2")).toHaveAttribute("title", "e@example.com, f@example.com");
    expect(screen.queryByText("e@example.com")).not.toBeInTheDocument();
    expect(screen.getByTitle("6 attendees")).toBeInTheDocument();
  });
});
