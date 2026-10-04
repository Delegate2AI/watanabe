import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderDesignedDocument } from "./client";

/**
 * The render sidecar client
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * NEVER THROWS. The only caller is a document save, and a document must not fail
 * to save because a Chromium pod was restarting. Every failure comes back as
 * `null`, which the pipeline reads as "no PDF this time", and the body is
 * already stored before this is ever called.
 */

const HTML = "<h1>Designed</h1>";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake").toString("base64");

beforeEach(() => {
  process.env.HTML_DOCUMENTS_ENABLED = "1";
  process.env.DOC_RENDER_URL = "http://doc-render:8791";
});

afterEach(() => {
  delete process.env.HTML_DOCUMENTS_ENABLED;
  delete process.env.DOC_RENDER_URL;
  vi.unstubAllGlobals();
});

describe("renderDesignedDocument", () => {
  it("returns the pdf bytes and the self-contained html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ pdf: PDF_BASE64, html: "<h1>Designed</h1><style>@font-face{}</style>" })),
    );

    const result = await renderDesignedDocument({ html: HTML, title: "Designed" });

    expect(result).not.toBeNull();
    expect(result?.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result?.html).toContain("@font-face");
  });

  it("posts the body and the title to the sidecar's render endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ pdf: PDF_BASE64, html: HTML }));
    vi.stubGlobal("fetch", fetchMock);

    await renderDesignedDocument({ html: HTML, title: "Designed" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://doc-render:8791/render");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ html: HTML, title: "Designed" });
  });

  it("returns null when no sidecar is configured, without attempting a request", async () => {
    delete process.env.DOC_RENDER_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the feature flag is off", async () => {
    process.env.HTML_DOCUMENTS_ENABLED = "0";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the sidecar answers with an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
  });

  it("returns null rather than throwing when the sidecar is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
  });

  it("returns null rather than throwing when the sidecar answers with something that is not json", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })));
    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
  });

  it("returns null when the payload is missing a field, rather than half a result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ html: HTML })));
    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
  });

  it("returns null for an empty body instead of asking the sidecar to render nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await renderDesignedDocument({ html: "   ", title: "Designed" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after the configured timeout rather than holding the save open", async () => {
    process.env.DOC_RENDER_TIMEOUT_MS = "10";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        await new Promise((resolve, reject) => {
          const signal = init.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(resolve, 5_000);
        });
        return jsonResponse({ pdf: PDF_BASE64, html: HTML });
      }),
    );

    expect(await renderDesignedDocument({ html: HTML, title: "Designed" })).toBeNull();
    delete process.env.DOC_RENDER_TIMEOUT_MS;
  });
});
