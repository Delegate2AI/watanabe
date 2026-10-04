// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TurnActivity, activityLabel } from "./turn-activity";
import type { AssistantTurn, Segment } from "@/lib/agent/conversation";

function turn(segments: Segment[]): AssistantTurn {
  return { id: "t1", role: "assistant", status: "streaming", segments };
}

const tool = (name: string, status: "running" | "ok" | "error" = "running"): Segment => ({
  kind: "tool",
  id: `${name}-1`,
  name,
  input: {},
  status,
});

describe("activityLabel", () => {
  it("says something neutral before any tool has run", () => {
    expect(activityLabel(turn([]))).toBe("Working");
  });

  it("names what a running knowledge-base search is doing", () => {
    expect(activityLabel(turn([tool("mcp__kb__kb_search")]))).toBe("Searching the knowledge base");
  });

  it("strips the MCP server prefix before looking a tool up", () => {
    expect(activityLabel(turn([tool("mcp__docs__doc_write")]))).toBe("Writing a document");
  });

  it("reports the most recent running tool, not the first", () => {
    expect(
      activityLabel(turn([tool("mcp__kb__kb_search", "ok"), tool("mcp__kb__kb_read")])),
    ).toBe("Reading the knowledge base");
  });

  it("says the model is thinking once its tools have all finished", () => {
    expect(activityLabel(turn([tool("mcp__kb__kb_search", "ok")]))).toBe("Thinking");
  });

  it("falls back to a neutral label for a tool it has no copy for", () => {
    expect(activityLabel(turn([tool("some_unmapped_tool")]))).toBe("Working");
  });

  it("never renders a raw tool name, which would leak an internal identifier", () => {
    expect(activityLabel(turn([tool("mcp__kb__kb_submit_internal_v2")]))).not.toContain("mcp__");
  });
});

describe("TurnActivity", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the current activity instead of a static placeholder", () => {
    render(<TurnActivity turn={turn([tool("mcp__kb__kb_search")])} />);
    expect(screen.getByText("Searching the knowledge base")).toBeInTheDocument();
  });

  it("keeps the Working label so assistive technology hears that a turn is in flight", () => {
    render(<TurnActivity turn={turn([])} />);
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
  });

  it("shows no elapsed time for the first ten seconds", () => {
    vi.useFakeTimers();
    render(<TurnActivity turn={turn([])} />);
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument();
  });

  it("starts reporting elapsed time once a turn passes ten seconds", () => {
    vi.useFakeTimers();
    render(<TurnActivity turn={turn([])} />);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByText("12s")).toBeInTheDocument();
  });

  it("switches to minutes and seconds on a long turn, the case that has no feedback today", () => {
    vi.useFakeTimers();
    render(<TurnActivity turn={turn([])} />);
    act(() => {
      vi.advanceTimersByTime(215_000);
    });
    expect(screen.getByText("3m 35s")).toBeInTheDocument();
  });

  it("stops its timer on unmount so a finished turn leaves nothing ticking", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<TurnActivity turn={turn([])} />);
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
