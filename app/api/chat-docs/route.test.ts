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

const listRoute = await import("./route");
const singleRoute = await import("./[id]/route");
const promoteRoute = await import("./[id]/promote/route");
const updateRoute = await import("./[id]/update-target/route");
const { openDb } = await import("@/lib/db/client");
const { createDoc, addVersion, getPromotions } = await import("@/lib/db/chat-docs");
const { recordThread } = await import("@/lib/db/threads");
const { getVersions: artifactVersions } = await import("@/lib/db/artifacts");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function req(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  delete process.env.CANVAS_ENABLED;
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
});
afterEach(() => {
  delete process.env.CANVAS_ENABLED;
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("GET /api/chat-docs (list by thread)", () => {
  it("is a 404 when the canvas flag is off", async () => {
    recordThread(db, "t1", ALICE.email, "chat");
    const res = await listRoute.GET(req("http://t/api/chat-docs?thread=t1"));
    expect(res.status).toBe(404);
  });

  it("lists the owner's docs for a thread they own", async () => {
    process.env.CANVAS_ENABLED = "1";
    recordThread(db, "t1", ALICE.email, "chat");
    createDoc(db, { id: "d1", threadId: "t1", ownerEmail: ALICE.email, title: "Memo", body: "b" });
    const res = await listRoute.GET(req("http://t/api/chat-docs?thread=t1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { docs: Array<{ id: string }> };
    expect(body.docs.map((d) => d.id)).toEqual(["d1"]);
  });

  it("404s a thread the caller does not own (same as unknown, no oracle)", async () => {
    process.env.CANVAS_ENABLED = "1";
    recordThread(db, "t1", BOB.email, "chat");
    createDoc(db, { id: "d1", threadId: "t1", ownerEmail: BOB.email, title: "Memo", body: "b" });
    const owned = await listRoute.GET(req("http://t/api/chat-docs?thread=t1"));
    const unknown = await listRoute.GET(req("http://t/api/chat-docs?thread=nope"));
    expect(owned.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});

describe("GET /api/chat-docs/[id] (single)", () => {
  it("returns the doc, versions, and promotion flags for the owner", async () => {
    process.env.CANVAS_ENABLED = "1";
    recordThread(db, "t1", ALICE.email, "chat");
    createDoc(db, { id: "d1", threadId: "t1", ownerEmail: ALICE.email, title: "Memo", body: "v1" });
    const res = await singleRoute.GET(req("http://t/api/chat-docs/d1"), p("d1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { doc: { title: string }; versions: unknown[]; flags: unknown };
    expect(body.doc.title).toBe("Memo");
    expect(body.versions).toHaveLength(1);
  });

  it("404s a foreign id the same as an unknown one", async () => {
    process.env.CANVAS_ENABLED = "1";
    recordThread(db, "t1", BOB.email, "chat");
    createDoc(db, { id: "d1", threadId: "t1", ownerEmail: BOB.email, title: "Memo", body: "v1" });
    const foreign = await singleRoute.GET(req("http://t/api/chat-docs/d1"), p("d1"));
    const unknown = await singleRoute.GET(req("http://t/api/chat-docs/nope"), p("nope"));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
  });

  it("404s when owner_email matches but the SOURCE THREAD is foreign (thread is the authority)", async () => {
    process.env.CANVAS_ENABLED = "1";
    // The source thread t1 is owned by BOB; inject a divergent chat_documents row
    // whose denormalized owner_email is ALICE. ALICE must still get a 404.
    recordThread(db, "t1", BOB.email, "chat");
    db.prepare(
      `INSERT INTO chat_documents (id, thread_id, owner_email, title, current_version, created_at, updated_at)
       VALUES ('div', 't1', @alice, 'Divergent', 1, '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z')`,
    ).run({ alice: ALICE.email });
    db.prepare(
      `INSERT INTO chat_document_versions (doc_id, version, body, created_at) VALUES ('div', 1, 'secret', '2026-07-11T00:00:00Z')`,
    ).run();
    const res = await singleRoute.GET(req("http://t/api/chat-docs/div"), p("div"));
    const unknown = await singleRoute.GET(req("http://t/api/chat-docs/nope"), p("nope"));
    expect(res.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});

describe("POST promote + update-target", () => {
  beforeEach(() => {
    process.env.CANVAS_ENABLED = "1";
    process.env.ARTIFACTS_ENABLED = "1";
    recordThread(db, "t1", ALICE.email, "chat");
    createDoc(db, { id: "d1", threadId: "t1", ownerEmail: ALICE.email, title: "Memo", body: "v1" });
  });

  it("promotes to an artifact seeded from the current version", async () => {
    const res = await promoteRoute.POST(req("http://t/api/chat-docs/d1/promote", { target: "artifact" }), p("d1"));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { targetId: string };
    expect(artifactVersions(db, body.targetId, ALICE.email)[0].body).toBe("v1");
    expect(getPromotions(db, "d1", ALICE.email)).toHaveLength(1);
  });

  it("hides a target whose flag is off (400)", async () => {
    const res = await promoteRoute.POST(req("http://t/api/chat-docs/d1/promote", { target: "shared_doc" }), p("d1"));
    expect(res.status).toBe(400);
  });

  it("update warns on divergence (409) then applies on confirm", async () => {
    const promoted = await promoteRoute.POST(req("http://t/api/chat-docs/d1/promote", { target: "artifact" }), p("d1"));
    const { targetId } = (await promoted.json()) as { targetId: string };
    // Owner edits the artifact independently, and the chat doc advances.
    const { addVersion: artAdd } = await import("@/lib/db/artifacts");
    artAdd(db, targetId, ALICE.email, "owner edit");
    addVersion(db, "d1", ALICE.email, "chat v2");

    const warned = await updateRoute.POST(req("http://t/api/chat-docs/d1/update-target", { target: "artifact" }), p("d1"));
    expect(warned.status).toBe(409);
    const warnBody = (await warned.json()) as { error: string };
    expect(warnBody.error).toEqual({ code: "conflict", detail: "diverged" });

    const confirmed = await updateRoute.POST(
      req("http://t/api/chat-docs/d1/update-target", { target: "artifact", confirm: true }),
      p("d1"),
    );
    expect(confirmed.status).toBe(200);
    expect(artifactVersions(db, targetId, ALICE.email).map((v) => v.body)).toEqual(["v1", "owner edit", "chat v2"]);
  });

  it("404s promote for a foreign doc (no oracle)", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await promoteRoute.POST(req("http://t/api/chat-docs/d1/promote", { target: "artifact" }), p("d1"));
    expect(res.status).toBe(404);
  });

  it("404s promote AND update when owner_email matches but the source thread is foreign", async () => {
    // A divergent doc: denormalized owner ALICE, but its source thread t2 is BOB's.
    recordThread(db, "t2", BOB.email, "chat");
    db.prepare(
      `INSERT INTO chat_documents (id, thread_id, owner_email, title, current_version, created_at, updated_at)
       VALUES ('div', 't2', @alice, 'Divergent', 1, '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z')`,
    ).run({ alice: ALICE.email });
    db.prepare(
      `INSERT INTO chat_document_versions (doc_id, version, body, created_at) VALUES ('div', 1, 'x', '2026-07-11T00:00:00Z')`,
    ).run();
    // ALICE (the denormalized owner) must still be denied on promote and update.
    const promoteRes = await promoteRoute.POST(req("http://t/api/chat-docs/div/promote", { target: "artifact" }), p("div"));
    const updateRes = await updateRoute.POST(
      req("http://t/api/chat-docs/div/update-target", { target: "artifact" }),
      p("div"),
    );
    const unknownPromote = await promoteRoute.POST(req("http://t/api/chat-docs/nope/promote", { target: "artifact" }), p("nope"));
    expect(promoteRes.status).toBe(404);
    expect(updateRes.status).toBe(404);
    expect(unknownPromote.status).toBe(404);
  });
});
