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

const { GET, PATCH, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertArtifact, getArtifactForOwner, getVersions, latestBody, updateArtifact, markPublished } =
  await import("@/lib/db/artifacts");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patch(id: string, body: unknown): Request {
  return new Request(`http://t/api/artifacts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.ARTIFACTS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertArtifact(db, { id: "a1", title: "Draft", ownerEmail: ALICE.email, sourceThreadId: "t1", body: "# v1" });
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
});

describe("GET /api/artifacts/[id]", () => {
  it("returns the artifact and its version history to the owner", async () => {
    const res = await GET(new Request("http://t/api/artifacts/a1"), ctx("a1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { artifact: { title: string }; versions: unknown[]; body: string };
    expect(data.artifact.title).toBe("Draft");
    expect(data.body).toBe("# v1");
    expect(data.versions).toHaveLength(1);
  });

  it("404 for a non-owner (same as unknown id: no existence oracle)", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const foreign = await GET(new Request("http://t/api/artifacts/a1"), ctx("a1"));
    const unknown = await GET(new Request("http://t/api/artifacts/nope"), ctx("nope"));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.text()).toBe(await unknown.text());
    expect(await GET(new Request("http://t/api/artifacts/nope"), ctx("nope")).then((res) => res.json()))
      .toEqual({ error: { code: "not_found" } });
  });

  it("404 when the flag is off", async () => {
    delete process.env.ARTIFACTS_ENABLED;
    const res = await GET(new Request("http://t/api/artifacts/a1"), ctx("a1"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/artifacts/[id]", () => {
  it("an edited body appends a new version and advances the latest", async () => {
    const res = await PATCH(patch("a1", { body: "# v2" }), ctx("a1"));
    expect(res.status).toBe(200);
    expect(latestBody(db, "a1", ALICE.email)).toBe("# v2");
    expect(getVersions(db, "a1", ALICE.email)).toHaveLength(2);
  });

  it("sets target path/visibility and transitions draft -> ready", async () => {
    const res = await PATCH(
      patch("a1", { targetPath: "docs/notes/x.md", targetVisibility: ["all-hands"], status: "ready" }),
      ctx("a1"),
    );
    expect(res.status).toBe(200);
    const a = getArtifactForOwner(db, "a1", ALICE.email);
    expect(a?.status).toBe("ready");
    expect(a?.targetPath).toBe("docs/notes/x.md");
    expect(a?.targetVisibility).toEqual(["all-hands"]);
  });

  it("refuses ready without a target path (400)", async () => {
    const res = await PATCH(patch("a1", { status: "ready" }), ctx("a1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } });
    expect(getArtifactForOwner(db, "a1", ALICE.email)?.status).toBe("draft");
  });

  it("cannot be set to published via PATCH (that is the publish route)", async () => {
    const res = await PATCH(patch("a1", { status: "published" }), ctx("a1"));
    expect(res.status).toBe(400);
  });

  it("404 for a non-owner, and the edit does not land", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await PATCH(patch("a1", { body: "# hijack" }), ctx("a1"));
    expect(res.status).toBe(404);
    expect(latestBody(db, "a1", ALICE.email)).toBe("# v1");
  });
});

function del(id: string): Request {
  return new Request(`http://t/api/artifacts/${id}`, { method: "DELETE" });
}

describe("DELETE /api/artifacts/[id]", () => {
  it("deletes a draft artifact and its versions for the owner", async () => {
    const res = await DELETE(del("a1"), ctx("a1"));
    expect(res.status).toBe(200);
    expect(getArtifactForOwner(db, "a1", ALICE.email)).toBeNull();
    expect(getVersions(db, "a1", ALICE.email)).toHaveLength(0);
  });

  it("deletes a ready (unpublished) artifact too", async () => {
    updateArtifact(db, "a1", ALICE.email, { targetPath: "docs/notes/x.md", status: "ready" });
    const res = await DELETE(del("a1"), ctx("a1"));
    expect(res.status).toBe(200);
    expect(getArtifactForOwner(db, "a1", ALICE.email)).toBeNull();
  });

  it("refuses to delete a published artifact (409), leaving it intact", async () => {
    markPublished(db, "a1", ALICE.email, "docs/notes/x.md");
    const res = await DELETE(del("a1"), ctx("a1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "wrong_status" } });
    expect(getArtifactForOwner(db, "a1", ALICE.email)).not.toBeNull();
  });

  it("404 for a non-owner, and the artifact survives", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await DELETE(del("a1"), ctx("a1"));
    expect(res.status).toBe(404);
    expect(getArtifactForOwner(db, "a1", ALICE.email)).not.toBeNull();
  });

  it("404 when the flag is off", async () => {
    delete process.env.ARTIFACTS_ENABLED;
    const res = await DELETE(del("a1"), ctx("a1"));
    expect(res.status).toBe(404);
  });

  // Codex review: the in-review freeze lived only in the rendered client, so a
  // second tab still holding the artifact as `ready` could PATCH over it after
  // the merge request opened, or flip it back to `ready` and open a second one.
  describe("submitted artifacts are frozen at the server, not just in the editor", () => {
    it("refuses a PATCH to an in_review artifact", async () => {
      updateArtifact(db, "a1", ALICE.email, { targetPath: "docs/x.md", status: "ready" });
      markPublished(db, "a1", ALICE.email, "docs/x.md", "in_review", { url: "https://gl/mr/1", iid: 1 });

      const res = await PATCH(patch("a1", { body: "sneaky rewrite" }), ctx("a1"));
      expect(res.status).toBe(409);
      expect(getArtifactForOwner(db, "a1", ALICE.email)?.status).toBe("in_review");
      expect(latestBody(db, "a1", ALICE.email)).toBe("# v1");
    });

    it("refuses to reopen an in_review artifact by setting it back to ready", async () => {
      updateArtifact(db, "a1", ALICE.email, { targetPath: "docs/x.md", status: "ready" });
      markPublished(db, "a1", ALICE.email, "docs/x.md", "in_review", { url: "https://gl/mr/1", iid: 1 });

      const res = await PATCH(patch("a1", { status: "ready" }), ctx("a1"));
      expect(res.status).toBe(409);
      expect(getArtifactForOwner(db, "a1", ALICE.email)?.status).toBe("in_review");
    });

    // Deleting the row would leave the merge request and its branch open, so an
    // abandoned proposal could still be merged with nothing left to explain it.
    it("refuses to delete an in_review artifact", async () => {
      updateArtifact(db, "a1", ALICE.email, { targetPath: "docs/x.md", status: "ready" });
      markPublished(db, "a1", ALICE.email, "docs/x.md", "in_review", { url: "https://gl/mr/1", iid: 1 });

      const res = await DELETE(del("a1"), ctx("a1"));
      expect(res.status).toBe(409);
      expect(getArtifactForOwner(db, "a1", ALICE.email)).not.toBeNull();
    });

    it("still lets a draft be deleted", async () => {
      insertArtifact(db, { id: "a2", title: "D", ownerEmail: ALICE.email, body: "b" });
      const res = await DELETE(del("a2"), ctx("a2"));
      expect(res.status).toBe(200);
      expect(getArtifactForOwner(db, "a2", ALICE.email)).toBeNull();
    });
  });
});
