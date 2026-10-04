// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasPane } from "./canvas-pane";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * The canvas renders a document as what it IS
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Sending an HTML body through `<Markdown>` is not a cosmetic mismatch: the
 * shared pipeline sets `proseSkipHtml`, which DROPS raw HTML rather than
 * printing it, so the author of a designed page saw a blank pane and no reason
 * why. Per version, not per document, so an older markdown version of a document
 * that has since been rewritten still renders as markdown.
 */

const HTML_BODY = "<!doctype html><html><body><h1>Designed page</h1></body></html>";

function docData(versions: Array<{ version: number; body: string; format: string }>) {
  return {
    doc: { id: "d1", title: "Risk memo", currentVersion: versions.length, updatedAt: "2026-08-20T00:00:00Z" },
    versions: versions.map((v) => ({ ...v, createdAt: "2026-08-20T00:00:00Z" })),
    promotions: [],
    flags: { artifactsEnabled: true, sharedDocsEnabled: false },
  };
}

function stubFetch(data: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("CanvasPane with a designed document", () => {
  it("renders an html version in a frame, not through the markdown renderer", async () => {
    stubFetch(docData([{ version: 1, body: HTML_BODY, format: "html" }]));
    render(<CanvasPane docId="d1" onClose={() => {}} />);

    const frame = (await screen.findByTitle("Risk memo")) as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("srcdoc")).toContain("Designed page");
    // Dropped by `proseSkipHtml` if this had gone through `<Markdown>`.
    expect(screen.queryByRole("heading", { name: "Designed page" })).toBeNull();
  });

  it("still renders a markdown version through the markdown renderer", async () => {
    stubFetch(docData([{ version: 1, body: "# Two\n\nlatest body", format: "md" }]));
    render(<CanvasPane docId="d1" onClose={() => {}} />);

    expect(await screen.findByText("latest body")).toBeInTheDocument();
    expect(screen.queryByTitle("Risk memo")).toBeNull();
  });

  it("shows the source of an html version when the reader asks for source", async () => {
    stubFetch(docData([{ version: 1, body: HTML_BODY, format: "html" }]));
    const user = userEvent.setup();
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    await screen.findByTitle("Risk memo");

    await user.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByText(/<h1>Designed page<\/h1>/)).toBeInTheDocument();
  });

  it("follows the selected version, so an older markdown version renders as markdown", async () => {
    stubFetch(
      docData([
        { version: 1, body: "# plain\n\nold body", format: "md" },
        { version: 2, body: HTML_BODY, format: "html" },
      ]),
    );
    const user = userEvent.setup();
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    await screen.findByTitle("Risk memo");

    await user.selectOptions(screen.getByLabelText("Version"), "1");
    await waitFor(() => expect(screen.getByText("old body")).toBeInTheDocument());
    expect(screen.queryByTitle("Risk memo")).toBeNull();
  });
});
