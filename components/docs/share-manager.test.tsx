// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareManager } from "./share-manager";
import type { DocShare, ShareOptions } from "@/lib/shared-docs/types";

const fetchMock = vi.fn();

const TEAMMATE = "teammate@example.com";

function person(email: string, name: string) {
  return { email, name, initials: name.slice(0, 2).toUpperCase(), isSelf: false };
}

function shares(): DocShare[] {
  return [{ recipient: TEAMMATE, recipientKind: "user", access: "view", createdAt: "2026-08-11T00:00:00.000Z" }];
}

function options(): ShareOptions {
  return {
    teams: [
      { name: "all-hands", memberCount: null },
      { name: "engineering", memberCount: 6 },
    ],
    people: [
      { email: "alice@example.com", person: person("alice@example.com", "Alice") },
      { email: "bob@example.com", person: person("bob@example.com", "Bob") },
    ],
  };
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ shares: shares() }) });
  vi.stubGlobal("fetch", fetchMock);
});

function renderManager(props: Partial<React.ComponentProps<typeof ShareManager>> = {}) {
  return render(
    <ShareManager
      id="d1"
      initialShares={shares()}
      initialLinks={[]}
      externalEnabled={false}
      options={options()}
      people={{ [TEAMMATE]: person(TEAMMATE, "Teammate") }}
      {...props}
    />,
  );
}

const picker = () => screen.getByLabelText("Team or person to share with");

describe("ShareManager", () => {
  it("adds a person with the chosen access", async () => {
    renderManager({ initialShares: [] });
    await userEvent.selectOptions(picker(), "user:alice@example.com");
    await userEvent.selectOptions(screen.getByLabelText("Access for new recipient"), "comment");
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipient: "alice@example.com", kind: "user", access: "comment" }),
      }),
    );
  });

  it("adds a whole team, sending it as a group recipient", async () => {
    renderManager({ initialShares: [] });
    await userEvent.selectOptions(picker(), "group:engineering");
    await userEvent.selectOptions(screen.getByLabelText("Access for new recipient"), "edit");
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipient: "engineering", kind: "group", access: "edit" }),
      }),
    );
  });

  it("offers teams and people, and no free-text entry", () => {
    renderManager();
    const values = Array.from(picker().querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual([
      "",
      "group:all-hands",
      "group:engineering",
      "user:alice@example.com",
      "user:bob@example.com",
    ]);
    // The old free-text box is gone: a typo there wrote a share row aimed at an
    // address nobody owns, indistinguishable from a working grant.
    expect(screen.queryByPlaceholderText("Add people by email")).not.toBeInTheDocument();
  });

  it("names a team by its size and all-hands as Everyone", () => {
    renderManager();
    const labels = Array.from(picker().querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("engineering (6 people)");
    expect(labels).toContain("Everyone");
  });

  it("cannot share until a recipient is picked", async () => {
    renderManager({ initialShares: [] });
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    await userEvent.selectOptions(picker(), "user:bob@example.com");
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  });

  it("renders a team share row and revokes it as a group", async () => {
    renderManager({
      initialShares: [
        { recipient: "engineering", recipientKind: "group", access: "view", createdAt: "2026-08-11T00:00:00.000Z" },
      ],
    });
    // Scoped to the share list: the same label is also a picker <option>.
    const list = screen.getByRole("list");
    expect(within(list).getByText("engineering (6 people)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /revoke access for engineering/i }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ recipient: "engineering", kind: "group" }),
      }),
    );
  });

  it("shows a team no longer in the picker by its bare name, not as 0 people", () => {
    renderManager({
      initialShares: [
        { recipient: "retired-team", recipientKind: "group", access: "view", createdAt: "2026-08-11T00:00:00.000Z" },
      ],
    });
    expect(within(screen.getByRole("list")).getByText("retired-team")).toBeInTheDocument();
  });

  it("changes an existing recipient's role inline via upsert", async () => {
    renderManager();
    const row = screen.getByText("Teammate").closest("li")!;
    await userEvent.selectOptions(within(row).getByLabelText(`Access for ${TEAMMATE}`), "edit");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipient: TEAMMATE, kind: "user", access: "edit" }),
      }),
    );
  });

  it("revokes a recipient only after a second, deliberate confirm", async () => {
    renderManager();
    // First click asks for confirmation and does NOT revoke.
    await userEvent.click(screen.getByRole("button", { name: /revoke access for teammate/i }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({ method: "DELETE" }),
    );
    // Confirming fires the DELETE.
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ recipient: TEAMMATE, kind: "user" }),
      }),
    );
  });

  it("cancels a pending revoke without touching access", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: /revoke access for teammate/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/docs/d1/shares",
      expect.objectContaining({ method: "DELETE" }),
    );
    // The Revoke affordance is back, ready to try again.
    expect(screen.getByRole("button", { name: /revoke access for teammate/i })).toBeInTheDocument();
  });

  it("says so when there is nobody to share with, instead of an inert box", () => {
    renderManager({ options: { teams: [], people: [] } });
    expect(picker()).toBeDisabled();
    expect(screen.getByText("No one to share with yet")).toBeInTheDocument();
  });
});
