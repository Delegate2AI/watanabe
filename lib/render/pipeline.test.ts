import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderDocumentExports } from "./pipeline";
import { readRender } from "./store";

/**
 * Turning one saved version into the three downloadable files
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The property under test is graceful degradation. The body is already stored
 * before this runs, so a sidecar that is down costs the document its PDF and its
 * self-contained HTML, and NEVER its markdown: the markdown is derived in
 * process and the KB publish path reads it.
 */

let root: string;
const OWNER = "alice@example.com";
const PDF_BASE64 = Buffer.from("%PDF-1.4 fake").toString("base64");

function sidecarUp(html = "<h1>rendered</h1>") {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ pdf: PDF_BASE64, html }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "renders-pipe-"));
  process.env.DOC_RENDERS_DIR = root;
  process.env.HTML_DOCUMENTS_ENABLED = "1";
  process.env.DOC_RENDER_URL = "http://doc-render:8791";
});

afterEach(() => {
  delete process.env.DOC_RENDERS_DIR;
  delete process.env.HTML_DOCUMENTS_ENABLED;
  delete process.env.DOC_RENDER_URL;
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

function ref(kind: "pdf" | "html" | "md") {
  return { ownerEmail: OWNER, docId: "d1", version: 1, kind } as const;
}

describe("renderDocumentExports", () => {
  it("stores all three formats for a designed document", async () => {
    vi.stubGlobal("fetch", sidecarUp());

    const result = await renderDocumentExports({
      ownerEmail: OWNER,
      docId: "d1",
      version: 1,
      title: "Designed",
      body: "<h1>Designed</h1><p>text</p>",
      format: "html",
    });

    expect(result).toEqual({ md: true, html: true, pdf: true });
    expect(readRender(ref("md"))?.toString()).toContain("# Designed");
    expect(readRender(ref("html"))?.toString()).toBe("<h1>rendered</h1>");
    expect(readRender(ref("pdf"))?.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("stores all three formats for a markdown document too, which is the whole ask", async () => {
    vi.stubGlobal("fetch", sidecarUp("<h1>printed</h1>"));

    const result = await renderDocumentExports({
      ownerEmail: OWNER,
      docId: "d1",
      version: 1,
      title: "Plain",
      body: "# Plain\n\ntext",
      format: "md",
    });

    expect(result).toEqual({ md: true, html: true, pdf: true });
    expect(readRender(ref("md"))?.toString()).toBe("# Plain\n\ntext");
    expect(readRender(ref("pdf"))).not.toBeNull();
  });

  it("sends the designed body's own markup and styling, not a re-rendered copy", async () => {
    const fetchMock = sidecarUp();
    vi.stubGlobal("fetch", fetchMock);
    const body = "<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>Designed</h1></body></html>";

    await renderDocumentExports({ ownerEmail: OWNER, docId: "d1", version: 1, title: "D", body, format: "html" });

    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).html;
    expect(sent).toContain("<h1>Designed</h1>");
    expect(sent).toContain("color:red");
  });

  it("strips script and remote references before rendering, because the result is downloaded", async () => {
    const fetchMock = sidecarUp();
    vi.stubGlobal("fetch", fetchMock);
    // Once a person opens the downloaded file, neither the viewer's sandbox nor
    // its policy is anywhere near it. Sanitizing after the render would be too
    // late: the returned bytes are the file.
    const body = '<h1>D</h1><script>alert(1)</script><img src="https://attacker.example/x.png">';

    await renderDocumentExports({ ownerEmail: OWNER, docId: "d1", version: 1, title: "D", body, format: "html" });

    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).html;
    expect(sent).not.toContain("alert(1)");
    expect(sent).not.toContain("attacker.example");
    expect(sent).toContain("<h1>D</h1>");
  });

  it("degrades to no pdf rather than throwing when building the page fails", async () => {
    // The one call that can still throw is the sanitizer/wrapper on a designed
    // body. Whatever it is, the body already saved, so this must cost the PDF
    // and nothing else.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("boom");
    }));

    const result = await renderDocumentExports({
      ownerEmail: OWNER,
      docId: "d1",
      version: 1,
      title: "Deep",
      body: "# deep",
      format: "md",
    });

    expect(result.md).toBe(true);
    expect(result.pdf).toBe(false);
  });

  it("sends a markdown body as markdown, with the stylesheet to print it with", async () => {
    const fetchMock = sidecarUp();
    vi.stubGlobal("fetch", fetchMock);

    await renderDocumentExports({
      ownerEmail: OWNER,
      docId: "d1",
      version: 1,
      title: "Plain",
      body: "# Plain",
      format: "md",
    });

    // Converted in the sidecar, because Next.js refuses `react-dom/server` in
    // the App Router bundle. The stylesheet still travels from here, so the app
    // keeps owning how an exported document looks.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { markdown?: string; css?: string; html?: string };
    expect(sent.markdown).toBe("# Plain");
    expect(sent.css).toContain("@page");
    expect(sent.html).toBeUndefined();
  });

  it("still writes the markdown when the sidecar is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const result = await renderDocumentExports({
      ownerEmail: OWNER,
      docId: "d1",
      version: 1,
      title: "Designed",
      body: "<h1>Designed</h1>",
      format: "html",
    });

    expect(result).toEqual({ md: true, html: false, pdf: false });
    expect(readRender(ref("md"))?.toString()).toContain("# Designed");
    expect(readRender(ref("pdf"))).toBeNull();
  });

  it("still writes the markdown when no sidecar is configured at all", async () => {
    delete process.env.DOC_RENDER_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderDocumentExports({
      ownerEmail: OWNER,
      docId: "d1",
      version: 1,
      title: "Plain",
      body: "# Plain",
      format: "md",
    });

    expect(result.md).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, whatever the sidecar does", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    await expect(
      renderDocumentExports({
        ownerEmail: OWNER,
        docId: "d1",
        version: 1,
        title: "D",
        body: "<h1>D</h1>",
        format: "html",
      }),
    ).resolves.toBeTruthy();
  });
});
