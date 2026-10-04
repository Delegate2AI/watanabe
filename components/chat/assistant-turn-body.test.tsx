// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantTurnBody } from "./assistant-turn-body";
import type { AssistantTurn } from "@/lib/agent/conversation";

function assistantTurn(text: string, status: AssistantTurn["status"] = "done"): AssistantTurn {
  return {
    id: "t1",
    role: "assistant",
    status,
    segments: [{ kind: "text", text }],
  };
}

describe("AssistantTurnBody", () => {
  it("renders the assistant answer as markdown, not raw source", () => {
    render(
      <AssistantTurnBody
        turn={assistantTurn("# Meridian\n\n**What it is.** A two-sided marketplace.")}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Meridian" });
    expect(heading.tagName).toBe("H1");
    // The bold lead renders as <strong>, and the "**" markers are gone.
    const strong = screen.getByText("What it is.");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.queryByText(/^# Meridian/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*What it is\.\*\*/)).not.toBeInTheDocument();
  });

  it("still shows the Working… placeholder while streaming with no text yet", () => {
    render(<AssistantTurnBody turn={{ ...assistantTurn("", "streaming"), segments: [] }} />);
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
  });
});
