// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadTurn } from "./thread-turn";

describe("ThreadTurn", () => {
  it("renders a user turn with its content and role marker", () => {
    render(
      <ThreadTurn role="user" avatar="N">
        <p>What changed?</p>
      </ThreadTurn>,
    );
    expect(screen.getByText("What changed?")).toBeInTheDocument();
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(
      screen.getByText("What changed?").closest("[data-role]"),
    ).toHaveAttribute("data-role", "user");
  });

  it("renders an assistant turn", () => {
    render(
      <ThreadTurn role="assistant">
        <p>Two changes were decided.</p>
      </ThreadTurn>,
    );
    expect(
      screen.getByText("Two changes were decided.").closest("[data-role]"),
    ).toHaveAttribute("data-role", "assistant");
  });

  it("shows no Save-as-artifact affordance by default (flag off = callback absent)", () => {
    render(
      <ThreadTurn role="assistant">
        <p>Some draft.</p>
      </ThreadTurn>,
    );
    expect(screen.queryByRole("button", { name: /save as artifact/i })).not.toBeInTheDocument();
  });

  it("offers Save as artifact on an assistant turn when the callback is provided", async () => {
    const onSave = vi.fn();
    render(
      <ThreadTurn role="assistant" onSaveAsArtifact={onSave}>
        <p>A substantial draft.</p>
      </ThreadTurn>,
    );
    const button = screen.getByRole("button", { name: /save as artifact/i });
    await userEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("never offers Save as artifact on a user turn, even with the callback", () => {
    render(
      <ThreadTurn role="user" onSaveAsArtifact={vi.fn()}>
        <p>My question.</p>
      </ThreadTurn>,
    );
    expect(screen.queryByRole("button", { name: /save as artifact/i })).not.toBeInTheDocument();
  });

  it("shows a disabled Saving… state while the save is in flight", () => {
    render(
      <ThreadTurn role="assistant" onSaveAsArtifact={vi.fn()} saveState="saving">
        <p>Draft.</p>
      </ThreadTurn>,
    );
    const button = screen.getByRole("button", { name: /saving/i });
    expect(button).toBeDisabled();
  });

  it("confirms the save and links to the created artifact when saved", () => {
    render(
      <ThreadTurn
        role="assistant"
        onSaveAsArtifact={vi.fn()}
        saveState="saved"
        savedHref="/artifacts/abc"
      >
        <p>Draft.</p>
      </ThreadTurn>,
    );
    expect(screen.getByText(/saved as artifact/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view/i })).toHaveAttribute("href", "/artifacts/abc");
    // Once saved, the plain "Save as artifact" button is gone.
    expect(screen.queryByRole("button", { name: /^save as artifact$/i })).not.toBeInTheDocument();
  });

  it("offers a retry when the save failed", async () => {
    const onSave = vi.fn();
    render(
      <ThreadTurn role="assistant" onSaveAsArtifact={onSave} saveState="error">
        <p>Draft.</p>
      </ThreadTurn>,
    );
    const button = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
