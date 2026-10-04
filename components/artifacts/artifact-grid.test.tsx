// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ArtifactGrid } from "./artifact-grid";

describe("ArtifactGrid", () => {
  it("shows an empty-state prompt when the owner has no artifacts", () => {
    render(<ArtifactGrid artifacts={[]} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it("renders a card per artifact with its status pill and a link to the editor", () => {
    render(
      <ArtifactGrid
        artifacts={[
          {
            id: "a1",
            title: "Risk draft",
            status: "ready",
            sourceThreadId: "t1",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /risk draft/i });
    expect(link).toHaveAttribute("href", "/artifacts/a1");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /from chat/i })).toHaveAttribute("href", "/chat/t1");
  });

  it("keeps the status and chat provenance inside the card", () => {
    render(
      <ArtifactGrid
        artifacts={[
          {
            id: "a1",
            title: "Risk draft",
            status: "ready",
            sourceThreadId: "t1",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ]}
      />,
    );
    const card = screen.getByRole("article", { name: "Risk draft" });
    expect(within(card).getByText("Ready")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "From chat" })).toHaveAttribute("href", "/chat/t1");
  });
});
