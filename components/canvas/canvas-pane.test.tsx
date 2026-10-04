// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasPane } from "./canvas-pane";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const docData = {
  doc: { id: "d1", title: "Risk memo", currentVersion: 2, updatedAt: "2026-07-11T00:00:00Z" },
  versions: [
    { version: 1, body: "# One", createdAt: "2026-07-11T00:00:00Z" },
    { version: 2, body: "# Two\n\nlatest body", createdAt: "2026-07-11T01:00:00Z" },
  ],
  promotions: [],
  flags: { artifactsEnabled: true, sharedDocsEnabled: false },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(docData), { status: 200, headers: { "content-type": "application/json" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("CanvasPane", () => {
  it("renders the title and the latest version body by default", async () => {
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    expect(await screen.findByText("Risk memo")).toBeInTheDocument();
    expect(await screen.findByText("latest body")).toBeInTheDocument();
  });

  it("toggles between Rendered and Markdown", async () => {
    const user = userEvent.setup();
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    await screen.findByText("latest body");
    await user.click(screen.getByRole("button", { name: "Markdown" }));
    // Raw markdown shows the heading syntax verbatim.
    expect(screen.getByText(/# Two/)).toBeInTheDocument();
  });

  it("offers only the enabled Promote target and calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CanvasPane docId="d1" onClose={onClose} />);
    await screen.findByText("Risk memo");
    expect(screen.getByRole("button", { name: /Promote to Artifact/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Promote to Shared File/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("puts the promote controls above the document, not under all of it", async () => {
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    const promote = await screen.findByRole("button", { name: /Promote to Artifact/ });
    const body = await screen.findByText("latest body");
    // Buried at the foot of the pane the actions were off screen for any
    // document longer than the viewport, so they must precede the body.
    expect(promote.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens at about half the window, not as a narrow rail", async () => {
    window.innerWidth = 1600;
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    const pane = await screen.findByLabelText("Document canvas");
    await waitFor(() => expect(pane.style.width).toBe("800px"));
  });

  it("lets the drag reach most of a wide window", async () => {
    // A fixed 760px ceiling made the pane a rail on a large display.
    window.innerWidth = 2400;
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    const pane = await screen.findByLabelText("Document canvas");
    await waitFor(() => expect(pane.style.width).toBe("1200px"));
    const separator = screen.getByRole("separator");
    await userEvent.pointer([{ target: separator, keys: "[MouseLeft>]" }]);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100 }));
    await waitFor(() => expect(pane.style.width).toBe("1680px"));
  });

  it("stays a full-screen overlay on a phone, with no inline width", async () => {
    window.innerWidth = 500;
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    const pane = await screen.findByLabelText("Document canvas");
    await screen.findByText("latest body");
    expect(pane.style.width).toBe("");
  });

  it("shows a version selector when more than one version exists", async () => {
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    await screen.findByText("Risk memo");
    await waitFor(() => expect(screen.getByLabelText("Version")).toBeInTheDocument());
    expect((screen.getByLabelText("Version") as HTMLSelectElement).value).toBe("2");
  });
});
