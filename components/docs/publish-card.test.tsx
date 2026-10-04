// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PublishCard } from "./publish-card";
import type { KbTargetOptions } from "@/lib/kb/target-options";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";

const fetchMock = vi.fn();

const OPTS: VisibilityOptions = { groups: ["all-hands", "exec"], people: [] };

const TARGETS: KbTargetOptions = {
  dirs: ["00-overview", "handbook", "handbook/hr"],
  notes: [
    { path: "handbook/tools.md", title: "Tools" },
    { path: "handbook/hr/onboarding.md", title: "Onboarding" },
  ],
};

function renderCard(props: Partial<React.ComponentProps<typeof PublishCard>> = {}) {
  return render(
    <PublishCard
      docId="d1"
      docTitle="Pricing Model 2026"
      publication={null}
      targets={TARGETS}
      visibilityOptions={OPTS}
      canPublishDirect={false}
      {...props}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ mode: "mr", notePath: "x" }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("PublishCard destination picker", () => {
  it("suggests the note name from the document title", () => {
    renderCard();
    expect(screen.getByRole("textbox", { name: "Note name" })).toHaveValue("pricing-model-2026");
    expect(screen.getByText("docs/pricing-model-2026.md")).toBeTruthy();
    expect(screen.getByText(/creates a new note/i)).toBeTruthy();
  });

  it("offers the existing folders on focus and composes the chosen one into the target", () => {
    renderCard();
    const folderInput = screen.getByRole("combobox", { name: "Folder" });
    fireEvent.focus(folderInput);
    fireEvent.change(folderInput, { target: { value: "hand" } });
    fireEvent.click(screen.getByRole("option", { name: "handbook/hr/" }));
    expect(screen.getByText("docs/handbook/hr/pricing-model-2026.md")).toBeTruthy();
  });

  it("offers an unknown folder as an explicit New folder row", () => {
    renderCard();
    const folderInput = screen.getByRole("combobox", { name: "Folder" });
    fireEvent.focus(folderInput);
    fireEvent.change(folderInput, { target: { value: "brand-new/team" } });
    expect(screen.getByRole("option", { name: 'New folder "brand-new/team/"' })).toBeTruthy();
    expect(screen.getByText(/in the new folder/i)).toBeTruthy();
  });

  it("posts the composed target path", () => {
    renderCard();
    const folderInput = screen.getByRole("combobox", { name: "Folder" });
    fireEvent.focus(folderInput);
    fireEvent.change(folderInput, { target: { value: "handbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.targetPath).toBe("handbook/pricing-model-2026.md");
  });

  it("locks visibility and says so when the target note already exists", () => {
    renderCard();
    const folderInput = screen.getByRole("combobox", { name: "Folder" });
    fireEvent.change(folderInput, { target: { value: "handbook" } });
    // The sibling chip adopts the existing note's name, which is the collision.
    fireEvent.click(screen.getByRole("button", { name: "tools" }));
    expect(screen.getByText(/proposes an update to the existing note "tools"/i)).toBeTruthy();
    expect(screen.getByText(/keeps the note's own visibility/i)).toBeTruthy();
    expect(screen.queryByLabelText("Add group or person")).toBeNull();
  });

  it("reopens onto a prior publication's destination", () => {
    renderCard({
      publication: {
        status: "in_review",
        targetPath: "handbook/hr/onboarding.md",
        targetVisibility: ["all-hands"],
        publishedNotePath: null,
        mrUrl: "https://gl/mr/1",
      },
    });
    expect(screen.getByRole("combobox", { name: "Folder" })).toHaveValue("handbook/hr");
    expect(screen.getByRole("textbox", { name: "Note name" })).toHaveValue("onboarding");
    expect(screen.getByText(/proposes an update to the existing note "onboarding"/i)).toBeTruthy();
  });

  it("keeps the publish buttons disabled while the name is empty", () => {
    renderCard();
    fireEvent.change(screen.getByRole("textbox", { name: "Note name" }), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Request review" })).toBeDisabled();
  });
});
