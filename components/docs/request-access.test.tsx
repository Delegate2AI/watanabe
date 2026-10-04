// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestAccess } from "./request-access";
import type { DocAccessRequest } from "@/lib/shared-docs/types";

const fetchMock = vi.fn();

function pending(access: DocAccessRequest["access"] = "view"): DocAccessRequest {
  return {
    id: "r1",
    docId: "d1",
    requesterEmail: "bob@example.com",
    access,
    message: null,
    status: "pending",
    createdAt: "2026-08-23T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
  };
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ request: pending("comment") }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("RequestAccess", () => {
  it("sends the chosen level and the message", async () => {
    render(<RequestAccess docId="d1" />);
    await userEvent.click(screen.getByLabelText(/Commenter/));
    await userEvent.type(screen.getByLabelText(/Message/), "for the review");
    await userEvent.click(screen.getByRole("button", { name: "Request access" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1/access-requests",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      access: "comment",
      message: "for the review",
    });
    expect(screen.getByText(/Your request is with the document/)).toBeTruthy();
  });

  it("omits an empty message rather than sending a blank one", async () => {
    render(<RequestAccess docId="d1" />);
    await userEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ access: "view" });
  });

  it("shows a standing ask instead of an empty form, and can reopen it", async () => {
    render(<RequestAccess docId="d1" standing={pending("edit")} />);
    expect(screen.getByText(/Requested editor access/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Change the request" }));
    expect((screen.getByLabelText(/Editor/) as HTMLInputElement).checked).toBe(true);
  });

  it("renders the failure and does not claim the ask landed", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "not_found" }) });
    render(<RequestAccess docId="d1" />);
    await userEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(screen.queryByText(/Your request is with the document/)).toBeNull();
  });
});
