import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => ({ "all-hands": ["alice@example.com", "bob@example.com"] }) };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createProject } = await import("@/lib/db/projects");
const { insertSharedDoc, upsertShare, removeShare } = await import("@/lib/db/shared-docs");
const { listProjectReferences } = await import("@/lib/db/project-references");

const ALICE = { email: "alice@example.com", name: "Alice" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function send(method: string, body: unknown): Request {
  return new Request("http://t/api/projects/p1/references", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.PROJECTS_ENABLED = "1";
  process.env.SHARED_DOCS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  createProject(db, {
    id: "p1",
    name: "Launch",
    description: null,
    context: null,
    clearance: ["all-hands"],
    ownerEmail: ALICE.email,
    createdAt: "2026-07-01T00:00:00Z",
  });
  insertSharedDoc(db, { id: "d1", title: "Launch checklist", ownerEmail: "bob@example.com", body: "one" });
  upsertShare(db, "d1", ALICE.email, "view");
});

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("/api/projects/[id]/references", () => {
  it("attaches a doc the caller can reach and lists it back", async () => {
    const attached = await POST(send("POST", { kind: "shared_doc", targetId: "d1" }), ctx("p1"));
    expect(attached.status).toBe(200);

    const res = await GET(new Request("http://t/api/projects/p1/references"), ctx("p1"));
    const body = (await res.json()) as { references: Array<{ title: string; href: string }> };
    expect(body.references).toHaveLength(1);
    expect(body.references[0]).toMatchObject({ title: "Launch checklist", href: "/docs/d1" });
  });

  it("404s an attach of a doc the caller cannot reach", async () => {
    insertSharedDoc(db, { id: "d2", title: "Private", ownerEmail: "bob@example.com", body: "x" });
    const res = await POST(send("POST", { kind: "shared_doc", targetId: "d2" }), ctx("p1"));
    expect(res.status).toBe(404);
    expect(listProjectReferences(db, "p1")).toHaveLength(0);
  });

  it("stops listing a reference once access to the target is revoked, without deleting it", async () => {
    await POST(send("POST", { kind: "shared_doc", targetId: "d1" }), ctx("p1"));
    removeShare(db, "d1", ALICE.email);

    const res = await GET(new Request("http://t/api/projects/p1/references"), ctx("p1"));
    const body = (await res.json()) as { references: unknown[] };
    expect(body.references).toHaveLength(0);
    expect(listProjectReferences(db, "p1")).toHaveLength(1);
  });

  it("detaches a reference without touching the target", async () => {
    await POST(send("POST", { kind: "shared_doc", targetId: "d1" }), ctx("p1"));
    const [ref] = listProjectReferences(db, "p1");
    const res = await DELETE(send("DELETE", { referenceId: ref.id }), ctx("p1"));
    expect(res.status).toBe(200);
    expect(listProjectReferences(db, "p1")).toHaveLength(0);
    expect(db.prepare("SELECT id FROM shared_docs WHERE id = 'd1'").get()).toBeTruthy();
  });

  it("404s every method with the projects flag off", async () => {
    delete process.env.PROJECTS_ENABLED;
    const list = await GET(new Request("http://t/api/projects/p1/references"), ctx("p1"));
    const attach = await POST(send("POST", { kind: "shared_doc", targetId: "d1" }), ctx("p1"));
    expect(list.status).toBe(404);
    expect(attach.status).toBe(404);
  });
});
