// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocView } from "./doc-view";
import type { Note } from "@/lib/kb/note";

const isPeopleEnabledMock = vi.fn(() => false);
vi.mock("@/lib/people/config", () => ({ isPeopleEnabled: () => isPeopleEnabledMock() }));
const resolvePersonMock = vi.fn();
vi.mock("@/lib/people/resolve", () => ({ resolvePerson: (...a: unknown[]) => resolvePersonMock(...a) }));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/agent/agent-chat", async () => {
  const React = await import("react");
  const { useChatContext } = await import("@/components/agent/chat-context-provider");
  return {
    AgentChat: () => {
      const context = useChatContext();
      return React.createElement(
        "pre",
        { "data-testid": "pending-chat-context" },
        JSON.stringify(context?.pendingContext ?? []),
      );
    },
  };
});

const fetchMock = vi.fn();
const writeTextMock = vi.fn();

const note: Note = {
  title: "Exec Comp Plan",
  type: "canon",
  updated: "2026-07-01",
  owner: "nick@example.com",
  visibility: "restricted",
  group: "Exec",
  body: "# Exec Comp Plan\n\nSee [[Roadmap]] and [external](https://example.com).",
};

const actions = {
  canProposeEdit: true,
  isAdmin: true,
  canDelete: true,
  groups: ["all-hands", "exec"],
  requesterEmail: "admin@example.com",
};

beforeEach(() => {
  pushMock.mockReset();
  fetchMock.mockReset();
  writeTextMock.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});


describe("DocView actions", () => {
  it("renders document actions in the specified order", () => {
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={actions}
      />,
    );
    const toolbar = screen.getByRole("toolbar", { name: "Document actions" });
    expect(within(toolbar).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Ask about this",
      "Copy link",
      "Propose an edit",
      "Manage access",
      "Delete",
    ]);
  });

  it("copies the absolute deep link for the same note", async () => {
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/kb/exec/comp`);
  });

  it("opens chat with a context chip and no synthetic user message", async () => {
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    expect(screen.getByRole("dialog", { name: "Chat about Exec Comp Plan" })).toBeInTheDocument();
    await waitFor(() => {
      const pending = JSON.parse(screen.getByTestId("pending-chat-context").textContent ?? "[]");
      expect(pending).toEqual([
        expect.objectContaining({
          type: "doc-selection",
          path: "exec/comp.md",
          docTitle: "Exec Comp Plan",
          selectedText: note.body,
        }),
      ]);
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates an artifact draft from the note and routes to it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "artifact-1" }), { status: 201 }));
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Propose an edit" }));
    // Only which note is meant. The rendered body reaching the server is the
    // whole defect this control was withheld for: what this component holds is
    // the reader's clearance projection, whose wikilinks to notes they cannot
    // see have already been deleted from it on disk. The server reads the source.
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sourcePath: "exec/comp.md" }),
    }));
    const sent = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(sent).not.toContain("[[Roadmap]]");
    expect(sent).not.toContain(note.body);
    expect(pushMock).toHaveBeenCalledWith("/artifacts/artifact-1");
  });

  it("hides write and access actions when server-computed capabilities are false", () => {
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={{
          ...actions,
          canProposeEdit: false,
          isAdmin: false,
          canDelete: false,
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Propose an edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("confirms a deletion by naming the path, then proposes it as a merge request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ branch: "kb/admin/delete-comp-1", mrUrl: "https://gl/mr/9" }), { status: 200 }),
    );
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete document" });
    expect(within(dialog).getByText("exec/comp.md")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Propose deletion" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/kb/delete", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ path: "exec/comp.md" }),
    }));
    expect(await within(dialog).findByRole("link", { name: /merge request/i })).toHaveAttribute(
      "href",
      "https://gl/mr/9",
    );
  });

  it("reports a refused deletion instead of claiming the note is gone", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 }),
    );
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete document" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Propose deletion" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /merge request/i })).not.toBeInTheDocument();
  });
});
