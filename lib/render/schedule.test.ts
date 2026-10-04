import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scheduleRender, flushScheduledRenders } from "./schedule";

/**
 * Rendering on save without rendering on every keystroke-equivalent
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The assistant revises a document by calling `doc_write` again, sometimes
 * several times in a row while it is still working. One Chromium run per
 * revision is waste, and the intermediate ones are never downloaded. So a render
 * is scheduled, not run: a later save for the same document replaces the pending
 * one, and only the last body is drawn.
 */

let root: string;
const OWNER = "alice@example.com";
const PDF_BASE64 = Buffer.from("%PDF-1.4").toString("base64");

function request(version: number, body: string) {
  return { ownerEmail: OWNER, docId: "d1", version, title: "T", body, format: "md" as const };
}

beforeEach(() => {
  vi.useFakeTimers();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "renders-sched-"));
  process.env.DOC_RENDERS_DIR = root;
  process.env.HTML_DOCUMENTS_ENABLED = "1";
  process.env.DOC_RENDER_URL = "http://doc-render:8791";
  process.env.DOC_RENDER_DEBOUNCE_MS = "500";
});

afterEach(async () => {
  vi.useRealTimers();
  delete process.env.DOC_RENDERS_DIR;
  delete process.env.HTML_DOCUMENTS_ENABLED;
  delete process.env.DOC_RENDER_URL;
  delete process.env.DOC_RENDER_DEBOUNCE_MS;
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

function stubSidecar() {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ pdf: PDF_BASE64, html: "<h1>x</h1>" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("scheduleRender", () => {
  it("does not render immediately, so a save returns without waiting on Chromium", () => {
    const fetchMock = stubSidecar();
    scheduleRender(request(1, "# one"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders once the quiet period passes", async () => {
    const fetchMock = stubSidecar();
    scheduleRender(request(1, "# one"));

    await vi.advanceTimersByTimeAsync(600);
    await flushScheduledRenders();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of revisions to one render of the last body", async () => {
    const fetchMock = stubSidecar();
    scheduleRender(request(1, "# one"));
    await vi.advanceTimersByTimeAsync(100);
    scheduleRender(request(2, "# two"));
    await vi.advanceTimersByTimeAsync(100);
    scheduleRender(request(3, "# three"));

    await vi.advanceTimersByTimeAsync(600);
    await flushScheduledRenders();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).markdown).toContain("three");
  });

  it("keeps two different documents on their own timers", async () => {
    const fetchMock = stubSidecar();
    scheduleRender(request(1, "# one"));
    scheduleRender({ ...request(1, "# other"), docId: "d2" });

    await vi.advanceTimersByTimeAsync(600);
    await flushScheduledRenders();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("holds a burst to the concurrency limit rather than opening one context per document", async () => {
    // Real timers here: the mock has to stay in flight across a tick for the
    // overlap to be observable, and a fake-timer sleep inside a promise that
    // `flushScheduledRenders` is awaiting simply deadlocks.
    vi.useRealTimers();
    process.env.DOC_RENDER_CONCURRENCY = "2";
    process.env.DOC_RENDER_DEBOUNCE_MS = "0";

    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return new Response(JSON.stringify({ pdf: PDF_BASE64, html: "<h1>x</h1>" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    // There is ONE render pod and every request opens a fresh browser context,
    // so an unbounded fan-out is how it falls over: this used to be 25 calls at
    // once.
    for (let i = 0; i < 25; i++) scheduleRender({ ...request(1, `# ${i}`), docId: `d${i}` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushScheduledRenders();

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
    delete process.env.DOC_RENDER_CONCURRENCY;
  });

  it("renders every document in a burst, so the bound delays work rather than dropping it", async () => {
    vi.useRealTimers();
    process.env.DOC_RENDER_CONCURRENCY = "2";
    process.env.DOC_RENDER_DEBOUNCE_MS = "0";
    const fetchMock = stubSidecar();

    for (let i = 0; i < 6; i++) scheduleRender({ ...request(1, `# ${i}`), docId: `d${i}` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushScheduledRenders();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    delete process.env.DOC_RENDER_CONCURRENCY;
  });

  it("swallows a failing render rather than surfacing an unhandled rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    scheduleRender(request(1, "# one"));

    await vi.advanceTimersByTimeAsync(600);
    await expect(flushScheduledRenders()).resolves.toBeUndefined();
  });
});
