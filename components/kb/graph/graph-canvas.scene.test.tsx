// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphCanvas } from "./graph-canvas";

/**
 * Split out from `graph-canvas.test.tsx`: that file stubs `getContext` to
 * `null` for every test, so `mountGraph` is never actually called there and
 * requirement 1 (a live scene handle that pushes rather than rebuilds) goes
 * completely unguarded. Here `getContext` returns a truthy stub and
 * `./graph-mount` is mocked, so these tests exercise the wiring itself: a
 * rebuild only on a new `graph`, and every other control pushing into the
 * existing scene.
 */

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

/** Mutated per test to drive a theme change without fighting jsdom's inert `matchMedia` stub. */
let mockResolvedTheme: string | undefined;
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mockResolvedTheme }),
}));

const setDarkMock = vi.fn();
const setForcesMock = vi.fn();
const setViewMock = vi.fn();
const destroyMock = vi.fn();
const mountGraphMock = vi.fn((options: unknown) => {
  void options;
  return { setDark: setDarkMock, setForces: setForcesMock, setView: setViewMock, destroy: destroyMock };
});
vi.mock("./graph-mount", () => ({
  mountGraph: (options: unknown) => mountGraphMock(options),
}));

const GRAPH = {
  nodes: [
    { id: "a/one", t: "One", g: "a", d: 1 },
    { id: "a/two", t: "Two", g: "a", d: 1 },
  ],
  edges: [[0, 1]] as [number, number][],
  total: 2,
};

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({}) as unknown as CanvasRenderingContext2D,
  ) as never;
  mockResolvedTheme = undefined;
  mountGraphMock.mockClear();
  pushMock.mockClear();
  setDarkMock.mockClear();
  setForcesMock.mockClear();
  setViewMock.mockClear();
  destroyMock.mockClear();
});

describe("live scene wiring", () => {
  it("pushes a theme change into the live scene without rebuilding it", () => {
    const { rerender } = render(
      <GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />,
    );
    expect(mountGraphMock).toHaveBeenCalledOnce();
    // Nothing pushed yet: the mounted-scene guard must skip the initial round.
    expect(setDarkMock).not.toHaveBeenCalled();

    mockResolvedTheme = "dark";
    rerender(<GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />);

    expect(setDarkMock).toHaveBeenCalledWith(true);
    expect(mountGraphMock).toHaveBeenCalledOnce();
  });

  it("pushes a filter keystroke into the live scene without rebuilding it", () => {
    render(<GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />);
    expect(mountGraphMock).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "emission" } });

    expect(setViewMock).toHaveBeenCalledWith(expect.objectContaining({ query: "emission" }));
    expect(mountGraphMock).toHaveBeenCalledOnce();
  });

  it("pushes a legend click into the live scene without rebuilding it", () => {
    render(<GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />);
    expect(mountGraphMock).toHaveBeenCalledOnce();
    expect(setViewMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^a$/i }));

    expect(setViewMock).toHaveBeenCalled();
    expect(mountGraphMock).toHaveBeenCalledOnce();
  });

  it("opens a node through the same percent-encoding the List tab uses", () => {
    render(<GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />);

    const options = mountGraphMock.mock.calls[0][0] as { onOpen: (id: string) => void };
    // Spaces and `#` are legal in a vault filename, and a raw `#` would strand
    // the reader on the parent path with the rest read as a fragment.
    options.onOpen("trader score/q3 plan #1");

    expect(pushMock).toHaveBeenCalledWith("/kb/trader%20score/q3%20plan%20%231");
  });

  it("rebuilds the scene exactly once on a new graph identity, and destroys the old one exactly once", () => {
    const { rerender } = render(
      <GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />,
    );
    expect(mountGraphMock).toHaveBeenCalledOnce();
    expect(destroyMock).not.toHaveBeenCalled();

    const otherGraph = { ...GRAPH, total: 3 };
    rerender(<GraphCanvas graph={otherGraph} loading={false} error={false} onRetry={() => {}} />);

    expect(mountGraphMock).toHaveBeenCalledTimes(2);
    expect(destroyMock).toHaveBeenCalledOnce();
  });
});
