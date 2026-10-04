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

describe("ArtifactEditor publishing", () => {
  it("hides Publish controls from a non-writer even when ready", () => {
    renderEditor({ artifact: baseArtifact({ status: "ready", targetPath: "notes/x.md" }) });
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission to publish/i)).toBeInTheDocument();
  });

  it("shows review publishing to an editor and immediate publishing to an approver", () => {
    const { rerender } = renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: "notes/x.md" }),
      canPublish: true,
    });
    expect(screen.getByRole("button", { name: "Request review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish now" })).not.toBeInTheDocument();

    rerender(
      <ArtifactEditor
        artifact={baseArtifact({ status: "ready", targetPath: "notes/x.md" })}
        body="b"
        versions={[]}
        visibilityOptions={OPTS}
        targetFolders={["03-product", "07-governance"]}
        canPublish={true}
        canPublishDirect={true}
      />,
    );
    expect(screen.getByRole("button", { name: "Request review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish now" })).toBeInTheDocument();
    expect(screen.getByText(/opens a merge request for an approver to merge/i)).toHaveTextContent(
      /publish now goes live immediately/i,
    );
  });

  it("publishes via the publish endpoint and surfaces the MR url", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, mrUrl: "https://gl/mr/9" }) });
    renderEditor({ artifact: baseArtifact({ status: "ready", targetPath: "notes/x.md" }), canPublish: true });
    await userEvent.click(screen.getByRole("button", { name: "Request review" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/artifacts/a1/publish",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText(/merge request opened/i)).toBeInTheDocument();
  });

  it("renders publish failures through the shared error-code copy", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { code: "needs_role" } }),
        { status: 403 },
      ));
    renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: "03-product/risk.md" }),
      canPublish: true,
    });
    await userEvent.click(screen.getByRole("button", { name: "Request review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You need editor access to do that. Ask an admin.",
    );
  });

  it("confirms the target and audience before publishing immediately", async () => {
    renderEditor({
      artifact: baseArtifact({
        status: "ready",
        targetPath: "03-product/risk.md",
        targetVisibility: ["exec"],
      }),
      canPublish: true,
      canPublishDirect: true,
    });

    await userEvent.click(screen.getByRole("button", { name: "Publish now" }));
    expect(fetchMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Publish now" });
    expect(dialog).toHaveTextContent("docs/03-product/risk.md");
    expect(dialog).toHaveTextContent("exec");
    expect(dialog).toHaveTextContent("immediately");
    expect(dialog).toHaveTextContent("no review");

    await userEvent.click(within(dialog).getByRole("button", { name: "Publish now" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/artifacts/a1/publish",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "direct" }),
      }),
    );
  });

  it("publishes exactly the displayed target and visibility (persisted before the publish call)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, mrUrl: "https://gl/mr/2" }) });
    renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: "notes/old.md", targetVisibility: ["all-hands"] }),
      canPublish: true,
    });
    // The owner changes the destination and picks groups in the visibility picker.
    const pathField = screen.getByRole("combobox", { name: "Target path (under docs/)" });
    await userEvent.clear(pathField);
    await userEvent.type(pathField, "notes/new.md");
    await userEvent.click(screen.getByRole("button", { name: "Remove all-hands" }));
    const add = screen.getByLabelText("Add group or person");
    await userEvent.selectOptions(add, "group:exec");
    await userEvent.selectOptions(add, "group:board");

    await userEvent.click(screen.getByRole("button", { name: "Request review" }));

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/artifacts/a1" && (init as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(patchBody.targetPath).toBe("notes/new.md");
    expect(patchBody.targetVisibility).toEqual(["exec", "board"]);

    const patchIdx = fetchMock.mock.calls.indexOf(patchCall!);
    const publishIdx = fetchMock.mock.calls.findIndex(([url]) => url === "/api/artifacts/a1/publish");
    expect(publishIdx).toBeGreaterThan(patchIdx);
  });

  it("adding a person to visibility expands to that person's groups", async () => {
    renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: "notes/x.md", targetVisibility: [] }),
      canPublish: true,
    });
    await userEvent.selectOptions(screen.getByLabelText("Add group or person"), "person:alice@example.com");
    // alice maps to exec, so the chip added is the group, not the email. Scoped
    // to the visibility list: the publishing-steps trail is a list too.
    const chips = screen.getByRole("list", { name: "Selected visibility" });
    expect(within(chips).getByRole("listitem")).toHaveTextContent("exec");
  });

  it("prefills the publish target inside an existing vault folder", () => {
    renderEditor({
      artifact: baseArtifact({ status: "ready", title: "Liquidity model summary", targetPath: null }),
      canPublish: true,
    });
    expect(screen.getByRole("combobox", { name: "Target path (under docs/)" })).toHaveValue(
      "03-product/liquidity-model-summary.md",
    );
  });

  it("offers existing top-level folders while keeping the target editable", () => {
    renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: null }),
      canPublish: true,
    });
    const target = screen.getByRole("combobox", { name: "Target path (under docs/)" });
    expect(target).toHaveAttribute("list", "artifact-target-folders");
    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#artifact-target-folders option"),
      (option) => option.getAttribute("value"),
    );
    expect(options).toEqual(["03-product/", "07-governance/"]);
    expect(target).not.toHaveAttribute("readonly");
  });

  it("keeps a saved target path over the suggestion", () => {
    renderEditor({
      artifact: baseArtifact({ status: "ready", title: "Liquidity model summary", targetPath: "notes/kept.md" }),
      canPublish: true,
    });
    expect(screen.getByRole("combobox", { name: "Target path (under docs/)" })).toHaveValue("notes/kept.md");
  });

  // Codex review: the PATCH route appends a version whenever a body is present,
  // so including `body` in the pre-publish save minted a duplicate version on
  // every publish and another on every retry after a failure.
  it("saves the title before publishing without resending the body", async () => {
    const user = userEvent.setup();
    renderEditor({
      artifact: { ...baseArtifact(), status: "ready", targetPath: "docs/notes/x.md" },
      canPublish: true,
    });

    await user.click(screen.getByRole("button", { name: /request review/i }));

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const sent = JSON.parse(String((patchCall![1] as RequestInit).body));
    expect(sent).toHaveProperty("title");
    expect(sent).toHaveProperty("targetPath");
    expect(sent).not.toHaveProperty("body");
  });
});
