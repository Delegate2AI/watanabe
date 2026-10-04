import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Downloading a document as PDF, HTML or Markdown
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Owner-scoped like every other chat-doc route: a foreign id, an unknown id and
 * the flag being off all answer with the same 404, so the route is not an
 * existence oracle for documents belonging to other people.
 */

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createDoc } = await import("@/lib/db/chat-docs");
const { recordThread } = await import("@/lib/db/threads");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const THREAD = "thread-1";

let root: string;

const req = () => new Request("http://localhost/api/chat-docs/d1/export/md");
const p = (id: string, kind: string) => ({ params: Promise.resolve({ id, kind }) });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "renders-route-"));
  process.env.DOC_RENDERS_DIR = root;
  process.env.CANVAS_ENABLED = "1";
  process.env.HTML_DOCUMENTS_ENABLED = "1";
  delete process.env.DOC_RENDER_URL;
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  recordThread(db, THREAD, ALICE.email, "chat");
  createDoc(db, {
    id: "d1",
    threadId: THREAD,
    ownerEmail: ALICE.email,
    title: "Risk memo",
    body: "# Risk memo\n\ntext",
  });
});

afterEach(() => {
  delete process.env.DOC_RENDERS_DIR;
  delete process.env.CANVAS_ENABLED;
  delete process.env.HTML_DOCUMENTS_ENABLED;
  delete process.env.DOC_RENDER_URL;
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/chat-docs/[id]/export/[kind]", () => {
  it("returns the markdown, rendering it on demand when it was never stored", async () => {
    const response = await GET(req(), p("d1", "md"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("# Risk memo");
  });

  it("names the file after the document so it is findable in a Downloads folder", async () => {
    const response = await GET(req(), p("d1", "md"));
    expect(response.headers.get("content-disposition")).toContain("Risk-memo.md");
  });

  it("sends a markdown content type", async () => {
    const response = await GET(req(), p("d1", "md"));
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });

  it("404s an unknown document", async () => {
    expect((await GET(req(), p("nope", "md"))).status).toBe(404);
  });

  it("404s a document owned by somebody else, identically to an unknown one", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await GET(req(), p("d1", "md"))).status).toBe(404);
  });

  it("404s when the canvas flag is off, keeping the route dark", async () => {
    process.env.CANVAS_ENABLED = "0";
    expect((await GET(req(), p("d1", "md"))).status).toBe(404);
  });

  it("serves the version asked for, not always the latest", async () => {
    const { addVersion } = await import("@/lib/db/chat-docs");
    addVersion(db, "d1", ALICE.email, "# Risk memo v2\n\nrewritten");

    const older = new Request("http://localhost/api/chat-docs/d1/export/md?v=1");
    // Reading an older version and pressing Download used to hand over the
    // newest one, so the file and the screen disagreed with no indication.
    expect(await (await GET(older, p("d1", "md"))).text()).toContain("text");

    const latest = new Request("http://localhost/api/chat-docs/d1/export/md");
    expect(await (await GET(latest, p("d1", "md"))).text()).toContain("rewritten");
  });

  it("404s an unknown version, so this cannot count a document's versions", async () => {
    const request = new Request("http://localhost/api/chat-docs/d1/export/md?v=99");
    expect((await GET(request, p("d1", "md"))).status).toBe(404);
  });

  it("ignores a version that is not a positive number and serves the latest", async () => {
    const request = new Request("http://localhost/api/chat-docs/d1/export/md?v=-3");
    expect((await GET(request, p("d1", "md"))).status).toBe(200);
  });

  it("refuses a format it does not produce", async () => {
    expect((await GET(req(), p("d1", "docx"))).status).toBe(400);
  });

  it("tells the caller a pdf is not available rather than serving an empty file", async () => {
    // No sidecar configured, so nothing can have produced a PDF.
    const response = await GET(req(), p("d1", "pdf"));
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("serves a pdf once one has been rendered", async () => {
    process.env.DOC_RENDER_URL = "http://doc-render:8791";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ pdf: Buffer.from("%PDF-1.4 body").toString("base64"), html: "<h1>x</h1>" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const response = await GET(req(), p("d1", "pdf"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
