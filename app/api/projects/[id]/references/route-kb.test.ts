import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return {
    ...actual,
    loadGroups: () => ({ "all-hands": ["alice@example.com"], exec: ["drew@example.com"] }),
  };
});

// Stands in for the clearance projection: one root per clearance set, and a
// note above the requester is absent from theirs (spec 19).
const roots = new Map<string, string>();
vi.mock("@/lib/repo", () => ({
  vaultRootFor: (clearance: string[]) => roots.get([...clearance].sort().join(",")) ?? "/nonexistent",
}));

// The KB search backend has its own tests; what matters here is that the route
// scopes it to the caller's root, caps it, and shapes it as kb candidates.
const searchKbMock = vi.fn();
vi.mock("@/lib/kb/search", () => ({ searchKb: (...args: unknown[]) => searchKbMock(...args) }));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createProject } = await import("@/lib/db/projects");
const { listProjectReferences } = await import("@/lib/db/project-references");

const ALICE = { email: "alice@example.com", name: "Alice" };
const DREW = { email: "drew@example.com", name: "Drew" };

let allHands: string;
let execRoot: string;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function attach(body: unknown): Request {
  return new Request("http://t/api/projects/p1/references", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.PROJECTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  searchKbMock.mockReset().mockResolvedValue([]);

  allHands = mkdtempSync(path.join(tmpdir(), "kb-route-all-"));
  execRoot = mkdtempSync(path.join(tmpdir(), "kb-route-exec-"));
  roots.clear();
  roots.set("all-hands", allHands);
  roots.set("all-hands,exec", execRoot);

  const publicNote = "---\ntitle: Trader Score\n---\nBody.";
  write(allHands, "03-product/trader-score.md", publicNote);
  write(execRoot, "03-product/trader-score.md", publicNote);
  write(execRoot, "04-economy/fee-splits.md", "---\ntitle: Fee Splits\nvisibility: [exec]\n---\nNumbers.");

  createProject(db, {
    id: "p1",
    name: "Meridian specs",
    description: null,
    context: null,
    clearance: ["all-hands"],
    ownerEmail: ALICE.email,
    createdAt: "2026-08-01T00:00:00Z",
  });
});

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
  rmSync(allHands, { recursive: true, force: true });
  rmSync(execRoot, { recursive: true, force: true });
});

describe("/api/projects/[id]/references: kb", () => {
  it("attaches a note the caller is cleared for and links it into the KB view", async () => {
    const res = await POST(attach({ kind: "kb", targetId: "03-product/trader-score.md" }), ctx("p1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { references: Array<{ title: string; href: string; kind: string }> };
    expect(body.references).toEqual([
      expect.objectContaining({ kind: "kb", title: "Trader Score", href: "/kb/03-product/trader-score" }),
    ]);
  });

  it("stores the canonical on-disk path, not the spelling the caller sent", async () => {
    await POST(attach({ kind: "kb", targetId: "03-product/trader-score" }), ctx("p1"));
    expect(listProjectReferences(db, "p1")[0].targetId).toBe("03-product/trader-score.md");
  });

  it("answers a restricted note exactly as it answers an invented one", async () => {
    const restricted = await POST(attach({ kind: "kb", targetId: "04-economy/fee-splits.md" }), ctx("p1"));
    const invented = await POST(attach({ kind: "kb", targetId: "04-economy/no-such-note.md" }), ctx("p1"));

    expect(restricted.status).toBe(invented.status);
    expect(await restricted.text()).toBe(await invented.text());
    expect(listProjectReferences(db, "p1")).toHaveLength(0);

    // And the note is real: the same request from someone cleared for it works,
    // which is what makes the pair above a boundary rather than a coincidence.
    requireIdentityMock.mockResolvedValue({ identity: DREW });
    const cleared = await POST(attach({ kind: "kb", targetId: "04-economy/fee-splits.md" }), ctx("p1"));
    expect(cleared.status).toBe(200);
  });

  it("refuses a traversal escape", async () => {
    const res = await POST(attach({ kind: "kb", targetId: "../../etc/passwd" }), ctx("p1"));
    expect(res.status).toBe(404);
    expect(listProjectReferences(db, "p1")).toHaveLength(0);
  });

  it("searches the KB scoped to the caller's own root, and only when asked", async () => {
    const blank = await GET(new Request("http://t/api/projects/p1/references"), ctx("p1"));
    expect((await blank.json()).kbCandidates).toEqual([]);
    expect(searchKbMock).not.toHaveBeenCalled();

    searchKbMock.mockResolvedValue([
      { relPath: "03-product/trader-score.md", title: "Trader Score", route: "03-product/trader-score" },
    ]);
    const res = await GET(new Request("http://t/api/projects/p1/references?q=score"), ctx("p1"));
    expect(searchKbMock).toHaveBeenCalledWith("score", allHands);
    expect((await res.json()).kbCandidates).toEqual([
      { kind: "kb", targetId: "03-product/trader-score.md", title: "Trader Score" },
    ]);
  });

  it("caps how many search hits the picker is offered", async () => {
    searchKbMock.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        relPath: `03-product/note-${i}.md`,
        title: `Note ${i}`,
        route: `03-product/note-${i}`,
      })),
    );
    const res = await GET(new Request("http://t/api/projects/p1/references?q=note"), ctx("p1"));
    expect((await res.json()).kbCandidates).toHaveLength(20);
  });
});
