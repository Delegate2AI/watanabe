// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactEditor } from "./artifact-editor";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: pushMock }) }));

const fetchMock = vi.fn();

const OPTS: VisibilityOptions = {
  groups: ["all-hands", "board", "exec"],
  people: [{
    email: "alice@example.com",
    groups: ["exec"],
    person: { email: "alice@example.com", name: "Alice Adams", initials: "AA", isSelf: false },
  }],
};

function baseArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "Risk draft",
    status: "draft" as const,
    targetPath: null,
    targetVisibility: null,
    publishedNotePath: null,
    mrUrl: null,
    ...overrides,
  };
}

function renderEditor(props: Partial<React.ComponentProps<typeof ArtifactEditor>> = {}) {
  return render(
    <ArtifactEditor
      artifact={baseArtifact()}
      body="b"
      versions={[]}
      visibilityOptions={OPTS}
      targetFolders={["03-product", "07-governance"]}
      canPublish={false}
      canPublishDirect={false}
      {...props}
    />,
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  pushMock.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("ArtifactEditor", () => {
  it("saves an edited body as a new version via PATCH", async () => {
    renderEditor({ versions: [] });
    await userEvent.click(screen.getByRole("button", { name: /save version/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/a1", expect.objectContaining({ method: "PATCH" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("opens on the rendered markdown preview and toggles to an edit textarea", async () => {
    renderEditor({ body: "## Heading\n\n**bold** text", versions: [] });
    // Default is Preview: markdown renders (a real heading + <strong>), and the
    // raw textarea is not shown.
    expect(screen.getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.queryByLabelText("Artifact body")).not.toBeInTheDocument();
    // Edit reveals the raw textarea for authoring.
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByLabelText("Artifact body")).toBeInTheDocument();
  });

  it("offers rich and markdown modes instead of edit and preview when the flag is on", async () => {
    renderEditor({ richEditorEnabled: true, body: "## Heading\n\n**bold** text", versions: [] });
    expect(screen.queryByRole("button", { name: /^preview$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^markdown$/i })).toBeInTheDocument();
    // Rich mode opens straight onto an editable rendering of the body.
    const rich = await screen.findByLabelText("Artifact body");
    expect(rich).toHaveAttribute("contenteditable", "true");
    expect(within(rich).getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
  });

  it("keeps a published artifact on the read-only render even with the flag on", () => {
    renderEditor({
      richEditorEnabled: true,
      artifact: baseArtifact({ status: "published", publishedNotePath: "03-product/risk.md" }),
      body: "## Heading",
    });
    expect(screen.getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
    expect(screen.queryByRole("button", { name: /^markdown$/i })).not.toBeInTheDocument();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("deletes a draft after confirmation and returns to the list", async () => {
    renderEditor({ versions: [] });
    await userEvent.click(screen.getByRole("button", { name: /^delete draft$/i }));
    // A first click only asks for confirmation, it does not delete.
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/a1", expect.objectContaining({ method: "DELETE" }));
    expect(pushMock).toHaveBeenCalledWith("/artifacts");
  });

  it("labels deletion for a ready artifact by its current state", () => {
    renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: "03-product/risk.md" }),
    });
    expect(screen.getByRole("button", { name: "Delete artifact" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
  });

  it("offers no delete affordance for a published artifact", () => {
    renderEditor({ artifact: baseArtifact({ status: "published", publishedNotePath: "docs/notes/x.md" }) });
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("opens a past version in a read-only viewer without mutating", async () => {
    renderEditor({
      body: "# current draft",
      versions: [
        { version: 1, body: "# first cut", format: "md" as const, createdAt: "2026-07-12T08:39:17Z" },
        { version: 2, body: "# second cut", format: "md" as const, createdAt: "2026-07-12T08:50:26Z" },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    const dialog = screen.getByRole("dialog", { name: "Version 1" });
    // The version body renders as markdown now: "# first cut" becomes a heading,
    // so the "#" marker is gone and the text is "first cut".
    expect(dialog).toHaveTextContent("first cut");
    expect(within(dialog).getByRole("heading", { name: "first cut" }).tagName).toBe("H1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /close version viewer/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a published artifact is read-only: no Save version control", () => {
    renderEditor({
      artifact: baseArtifact({ status: "published", publishedNotePath: "docs/notes/x.md" }),
      versions: [{ version: 1, body: "b", format: "md" as const, createdAt: new Date().toISOString() }],
      canPublish: true,
      canPublishDirect: true,
    });
    expect(screen.queryByRole("button", { name: /save version/i })).not.toBeInTheDocument();
    expect(screen.getByText(/has been published/i)).toBeInTheDocument();
  });
});
