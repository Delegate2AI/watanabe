// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import type { MeetingListItem } from "@/lib/meetings/list";

const isMeetingsEnabledMock = vi.fn();
vi.mock("@/lib/meetings/config", () => ({
  isMeetingsEnabled: () => isMeetingsEnabledMock(),
}));

// The on-branch touches these; the off-branch must never reach them.
const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentityMock() }));
const listMeetingNotesMock = vi.fn((): MeetingListItem[] => []);
vi.mock("@/lib/meetings/list", () => ({
  listMeetingNotes: (...args: unknown[]) => listMeetingNotesMock(...(args as [])),
}));

const isAuthorityEnabledMock = vi.fn(() => false);
vi.mock("@/lib/authority/config", () => ({
  isAuthorityEnabled: () => isAuthorityEnabledMock(),
  aliasesFilePath: () => "/nonexistent/aliases.yaml",
}));
const canMock = vi.fn(() => false);
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));
const loadGroupsMock = vi.fn(() => ({}));
vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => loadGroupsMock(),
  isKnownMember: (email: string, groups: Record<string, string[]>) =>
    Object.values(groups).some((members) => members.includes(email)),
}));

const Page = (await import("./page")).default;

beforeEach(() => {
  isMeetingsEnabledMock.mockReset();
  resolveIdentityMock
    .mockReset()
    .mockResolvedValue({ email: "alice@example.com", clearance: ["all-hands"] });
  listMeetingNotesMock.mockClear();
  isAuthorityEnabledMock.mockReset().mockReturnValue(false);
  canMock.mockReset().mockReturnValue(false);
  loadGroupsMock.mockReset().mockReturnValue({});
});

describe("MeetingsPage flag-off scaffold", () => {
  it("renders the byte-identical spec-20 RouteScaffold when the flag is off", async () => {
    isMeetingsEnabledMock.mockReturnValue(false);
    const element = await Page();
    const actual = renderToStaticMarkup(element);
    const expected = renderToStaticMarkup(
      <RouteScaffold
        icon={Calendar}
        eyebrow="Meetings"
        title="Transcribed and in the knowledge base"
        description="Every meeting is transcribed, summarized, and filed at the clearance of who attended. You only see the ones you are cleared for."
        spec="spec 20"
        flag="MEETINGS_ENABLED"
      />,
    );
    expect(actual).toBe(expected);
    // The off-branch must not read identity or the meeting store at all.
    expect(resolveIdentityMock).not.toHaveBeenCalled();
    expect(listMeetingNotesMock).not.toHaveBeenCalled();
  });

  it("scopes the reader to the viewer clearance when the flag is on", async () => {
    isMeetingsEnabledMock.mockReturnValue(true);
    const element = await Page();
    const { container } = render(element);
    expect(container.textContent).not.toContain("not switched on here");
    expect(resolveIdentityMock).toHaveBeenCalled();
    expect(listMeetingNotesMock).toHaveBeenCalledWith(["all-hands"]);
  });

  it("never loads group membership for a non-admin viewer", async () => {
    isMeetingsEnabledMock.mockReturnValue(true);
    canMock.mockReturnValue(false);
    await Page();
    expect(loadGroupsMock).not.toHaveBeenCalled();
  });

  it("gives an admin viewer the re-clearance control with unresolved attendees flagged", async () => {
    isMeetingsEnabledMock.mockReturnValue(true);
    isAuthorityEnabledMock.mockReturnValue(true);
    canMock.mockReturnValue(true);
    loadGroupsMock.mockReturnValue({ "all-hands": ["alice@example.com"], exec: ["alice@example.com"] });
    listMeetingNotesMock.mockReturnValue([{
      title: "Board Sync",
      date: "2026-07-11T10:00:00Z",
      attendeeCount: 2,
      visibility: "restricted",
      group: "Admins",
      href: "/kb/meetings/2026/board-sync",
      notePath: "meetings/2026/board-sync.md",
      visibilityGroups: ["admins"],
      attendees: ["alice@example.com", "unknown@example.com"],
    }]);

    const element = await Page();
    render(element);

    expect(loadGroupsMock).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Edit visibility");
  });
});
