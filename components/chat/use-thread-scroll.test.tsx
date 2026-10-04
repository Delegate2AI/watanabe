// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { Turn } from "@/lib/agent/conversation";
import { useThreadScroll, THREAD_NEAR_BOTTOM_PX } from "./use-thread-scroll";

function userTurn(id: string): Turn {
  return { id, role: "user", content: `message ${id}` };
}

/**
 * The hook drives real DOM refs, so the tests mount a minimal harness that
 * wires them the way thread.tsx does: scrollRef + onScroll on the container,
 * bottomRef on a sentinel after the turns.
 */
function Harness({ turns }: { turns: Turn[] }) {
  const { scrollRef, bottomRef, handleScroll, showJumpToBottom, scrollToBottom, pinToBottom } =
    useThreadScroll(turns);
  return (
    <div ref={scrollRef} onScroll={handleScroll} data-testid="scroll">
      <div ref={bottomRef} data-testid="bottom" />
      {showJumpToBottom && (
        <button type="button" data-testid="jump" onClick={() => scrollToBottom()} />
      )}
      {/* Stand-in for the send path, which re-arms following via pinToBottom. */}
      <button type="button" data-testid="pin" onClick={pinToBottom} />
    </div>
  );
}

/** jsdom has no scrollIntoView; the spy doubles as the assertion point. */
const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  scrollIntoView.mockReset();
});

/** Make the container report a given distance from its bottom edge. */
function setScrollMetrics(el: HTMLElement, distanceFromBottom: number) {
  Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
  el.scrollTop = 1000 - 400 - distanceFromBottom;
}

describe("useThreadScroll", () => {
  it("pins the view to the bottom sentinel when turns change, instantly (not smooth)", () => {
    const { rerender } = render(<Harness turns={[userTurn("1")]} />);
    scrollIntoView.mockClear();

    rerender(<Harness turns={[userTurn("1"), userTurn("2")]} />);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "auto" });
  });

  it("stops following once the user scrolls away from the bottom, and offers Jump to latest", () => {
    const { getByTestId, queryByTestId, rerender } = render(<Harness turns={[userTurn("1")]} />);
    const container = getByTestId("scroll");

    setScrollMetrics(container, THREAD_NEAR_BOTTOM_PX + 1);
    fireEvent.scroll(container);
    scrollIntoView.mockClear();

    rerender(<Harness turns={[userTurn("1"), userTurn("2")]} />);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(queryByTestId("jump")).not.toBeNull();
  });

  it("keeps following while the viewport stays within the near-bottom threshold", () => {
    const { getByTestId, queryByTestId, rerender } = render(<Harness turns={[userTurn("1")]} />);
    const container = getByTestId("scroll");

    setScrollMetrics(container, THREAD_NEAR_BOTTOM_PX - 1);
    fireEvent.scroll(container);
    scrollIntoView.mockClear();

    rerender(<Harness turns={[userTurn("1"), userTurn("2")]} />);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "auto" });
    expect(queryByTestId("jump")).toBeNull();
  });

  it("Jump to latest scrolls smoothly, hides itself, and re-arms following", () => {
    const { getByTestId, queryByTestId, rerender } = render(<Harness turns={[userTurn("1")]} />);
    const container = getByTestId("scroll");

    setScrollMetrics(container, THREAD_NEAR_BOTTOM_PX + 1);
    fireEvent.scroll(container);
    scrollIntoView.mockClear();

    fireEvent.click(getByTestId("jump"));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "smooth" });
    expect(queryByTestId("jump")).toBeNull();

    scrollIntoView.mockClear();
    rerender(<Harness turns={[userTurn("1"), userTurn("2")]} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "auto" });
  });

  it("pinToBottom re-arms following after the user had scrolled away (send path)", () => {
    const { getByTestId, rerender } = render(<Harness turns={[userTurn("1")]} />);
    const container = getByTestId("scroll");

    setScrollMetrics(container, THREAD_NEAR_BOTTOM_PX + 1);
    fireEvent.scroll(container);
    scrollIntoView.mockClear();

    fireEvent.click(getByTestId("pin"));

    rerender(<Harness turns={[userTurn("1"), userTurn("2")]} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "auto" });
  });
});
