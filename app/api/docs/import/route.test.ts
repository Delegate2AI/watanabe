import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { listSharedByOwner, getSharedDoc, latestBody } = await import("@/lib/db/shared-docs");
const { docx, image, paragraph } = await import("@/test/docx-fixture");

const ALICE = { email: "alice@example.com", name: "Alice" };

function upload(filename: string, bytes: Buffer | string, field = "file"): Request {
  const form = new FormData();
  const body = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  form.append(field, new File([new Uint8Array(body)], filename));
  return new Request("http://t/api/docs/import", { method: "POST", body: form });
}

/** The same request, declaring a length the way a browser does. */
function uploadDeclaring(length: number): Request {
  const request = upload("notes.md", "# notes");
  request.headers.set("content-length", String(length));
  return request;
}

async function codeOf(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code?: string } };
  return body.error?.code;
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_IMPORT_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_IMPORT_ENABLED;
  delete process.env.DOC_IMPORT_MAX_BYTES;
});

describe("POST /api/docs/import", () => {
  it("imports a markdown file as a document owned by the caller", async () => {
    const res = await POST(upload("Q3 plan.md", "# Q3 plan\n\nShip the thing."));
    expect(res.status).toBe(201);
    const { id, title, droppedImages } = (await res.json()) as {
      id: string;
      title: string;
      droppedImages: number;
    };
    expect(title).toBe("Q3 plan");
    expect(droppedImages).toBe(0);
    expect(getSharedDoc(db, id)?.ownerEmail).toBe(ALICE.email);
    expect(latestBody(db, id)).toBe("# Q3 plan\n\nShip the thing.");
  });

  it("imports a docx as markdown and reports its dropped images", async () => {
    const res = await POST(
      upload("brief.docx", docx(paragraph("Quarterly plan", "Heading1"), image("A chart"))),
    );
    expect(res.status).toBe(201);
    const { id, droppedImages } = (await res.json()) as { id: string; droppedImages: number };
    expect(droppedImages).toBe(1);
    expect(latestBody(db, id)).toContain("# Quarterly plan");
  });

  it("is a 404 empty surface when its own flag is off, before it looks at identity", async () => {
    delete process.env.DOC_IMPORT_ENABLED;
    const res = await POST(upload("notes.md", "# notes"));
    expect(res.status).toBe(404);
    // A 401 here would tell an unauthenticated caller the route exists.
    expect(requireIdentityMock).not.toHaveBeenCalled();
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("is a 404 when shared docs are off, whatever the import flag says", async () => {
    delete process.env.SHARED_DOCS_ENABLED;
    const res = await POST(upload("notes.md", "# notes"));
    expect(res.status).toBe(404);
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("401s with no identity, before anything is created", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no id" }, { status: 401 }) });
    const res = await POST(upload("notes.md", "# notes"));
    expect(res.status).toBe(401);
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("names the unsupported type rather than a generic bad request", async () => {
    const res = await POST(upload("sheet.xlsx", "x"));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("unsupported_file");
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("413s a file over the cap", async () => {
    process.env.DOC_IMPORT_MAX_BYTES = "10";
    const res = await POST(upload("big.md", "# ".concat("a".repeat(64))));
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe("file_too_large");
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("400s a docx that will not parse", async () => {
    const res = await POST(upload("corrupt.docx", "not a zip"));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("unreadable_file");
  });

  it("413s a request that declares more than the cap, before reading its body", async () => {
    const res = await POST(uploadDeclaring(50 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe("file_too_large");
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("reads a request that declares a length within the cap", async () => {
    const res = await POST(uploadDeclaring(1024));
    expect(res.status).toBe(201);
  });

  it("413s an oversized body that declares no length at all", async () => {
    process.env.DOC_IMPORT_MAX_BYTES = "10";
    // No content-length here, which is what a chunked upload looks like: the
    // only bound left is counting the bytes as they are read.
    const res = await POST(upload("big.md", "x".repeat(200 * 1024)));
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe("file_too_large");
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("400s when no file field is present", async () => {
    const res = await POST(upload("notes.md", "# notes", "attachment"));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
  });

  it("creates the document with no shares, private to its owner", async () => {
    const res = await POST(upload("notes.md", "# notes"));
    const { id } = (await res.json()) as { id: string };
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM doc_shares WHERE doc_id = ?`).get(id) as { n: number };
    expect(rows.n).toBe(0);
  });
});
