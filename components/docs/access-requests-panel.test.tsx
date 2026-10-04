// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessRequestsPanel } from "./access-requests-panel";
import type { DocAccessRequest, SharedAccess } from "@/lib/shared-docs/types";

const fetchMock = vi.fn();

function request(id: string, email: string, access: SharedAccess = "comment"): DocAccessRequest {
  return {
    id,
    docId: "d1",
    requesterEmail: email,
    access,
    message: null,
    status: "pending",
    createdAt: "2026-08-23T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
  };
}

function lastBody(): { decision: string; access: string } {
  return JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string);
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("AccessRequestsPanel", () => {
  it("renders nothing when nobody is asking", () => {
    const { container } = render(<AccessRequestsPanel docId="d1" initialRequests={[]} />);
    expect(container.textContent).toBe("");
  });

  it("grants at the level asked for and drops the row", async () => {
    render(<AccessRequestsPanel docId="d1" initialRequests={[request("r1", "bob@example.com")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Grant" }));

    expect(fetchMock.mock.calls[0][0]).toBe("/api/docs/d1/access-requests/r1");
    expect(lastBody()).toEqual({ decision: "granted", access: "comment" });
    expect(screen.queryByRole("button", { name: "Grant" })).toBeNull();
  });

  it("grants at a level the owner picks instead", async () => {
    render(<AccessRequestsPanel docId="d1" initialRequests={[request("r1", "bob@example.com", "edit")]} />);
    await userEvent.selectOptions(screen.getByLabelText("Access to grant"), "view");
    await userEvent.click(screen.getByRole("button", { name: "Grant" }));
    expect(lastBody()).toEqual({ decision: "granted", access: "view" });
  });

  it("declines without granting anything", async () => {
    render(<AccessRequestsPanel docId="d1" initialRequests={[request("r1", "bob@example.com")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(lastBody().decision).toBe("declined");
  });

  it("keeps the row and reports the failure when the server refuses", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "conflict" }) });
    render(<AccessRequestsPanel docId="d1" initialRequests={[request("r1", "bob@example.com")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Grant" }));
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant" })).toBeTruthy();
  });

  it("counts the people waiting", () => {
    render(
      <AccessRequestsPanel
        docId="d1"
        initialRequests={[request("r1", "bob@example.com"), request("r2", "dana@example.com")]}
      />,
    );
    expect(screen.getByText("2 people are asking for access")).toBeTruthy();
  });
});
