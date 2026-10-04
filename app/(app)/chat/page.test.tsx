// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentityMock() }));
const listThreadsForOwnerMock = vi.fn(() => [] as unknown[]);
vi.mock("@/lib/db/threads", () => ({
  listThreadsForOwner: (...args: unknown[]) => listThreadsForOwnerMock(...(args as [])),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const Page = (await import("./page")).default;

function thread(over: Record<string, unknown> = {}) {
  return {
    sdkSessionId: "t1",
    ownerEmail: "alice@example.com",
    title: "Fee model",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    dirty: false,
    dreamedAt: null,
    pinned: false,
    ...over,
  };
}

beforeEach(() => {
  resolveIdentityMock
    .mockReset()
    .mockResolvedValue({ email: "alice@example.com", clearance: ["all-hands"] });
  listThreadsForOwnerMock.mockReset().mockReturnValue([]);
});

describe("ChatIndexPage", () => {
  it("no longer renders the spec-18 placeholder scaffold", async () => {
    const { container } = render(await Page());
    expect(container.textContent).not.toContain("not switched on here");
  });

  it("scopes the thread list to the resolved identity", async () => {
    await Page();
    expect(resolveIdentityMock).toHaveBeenCalled();
    expect(listThreadsForOwnerMock).toHaveBeenCalledWith({}, "alice@example.com");
  });

  it("renders an empty state when the viewer has no threads", async () => {
    listThreadsForOwnerMock.mockReturnValue([]);
    const { container } = render(await Page());
    expect(container.textContent).toContain("have not started any conversations");
  });

  it("lists pinned and recent threads, each linking to its thread view", async () => {
    listThreadsForOwnerMock.mockReturnValue([
      thread({ sdkSessionId: "pin1", title: "Pinned chat", pinned: true }),
      thread({ sdkSessionId: "rec1", title: "Recent chat", pinned: false }),
    ]);
    const { container, getByRole } = render(await Page());
    expect(container.textContent).toContain("Pinned");
    expect(container.textContent).toContain("Recents");
    expect(getByRole("link", { name: /Pinned chat/ })).toHaveAttribute("href", "/chat/pin1");
    expect(getByRole("link", { name: /Recent chat/ })).toHaveAttribute("href", "/chat/rec1");
  });

  it("falls back to 'New chat' for an untitled thread", async () => {
    listThreadsForOwnerMock.mockReturnValue([thread({ sdkSessionId: "t9", title: null })]);
    const { container } = render(await Page());
    expect(container.textContent).toContain("New chat");
  });
});
