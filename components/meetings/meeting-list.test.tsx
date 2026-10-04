// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingList } from "./meeting-list";
import type { MeetingListItem } from "@/lib/meetings/list";

afterEach(cleanup);

function meeting(title: string, href: string, group?: string): MeetingListItem {
  return {
    title,
    date: "2026-07-11T10:00:00Z",
    attendeeCount: 2,
    visibility: group ? "restricted" : "all-hands",
    ...(group ? { group } : {}),
    href,
    notePath: `${href}.md`,
    visibilityGroups: group ? [group.toLowerCase()] : ["all-hands"],
    attendees: ["alice@example.com"],
  };
}

const ENTRIES = [
  { meeting: meeting("Board Sync", "/kb/meetings/board-sync", "Admins") },
  { meeting: meeting("Roadmap review", "/kb/meetings/roadmap-review") },
];

describe("MeetingList scope toggle", () => {
  const SCOPED = [
    { meeting: meeting("Board Sync", "/kb/meetings/board-sync", "Admins"), attended: true },
    { meeting: meeting("Roadmap review", "/kb/meetings/roadmap-review") },
  ];

  it("opens on My meetings when the viewer attended one", () => {
    render(<MeetingList entries={SCOPED} people={{}} />);
    expect(screen.getByRole("tab", { name: "My meetings 1", selected: true })).toBeTruthy();
    expect(screen.getByText("Board Sync")).toBeTruthy();
    expect(screen.queryByText("Roadmap review")).toBeNull();
  });

  it("widens back to every cleared meeting on All", async () => {
    render(<MeetingList entries={SCOPED} people={{}} />);
    await userEvent.click(screen.getByRole("tab", { name: "All 2" }));
    expect(screen.getByText("Board Sync")).toBeTruthy();
    expect(screen.getByText("Roadmap review")).toBeTruthy();
  });

  it("opens on All when the viewer attended none", () => {
    render(<MeetingList entries={ENTRIES} people={{}} />);
    expect(screen.getByRole("tab", { name: "All 2", selected: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "My meetings 0" })).toBeTruthy();
    expect(screen.getByText("Roadmap review")).toBeTruthy();
  });

  it("says so when My meetings is empty", async () => {
    render(<MeetingList entries={ENTRIES} people={{}} />);
    await userEvent.click(screen.getByRole("tab", { name: "My meetings 0" }));
    expect(screen.getByText("None of the meetings you are cleared for list you as an attendee.")).toBeTruthy();
  });
});

describe("MeetingList filter", () => {
  it("shows every meeting before anything is typed", () => {
    render(<MeetingList entries={ENTRIES} people={{}} />);
    expect(screen.getByText("Board Sync")).toBeTruthy();
    expect(screen.getByText("Roadmap review")).toBeTruthy();
  });

  it("narrows to matching meetings", async () => {
    render(<MeetingList entries={ENTRIES} people={{}} />);
    await userEvent.type(screen.getByLabelText("Filter meetings"), "roadmap");
    expect(screen.queryByText("Board Sync")).toBeNull();
    expect(screen.getByText("Roadmap review")).toBeTruthy();
  });

  it("says so when the filter hides everything", async () => {
    render(<MeetingList entries={ENTRIES} people={{}} />);
    await userEvent.type(screen.getByLabelText("Filter meetings"), "zzz");
    expect(screen.getByText("No meetings match that filter.")).toBeTruthy();
  });
});
