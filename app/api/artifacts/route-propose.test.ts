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

const readSourceNoteMock = vi.fn();
vi.mock("@/lib/kb/source-note", () => ({
  readSourceNote: (...args: unknown[]) => readSourceNoteMock(...args),
  sourceNoteExists: () => true,
}));

const effectiveCanWriteMock = vi.fn(() => true);
vi.mock("@/lib/authority/write-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/write-gate")>();
  return { ...actual, effectiveCanWrite: () => effectiveCanWriteMock() };
});

// `requireIdentity` carries no clearance, so the route resolves it. Pinned here
// so the assertion below is about WHICH clearance reached the source read.
vi.mock("@/lib/identity/resolve", () => ({ resolveClearanceForEmail: () => ["exec"] }));

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { getArtifactForOwner, listArtifactsForOwner, latestBody } = await import("@/lib/db/artifacts");

const ALICE = { email: "alice@example.com", name: "Alice" };

/** What the source vault holds, links intact. */
const SOURCE = {
  relPath: "exec/comp.md",
  title: "Exec Comp Plan",
  body: "Bands, and a link to [[Board Deck]].",
  visibility: ["exec"],
};

function post(body: unknown): Request {
  return new Request("http://t/api/artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.KB_PROPOSE_EDIT_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  readSourceNoteMock.mockReset().mockReturnValue(SOURCE);
  effectiveCanWriteMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.KB_WRITE_ENABLED;
  delete process.env.KB_PROPOSE_EDIT_ENABLED;
});

describe("POST /api/artifacts (propose an edit)", () => {
  it("seeds the draft from the source note, not from anything the caller sent", async () => {
    const res = await POST(post({ sourcePath: "exec/comp.md" }));

    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(readSourceNoteMock).toHaveBeenCalledWith("exec/comp.md", ["exec"]);
    // The wikilink survives because the body came from the source vault. Seeded
    // from the requester's projection it would already have been stripped.
    expect(latestBody(db, id, ALICE.email)).toBe(SOURCE.body);
    const artifact = getArtifactForOwner(db, id, ALICE.email);
    expect(artifact?.title).toBe("Exec Comp Plan");
    expect(artifact?.targetPath).toBe("exec/comp.md");
    expect(artifact?.targetVisibility).toEqual(["exec"]);
  });

  it("ignores a body smuggled alongside sourcePath rather than preferring it", async () => {
    // Both keys is not a request this API answers: it is the shape an attacker
    // would send to get their own content stored against a note they can read.
    const res = await POST(post({ sourcePath: "exec/comp.md", body: "Attacker prose." }));

    expect(res.status).toBe(400);
    expect(listArtifactsForOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("answers 404 for a note the requester is not cleared for, same as an unknown one", async () => {
    readSourceNoteMock.mockReturnValue(null);

    const res = await POST(post({ sourcePath: "board/secret.md" }));

    expect(res.status).toBe(404);
    expect(listArtifactsForOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("refuses a reader without the write role, since reading never implied writing", async () => {
    effectiveCanWriteMock.mockReturnValue(false);

    const res = await POST(post({ sourcePath: "exec/comp.md" }));

    expect(res.status).toBe(404);
    expect(readSourceNoteMock).not.toHaveBeenCalled();
  });

  it("is dark with the propose flag off, leaving the capture path untouched", async () => {
    delete process.env.KB_PROPOSE_EDIT_ENABLED;

    const proposed = await POST(post({ sourcePath: "exec/comp.md" }));
    expect(proposed.status).toBe(404);

    // Flag-off must not disturb the other way in.
    const captured = await POST(post({ title: "T", body: "Authored by the caller." }));
    expect(captured.status).toBe(201);
  });

  it("lets the proposer retitle without touching anything else", async () => {
    const res = await POST(post({ sourcePath: "exec/comp.md", title: "Exec Comp Plan 2027" }));

    const { id } = (await res.json()) as { id: string };
    const artifact = getArtifactForOwner(db, id, ALICE.email);
    expect(artifact?.title).toBe("Exec Comp Plan 2027");
    expect(artifact?.targetVisibility).toEqual(["exec"]);
    expect(latestBody(db, id, ALICE.email)).toBe(SOURCE.body);
  });
});
