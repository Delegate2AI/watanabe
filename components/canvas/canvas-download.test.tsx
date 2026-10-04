// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasPane } from "./canvas-pane";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * Three formats on every document
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The old control was a single button that built a `Blob` from the body and
 * saved it as `.md`. That is the ".md only" this whole change exists to fix, so
 * it is replaced by links to the export route: the PDF and the self-contained
 * HTML are produced server-side and cannot be assembled in the browser.
 */

const docData = {
  doc: { id: "d1", title: "Risk memo", currentVersion: 1, updatedAt: "2026-08-20T00:00:00Z" },
  versions: [{ version: 1, body: "# Risk memo", format: "md", createdAt: "2026-08-20T00:00:00Z" }],
  promotions: [],
  flags: { artifactsEnabled: true, sharedDocsEnabled: false },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(docData), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function openMenu() {
  const user = userEvent.setup();
  render(<CanvasPane docId="d1" onClose={() => {}} />);
  await screen.findByRole("button", { name: "Download" });
  await user.click(screen.getByRole("button", { name: "Download" }));
  return user;
}

describe("CanvasPane download", () => {
  it("offers all three formats", async () => {
    await openMenu();

    expect(screen.getByRole("link", { name: /PDF/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Web page/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Markdown/i })).toBeInTheDocument();
  });

  it("points each one at the export route for this document", async () => {
    await openMenu();

    expect(screen.getByRole("link", { name: /PDF/i })).toHaveAttribute(
      "href",
      "/api/chat-docs/d1/export/pdf?v=1",
    );
    expect(screen.getByRole("link", { name: /Web page/i })).toHaveAttribute(
      "href",
      "/api/chat-docs/d1/export/html?v=1",
    );
    expect(screen.getByRole("link", { name: /Markdown/i })).toHaveAttribute(
      "href",
      "/api/chat-docs/d1/export/md?v=1",
    );
  });

  it("keeps the menu closed until it is asked for", async () => {
    render(<CanvasPane docId="d1" onClose={() => {}} />);
    await screen.findByRole("button", { name: "Download" });
    expect(screen.queryByRole("link", { name: /PDF/i })).toBeNull();
  });

  it("closes the menu after a format is chosen", async () => {
    const user = await openMenu();
    await user.click(screen.getByRole("link", { name: /Markdown/i }));
    expect(screen.queryByRole("link", { name: /PDF/i })).toBeNull();
  });

  it("escapes a document id, so an id is never spliced into the url raw", async () => {
    const user = userEvent.setup();
    render(<CanvasPane docId="a b/c" onClose={() => {}} />);
    await screen.findByRole("button", { name: "Download" });
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(screen.getByRole("link", { name: /Markdown/i })).toHaveAttribute(
      "href",
      "/api/chat-docs/a%20b%2Fc/export/md?v=1",
    );
  });
});
