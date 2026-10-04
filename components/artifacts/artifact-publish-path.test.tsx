// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

describe("ArtifactEditor publish path", () => {
  it("names the whole route to the knowledge base, marking where the artifact is", () => {
    renderEditor({ artifact: baseArtifact({ status: "draft" }), canPublish: true });
    const steps = screen.getByRole("list", { name: "Publishing steps" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Draft", "Ready", "In review", "Published",
    ]);
    expect(within(steps).getByText("Draft").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("says what Mark ready leads to, so the draft is not a dead end", () => {
    renderEditor({ artifact: baseArtifact({ status: "draft" }), canPublish: true });
    expect(screen.getByText(/mark ready/i, { selector: "p" })).toHaveTextContent(
      /request review/i,
    );
  });

  it("tells an editor without approval who finishes the publish", () => {
    renderEditor({
      artifact: baseArtifact({ status: "ready", targetPath: "notes/x.md" }),
      canPublish: true,
    });
    expect(screen.getByText(/opens a merge request/i)).toHaveTextContent(/approver/i);
  });

  it("shows the way to the open review when an in-review artifact is reopened", () => {
    // The merge request link used to ride along with the post-action notice, so
    // reloading the page left "waiting on review" with no route to the review.
    renderEditor({
      artifact: baseArtifact({
        status: "in_review",
        targetPath: "notes/x.md",
        mrUrl: "https://gl/mr/9",
      }),
      canPublish: true,
    });
    expect(screen.getByRole("link", { name: /open merge request/i })).toHaveAttribute(
      "href",
      "https://gl/mr/9",
    );
  });

  it("links a published artifact to the note it became", () => {
    renderEditor({
      artifact: baseArtifact({
        status: "published",
        targetPath: "03-product/risk.md",
        publishedNotePath: "03-product/risk.md",
      }),
      canPublish: true,
    });
    expect(screen.getByRole("link", { name: /open in the knowledge base/i })).toHaveAttribute(
      "href",
      "/kb/03-product/risk",
    );
  });
});
