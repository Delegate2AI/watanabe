// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReclearControl } from "./reclear-control";

const PROPS = {
  notePath: "meetings/2026/one.md",
  visibilityGroups: ["exec"],
  unresolvedAttendees: [],
  availableGroups: ["exec", "engineering"],
};

/** Open the control and press Submit, with `fetch` answering as given. */
async function submit(response: { ok: boolean; status: number; body: unknown }): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    }),
  );
  const user = userEvent.setup();
  render(<ReclearControl {...PROPS} />);
  await user.click(screen.getByRole("button", { name: "Edit visibility" }));
  await user.click(screen.getByRole("button", { name: "Submit for review" }));
}

describe("ReclearControl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links the merge request a reviewer has to act on", async () => {
    await submit({
      ok: true,
      status: 200,
      body: { branch: "kb/admin/reclear-1", mrUrl: "https://git.example.com/mr/7" },
    });

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open merge request" })).toHaveAttribute(
      "href",
      "https://git.example.com/mr/7",
    );
    // Not "applied": the note keeps its old clearance until the merge lands.
    expect(screen.getByRole("status")).toHaveTextContent("Merge it to apply the new clearance");
  });

  it("does not claim a review exists when the response carries no merge request", async () => {
    await submit({ ok: true, status: 200, body: { branch: "kb/admin/reclear-1" } });

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Open merge request" })).not.toBeInTheDocument();
  });

  it("tells the admin the change survived when only the merge request failed", async () => {
    await submit({ ok: false, status: 502, body: { error: { code: "review_unavailable" } } });

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    // The distinction that matters: the branch is pushed, so this is not a
    // "try again" and the copy must not read as one.
    expect(screen.getByRole("status")).toHaveTextContent(/saved to a branch/i);
    expect(screen.queryByRole("link", { name: "Open merge request" })).not.toBeInTheDocument();
  });
});
